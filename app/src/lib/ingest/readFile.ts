import { parseBoqSheet, type ParsedBoq, type SheetPreview } from "./boqParser";
import { readCachedValues, type Cached } from "./xlsxCache";
import { evaluateCellFormula, UnsupportedFormula } from "./cellFormula";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { extractXlsxImages, stripDrawings } from "./xlsxImages";

export type ExtractedImage = {
  buffer: Buffer;
  mime: string;
  ext: string;
  sheetName: string | null;
  anchorRow: number | null; // 1-based spreadsheet row the image sits on
  anchorCol: number | null;
};

/** What the workbook itself says about its formulas and errors, checked without any AI. Lists are capped. */
export type SheetAudit = {
  formulaCount: number;
  /** cached result disagrees with our own recalculation of the same formula */
  mismatches: { a: string; f: string; cached: number; recalc: number }[];
  /** formulas we cannot recompute (other functions, other sheets, external links) — the cached value is kept but unverified */
  unverified: { a: string; f: string; why: string }[];
  /** formulas saved without any cached result */
  uncached: string[];
  errors: { a: string; text: string }[];
  /** layout the deterministic reader found (columns, sections, counts, printed vs computed totals) */
  parse?: SheetPreview;
};

export type SheetText = {
  name: string;
  text: string;
  rowCount: number;
  imageCount: number;
  audit?: SheetAudit;
  /** set when the sheet has a classic BOQ layout and was read without AI */
  parsed?: ParsedBoq;
};

export type ReadResult = {
  sourceType: "xlsx" | "csv" | "pdf" | "docx" | "txt" | "image";
  sheets: SheetText[];
  images: ExtractedImage[];
};

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };
const MIN_IMAGE_BYTES = 1500; // skip 1px spacers / bullets

/** Minimal RFC4180 line parser (quotes, escaped quotes, commas inside quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t" || c === ";") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const colLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

/** Rows that look like priced/quantified items: a number plus at least two text-ish cells. Used as a sanity floor. */
export function expectedItemRows(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    const cells = line.replace(/^[RL]\d+ \| /, "").split(" | ").map((c) => c.replace(/^[A-Z]{1,2}:/, "").trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const numeric = cells.filter((c) => /^-?[\d,]+(\.\d+)?$/.test(c)).length;
    const texty = cells.filter((c) => /[A-Za-z]{3,}/.test(c)).length;
    if (numeric >= 1 && texty >= 2) n++;
  }
  return n;
}

export function detectType(filename: string, mimeType: string): ReadResult["sourceType"] {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (["xlsx", "xlsm"].includes(ext) || mimeType.includes("spreadsheetml")) return "xlsx";
  if (ext === "csv" || mimeType === "text/csv") return "csv";
  if (ext === "pdf" || mimeType.includes("pdf")) return "pdf";
  if (ext === "docx" || mimeType.includes("wordprocessingml")) return "docx";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext) || mimeType.startsWith("image/")) return "image";
  return "txt";
}

function cellToText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Shared-formula children and uncached formulas carry no value at all: treat as blank so the
  // calculation engine can fill them in and show that it did.
  if (typeof v === "object" && "sharedFormula" in (v as object) && !("result" in (v as object))) return "";
  if (typeof v === "object" && "result" in (v as object)) return cellToText((v as { result: ExcelJS.CellValue }).result);
  if (typeof v === "object" && "formula" in (v as object)) return "";
  if (typeof v === "object" && "error" in (v as object)) return `#ERROR(${(v as { error: string }).error})`;
  if (typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: string }).text);
  if (typeof v === "object") return "";
  if (typeof v === "number") return String(Math.round(v * 10000) / 10000);
  return String(v);
}


const AUDIT_CAP = 40;
const numOf = (v: ExcelJS.CellValue): number | null => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in (v as object)) return numOf((v as { result: ExcelJS.CellValue }).result);
  return null;
};

/** Re-checks every formula in a sheet against its own cached result, using only the sheet's other cell values. */
function auditSheet(sheet: ExcelJS.Worksheet, cache?: Map<string, Cached>): SheetAudit {
  const audit: SheetAudit = { formulaCount: 0, mismatches: [], unverified: [], uncached: [], errors: [] };
  const get = (address: string) => numOf(sheet.getCell(address).value);
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value as unknown;
      if (v && typeof v === "object" && "error" in (v as object)) {
        if (audit.errors.length < AUDIT_CAP) audit.errors.push({ a: cell.address, text: String((v as { error: string }).error) });
        return;
      }
      const isFormula = !!v && typeof v === "object" && ("formula" in (v as object) || "sharedFormula" in (v as object));
      if (!isFormula) return;
      audit.formulaCount++;
      let formula = "";
      try { formula = String(cell.formula ?? ""); } catch { formula = String((v as { formula?: string }).formula ?? ""); }
      let result = (v as { result?: unknown }).result;
      if (result === undefined || result === null) {
        const c = cache?.get(cell.address);
        if (c) result = c.e !== undefined ? { error: c.e } : c.n !== undefined ? c.n : c.s;
      }
      if (result && typeof result === "object" && "error" in (result as object)) {
        if (audit.errors.length < AUDIT_CAP) audit.errors.push({ a: cell.address, text: String((result as { error: string }).error) });
        return;
      }
      if (result === undefined || result === null) {
        if (audit.uncached.length < AUDIT_CAP) audit.uncached.push(cell.address);
        return;
      }
      const cached = typeof result === "number" ? result : null;
      const fn = /([A-Z][A-Z0-9.]*)\(/i.exec(formula.replace(/SUM\(/gi, ""))?.[1];
      const why = /\[\d+\]|\[.*\]/.test(formula) ? "refers to another workbook" : formula.includes("!") ? "refers to another sheet" : fn ? `uses ${fn.toUpperCase()}()` : null;
      if (why) { if (audit.unverified.length < AUDIT_CAP) audit.unverified.push({ a: cell.address, f: formula.slice(0, 80), why }); return; }
      if (cached === null || !formula) return;
      try {
        const recalc = Math.round(evaluateCellFormula(formula, get) * 1e6) / 1e6;
        if (Math.abs(recalc - cached) >= 0.01 && audit.mismatches.length < AUDIT_CAP) audit.mismatches.push({ a: cell.address, f: formula.slice(0, 80), cached, recalc });
      } catch (e) {
        if (e instanceof UnsupportedFormula && audit.unverified.length < AUDIT_CAP) audit.unverified.push({ a: cell.address, f: formula.slice(0, 80), why: e.message });
      }
    });
  });
  return audit;
}

function safeParse(sheet: ExcelJS.Worksheet, cache?: Map<string, Cached>): ParsedBoq | null {
  try { return parseBoqSheet(sheet, cache); } catch { return null; }
}

async function readXlsx(buffer: Buffer): Promise<{ sheets: SheetText[]; images: ExtractedImage[] }> {
  const images = await extractXlsxImages(buffer).catch(() => [] as ExtractedImage[]);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    // some drawing layouts crash the cell parser; the cells themselves are still readable without them
    await wb.xlsx.load((await stripDrawings(buffer)) as unknown as ExcelJS.Buffer);
  }
  const cached = await readCachedValues(buffer);
  const sheets: SheetText[] = [];
  wb.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const parts: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        let text = cellToText(cell.value).trim().replace(/\s+/g, " ");
        if (!text) return;
        if (text.length > 1500) text = text.slice(0, 1500) + `…[+${text.length - 1500} chars]`;
        parts.push(`${cell.address.replace(/\d+$/, "")}:${text}`);
      });
      if (parts.length) lines.push(`R${rowNumber} | ${parts.join(" | ")}`);
    });
    const imageCount = images.filter((i) => i.sheetName === sheet.name).length;
    if (lines.length > 0 || imageCount > 0) sheets.push({ name: sheet.name, text: lines.join("\n"), rowCount: lines.length, imageCount, audit: auditSheet(sheet, cached.get(sheet.name)), parsed: safeParse(sheet, cached.get(sheet.name)) ?? undefined });
  });
  return { sheets, images };
}

async function readDocx(buffer: Buffer): Promise<{ text: string; images: ExtractedImage[] }> {
  const images: ExtractedImage[] = [];
  await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const b64 = await image.read("base64");
        const buf = Buffer.from(b64, "base64");
        if (buf.length >= MIN_IMAGE_BYTES) {
          const ext = (image.contentType.split("/")[1] || "png").replace("jpeg", "jpg");
          images.push({ buffer: buf, mime: image.contentType, ext, sheetName: null, anchorRow: null, anchorCol: null });
        }
        return { src: "" };
      }),
    }
  );
  const raw = await mammoth.extractRawText({ buffer });
  return { text: raw.value, images };
}

async function readPdf(buffer: Buffer): Promise<{ text: string; images: ExtractedImage[] }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const text = (await parser.getText()).text;
  const images: ExtractedImage[] = [];
  try {
    const res = await parser.getImage({ imageThreshold: 100, imageDataUrl: true, imageBuffer: false });
    for (const page of res.pages) {
      for (const im of page.images) {
        const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(im.dataUrl ?? "");
        if (!m) continue;
        const buf = Buffer.from(m[2], "base64");
        if (buf.length < MIN_IMAGE_BYTES) continue;
        images.push({ buffer: buf, mime: m[1], ext: m[1].split("/")[1].replace("jpeg", "jpg"), sheetName: `Page ${page.pageNumber}`, anchorRow: null, anchorCol: null });
      }
    }
  } catch {
    /* image extraction is best-effort */
  }
  await parser.destroy();
  return { text, images };
}

/** Characters per LLM call. Groq's free tier caps a request at ~8k tokens in+out, so stay well below. */
export const CHUNK_CHARS = Number(process.env.GROQ_TPM || 8000) >= 20000 ? 14000 : 3600;
const CONTEXT_ROWS_CHARS = 900;

/** Splits one sheet into row-aligned chunks; later chunks get the sheet's header rows as context. */
export function chunkSheet(sheet: SheetText): { name: string; text: string; context: string; rowCount: number; imageCount: number; audit?: SheetAudit }[] {
  if (sheet.text.length <= CHUNK_CHARS) return [{ name: sheet.name, text: sheet.text, context: "", rowCount: sheet.rowCount, imageCount: sheet.imageCount, audit: sheet.audit }];
  const lines = sheet.text.split("\n");
  let context = "";
  const isDataRow = (l: string) => /\|\s*[A-Z]+:-?\d[\d.]*\s*(\||$)/.test(l.replace(/^R\d+ \|/, "|").replace(/^L\d+ \|/, "|")) && !/^R\d+ \| A:Sr/i.test(l);
  for (const l of lines.slice(0, 8)) {
    if (isDataRow(l) || context.length + l.length > CONTEXT_ROWS_CHARS) break;
    context += l + "\n";
  }
  const chunks: { name: string; text: string; context: string; rowCount: number; imageCount: number; audit?: SheetAudit }[] = [];
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    chunks.push({ name: sheet.name, text: buf.join("\n"), context: chunks.length === 0 ? "" : context.trim(), rowCount: buf.length, imageCount: chunks.length === 0 ? sheet.imageCount : 0, audit: chunks.length === 0 ? sheet.audit : undefined });
    buf = [];
    size = 0;
  };
  for (const line of lines) {
    if (size + line.length > CHUNK_CHARS) flush();
    buf.push(line);
    size += line.length + 1;
  }
  flush();
  return chunks.map((c, i) => ({ ...c, name: chunks.length > 1 ? `${c.name} (part ${i + 1}/${chunks.length})` : c.name }));
}

export async function readFile(buffer: Buffer, filename: string, mimeType: string): Promise<ReadResult> {
  const sourceType = detectType(filename, mimeType);
  switch (sourceType) {
    case "xlsx": {
      const { sheets, images } = await readXlsx(buffer);
      return { sourceType, sheets, images };
    }
    case "docx": {
      const { text, images } = await readDocx(buffer);
      const lines = text.split("\n").filter((l) => l.trim());
      return { sourceType, sheets: [{ name: "Document", text: lines.map((l, i) => `L${i + 1} | ${l.trim()}`).join("\n"), rowCount: lines.length, imageCount: images.length }], images };
    }
    case "pdf": {
      const { text, images } = await readPdf(buffer);
      const lines = text.split("\n").filter((l) => l.trim());
      return { sourceType, sheets: [{ name: "Document", text: lines.map((l, i) => `L${i + 1} | ${l.trim()}`).join("\n"), rowCount: lines.length, imageCount: images.length }], images };
    }
    case "image": {
      const ext = (filename.split(".").pop() || "png").toLowerCase();
      return { sourceType, sheets: [], images: [{ buffer, mime: MIME_BY_EXT[ext] ?? mimeType ?? "image/png", ext, sheetName: null, anchorRow: null, anchorCol: null }] };
    }
    default: {
      const text = buffer.toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      const rendered =
        sourceType === "csv"
          ? text.split(/\r?\n/).map((raw, i) => {
              const cells = parseCsvLine(raw).map((v, ci) => [colLetter(ci), v.trim()] as const).filter(([, v]) => v);
              return cells.length ? `R${i + 1} | ${cells.map(([c, v]) => `${c}:${v}`).join(" | ")}` : "";
            }).filter(Boolean).join("\n")
          : lines.map((l, i) => `L${i + 1} | ${l.trim()}`).join("\n");
      return { sourceType, sheets: [{ name: "Document", text: rendered, rowCount: lines.length, imageCount: 0 }], images: [] };
    }
  }
}
