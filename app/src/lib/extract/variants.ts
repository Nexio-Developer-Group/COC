import type { Price } from "@/lib/types";

type Cell = { col: string; value: number };

function parseRow(text: string, row: number): Cell[] {
  const line = text.split("\n").find((l) => l.startsWith(`R${row} |`));
  if (!line) return [];
  const out: Cell[] = [];
  for (const part of line.replace(/^R\d+ \| /, "").split(" | ")) {
    const m = /^([A-Z]{1,3}):\s*(-?\d+(?:\.\d+)?)$/.exec(part.trim());
    if (m) out.push({ col: m[1], value: Number(m[2]) });
  }
  return out;
}

/**
 * Several rate columns + several amount columns on one row are price OPTIONS. The amount columns can
 * be in a different order than the rate columns, so pair by arithmetic (amount = quantity x rate),
 * never by position. Returns null when the row doesn't show a multi-option pattern.
 */
export function derivePairs(text: string, row: number, quantity: number | null): { col: string; rate: number; amount: number }[] | null {
  if (quantity == null || quantity <= 0) return null;
  const cells = parseRow(text, row);
  if (cells.length < 4) return null;
  const pairs: { col: string; rate: number; amount: number }[] = [];
  const usedAmountCols = new Set<string>();
  for (const r of cells) {
    if (r.value <= 0 || r.value === quantity) continue;
    const target = quantity * r.value;
    const a = cells.find((c) => c.col !== r.col && !usedAmountCols.has(c.col) && c.value !== quantity && Math.abs(c.value - target) <= Math.max(1, Math.abs(target) * 0.005));
    if (a && a.value > r.value) {
      pairs.push({ col: r.col, rate: r.value, amount: a.value });
      usedAmountCols.add(a.col);
    }
  }
  const distinctRateCols = new Set(pairs.map((p) => p.col));
  return distinctRateCols.size >= 2 ? pairs.sort((x, y) => (x.col.length - y.col.length) || x.col.localeCompare(y.col)) : null;
}

export type VariantResult = { labels: Record<string, string>; perItem: Map<object, Price[]> };

/** Applies derivePairs to every item that has a source row; variant keys follow the rate columns left to right. */
export function deriveVariants<T extends { source_row?: number | null; quantity: number | null }>(
  items: { item: T; sheetText: string }[]
): VariantResult | null {
  const found = new Map<T, { col: string; rate: number; amount: number }[]>();
  const cols = new Set<string>();
  for (const { item, sheetText } of items) {
    if (item.source_row == null) continue;
    const pairs = derivePairs(sheetText, item.source_row, item.quantity);
    if (pairs) {
      found.set(item, pairs);
      pairs.forEach((p) => cols.add(p.col));
    }
  }
  if (found.size === 0 || cols.size < 2) return null;
  const ordered = [...cols].sort((x, y) => (x.length - y.length) || x.localeCompare(y));
  const key = (col: string) => `v${ordered.indexOf(col) + 1}`;
  const labels: Record<string, string> = Object.fromEntries(ordered.map((c, i) => [`v${i + 1}`, `Option ${i + 1} (column ${c})`]));
  const perItem = new Map<object, Price[]>();
  for (const [item, pairs] of found) {
    perItem.set(
      item,
      ordered.map((c) => {
        const p = pairs.find((x) => x.col === c);
        return { variant: key(c), rate: p?.rate ?? null, amount: p?.amount ?? null };
      })
    );
  }
  return { labels, perItem };
}
