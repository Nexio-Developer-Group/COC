import type { ExtractedItem } from "./schema";

type RowCells = Record<string, string>;

const NOT_NAME = /description|^sr|s\.?\s*no|image|dimension|unit|qty|quantity|rate|amount|remarks|make/i;

/** "R18 | A:5 | B:Name | C:Text" -> { 18: { A: "5", B: "Name", C: "Text" } } */
export function parseRows(text: string): Map<number, RowCells> {
  const rows = new Map<number, RowCells>();
  for (const line of text.split("\n")) {
    const m = line.match(/^R(\d+) \| ([\s\S]*)$/);
    if (!m) continue;
    const cells: RowCells = {};
    for (const seg of m[2].split(" | ")) {
      const c = seg.match(/^([A-Z]{1,2}):([\s\S]*)$/);
      if (c) cells[c[1]] = c[2].trim();
    }
    rows.set(Number(m[1]), cells);
  }
  return rows;
}

/** Which column holds the item's short name / its long description, read from the sheet's header row. */
export function headerColumns(rows: Map<number, RowCells>): { nameCol?: string; descCol?: string } {
  for (const cells of rows.values()) {
    const entries = Object.entries(cells);
    const hasDesc = entries.some(([, v]) => /description|particular/i.test(v));
    const hasQty = entries.some(([, v]) => /^(qty|quantity)\b/i.test(v));
    if (!hasDesc || !hasQty) continue;
    const descCol = entries.find(([, v]) => /description|particular/i.test(v))?.[0];
    const nameCol = entries.find(([k, v]) => k !== descCol && /item|name|work|code/i.test(v) && !NOT_NAME.test(v))?.[0];
    return { nameCol, descCol };
  }
  return {};
}

/**
 * The AI sometimes leaves an item's name empty even though the sheet has it in its own column.
 * Fill those gaps straight from the sheet text, using the printed row the item came from.
 * `texts` are the rendered chunks of one workbook sheet; returns how many names were restored.
 */
export function backfillNames(entries: { item: ExtractedItem; sheetKey: string }[], texts: Map<string, string[]>): number {
  const perSheet = new Map<string, { rows: Map<number, RowCells>; cols: { nameCol?: string; descCol?: string } }>();
  for (const [key, chunks] of texts) {
    const rows = parseRows(chunks.join("\n"));
    perSheet.set(key, { rows, cols: headerColumns(rows) });
  }
  let n = 0;
  for (const { item, sheetKey } of entries) {
    if (item.name || item.source_row == null) continue;
    const sheet = perSheet.get(sheetKey);
    const cells = sheet?.rows.get(item.source_row);
    if (!sheet || !cells) continue;
    const { nameCol, descCol } = sheet.cols;
    const name = (nameCol && cells[nameCol]) || (descCol && cells[descCol] ? cells[descCol].slice(0, 90) : "");
    if (name) {
      item.name = name;
      n++;
    }
  }
  return n;
}
