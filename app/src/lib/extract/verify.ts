import type { Anomaly, Issue } from "@/lib/types";
import type { SheetAudit } from "@/lib/ingest/readFile";
import type { ExtractedItem } from "./schema";
import { parseRows } from "./backfill";

type RowCells = Record<string, string>;
export type SourceFlag = Anomaly & { corrected?: boolean };

const num = (t: string | undefined): number | null => {
  if (t == null) return null;
  const c = t.replace(/[,₹\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : null;
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);

/** Columns whose header row names them quantity / unit / rate / amount (a sheet may have several rate/amount pairs). */
function roleColumns(rows: Map<number, RowCells>) {
  const out = { qty: [] as string[], rate: [] as string[], amount: [] as string[] };
  for (const cells of rows.values()) {
    const entries = Object.entries(cells);
    if (!entries.some(([, v]) => /^(qty|quantity)\b/i.test(v)) || !entries.some(([, v]) => /^(rate|amount|total)/i.test(v))) continue;
    for (const [k, v] of entries) {
      if (/^(qty|quantity)\b/i.test(v)) out.qty.push(k);
      else if (/\brate\b/i.test(v)) out.rate.push(k);
      else if (/\b(amount|total)\b/i.test(v)) out.amount.push(k);
    }
    break;
  }
  return out;
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

/**
 * The AI reads the sheet text, so every number it returns is re-checked against the printed row it came from.
 * - A value that matches a cell of that row (or is the product/quotient of two that do) is confirmed.
 * - A value that matches nothing is replaced by the sheet's own number when its column is unambiguous,
 *   otherwise it is flagged — never silently trusted.
 * Flags are stored on the item and turned into anomalies/provenance notes when the lines are built.
 */
export function verifyAgainstSource(entries: { item: ExtractedItem; sheetKey: string }[], texts: Map<string, string[]>) {
  const perSheet = new Map<string, { rows: Map<number, RowCells>; cols: ReturnType<typeof roleColumns> }>();
  for (const [key, chunks] of texts) {
    const rows = parseRows(chunks.join("\n"));
    perSheet.set(key, { rows, cols: roleColumns(rows) });
  }
  const stats = { checked: 0, confirmed: 0, corrected: 0, unverified: 0, examples: [] as string[] };

  for (const { item, sheetKey } of entries) {
    if (item.source_row == null) continue;
    const sheet = perSheet.get(sheetKey);
    const cells = sheet?.rows.get(item.source_row);
    if (!sheet || !cells) continue;
    const at = (col: string) => `${col}${item.source_row}`;
    const numerics = Object.entries(cells).map(([col, t]) => ({ col, v: num(t) })).filter((x): x is { col: string; v: number } => x.v != null);
    const flags: SourceFlag[] = [];
    const has = (v: number) => numerics.some((n) => close(n.v, v));
    const only = (cols: string[]) => {
      const c = numerics.filter((n) => cols.includes(n.col));
      return c.length === 1 ? c[0] : null;
    };

    // quantity
    if (item.quantity != null) {
      stats.checked++;
      if (has(item.quantity)) stats.confirmed++;
      else {
        const fix = only(sheet.cols.qty);
        if (fix) {
          flags.push({ field: "quantity", code: "corrected_from_source", severity: "warn", corrected: true, message: `Quantity taken from sheet cell ${at(fix.col)} (${fmt(fix.v)}); the AI had read ${fmt(item.quantity)}.` });
          item.quantity = fix.v;
          stats.corrected++;
          if (stats.examples.length < 5) stats.examples.push(`row ${item.source_row} quantity ${fmt(fix.v)}`);
        } else {
          flags.push({ field: "quantity", code: "not_in_source", severity: "warn", message: `Quantity ${fmt(item.quantity)} does not appear in the sheet row ${item.source_row} — please check.` });
          stats.unverified++;
        }
      }
    }

    // each price option
    const single = item.prices.length === 1;
    for (const p of item.prices) {
      const qty = item.quantity;
      if (p.rate != null) {
        stats.checked++;
        const derived = qty && p.amount != null && close(p.amount / qty, p.rate);
        if (has(p.rate) || derived) stats.confirmed++;
        else {
          const fix = single ? only(sheet.cols.rate) : null;
          if (fix) {
            flags.push({ field: "rate", code: "corrected_from_source", severity: "warn", corrected: true, message: `Rate taken from sheet cell ${at(fix.col)} (${fmt(fix.v)}); the AI had read ${fmt(p.rate)}.` });
            p.rate = fix.v;
            stats.corrected++;
            if (stats.examples.length < 5) stats.examples.push(`row ${item.source_row} rate ${fmt(fix.v)}`);
          } else {
            flags.push({ field: "rate", code: "not_in_source", severity: "warn", message: `Rate ${fmt(p.rate)} does not appear in sheet row ${item.source_row} — please check.` });
            stats.unverified++;
          }
        }
      }
      if (p.amount != null) {
        stats.checked++;
        const derived = qty && p.rate != null && close(qty * p.rate, p.amount);
        if (has(p.amount) || derived) stats.confirmed++;
        else {
          const fix = single ? only(sheet.cols.amount) : null;
          if (fix) {
            flags.push({ field: "amount", code: "corrected_from_source", severity: "warn", corrected: true, message: `Amount taken from sheet cell ${at(fix.col)} (${fmt(fix.v)}); the AI had read ${fmt(p.amount)}.` });
            p.amount = fix.v;
            stats.corrected++;
            if (stats.examples.length < 5) stats.examples.push(`row ${item.source_row} amount ${fmt(fix.v)}`);
          } else {
            flags.push({ field: "amount", code: "not_in_source", severity: "warn", message: `Amount ${fmt(p.amount)} does not appear in sheet row ${item.source_row} — please check.` });
            stats.unverified++;
          }
        }
      }
    }
    if (flags.length) (item.attributes as Record<string, unknown>).source_check = flags;
  }
  return stats;
}

/** Turns the per-sheet formula audit (done without AI at upload) into document issues. */
export function auditIssues(audits: { sheet: string; audit: SheetAudit }[]): Issue[] {
  const issues: Issue[] = [];
  const list = <T,>(xs: T[], f: (x: T) => string, n = 4) => xs.slice(0, n).map(f).join("; ") + (xs.length > n ? ` … (+${xs.length - n} more)` : "");
  for (const { sheet, audit } of audits) {
    if (audit.mismatches.length)
      issues.push({ code: "formula_mismatch", severity: "error", category: "totals", message: `"${sheet}": ${audit.mismatches.length} formula result(s) saved in the file disagree with a fresh recalculation — ${list(audit.mismatches, (m) => `${m.a} shows ${m.cached.toLocaleString("en-IN")} but ${m.f} gives ${m.recalc.toLocaleString("en-IN")}`)}. Check which is right.` });
    if (audit.errors.length)
      issues.push({ code: "excel_error", severity: "error", category: "ingest", message: `"${sheet}": ${audit.errors.length} cell(s) hold an Excel error — ${list(audit.errors, (e) => `${e.a} (${e.text})`)}. Values that depend on them are not reliable.` });
    if (audit.uncached.length)
      issues.push({ code: "formula_not_calculated", severity: "warn", category: "ingest", message: `"${sheet}": ${audit.uncached.length} formula(s) were saved without a result (${list(audit.uncached, (a) => a)}). They were calculated here instead; open and re-save the file in Excel to confirm.` });
    if (audit.unverified.length)
      issues.push({ code: "formula_unverified", severity: "warn", category: "ingest", message: `"${sheet}": ${audit.unverified.length} formula(s) could not be re-checked (${list(audit.unverified, (u) => `${u.a} ${u.why}`)}). The saved values are kept but remain unverified.` });
  }
  return issues;
}

const looksLikeItemRow = (cells: RowCells) => {
  const vals = Object.values(cells).filter(Boolean);
  if (vals.length < 3) return false;
  const numeric = vals.filter((c) => num(c) != null).length;
  const texty = vals.filter((c) => /[A-Za-z]{3,}/.test(c)).length;
  return numeric >= 1 && texty >= 2;
};

/** Sheet rows that look like items (text plus a number) but have no extracted item — i.e. rows the AI skipped. */
export function missingRows(entries: { item: ExtractedItem; sheetKey: string }[], texts: Map<string, string[]>): { sheet: string; rows: number[] }[] {
  const covered = new Map<string, Set<number>>();
  for (const { item, sheetKey } of entries) if (item.source_row != null) covered.set(sheetKey, (covered.get(sheetKey) ?? new Set()).add(item.source_row));
  const out: { sheet: string; rows: number[] }[] = [];
  for (const [key, chunks] of texts) {
    const rows = [...parseRows(chunks.join("\n")).entries()].filter(([, cells]) => looksLikeItemRow(cells)).map(([n]) => n);
    const have = covered.get(key) ?? new Set<number>();
    // a note row directly under an item ("Make: As per selection") carries no number of its own, so only rows that really look like items count
    const missing = rows.filter((n) => !have.has(n));
    if (missing.length) out.push({ sheet: key, rows: missing });
  }
  return out;
}
