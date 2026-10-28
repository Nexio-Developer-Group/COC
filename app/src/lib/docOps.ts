import { db } from "@/lib/db";
import { applyUnitConversion, checkPlausibility, previewFormula, recompute, revertUnitConversion, type FormulaPreviewRow } from "@/lib/calc";
import { describeFormula, evaluate, parseFormula, validateFormula, type NumericField } from "@/lib/formula";
import { normalizeUnit } from "@/lib/units";
import type { CellMeta, Document, LineItem } from "@/lib/types";

export type DocBundle = { doc: Document; lines: LineItem[] };

const TRACKED = ["name", "description", "unit_raw", "unit", "quantity", "rate", "amount", "remarks", "quote_status", "flags", "tender_line_id", "trade", "cell_meta", "converted", "prices", "anomalies", "match_method", "match_confidence", "match_note"] as const;

export async function loadDoc(documentId: string): Promise<DocBundle | null> {
  const { data: doc } = await db.from("documents").select("*").eq("id", documentId).single<Document>();
  if (!doc) return null;
  const { data: lines } = await db.from("line_items").select("*").eq("document_id", documentId).order("position").returns<LineItem[]>();
  return { doc, lines: (lines ?? []).map(normalizeLine) };
}

function normalizeLine(l: LineItem): LineItem {
  return {
    ...l,
    quantity: l.quantity == null ? null : Number(l.quantity),
    rate: l.rate == null ? null : Number(l.rate),
    amount: l.amount == null ? null : Number(l.amount),
    cell_meta: l.cell_meta ?? {},
    anomalies: l.anomalies ?? [],
    converted: l.converted ?? null,
    prices: l.prices ?? [],
    flags: l.flags ?? [],
  };
}

const snap = (l: LineItem) => JSON.stringify(TRACKED.map((k) => (l as unknown as Record<string, unknown>)[k] ?? null));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export type Notice =
  | { kind: "formula_override"; field: string; formula: string; message: string }
  | { kind: "dependent_mismatch"; field: NumericField; lineId: string; current: number | null; suggested: number; message: string }
  | { kind: "dependents_broken"; codes: string[]; message: string }
  | { kind: "info"; message: string };

export type EditResult = { ok: true; lines: LineItem[]; changed: string[]; notices: Notice[]; seq: number } | { ok: false; error: string; conflict?: Notice };

async function recomputeAnomalies(bundle: DocBundle) {
  const items = bundle.lines.filter((l) => l.kind === "item");
  let tenderById = new Map<string, LineItem>();
  const medians = new Map<string, number>();
  if (bundle.doc.role === "bid") {
    const { data: t } = await db.from("tenders").select("requirements_doc_id").eq("id", bundle.doc.tender_id).single();
    if (t?.requirements_doc_id) {
      const { data: tl } = await db.from("line_items").select("*").eq("document_id", t.requirements_doc_id).eq("kind", "item").returns<LineItem[]>();
      tenderById = new Map((tl ?? []).map((x) => [x.id, normalizeLine(x)]));
    }
    const { data: others } = await db.from("documents").select("id").eq("tender_id", bundle.doc.tender_id).eq("role", "bid").is("superseded_at", null).neq("id", bundle.doc.id);
    const ids = (others ?? []).map((o) => o.id);
    if (ids.length) {
      const { data: ol } = await db.from("line_items").select("tender_line_id, rate").in("document_id", ids).not("tender_line_id", "is", null).gt("rate", 0);
      const by = new Map<string, number[]>();
      for (const r of ol ?? []) by.set(r.tender_line_id, [...(by.get(r.tender_line_id) ?? []), Number(r.rate)]);
      for (const [k, v] of by) {
        if (v.length < 2) continue;
        const s = [...v].sort((a, b) => a - b);
        medians.set(k, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
      }
    }
  }
  for (const l of items) {
    const t = l.tender_line_id ? tenderById.get(l.tender_line_id) : null;
    l.anomalies = checkPlausibility(l, { role: bundle.doc.role, tenderLine: t ? { quantity: t.quantity, rate: t.rate, unit: t.unit } : null, medianRate: l.tender_line_id ? medians.get(l.tender_line_id) ?? null : null });
  }
}

/** Writes only the lines that changed, logs each cell change, bumps the edit sequence. */
async function persist(bundle: DocBundle, before: Map<string, string>, beforeLines: Map<string, LineItem>, cause: string, reason?: string | null): Promise<{ changed: string[]; seq: number }> {
  const changed: string[] = [];
  const seq = (bundle.doc.edit_seq ?? 0) + 1;
  const logs: Record<string, unknown>[] = [];
  const stamp = new Date().toISOString();
  for (const l of bundle.lines) {
    if (before.get(l.id) === snap(l)) continue;
    changed.push(l.id);
    const old = beforeLines.get(l.id)!;
    const patch: Record<string, unknown> = { edited_at: stamp };
    for (const k of TRACKED) patch[k] = (l as unknown as Record<string, unknown>)[k] ?? (k === "flags" ? [] : null);
    await db.from("line_items").update(patch).eq("id", l.id);
    for (const f of ["name", "description", "unit_raw", "quantity", "rate", "amount", "remarks", "quote_status", "flags", "tender_line_id", "trade"] as const) {
      const ov = (old as unknown as Record<string, unknown>)[f] ?? null;
      const nv = (l as unknown as Record<string, unknown>)[f] ?? null;
      const om = (old.cell_meta as Record<string, CellMeta | undefined>)[f] ?? null;
      const nm = (l.cell_meta as Record<string, CellMeta | undefined>)[f] ?? null;
      if (JSON.stringify(ov) === JSON.stringify(nv) && JSON.stringify(om) === JSON.stringify(nm)) continue;
      logs.push({ document_id: bundle.doc.id, line_item_id: l.id, item_code: l.item_code, seq, field: f, old_value: ov, new_value: nv, old_meta: om, new_meta: nm, reason: reason ?? null, cause });
    }
  }
  if (logs.length) await db.from("line_item_edits").insert(logs);
  const total = bundle.lines.filter((l) => l.kind === "item").reduce((s, l) => s + (l.amount ?? 0), 0);
  await db.from("documents").update({ computed_total: total, edit_seq: seq, field_rules: bundle.doc.field_rules }).eq("id", bundle.doc.id);
  bundle.doc.edit_seq = seq;
  bundle.doc.computed_total = total;
  return { changed, seq };
}

function begin(bundle: DocBundle) {
  const before = new Map(bundle.lines.map((l) => [l.id, snap(l)]));
  const beforeLines = new Map(bundle.lines.map((l) => [l.id, clone(l)]));
  return { before, beforeLines };
}

async function getTenderLine(bundle: DocBundle, tenderLineId: string | null): Promise<LineItem | null> {
  if (!tenderLineId) return null;
  const { data } = await db.from("line_items").select("*").eq("id", tenderLineId).single<LineItem>();
  return data ? normalizeLine(data) : null;
}

export type EditInput = { field: string; value: unknown; force?: boolean; reason?: string | null };

export async function applyEdit(documentId: string, lineId: string, input: EditInput): Promise<EditResult> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return { ok: false, error: "Document not found" };
  const line = bundle.lines.find((l) => l.id === lineId);
  if (!line) return { ok: false, error: "Row not found" };
  const { field } = input;
  const { before, beforeLines } = begin(bundle);
  const notices: Notice[] = [];
  const stamp = new Date().toISOString();
  const meta = line.cell_meta as Record<string, CellMeta | undefined>;
  const rec = line as unknown as Record<string, unknown>;

  if (field === "quantity" || field === "rate" || field === "amount") {
    let v: number | null = null;
    if (input.value !== null && input.value !== "" && input.value !== undefined) {
      v = Number(String(input.value).replace(/,/g, ""));
      if (!Number.isFinite(v)) return { ok: false, error: "That isn't a number." };
    }
    const m = meta[field];
    if (m?.formula && !input.force && m.src !== "converted") {
      return { ok: false, error: "formula", conflict: { kind: "formula_override", field, formula: m.formula, message: `${field[0].toUpperCase() + field.slice(1)} is calculated as ${describeFormula(m.formula)}. Typing a value will replace the formula for this row.` } };
    }
    const prev = line[field];
    rec[field] = v;
    meta[field] = { src: "manual", original: m?.original ?? (m?.src && m.src !== "manual" ? m.original ?? prev : prev), at: stamp, note: "Edited by you" };
  } else if (field === "unit_raw") {
    const text = input.value == null ? null : String(input.value).trim() || null;
    if (line.converted) revertUnitConversion(line);
    line.unit_raw = text;
    line.unit = normalizeUnit(text);
    meta.unit_raw = { src: "manual", original: beforeLines.get(line.id)!.unit_raw, at: stamp, note: "Edited by you" };
    if (line.tender_line_id) applyUnitConversion(line, await getTenderLine(bundle, line.tender_line_id));
  } else if (field === "tender_line_id") {
    if (line.converted) revertUnitConversion(line);
    line.tender_line_id = (input.value as string | null) || null;
    line.match_method = "manual";
    line.match_confidence = line.tender_line_id ? "exact" : null;
    line.match_note = line.tender_line_id ? "Linked by you" : null;
    if (line.tender_line_id) applyUnitConversion(line, await getTenderLine(bundle, line.tender_line_id));
  } else if (["name", "description", "remarks", "quote_status", "trade"].includes(field)) {
    rec[field] = input.value == null || input.value === "" ? null : input.value;
    meta[field] = { src: "manual", original: beforeLines.get(line.id)!.cell_meta[field as keyof LineItem["cell_meta"]]?.original ?? (beforeLines.get(line.id) as unknown as Record<string, unknown>)[field] as string, at: stamp, note: "Edited by you" };
  } else if (field === "flags") {
    line.flags = Array.isArray(input.value) ? (input.value as string[]) : [];
  } else {
    return { ok: false, error: `Field "${field}" can't be edited.` };
  }

  recompute(bundle.lines, bundle.doc.field_rules, { primaryVariant: bundle.doc.primary_variant, cause: "recalc" });
  syncPrimaryPrice(line, bundle.doc.primary_variant);

  // a document-sourced dependent that no longer matches is surfaced, never silently rewritten
  if (field === "quantity" || field === "rate") {
    const q = line.quantity;
    const r = line.rate;
    const a = line.amount;
    if (q != null && r != null && a != null && !meta.amount?.formula && Math.abs(q * r - a) > Math.max(1, Math.abs(q * r) * 0.005)) {
      notices.push({ kind: "dependent_mismatch", field: "amount", lineId: line.id, current: a, suggested: Math.round(q * r * 10000) / 10000, message: `Amount ${a.toLocaleString("en-IN")} came from the document and no longer equals Quantity × Rate (${(q * r).toLocaleString("en-IN")}).` });
    }
  }
  await recomputeAnomalies(bundle);
  const { changed, seq } = await persist(bundle, before, beforeLines, "user", input.reason ?? null);
  return { ok: true, lines: bundle.lines.filter((l) => changed.includes(l.id)), changed, notices, seq };
}

function syncPrimaryPrice(line: LineItem, primary: string | null) {
  if (!line.prices?.length) return;
  const idx = Math.max(0, line.prices.findIndex((p) => p.variant === primary));
  line.prices = line.prices.map((p, i) => (i === idx ? { ...p, rate: line.rate, amount: line.amount } : p));
}

export type FormulaInput = {
  field: NumericField;
  expr: string | null; // null => remove formula (keep value, take manual control)
  scope: "cell" | "section" | "document";
  lineId?: string;
  sectionId?: string;
  mode: "preview" | "apply";
  overwriteIds?: string[] | "all";
  saveAsRule?: boolean;
};

export async function applyFormula(documentId: string, input: FormulaInput): Promise<{ ok: true; rows?: FormulaPreviewRow[]; lines?: LineItem[]; changed?: string[]; skipped?: string[]; seq?: number } | { ok: false; error: string }> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return { ok: false, error: "Document not found" };
  const items = bundle.lines.filter((l) => l.kind === "item");
  let targets = items;
  if (input.scope === "cell") targets = items.filter((l) => l.id === input.lineId);
  if (input.scope === "section") targets = items.filter((l) => l.parent_id === input.sectionId);
  if (targets.length === 0) return { ok: false, error: "No rows to apply this to." };
  const targetIds = new Set(targets.map((t) => t.id));
  const { before, beforeLines } = begin(bundle);
  const stamp = new Date().toISOString();

  if (input.expr === null) {
    for (const t of targets) {
      const m = t.cell_meta[input.field];
      if (m?.formula) t.cell_meta = { ...t.cell_meta, [input.field]: { src: "manual", original: m.original, at: stamp, note: "Formula removed — value kept" } };
    }
    const { changed, seq } = await persist(bundle, before, beforeLines, "formula_removed");
    return { ok: true, lines: bundle.lines.filter((l) => changed.includes(l.id)), changed, seq };
  }

  const v = validateFormula(input.expr, input.field);
  if (!v.ok) return { ok: false, error: v.error };
  const preview = previewFormula(bundle.lines, input.field, input.expr, targetIds);
  if (!preview.ok) return preview;
  if (input.mode === "preview") return { ok: true, rows: preview.rows };

  const ast = parseFormula(input.expr);
  const allowed = new Set<string>();
  const skipped: string[] = [];
  for (const r of preview.rows) {
    const overwrite = input.overwriteIds === "all" || (Array.isArray(input.overwriteIds) && input.overwriteIds.includes(r.lineId));
    if (!r.conflict || overwrite) allowed.add(r.lineId);
    else skipped.push(r.lineId);
  }
  const byCode = new Map(items.map((l) => [l.item_code, l]));
  for (const t of targets) {
    if (!allowed.has(t.id)) continue;
    const value = evaluate(ast, (row, f) => {
      const src = row ? byCode.get(row) : t;
      const n = src ? src[f] : null;
      return n == null ? null : Number(n);
    });
    const old = t.cell_meta[input.field];
    (t as unknown as Record<string, unknown>)[input.field] = value;
    t.cell_meta = {
      ...t.cell_meta,
      [input.field]: { src: "manual", formula: input.expr, rule: input.scope === "document" ? "document" : "row", original: old?.original ?? beforeLines.get(t.id)![input.field], at: stamp, note: `Formula set by you: ${describeFormula(input.expr)}` },
    };
  }
  if (input.scope === "document" && input.saveAsRule) {
    bundle.doc.field_rules = { ...bundle.doc.field_rules, [input.field]: { expr: input.expr, enabled: true } };
  }
  recompute(bundle.lines, bundle.doc.field_rules, { primaryVariant: bundle.doc.primary_variant, cause: "recalc" });
  for (const l of items) syncPrimaryPrice(l, bundle.doc.primary_variant);
  await recomputeAnomalies(bundle);
  const { changed, seq } = await persist(bundle, before, beforeLines, "formula");
  return { ok: true, lines: bundle.lines.filter((l) => changed.includes(l.id)), changed, skipped, seq };
}

/** Undo a whole user action (everything logged under one sequence number). */
export async function revertSeq(documentId: string, seq: number): Promise<EditResult> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return { ok: false, error: "Document not found" };
  const { data: edits } = await db.from("line_item_edits").select("*").eq("document_id", documentId).eq("seq", seq);
  if (!edits?.length) return { ok: false, error: "Nothing to undo for that change." };
  const { before, beforeLines } = begin(bundle);
  for (const e of edits) {
    const line = bundle.lines.find((l) => l.id === e.line_item_id);
    if (!line) continue;
    (line as unknown as Record<string, unknown>)[e.field] = e.old_value;
    const meta = { ...line.cell_meta } as Record<string, CellMeta | undefined>;
    if (e.old_meta) meta[e.field] = e.old_meta;
    else delete meta[e.field];
    line.cell_meta = meta;
    if (e.field === "unit_raw") line.unit = normalizeUnit(e.old_value as string | null);
  }
  await recomputeAnomalies(bundle);
  const { changed, seq: newSeq } = await persist(bundle, before, beforeLines, "revert", `Undid change #${seq}`);
  return { ok: true, lines: bundle.lines.filter((l) => changed.includes(l.id)), changed, notices: [], seq: newSeq };
}

export async function addLine(documentId: string, input: { sectionId: string; afterLineId?: string | null; values: Partial<Pick<LineItem, "name" | "description" | "unit_raw" | "quantity" | "rate" | "amount" | "remarks">> }): Promise<EditResult> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return { ok: false, error: "Document not found" };
  const section = bundle.lines.find((l) => l.id === input.sectionId && l.kind === "section");
  if (!section) return { ok: false, error: "Section not found" };
  const siblings = bundle.lines.filter((l) => l.parent_id === section.id);
  const maxN = siblings.reduce((m, l) => Math.max(m, Number(l.item_code.split(".").pop()) || 0), 0);
  const id = crypto.randomUUID();
  const after = input.afterLineId ? bundle.lines.find((l) => l.id === input.afterLineId) : siblings[siblings.length - 1] ?? section;
  const position = (after?.position ?? section.position) + 1;
  // shift positions after the insertion point
  const toShift = bundle.lines.filter((l) => l.position >= position);
  for (const l of toShift) await db.from("line_items").update({ position: l.position + 1 }).eq("id", l.id);
  const stamp = new Date().toISOString();
  const v = input.values;
  const row = {
    id, document_id: documentId, parent_id: section.id, kind: "item" as const, position, item_code: `${section.item_code}.${maxN + 1}`, source_ref: null,
    name: v.name ?? null, description: v.description ?? null, unit_raw: v.unit_raw ?? null, unit: normalizeUnit(v.unit_raw ?? null), quantity: v.quantity ?? null, rate: v.rate ?? null, amount: v.amount ?? null,
    prices: [], quote_status: "priced", flags: [], remarks: v.remarks ?? null, attributes: {}, trade: null, extraction_confidence: "high",
    cell_meta: Object.fromEntries(["name", "quantity", "rate", "amount", "unit_raw"].filter((k) => (v as Record<string, unknown>)[k] != null).map((k) => [k, { src: "manual", at: stamp, note: "Added by you" }])),
    anomalies: [], converted: null, sheet_name: section.sheet_name, source_row: null, edited_at: stamp, tender_line_id: null, match_method: null, match_confidence: null, match_note: null,
  };
  const { error } = await db.from("line_items").insert(row);
  if (error) return { ok: false, error: error.message };
  const fresh = await loadDoc(documentId);
  if (!fresh) return { ok: false, error: "Reload failed" };
  const { before, beforeLines } = begin(fresh);
  recompute(fresh.lines, fresh.doc.field_rules, { primaryVariant: fresh.doc.primary_variant });
  await recomputeAnomalies(fresh);
  const { changed, seq } = await persist(fresh, before, beforeLines, "add_row");
  await db.from("line_item_edits").insert({ document_id: documentId, line_item_id: id, item_code: row.item_code, seq, field: "row", old_value: null, new_value: { added: true }, cause: "add_row" });
  return { ok: true, lines: fresh.lines, changed: [id, ...changed], notices: [], seq };
}

export async function deleteLine(documentId: string, lineId: string): Promise<EditResult> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return { ok: false, error: "Document not found" };
  const line = bundle.lines.find((l) => l.id === lineId);
  if (!line) return { ok: false, error: "Row not found" };
  const notices: Notice[] = [];
  const dependents = bundle.lines.filter((l) => l.id !== lineId && Object.values(l.cell_meta).some((m) => m?.formula?.includes(`[${line.item_code}]`)));
  if (dependents.length) notices.push({ kind: "dependents_broken", codes: dependents.map((d) => d.item_code), message: `Formulas in ${dependents.map((d) => d.item_code).join(", ")} referred to ${line.item_code}; they will show blank until you edit them.` });
  const seq = (bundle.doc.edit_seq ?? 0) + 1;
  await db.from("line_item_edits").insert({ document_id: documentId, line_item_id: null, item_code: line.item_code, seq, field: "row", old_value: clone(line), new_value: null, cause: "delete_row", reason: `Deleted ${line.item_code} ${line.name ?? ""}` });
  await db.from("line_items").delete().eq("id", lineId);
  const fresh = await loadDoc(documentId);
  if (!fresh) return { ok: false, error: "Reload failed" };
  const { before, beforeLines } = begin(fresh);
  recompute(fresh.lines, fresh.doc.field_rules, { primaryVariant: fresh.doc.primary_variant });
  await recomputeAnomalies(fresh);
  const res = await persist(fresh, before, beforeLines, "recalc");
  await db.from("documents").update({ edit_seq: Math.max(seq, res.seq) }).eq("id", documentId);
  return { ok: true, lines: fresh.lines, changed: res.changed, notices, seq };
}

/** Switch the active price option; rewrites headline rate/amount from each row's prices. */
export async function setPrimaryVariant(documentId: string, variant: string): Promise<void> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return;
  const { before, beforeLines } = begin(bundle);
  for (const l of bundle.lines.filter((x) => x.kind === "item")) {
    const chosen = l.prices.find((p) => p.variant === variant) ?? l.prices[0];
    if (chosen) {
      l.rate = chosen.rate;
      l.amount = chosen.amount;
      const { rate: _r, amount: _a, ...rest } = l.cell_meta;
      void _r;
      void _a;
      l.cell_meta = rest;
    }
  }
  bundle.doc.primary_variant = variant;
  recompute(bundle.lines, bundle.doc.field_rules, { primaryVariant: variant });
  await recomputeAnomalies(bundle);
  await persist(bundle, before, beforeLines, "variant_switch", `Switched to price option ${variant}`);
  await db.from("documents").update({ primary_variant: variant }).eq("id", documentId);
}
