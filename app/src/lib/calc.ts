import {
  collectRefs,
  evaluate,
  parseFormula,
  validateFormula,
  describeFormula,
  type NumericField,
} from "./formula";
import { conversionFactor, normalizeUnit, unitsIncompatible } from "./units";
import type { Anomaly, CellMeta, Document, EditableField, Issue, LineItem } from "./types";

export type FieldRules = Document["field_rules"];

const COMPUTE_ORDER: NumericField[] = ["amount", "rate", "quantity"];
const DEFAULT_EXPR: Record<NumericField, string> = {
  amount: "quantity * rate",
  rate: "amount / quantity",
  quantity: "amount / rate",
};

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
const fmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(n);

/** Document-level rule for a field if enabled, else the built-in default. */
export function ruleFor(field: NumericField, rules: FieldRules | null | undefined): { expr: string; custom: boolean } | null {
  const r = rules?.[field];
  if (r && r.enabled === false) return null;
  if (r?.expr) return { expr: r.expr, custom: true };
  return { expr: DEFAULT_EXPR[field], custom: false };
}

export type CellChange = {
  lineId: string;
  itemCode: string;
  field: EditableField | "unit";
  oldValue: unknown;
  newValue: unknown;
  oldMeta: CellMeta | null;
  newMeta: CellMeta | null;
  cause: string;
};

function now() {
  return new Date().toISOString();
}

function numeric(line: LineItem, f: NumericField): number | null {
  const v = line[f];
  return v == null ? null : Number(v);
}

/** Keeps the primary price variant row in sync with the headline rate/amount. */
function syncPrices(line: LineItem, primaryVariant: string | null) {
  if (!line.prices || line.prices.length === 0) return;
  const idx = Math.max(0, line.prices.findIndex((p) => p.variant === primaryVariant));
  line.prices = line.prices.map((p, i) => (i === idx ? { ...p, rate: line.rate, amount: line.amount } : p));
}

/**
 * Recomputes every formula-driven cell and autofills empty ones. Mutates `lines` in place and
 * returns what changed so the caller can persist + log it. Cells with a value that came from the
 * document are never overwritten; only empty cells and cells already driven by a formula are.
 */
export function recompute(
  lines: LineItem[],
  rules: FieldRules | null | undefined,
  opts: { primaryVariant?: string | null; cause?: string; only?: Set<string> } = {}
): CellChange[] {
  const items = lines.filter((l) => l.kind === "item");
  const byCode = new Map(items.map((l) => [l.item_code, l]));
  const changes: CellChange[] = [];
  const cause = opts.cause ?? "autofill";

  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const line of items) {
      if (opts.only && !opts.only.has(line.id)) continue;
      for (const field of COMPUTE_ORDER) {
        const meta = line.cell_meta?.[field];
        const current = numeric(line, field);

        let expr: string | null = null;
        let ruleKind: "document" | "row" = "document";
        let src: CellMeta["src"] = "autofill";

        if (meta?.formula) {
          // already formula-driven (autofill or a user-applied formula) — keep it fresh
          expr = meta.formula;
          ruleKind = meta.rule ?? "row";
          src = meta.src === "manual" ? "manual" : "autofill";
        } else if (current == null && meta?.src !== "manual") {
          const r = ruleFor(field, rules);
          if (r) {
            expr = r.expr;
            ruleKind = "document";
          }
        }
        if (!expr) continue;

        let result: number | null;
        try {
          const ast = parseFormula(expr);
          result = evaluate(ast, (row, f) => {
            const target = row ? byCode.get(row) : line;
            return target ? numeric(target, f) : null;
          });
        } catch {
          continue;
        }
        if (result == null && current == null) continue;
        if (result != null && current != null && Math.abs(result - current) < 0.00005) {
          if (!meta?.formula) continue;
          continue;
        }
        if (result == null && !meta?.formula) continue;

        const oldMeta = meta ?? null;
        const newMeta: CellMeta = {
          src,
          formula: expr,
          rule: ruleKind,
          original: meta?.original ?? current,
          at: now(),
          note: `Calculated as ${describeFormula(expr)}`,
        };
        const before = current;
        (line as unknown as Record<string, unknown>)[field] = result;
        line.cell_meta = { ...(line.cell_meta ?? {}), [field]: newMeta };
        syncPrices(line, opts.primaryVariant ?? null);
        changes.push({ lineId: line.id, itemCode: line.item_code, field, oldValue: before, newValue: result, oldMeta, newMeta, cause });
        moved = true;
      }

      // a calculated price on a line the document called "not priced" makes it priced
      const amt = numeric(line, "amount");
      const rt = numeric(line, "rate");
      if ((line.quote_status === "not_priced" || line.quote_status == null) && ((amt ?? 0) > 0 || (rt ?? 0) > 0)) {
        const oldMeta = line.cell_meta?.quote_status ?? null;
        const old = line.quote_status;
        line.quote_status = "priced";
        line.cell_meta = { ...(line.cell_meta ?? {}), quote_status: { src: "autofill", note: "Set to priced because a rate/amount is now available", original: old, at: now() } };
        changes.push({ lineId: line.id, itemCode: line.item_code, field: "quote_status", oldValue: old, newValue: "priced", oldMeta, newMeta: line.cell_meta.quote_status!, cause });
        moved = true;
      }
    }
    if (!moved) break;
  }
  return changes;
}

/** Validates a user-supplied formula and previews the effect on every row. */
export type FormulaPreviewRow = {
  lineId: string;
  itemCode: string;
  name: string | null;
  current: number | null;
  next: number | null;
  currentSrc: CellMeta["src"] | "empty";
  /** document/manual value that would be replaced and doesn't already equal the formula result */
  conflict: boolean;
  unchanged: boolean;
};

export function previewFormula(
  lines: LineItem[],
  field: NumericField,
  expr: string,
  targetIds?: Set<string>
): { ok: true; rows: FormulaPreviewRow[] } | { ok: false; error: string } {
  const v = validateFormula(expr, field);
  if (!v.ok) return v;
  const ast = parseFormula(expr);
  const items = lines.filter((l) => l.kind === "item");
  const byCode = new Map(items.map((l) => [l.item_code, l]));
  const unknown = collectRefs(ast).filter((r) => r.row && !byCode.has(r.row));
  if (unknown.length) return { ok: false, error: `Row ${unknown[0].row} doesn't exist in this document.` };

  const rows: FormulaPreviewRow[] = [];
  for (const line of items) {
    if (targetIds && !targetIds.has(line.id)) continue;
    const next = evaluate(ast, (row, f) => numeric(row ? byCode.get(row)! : line, f));
    const current = numeric(line, field);
    const meta = line.cell_meta?.[field];
    const src = current == null ? "empty" : meta?.src ?? "document";
    const unchanged = next != null && current != null && Math.abs(next - current) < 0.005;
    const conflict = current != null && !unchanged && (src === "document" || src === "manual" || src === "converted");
    rows.push({ lineId: line.id, itemCode: line.item_code, name: line.name, current, next, currentSrc: src, conflict, unchanged });
  }
  return { ok: true, rows };
}

/** Converts a bid line's unit into the tender line's unit when the two measure the same thing. */
export function applyUnitConversion(line: LineItem, tenderLine: Pick<LineItem, "unit" | "unit_raw"> | null): CellChange[] {
  if (line.kind !== "item" || !tenderLine) return [];
  const target = tenderLine.unit ?? normalizeUnit(tenderLine.unit_raw);
  const current = line.unit ?? normalizeUnit(line.unit_raw);
  if (!target || !current || line.converted) return [];
  const conv = conversionFactor(current, target);
  if (!conv) return [];

  const q = numeric(line, "quantity");
  const r = numeric(line, "rate");
  const changes: CellChange[] = [];
  const stamp = now();
  line.converted = { from: conv.from, to: conv.to, factor: conv.factor, original_quantity: q, original_rate: r };

  const oldUnitMeta = line.cell_meta?.unit_raw ?? null;
  const oldUnit = line.unit;
  line.unit = conv.to;
  line.cell_meta = {
    ...(line.cell_meta ?? {}),
    unit_raw: { src: "converted", original: line.unit_raw, note: `Unit converted ${conv.from} → ${conv.to} to match your BOQ`, at: stamp },
  };
  changes.push({ lineId: line.id, itemCode: line.item_code, field: "unit", oldValue: oldUnit, newValue: conv.to, oldMeta: oldUnitMeta, newMeta: line.cell_meta.unit_raw!, cause: "conversion" });

  if (q != null) {
    const nq = round4(q * conv.factor);
    const oldMeta = line.cell_meta?.quantity ?? null;
    line.quantity = nq;
    line.cell_meta = { ...line.cell_meta, quantity: { src: "converted", formula: `${fmt(q)} × ${fmt(conv.factor)}`, original: q, note: `${fmt(q)} ${conv.from} → ${fmt(nq)} ${conv.to}`, at: stamp } };
    changes.push({ lineId: line.id, itemCode: line.item_code, field: "quantity", oldValue: q, newValue: nq, oldMeta, newMeta: line.cell_meta.quantity!, cause: "conversion" });
  }
  if (r != null) {
    const nr = round4(r / conv.factor);
    const oldMeta = line.cell_meta?.rate ?? null;
    line.rate = nr;
    line.cell_meta = { ...line.cell_meta, rate: { src: "converted", formula: `${fmt(r)} ÷ ${fmt(conv.factor)}`, original: r, note: `${fmt(r)} per ${conv.from} → ${fmt(nr)} per ${conv.to}`, at: stamp } };
    changes.push({ lineId: line.id, itemCode: line.item_code, field: "rate", oldValue: r, newValue: nr, oldMeta, newMeta: line.cell_meta.rate!, cause: "conversion" });
  }
  return changes;
}

export function revertUnitConversion(line: LineItem): CellChange[] {
  const c = line.converted;
  if (!c) return [];
  const changes: CellChange[] = [];
  const restore = (field: "quantity" | "rate", value: number | null) => {
    const oldMeta = line.cell_meta?.[field] ?? null;
    const old = numeric(line, field);
    (line as unknown as Record<string, unknown>)[field] = value;
    const { [field]: _drop, ...rest } = line.cell_meta ?? {};
    void _drop;
    line.cell_meta = rest;
    changes.push({ lineId: line.id, itemCode: line.item_code, field, oldValue: old, newValue: value, oldMeta, newMeta: null, cause: "revert_conversion" });
  };
  restore("quantity", c.original_quantity);
  restore("rate", c.original_rate);
  const oldUnit = line.unit;
  line.unit = normalizeUnit(line.unit_raw);
  const { unit_raw: _u, ...rest } = line.cell_meta ?? {};
  void _u;
  line.cell_meta = rest;
  line.converted = null;
  changes.push({ lineId: line.id, itemCode: line.item_code, field: "unit", oldValue: oldUnit, newValue: line.unit, oldMeta: null, newMeta: null, cause: "revert_conversion" });
  return changes;
}

type PlausibilityCtx = {
  tenderLine?: Pick<LineItem, "quantity" | "rate" | "unit"> | null;
  medianRate?: number | null;
  role: "tender" | "bid";
};

/** Flags values that are mathematically fine but unlikely in the real world. */
export function checkPlausibility(line: LineItem, ctx: PlausibilityCtx): Anomaly[] {
  if (line.kind !== "item") return [];
  const out: Anomaly[] = [];
  const q = numeric(line, "quantity");
  const r = numeric(line, "rate");
  const a = numeric(line, "amount");
  const unit = line.unit ?? "";
  const priced = line.quote_status === "priced" || line.quote_status == null;

  for (const [f, v] of [["quantity", q], ["rate", r], ["amount", a]] as const) {
    if (v != null && v < 0) out.push({ field: f, code: "negative_value", severity: "error", message: `${f[0].toUpperCase() + f.slice(1)} is negative (${fmt(v)}), which isn't realistic for a quoted line.` });
  }
  if (q === 0 && (a ?? 0) > 0) out.push({ field: "quantity", code: "zero_quantity", severity: "warn", message: `Quantity is 0 but an amount of ${fmt(a)} is charged.` });
  if (q != null && unit === "nos" && !Number.isInteger(q) && Math.abs(q - Math.round(q)) > 0.0001) {
    out.push({ field: "quantity", code: "fractional_count", severity: "warn", message: `${fmt(q)} nos is a fractional count — you can't buy part of a piece.` });
  }
  if (q != null && q > 10_000_000) out.push({ field: "quantity", code: "implausible_magnitude", severity: "warn", message: `Quantity ${fmt(q)} ${unit} is unusually large.` });
  if (r != null && r > 100_000_000) out.push({ field: "rate", code: "implausible_magnitude", severity: "warn", message: `Rate ${fmt(r)} per ${unit || "unit"} is unusually large.` });
  if (a != null && a > 100_000_000_000) out.push({ field: "amount", code: "implausible_magnitude", severity: "warn", message: `Amount ${fmt(a)} is unusually large.` });
  if (priced && r != null && r > 0 && r < 1 && unit !== "%" && unit !== "ls") {
    out.push({ field: "rate", code: "implausible_low_rate", severity: "warn", message: `Rate ${fmt(r)} per ${unit || "unit"} is below ₹1 — likely a typing or unit slip.` });
  }
  if (priced && q != null && r != null && a != null && q > 0) {
    const expected = q * r;
    if (Math.abs(expected - a) > Math.max(1, Math.abs(expected) * 0.005)) {
      const f = line.cell_meta?.amount?.src === "autofill" ? "amount" : "amount";
      out.push({ field: f, code: "amount_mismatch", severity: "warn", message: `${fmt(q)} × ${fmt(r)} = ${fmt(round4(expected))}, but the amount is ${fmt(a)}.` });
    }
  }
  if (ctx.role === "bid") {
    const t = ctx.tenderLine;
    if (t?.quantity && q != null && t.quantity > 0) {
      const dev = Math.abs(q - t.quantity) / t.quantity;
      if (dev > 0.25) out.push({ field: "quantity", code: "qty_deviation", severity: "warn", message: `Quoted quantity ${fmt(q)} differs from your BOQ quantity ${fmt(t.quantity)} by ${Math.round(dev * 100)}%.` });
    }
    const ref = t?.rate && t.rate > 0 ? t.rate : ctx.medianRate;
    if (r != null && r > 0 && ref && ref > 0) {
      const ratio = r / ref;
      const basis = t?.rate && t.rate > 0 ? "your budget rate" : "the median of the other bids";
      if (ratio > 5) out.push({ field: "rate", code: "rate_outlier_high", severity: "warn", message: `Rate ${fmt(r)} is ${ratio.toFixed(1)}× ${basis} (${fmt(ref)}) — unlikely to be realistic.` });
      else if (ratio < 0.2) out.push({ field: "rate", code: "rate_outlier_low", severity: "warn", message: `Rate ${fmt(r)} is only ${Math.round(ratio * 100)}% of ${basis} (${fmt(ref)}) — unlikely to be realistic.` });
    }
    if (t?.unit && line.unit && unitsIncompatible(line.unit, t.unit)) {
      out.push({ field: "unit_raw", code: "unit_incompatible", severity: "error", message: `Unit "${line.unit}" can't be converted to your BOQ unit "${t.unit}" — compare these rates with care.` });
    }
  } else if (r != null && ctx.medianRate != null) {
    /* tender budget rates are not compared */
  }
  return out;
}

/** Everything the review panel needs, derived (not stored) so it can never go stale. */
export function deriveReview(doc: Pick<Document, "issues" | "header_extra">, lines: LineItem[]): { issues: Issue[]; counts: Record<string, number>; acked: string[] } {
  const acked: string[] = doc.header_extra?.acks ?? [];
  const issues: Issue[] = [];
  for (const i of doc.issues ?? []) issues.push({ ...i, category: i.category ?? "ingest", id: i.id ?? `doc:${i.code}:${i.message.slice(0, 40)}` });

  for (const l of lines) {
    if (l.kind !== "item") continue;
    for (const [field, meta] of Object.entries(l.cell_meta ?? {}) as [string, CellMeta][]) {
      if (meta.src === "autofill") {
        issues.push({
          id: `autofill:${l.id}:${field}`,
          code: "autofilled",
          severity: "info",
          category: "autofill",
          line_id: l.id,
          item_code: l.item_code,
          field,
          message: `${l.item_code} ${l.name ?? ""}: ${field === "quote_status" ? "marked priced" : `${field} was missing and has been filled in`}${meta.formula ? ` as ${describeFormula(meta.formula)}` : ""}.`,
        });
      } else if (meta.src === "ai" && field !== "trade") {
        issues.push({ id: `ai:${l.id}:${field}`, code: "ai_inferred", severity: "info", category: "autofill", line_id: l.id, item_code: l.item_code, field, message: `${l.item_code} ${l.name ?? ""}: ${field} was inferred by AI.` });
      }
    }
    if (l.converted) {
      issues.push({
        id: `convert:${l.id}`,
        code: "unit_converted",
        severity: "warn",
        category: "conversion",
        line_id: l.id,
        item_code: l.item_code,
        message: `${l.item_code} ${l.name ?? ""}: converted ${fmt(l.converted.original_quantity)} ${l.converted.from} → ${fmt(l.quantity)} ${l.converted.to} (× ${fmt(l.converted.factor)}) to match your BOQ unit.`,
      });
    }
    for (const a of l.anomalies ?? []) {
      issues.push({ id: `anom:${l.id}:${a.code}`, code: a.code, severity: a.severity, category: "plausibility", line_id: l.id, item_code: l.item_code, field: a.field, message: `${l.item_code} ${l.name ?? ""}: ${a.message}` });
    }
    if (l.match_confidence === "low") {
      issues.push({ id: `match:${l.id}`, code: "low_confidence_match", severity: "warn", category: "match", line_id: l.id, item_code: l.item_code, message: `${l.item_code} ${l.name ?? ""} was matched to your BOQ with low confidence.` });
    }
  }
  const withState = issues.map((i) => ({ ...i, resolved: i.resolved || (i.id ? acked.includes(i.id) : false) }));
  const counts: Record<string, number> = {};
  for (const i of withState) if (!i.resolved) counts[i.category ?? "ingest"] = (counts[i.category ?? "ingest"] ?? 0) + 1;
  return { issues: withState, counts, acked };
}
