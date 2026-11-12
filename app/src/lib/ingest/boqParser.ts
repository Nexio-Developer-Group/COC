import type ExcelJS from "exceljs";
import type { ExtractedItem, ExtractedSection } from "@/lib/extract/schema";

/**
 * Deterministic reader for "classic" BOQ sheets: a header row (Sr.No / Item / Description / Unit / Quantity / Rate / Amount)
 * followed by section rows, item rows, note rows and total rows. No AI is involved, so numbers come straight from the cells.
 * A sheet that doesn't look like this returns null and goes through the AI reader instead.
 */
export type ColumnRole = "sr" | "name" | "desc" | "dim" | "unit" | "qty" | "rate" | "amount" | "remarks";

export type SheetPreview = {
  headerRow: number;
  /** role -> column letter and the header text found there */
  columns: Partial<Record<ColumnRole, { col: string; header: string }>>;
  sections: { name: string; row: number; items: number; printedTotal: number | null; itemTotal: number }[];
  counts: { items: number; priced: number; unpriced: number; notes: number; subtotals: number; continuation: number; skipped: number };
  skippedRows: number[];
  /** the sheet's own "Total Amount…" line, and what the items add up to */
  printedGrandTotal: { row: number; amount: number | null; label: string } | null;
  itemsTotal: number;
  taxNote: "excluded" | "included" | null;
};

export type ParsedBoq = { sections: ExtractedSection[]; preview: SheetPreview; projectName: string | null; sheetTitle: string | null };

type Cells = Record<string, { text: string; num: number | null }>;

const letter = (n: number) => { let s = ""; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

function valueText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in (v as object)) return valueText((v as { result: ExcelJS.CellValue }).result);
    if ("richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in (v as object)) return String((v as { text: string }).text);
    return "";
  }
  return String(v);
}
function valueNum(v: ExcelJS.CellValue, text: string): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in (v as object) && typeof (v as { result: unknown }).result === "number") return (v as { result: number }).result;
  const c = text.replace(/[,₹\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : null;
}

const HEADER_ROLES: [ColumnRole, RegExp][] = [
  ["sr", /^(sr\.?\s*no\.?|s\.?\s*no\.?|sl\.?\s*no\.?|item\s*no\.?|sr)$/i],
  ["desc", /description|particulars?\b/i],
  ["dim", /dimension|size/i],
  ["unit", /^unit\b/i],
  ["qty", /^(qty|quantity)\b/i],
  ["rate", /\b(rate|per unit|unit rate|price)\b/i],
  ["amount", /^(amount|total|value)\b/i],
  ["remarks", /remark|note/i],
  ["name", /item|name|work|code/i],
];

function trade(section: string): ExtractedSection["trade"] {
  const s = section.toLowerCase();
  if (/furniture/.test(s)) return "furniture";
  if (/door|carpent|joinery|wood(en)? work|panel/.test(s)) return "carpentry";
  if (/wooden floor|floor|tile|marble|granite|stone/.test(s)) return "flooring";
  if (/pop|gypsum|ceiling/.test(s)) return "ceiling";
  if (/paint|polish|putty/.test(s)) return "painting";
  if (/civil|plaster|masonry|brick/.test(s)) return "civil";
  if (/electri|light|fixture/.test(s)) return "electrical";
  if (/plumb|sanitary/.test(s)) return "plumbing";
  if (/hvac|air.?con|duct/.test(s)) return "hvac";
  if (/fire/.test(s)) return "fire";
  if (/glass|glaz/.test(s)) return "glazing";
  if (/steel|metal|alumin|ss\b/.test(s)) return "metalwork";
  if (/misc|other/.test(s)) return "other";
  return "general";
}

const SR = /^\d+(\.\d+)*[a-z]?\.?$/i;

export function parseBoqSheet(sheet: ExcelJS.Worksheet): ParsedBoq | null {
  // --- find the header row (within the first 30 rows) ---
  let headerRow = 0;
  const columns: SheetPreview["columns"] = {};
  const scan = Math.min(sheet.rowCount, 30);
  for (let r = 1; r <= scan && !headerRow; r++) {
    const found: SheetPreview["columns"] = {};
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const t = valueText(cell.value).replace(/\s+/g, " ").trim();
      if (!t || t.length > 40) return;
      const col = letter(Number(cell.col));
      for (const [role, re] of HEADER_ROLES) {
        if (!found[role] && re.test(t)) { found[role] = { col, header: t }; break; }
      }
    });
    if (found.sr && found.desc && found.qty && (found.rate || found.amount)) { headerRow = r; Object.assign(columns, found); }
  }
  if (!headerRow) return null;

  const colOf = (role: ColumnRole) => columns[role]?.col;
  const main = new Set(Object.values(columns).map((c) => c!.col));
  const cellsOf = (r: number): Cells => {
    const out: Cells = {};
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      const col = letter(Number(cell.col));
      if (!main.has(col)) return;
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const text = valueText(cell.value).replace(/\s+/g, " ").trim();
      if (text === "") return;
      out[col] = { text, num: valueNum(cell.value, text) };
    });
    return out;
  };
  const get = (cells: Cells, role: ColumnRole) => { const c = colOf(role); return c ? cells[c] : undefined; };

  const sections: ExtractedSection[] = [];
  const preview: SheetPreview = { headerRow, columns, sections: [], counts: { items: 0, priced: 0, unpriced: 0, notes: 0, subtotals: 0, continuation: 0, skipped: 0 }, skippedRows: [], printedGrandTotal: null, itemsTotal: 0, taxNote: null };
  let cur: ExtractedSection | null = null;
  let curPrev: { name: string; row: number; items: number; printedTotal: number | null; itemTotal: number } | null = null;
  let lastItem: ExtractedItem | null = null;
  let lastRef: string | null = null;
  let subN = 0;
  const openSection = (name: string | null, row: number) => {
    cur = { name, source_ref: null, continues_previous_section: false, trade: trade(name ?? ""), items: [] };
    sections.push(cur);
    curPrev = { name: name ?? "General", row, items: 0, printedTotal: null, itemTotal: 0 };
    preview.sections.push(curPrev);
    lastItem = null;
  };

  const projectName = valueText(sheet.getRow(1).getCell(1).value).trim() || null;
  const sheetTitle = valueText(sheet.getRow(2).getCell(1).value).trim() || null;

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const cells = cellsOf(r);
    if (Object.keys(cells).length === 0) continue;
    const sr = get(cells, "sr"), name = get(cells, "name"), desc = get(cells, "desc"), unit = get(cells, "unit");
    const qty = get(cells, "qty"), rate = get(cells, "rate"), amount = get(cells, "amount"), remarks = get(cells, "remarks"), dim = get(cells, "dim");
    const label = [sr?.text, desc?.text, name?.text, rate?.text].find((t) => t && /^\s*(grand\s+)?total\b/i.test(t));
    const numeric = [qty?.num, rate?.num, amount?.num].some((n) => n != null);

    // totals: "Total Civil Work", "Total" (amount in the amount column) and the closing "Total Amount without taxes"
    if (label) {
      const amt = amount?.num ?? [...Object.values(cells)].map((c) => c.num).filter((n): n is number => n != null).pop() ?? null;
      const isGrand = !!sr?.text && /^\s*(grand\s+)?total/i.test(sr.text);
      if (isGrand) {
        if (!preview.printedGrandTotal || (preview.printedGrandTotal.amount == null && amt != null)) preview.printedGrandTotal = { row: r, amount: amt, label: label.slice(0, 60) };
        if (/without tax|excl\w*\.? (gst|tax)|before tax/i.test(label)) preview.taxNote = "excluded";
        else if (/incl\w*\.? (gst|tax)|with tax/i.test(label)) preview.taxNote = "included";
      } else {
        preview.counts.subtotals++;
        if (curPrev && amt != null) (curPrev as { printedTotal: number | null }).printedTotal = amt;
      }
      lastItem = null;
      continue;
    }

    const isSrToken = !!sr && SR.test(sr.text);
    const rest = [name, desc, unit, qty, rate, amount].some(Boolean);

    // section heading: text in the Sr column only
    if (sr && !isSrToken && !rest) {
      openSection(sr.text, r);
      continue;
    }

    // a real item: numbered, with a name or description
    if (isSrToken && (name || desc)) {
      if (!cur) openSection(null, r);
      const rateNum = rate?.num ?? null;
      const amountNum = amount?.num ?? null;
      const priced = (rateNum != null && rateNum > 0) || (amountNum != null && amountNum > 0);
      const remarkText = remarks?.text ?? null;
      const clientScope = !priced && !!remarkText && /client('?s)? scope|by client|supplied by client/i.test(remarkText);
      const item: ExtractedItem = {
        source_ref: sr!.text.replace(/\.$/, ""),
        source_row: r,
        name: name?.text ?? (desc ? desc.text.slice(0, 90) : null),
        description: desc?.text ?? null,
        unit: unit?.text ?? null,
        quantity: qty?.num ?? null,
        prices: rateNum != null || amountNum != null ? [{ variant: "default", rate: rateNum, amount: amountNum }] : [],
        quote_status: priced ? "priced" : clientScope ? "excluded" : "not_priced",
        flags: rateNum === 0 || amountNum === 0 ? ["NEEDS_CLARIFICATION"] : [],
        remarks: remarkText,
        attributes: { ...(dim ? { dimension: dim.text } : {}), ...(rateNum === 0 ? { zero_rate_unconfirmed: true } : {}) },
        tender_ref: null,
        tender_ref_reason: null,
      };
      cur!.items.push(item);
      lastItem = item;
      lastRef = item.source_ref;
      subN = 0;
      preview.counts.items++;
      priced ? preview.counts.priced++ : preview.counts.unpriced++;
      (curPrev as unknown as { items: number }).items++;
      const itemAmt = amountNum ?? (qty?.num != null && rateNum != null ? qty.num * rateNum : 0);
      preview.itemsTotal += itemAmt;
      (curPrev as unknown as { itemTotal: number }).itemTotal += itemAmt;
      continue;
    }

    // note under an item ("Basic Tile Cost: …", "Make: …"): belongs to that item, never counted as one
    if (!sr && desc && !numeric && !unit) {
      if (lastItem) {
        const t = desc.text;
        if (/basic .*cost|allowance/i.test(t)) lastItem.attributes.basic_material_note = t;
        else if (/^make\b/i.test(t)) lastItem.attributes.make = t;
        else lastItem.remarks = [lastItem.remarks, t].filter(Boolean).join(" · ");
      }
      preview.counts.notes++;
      continue;
    }

    // a sub-line under a numbered item (no number of its own): its own description/quantity, e.g. the accessories listed under "Fixing of toilet accessories"
    if (!sr && numeric && lastItem) {
      if (!cur) openSection(null, r);
      const rateNum = rate?.num ?? null, amountNum = amount?.num ?? null;
      const label = name?.text ?? (desc ? desc.text.slice(0, 90) : null);
      const priced = (rateNum ?? 0) > 0 || (amountNum ?? 0) > 0;
      const remarkText = remarks?.text ?? null;
      const clientScope = !priced && !!remarkText && /client('?s)? scope|by client|supplied by client/i.test(remarkText);
      if (label) subN++;
      const item: ExtractedItem = {
        source_ref: label && lastRef ? `${lastRef}.${subN}` : null, source_row: r, name: label, description: desc?.text ?? null, unit: unit?.text ?? null, quantity: qty?.num ?? null,
        prices: rateNum != null || amountNum != null ? [{ variant: "default", rate: rateNum, amount: amountNum }] : [],
        quote_status: priced ? "priced" : clientScope ? "excluded" : "not_priced", flags: [], remarks: remarkText,
        attributes: { ...(dim ? { dimension: dim.text } : {}), ...(lastRef ? { sub_line_of: lastRef } : {}) }, tender_ref: null, tender_ref_reason: null,
      };
      cur!.items.push(item);
      preview.counts.continuation++;
      preview.counts.items++;
      priced ? preview.counts.priced++ : preview.counts.unpriced++;
      const itemAmt = amountNum ?? (qty?.num != null && rateNum != null ? qty.num * rateNum : 0);
      preview.itemsTotal += itemAmt;
      (curPrev as unknown as { items: number }).items++;
      (curPrev as unknown as { itemTotal: number }).itemTotal += itemAmt;
      continue;
    }

    preview.counts.skipped++;
    if (preview.skippedRows.length < 30) preview.skippedRows.push(r);
  }

  if (preview.counts.items < 3) return null;
  return { sections, preview, projectName, sheetTitle };
}
