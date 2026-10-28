import ExcelJS from "exceljs";
import mammoth from "mammoth";

export type ExtractedImage = {
  buffer: Buffer;
  mime: string;
  ext: string;
  sheetName: string | null;
  anchorRow: number | null; // 1-based spreadsheet row the image sits on
  anchorCol: number | null;
};

export type SheetText = {
  name: string;
  text: string;
  rowCount: number;
  imageCount: number;
};

export type ReadResult = {
  sourceType: "xlsx" | "csv" | "pdf" | "docx" | "txt" | "image";
  sheets: SheetText[];
  images: ExtractedImage[];
};

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };
const MIN_IMAGE_BYTES = 1500; // skip 1px spacers / bullets

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

async function readXlsx(buffer: Buffer): Promise<{ sheets: SheetText[]; images: ExtractedImage[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheets: SheetText[] = [];
  const images: ExtractedImage[] = [];

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

    let imageCount = 0;
    try {
      for (const img of sheet.getImages()) {
        const media = wb.getImage(Number(img.imageId));
        if (!media?.buffer) continue;
        const buf = Buffer.from(media.buffer as unknown as ArrayBuffer);
        if (buf.length < MIN_IMAGE_BYTES) continue;
        const ext = (media.extension || "png").toLowerCase();
        const tl = img.range.tl as { nativeRow?: number; row?: number; nativeCol?: number; col?: number };
        images.push({
          buffer: buf,
          mime: MIME_BY_EXT[ext] ?? "image/png",
          ext,
          sheetName: sheet.name,
          anchorRow: (tl.nativeRow ?? Math.floor(tl.row ?? 0)) + 1,
          anchorCol: (tl.nativeCol ?? Math.floor(tl.col ?? 0)) + 1,
        });
        imageCount++;
      }
    } catch {
      /* some workbooks carry malformed drawing parts — text is still usable */
    }

    if (lines.length > 0 || imageCount > 0) {
      sheets.push({ name: sheet.name, text: lines.join("\n"), rowCount: lines.length, imageCount });
    }
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
export function chunkSheet(sheet: SheetText): { name: string; text: string; context: string; rowCount: number; imageCount: number }[] {
  if (sheet.text.length <= CHUNK_CHARS) return [{ name: sheet.name, text: sheet.text, context: "", rowCount: sheet.rowCount, imageCount: sheet.imageCount }];
  const lines = sheet.text.split("\n");
  let context = "";
  const isDataRow = (l: string) => /\|\s*[A-Z]+:-?\d[\d.]*\s*(\||$)/.test(l.replace(/^R\d+ \|/, "|").replace(/^L\d+ \|/, "|")) && !/^R\d+ \| A:Sr/i.test(l);
  for (const l of lines.slice(0, 8)) {
    if (isDataRow(l) || context.length + l.length > CONTEXT_ROWS_CHARS) break;
    context += l + "\n";
  }
  const chunks: { name: string; text: string; context: string; rowCount: number; imageCount: number }[] = [];
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    chunks.push({ name: sheet.name, text: buf.join("\n"), context: chunks.length === 0 ? "" : context.trim(), rowCount: buf.length, imageCount: chunks.length === 0 ? sheet.imageCount : 0 });
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
      const prefix = sourceType === "csv" ? "R" : "L";
      const rendered = lines.map((l, i) => `${prefix}${i + 1} | ${l.trim()}`).join("\n");
      return { sourceType, sheets: [{ name: "Document", text: rendered, rowCount: lines.length, imageCount: 0 }], images: [] };
    }
  }
}
