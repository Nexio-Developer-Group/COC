import type ExcelJS from "exceljs";
import type { ExtractedItem, ExtractedSection } from "@/lib/extract/schema";
import type { Cached } from "./xlsxCache";

/**
 * Deterministic reader for "classic" BOQ sheets: a header row (Sr.No / Item / Description / Unit / Quantity / Rate / Amount)
 * followed by category rows, item rows, sub-item rows, note rows and total rows. No AI is involved, so numbers come straight
 * from the cells. EVERY non-blank row below the header is accounted for as exactly one of:
 *   category · item · sub-item · note · category total · footer (grand total / discount / net) · blank · helper-only · UNRECOGNISED.
 * Rows that fit nothing are never dropped: they are listed in `unrecognised` so they can be reviewed.
 * A sheet that doesn't look like this returns null and goes through the AI reader instead.
 */
export type ColumnRole = "sr" | "name" | "desc" | "dim" | "unit" | "qty" | "rate" | "amount" | "remarks";

export type FooterLine = { row: number; label: string; amount: number | null; kind: "total" | "discount" | "grand" };

export type SheetPreview = {
  headerRow: number;
  /** role -> column letter and the header text found there */
  columns: Partial<Record<ColumnRole, { col: string; header: string }>>;
  sections: { name: string; row: number; items: number; printedTotal: number | null; itemTotal: number; totalRow: number | null; totalLabel: string | null; labelMismatch: boolean; printedTotals: number }[];
  counts: { items: number; subItems: number; priced: number; unpriced: number; notes: number; subtotals: number; blank: number; helperOnly: number; skipped: number };
  /** rows below the header that fit no rule — NOT extracted, must be reviewed */
  unrecognised: { row: number; text: string }[];
  skippedRows: number[];
  /** notes that appear before any item in their category (kept, but not attached to an item) */
  unattachedNotes: number[];
  /** rows with numbers only outside the table (e.g. a contractor's rate-analysis columns) and nothing in the table itself */
  helperRows: number[];
  errorCells: { a: string; text: string }[];
  /** the closing lines in order: "Total Amount…", "Special Discount…", net / "G-Total…" */
  footer: FooterLine[];
  printedGrandTotal: { row: number; amount: number | null; label: string } | null;
  itemsTotal: number;
  taxNote: "excluded" | "included" | null;
};

export type ParsedBoq = { sections: ExtractedSection[]; preview: SheetPreview; projectName: string | null; sheetTitle: string | null };

type Cells = Record<string, { text: string; num: number | null; addr: string }>;

const letter = (n: number) => { let s = ""; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
const clean = (t: string) => t.replace(/[​-‍﻿ ]/g, " ").replace(/\s+/g, " ").trim();
/** "-", "nil", "n/a" in a number column mean "not quoted" */
const NOT_A_NUMBER = /^(-+|–|—|nil|n\/?a|na|\.|x)$/i;

function rawValue(cell: ExcelJS.Cell, cache?: Map<string, Cached>): { text: string; num: number | null; err?: string } {
  let v = cell.value as unknown;
  if (v !== null && typeof v === "object" && ("formula" in (v as object) || "sharedFormula" in (v as object))) {
    let r = (v as { result?: unknown }).result;
    if (r === undefined || r === null) {
      const c = cache?.get(cell.address);
      r = c ? (c.e !== undefined ? { error: c.e } : c.n !== undefined ? c.n : c.s) : undefined;
    }
    v = r;
  }
  if (v === null || v === undefined) return { text: "", num: null };
  if (v instanceof Date) return { text: v.toISOString().slice(0, 10), num: null };
  if (typeof v === "number") return { text: String(v), num: v };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", num: null };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("error" in o) return { text: `#${String(o.error).replace(/^#/, "")}`, num: null, err: String(o.error) };
    if ("richText" in o) return { text: clean((o.richText as { text: string }[]).map((x) => x.text).join("")), num: null };
    if ("text" in o) return { text: clean(String(o.text)), num: null };
    return { text: "", num: null };
  }
  const text = clean(String(v));
  const c = text.replace(/[,₹\s]/g, "");
  return { text, num: /^-?\d+(\.\d+)?$/.test(c) && !NOT_A_NUMBER.test(c) ? Number(c) : null };
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

/** 1 · 1.1 · 2a · 3. */
const SR = /^\d+(\.\d+)*[a-z]?\.?$/i;
/** a) · (a) · (ii) · b. — a lettered sub-item marker (a bare word like "Civil" never matches) */
const SUB_SR = /^(\([a-z]{1,3}\)|[a-z]{1,3}[.)])$/i;
const TOTAL_LABEL = /^\s*((grand\s+|g[-\s]?)?total|net\s+(payable|amount|total)|final\s+total)\b/i;
const DISCOUNT_LABEL = /^\s*(special\s+)?(discount|rebate)\b/i;
/** edit distance, for telling a typo ("Carpentary") from a different category */
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** the same category, allowing spelling/spacing/plural differences */
function sameCategory(a: string, b: string): boolean {
  if (!a || !b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return 1 - lev(a, b) / Math.max(a.length, b.length) >= 0.75;
}
const stem = (t: string) => t.toLowerCase().replace(/\b(total|work|works|the|of|and|&)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/s\b/g, "");

export function parseBoqSheet(sheet: ExcelJS.Worksheet, cache?: Map<string, Cached>): ParsedBoq | null {
  // --- find the header row (within the first 30 rows) ---
  let headerRow = 0;
  const columns: SheetPreview["columns"] = {};
  const scan = Math.min(sheet.rowCount, 30);
  for (let r = 1; r <= scan && !headerRow; r++) {
    const found: SheetPreview["columns"] = {};
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const t = rawValue(cell, cache).text;
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
  const preview: SheetPreview = {
    headerRow, columns, sections: [],
    counts: { items: 0, subItems: 0, priced: 0, unpriced: 0, notes: 0, subtotals: 0, blank: 0, helperOnly: 0, skipped: 0 },
    unrecognised: [], skippedRows: [], unattachedNotes: [], helperRows: [], errorCells: [], footer: [], printedGrandTotal: null, itemsTotal: 0, taxNote: null,
  };
  const cellsOf = (r: number): { cells: Cells; outsideValue: boolean } => {
    const cells: Cells = {};
    let outsideValue = false;
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      const col = letter(Number(cell.col));
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const v = rawValue(cell, cache);
      if (v.err && preview.errorCells.length < 40) preview.errorCells.push({ a: cell.address, text: v.text });
      if (v.text === "") return;
      if (!main.has(col)) { if (v.num != null && v.num !== 0) outsideValue = true; return; }
      cells[col] = { text: v.text, num: v.num, addr: cell.address };
    });
    return { cells, outsideValue };
  };
  const get = (cells: Cells, role: ColumnRole) => { const c = colOf(role); return c ? cells[c] : undefined; };
  const nz = (n: number | null | undefined) => n != null && n !== 0;

  const sections: ExtractedSection[] = [];
  type Sec = SheetPreview["sections"][number];
  let cur = null as ExtractedSection | null;
  let curPrev = null as Sec | null;
  let lastItem = null as ExtractedItem | null;
  let lastRef = null as string | null;
  let subN = 0;
  const openSection = (name: string | null, row: number) => {
    cur = { name, source_ref: null, continues_previous_section: false, trade: trade(name ?? ""), items: [] };
    sections.push(cur);
    curPrev = { name: name ?? "General", row, items: 0, printedTotal: null, itemTotal: 0, totalRow: null, totalLabel: null, labelMismatch: false, printedTotals: 0 };
    preview.sections.push(curPrev);
    lastItem = null;
    lastRef = null;
    subN = 0;
  };

  const srcCells = (cells: Cells) => ["qty", "rate", "amount"].map((role) => get(cells, role as ColumnRole)).filter((c): c is NonNullable<typeof c> => !!c && c.num != null).map((c) => `${c.addr}=${c.num}`).join("; ");

  const addItem = (item: ExtractedItem, cells: Cells, asSub: boolean) => {
    if (!cur) openSection(null, item.source_row ?? headerRow);
    item.attributes.source_cells = srcCells(cells);
    cur!.items.push(item);
    preview.counts.items++;
    if (asSub) preview.counts.subItems++;
    item.quote_status === "priced" ? preview.counts.priced++ : preview.counts.unpriced++;
    const p = item.prices[0];
    const itemAmt = p?.amount ?? (item.quantity != null && p?.rate != null ? item.quantity * p.rate : 0);
    preview.itemsTotal += itemAmt;
    if (curPrev) { curPrev.items++; curPrev.itemTotal += itemAmt; }
  };
  const priceOf = (rateNum: number | null, amountNum: number | null) => (rateNum != null || amountNum != null ? [{ variant: "default", rate: rateNum, amount: amountNum }] : []);
  const statusOf = (rateNum: number | null, amountNum: number | null, remarkText: string | null): ExtractedItem["quote_status"] => {
    if (nz(rateNum) && (rateNum as number) > 0 || nz(amountNum) && (amountNum as number) > 0) return "priced";
    return remarkText && /client('?s)? scope|by client|supplied by client/i.test(remarkText) ? "excluded" : "not_priced";
  };

  const projectName = rawValue(sheet.getRow(1).getCell(1), cache).text || null;
  const sheetTitle = rawValue(sheet.getRow(2).getCell(1), cache).text || null;

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const { cells, outsideValue } = cellsOf(r);
    const keys = Object.keys(cells);
    if (keys.length === 0) {
      if (outsideValue) { preview.counts.helperOnly++; if (preview.helperRows.length < 30) preview.helperRows.push(r); } else preview.counts.blank++;
      continue;
    }
    const sr = get(cells, "sr"), name = get(cells, "name"), desc = get(cells, "desc"), unit = get(cells, "unit");
    const qty = get(cells, "qty"), rate = get(cells, "rate"), amount = get(cells, "amount"), remarks = get(cells, "remarks"), dim = get(cells, "dim");
    const hasValue = nz(qty?.num) || nz(rate?.num) || nz(amount?.num);
    const hasText = !!(sr || name || desc || unit || remarks || dim);
    // a row that only holds zeros / dashes is a blank line, not an entry
    if (!hasText && !hasValue) { preview.counts.blank++; continue; }

    // ---- totals, discounts and the closing lines ----
    const label = [sr?.text, name?.text, desc?.text, rate?.text].find((t) => t && (TOTAL_LABEL.test(t) || DISCOUNT_LABEL.test(t)));
    if (label) {
      const amt = amount?.num ?? Object.values(cells).map((c) => c.num).filter((n): n is number => n != null).pop() ?? null;
      const isFooter = (!!sr && (TOTAL_LABEL.test(sr.text) || DISCOUNT_LABEL.test(sr.text))) || DISCOUNT_LABEL.test(label);
      if (isFooter) {
        const kind: FooterLine["kind"] = DISCOUNT_LABEL.test(label) ? "discount" : /g[-\s]?total|net|final|grand/i.test(label) ? "grand" : "total";
        preview.footer.push({ row: r, label: label.slice(0, 80), amount: amt, kind });
        if (kind === "total" && (!preview.printedGrandTotal || (preview.printedGrandTotal.amount == null && amt != null))) preview.printedGrandTotal = { row: r, amount: amt, label: label.slice(0, 60) };
        if (/without tax|excl\w*\.? (gst|tax)|before tax/i.test(label)) preview.taxNote = "excluded";
        else if (/incl\w*\.? (gst|tax)|with tax/i.test(label)) preview.taxNote = "included";
      } else {
        preview.counts.subtotals++;
        if (curPrev) {
          curPrev.printedTotals++;
          curPrev.totalRow = r;
          curPrev.totalLabel = label.slice(0, 60);
          if (amt != null) curPrev.printedTotal = amt;
          // "Total Doors Work" must belong to the "Doors" category directly above it; a bare "Total" always does
          const s = stem(label);
          if (s && !sameCategory(stem(curPrev.name), s)) curPrev.labelMismatch = true;
        }
      }
      lastItem = null;
      continue;
    }

    const isSrToken = !!sr && SR.test(sr.text);
    const isSubMarker = !!sr && SUB_SR.test(sr.text);
    const remarkText = remarks?.text ?? null;

    // ---- category heading: text in the Sr column, no description/unit and no real numbers (a stray 0 or dash in a number column is ignored) ----
    if (sr && !isSrToken && !isSubMarker && !name && !desc && !unit && !nz(qty?.num)) {
      const stray = [rate?.num, amount?.num].filter((n): n is number => nz(n));
      openSection(sr.text, r);
      if (stray.length) preview.unrecognised.push({ row: r, text: `Category "${sr.text}" also holds a number (${stray.join(", ")}) — check that it is not an item` });
      continue;
    }

    // ---- numbered item (with a name or description) ----
    if (isSrToken && (name || desc)) {
      const rateNum = rate?.num ?? null, amountNum = amount?.num ?? null;
      const item: ExtractedItem = {
        source_ref: sr!.text.replace(/\.$/, ""), source_row: r,
        name: name?.text ?? (desc ? desc.text.slice(0, 90) : null), description: desc?.text ?? null, unit: unit?.text ?? null, quantity: qty?.num ?? null,
        prices: priceOf(rateNum, amountNum), quote_status: statusOf(rateNum, amountNum, remarkText), flags: [], remarks: remarkText,
        attributes: { ...(dim ? { dimension: dim.text } : {}), ...(rateNum === 0 || amountNum === 0 ? { zero_value_in_source: true } : {}) }, tender_ref: null, tender_ref_reason: null,
      };
      if (!cur) openSection(null, r);
      lastItem = item; lastRef = item.source_ref; subN = 0;
      addItem(item, cells, false);
      continue;
    }

    // ---- sub-items: lettered markers, a repeated/unlabelled numbered row, or a labelled line with no number ----
    const labelText = name?.text ?? (desc ? desc.text.slice(0, 90) : null);
    const canSub = hasValue || (!!unit && qty?.num != null);
    if (canSub && (isSubMarker || (isSrToken && !(name || desc)) || (!sr && (labelText || unit)))) {
      const rateNum = rate?.num ?? null, amountNum = amount?.num ?? null;
      const sameNumber = isSrToken && lastRef != null && sr!.text.replace(/\.$/, "") === lastRef;
      const parentRef = lastRef;
      if (!lastItem) {
        // nothing above to attach to: keep it as its own entry and say so, rather than losing it
        preview.unrecognised.push({ row: r, text: `${labelText ?? "(no description)"} — a sub-line with no item above it in its category; kept as a separate entry` });
      }
      subN++;
      const item: ExtractedItem = {
        source_ref: parentRef ? `${parentRef}.${subN}` : sr?.text ?? null, source_row: r,
        name: labelText ?? remarkText, description: desc?.text ?? null, unit: unit?.text ?? null, quantity: qty?.num ?? null,
        prices: priceOf(rateNum, amountNum), quote_status: statusOf(rateNum, amountNum, remarkText), flags: sameNumber ? ["ALTERNATE_OFFERED"] : [], remarks: remarkText,
        attributes: { ...(dim ? { dimension: dim.text } : {}), ...(parentRef ? { sub_line_of: parentRef } : {}), ...(sr ? { source_serial: sr.text } : {}), ...(sameNumber ? { alternate_of: parentRef! } : {}) },
        tender_ref: null, tender_ref_reason: null,
      };
      addItem(item, cells, true);
      continue;
    }

    // ---- note under an item ("Basic Tile Cost: …", "Make: …"): attached to it, never counted as an item ----
    if (!sr && desc && !hasValue && !unit) {
      if (lastItem) {
        const t = desc.text;
        if (/basic .*cost|allowance/i.test(t)) lastItem.attributes.basic_material_note = t;
        else if (/^make\b/i.test(t)) lastItem.attributes.make = t;
        else lastItem.remarks = [lastItem.remarks, t].filter(Boolean).join(" · ");
      } else if (preview.unattachedNotes.length < 30) preview.unattachedNotes.push(r);
      preview.counts.notes++;
      continue;
    }
    // remarks/dimension-only rows under an item belong to it too
    if (!sr && !desc && !name && !unit && !hasValue && (remarks || dim) && lastItem) {
      lastItem.remarks = [lastItem.remarks, remarks?.text ?? dim?.text].filter(Boolean).join(" · ");
      preview.counts.notes++;
      continue;
    }

    // ---- nothing fits: never drop it silently ----
    preview.counts.skipped++;
    if (preview.skippedRows.length < 30) preview.skippedRows.push(r);
    if (preview.unrecognised.length < 60) preview.unrecognised.push({ row: r, text: Object.values(cells).map((c) => `${c.addr}:${c.text}`).join(" | ").slice(0, 140) });
  }

  if (preview.counts.items < 3) return null;
  return { sections, preview, projectName, sheetTitle };
}
