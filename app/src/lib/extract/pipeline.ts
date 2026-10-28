import crypto from "crypto";
import { db } from "@/lib/db";
import { groqJsonCompletion, GROQ_TPM, estimateTokens } from "@/lib/groq";
import { ExtractionSchema, type Extraction, type ExtractedItem } from "./schema";
import { PROMPT_VERSION, SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT, buildUserPrompt } from "./prompts";
import { normalizeUnit } from "@/lib/units";
import { matchAll, type MatchCandidate } from "@/lib/match";
import { chunkSheet, readFile } from "@/lib/ingest/readFile";
import { storeImages, linkImagesToLines } from "@/lib/ingest/images";
import { applyUnitConversion, checkPlausibility, recompute, unitMedians } from "@/lib/calc";
import type { CellMeta, Document, DocumentSheet, Issue, LineItem, Price } from "@/lib/types";

export type StepResult = { done: boolean; phase: "prepare" | "extract" | "finalize" | "failed"; detail: string; total: number; completed: number };

const MAX_TENDER_TABLE_ROWS = 70;

function pickPrimaryVariant(items: { prices: Price[] }[]): string {
  const totals = new Map<string, number>();
  for (const item of items) for (const p of item.prices) if (p.amount != null) totals.set(p.variant, (totals.get(p.variant) ?? 0) + p.amount);
  if (totals.size === 0) return "default";
  let best = "default";
  let bestTotal = Infinity;
  for (const [v, t] of totals) if (t < bestTotal) [best, bestTotal] = [v, t];
  return best;
}

async function setProgress(docId: string, patch: Record<string, unknown>, status_detail?: string | null) {
  const { data } = await db.from("documents").select("progress").eq("id", docId).single();
  await db
    .from("documents")
    .update({ progress: { ...(data?.progress ?? {}), ...patch }, ...(status_detail !== undefined ? { status_detail } : {}) })
    .eq("id", docId);
}

/** One resumable step. The client keeps calling until `done`. Safe to call again after a crash. */
export async function runStep(documentId: string, opts: { restart?: boolean; retryFailed?: boolean } = {}): Promise<StepResult> {
  const { data: doc } = await db.from("documents").select("*").eq("id", documentId).single<Document>();
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  if (opts.restart) {
    await db.from("document_sheets").delete().eq("document_id", documentId);
    await db.from("document_images").delete().eq("document_id", documentId).eq("origin", "embedded");
    await db.from("documents").update({ status: "uploaded", progress: {} }).eq("id", documentId);
    doc.status = "uploaded";
  }

  const { data: sheets } = await db.from("document_sheets").select("id, idx, name, status, kind, error, image_count, row_count").eq("document_id", documentId).order("idx").returns<DocumentSheet[]>();

  if (!sheets || sheets.length === 0) return prepare(doc);

  if (opts.retryFailed) {
    await db.from("document_sheets").update({ status: "pending", error: null }).eq("document_id", documentId).eq("status", "failed");
    sheets.forEach((s) => s.status === "failed" && (s.status = "pending"));
  }

  const next = sheets.find((s) => s.status === "pending");
  if (next) return extractSheet(doc, next, sheets);

  return finalize(doc);
}

async function prepare(doc: Document): Promise<StepResult> {
  await db.from("documents").update({ status: "processing", status_detail: "Opening your file…" }).eq("id", doc.id);
  const dl = await db.storage.from("tender-files").download(doc.storage_path);
  if (dl.error || !dl.data) {
    await fail(doc.id, `Could not read the stored file: ${dl.error?.message ?? "missing"}`);
    return { done: true, phase: "failed", detail: "File missing", total: 0, completed: 0 };
  }
  const buffer = Buffer.from(await dl.data.arrayBuffer());
  let read;
  try {
    read = await readFile(buffer, doc.file_name, doc.mime_type ?? "");
  } catch (e) {
    await fail(doc.id, `Could not read this file: ${e instanceof Error ? e.message : String(e)}`);
    return { done: true, phase: "failed", detail: "Unreadable file", total: 0, completed: 0 };
  }

  const chunks = read.sheets.flatMap((s) => chunkSheet(s));
  if (chunks.length === 0 && read.images.length === 0) {
    await fail(doc.id, "The file has no readable content.");
    return { done: true, phase: "failed", detail: "Empty file", total: 0, completed: 0 };
  }

  if (read.images.length) await storeImages({ tenderId: doc.tender_id, documentId: doc.id, images: read.images, origin: "embedded" });

  if (chunks.length) {
    await db.from("document_sheets").insert(
      chunks.map((c, i) => ({
        document_id: doc.id,
        idx: i,
        name: c.name,
        row_count: c.rowCount,
        rendered_text: c.text,
        image_count: c.imageCount,
        raw_output: c.context ? { _context: c.context } : null,
        status: "pending",
      }))
    );
  }
  const combined = chunks.map((c) => `=== ${c.name} ===\n${c.text}`).join("\n\n");
  await db.from("documents").update({ rendered_text: combined.slice(0, 200_000) }).eq("id", doc.id);
  await setProgress(doc.id, { total: chunks.length, done: 0, phase: "extract", images: read.images.length }, chunks.length ? `Reading ${chunks.length} sheet part${chunks.length > 1 ? "s" : ""}…` : "Saving images…");
  if (chunks.length === 0) return finalize(doc);
  return { done: false, phase: "prepare", detail: `Found ${read.sheets.length} sheet(s), ${read.images.length} image(s)`, total: chunks.length, completed: 0 };
}

async function fail(docId: string, message: string) {
  await db
    .from("documents")
    .update({ status: "failed", status_detail: message, issues: [{ code: "ingest_failed", severity: "error", category: "ingest", message }] })
    .eq("id", docId);
}

async function tenderCandidates(doc: Document, tenderReqId: string | null) {
  if (doc.role !== "bid" || !tenderReqId) return { table: undefined as string | undefined, candidates: [] as (MatchCandidate & { unit_raw: string | null; rate: number | null })[] };
  const { data: lines } = await db.from("line_items").select("*").eq("document_id", tenderReqId).order("position").returns<LineItem[]>();
  const sections = new Map((lines ?? []).filter((l) => l.kind === "section").map((s) => [s.id, s.name]));
  const candidates = (lines ?? [])
    .filter((l) => l.kind === "item")
    .map((l) => ({
      id: l.id,
      item_code: l.item_code,
      source_ref: l.source_ref,
      name: l.name,
      unit: l.unit,
      unit_raw: l.unit_raw,
      rate: l.rate,
      quantity: l.quantity,
      section_name: l.parent_id ? sections.get(l.parent_id) ?? null : null,
    }));
  const table =
    candidates.length > 0 && candidates.length <= MAX_TENDER_TABLE_ROWS
      ? candidates.map((t) => `${t.item_code} | ${t.section_name ?? ""} | ${t.source_ref ?? ""} | ${(t.name ?? "").slice(0, 60)} | ${t.unit ?? ""} | ${t.quantity ?? ""}`).join("\n")
      : undefined;
  return { table, candidates };
}

async function extractSheet(doc: Document, sheet: DocumentSheet, all: DocumentSheet[]): Promise<StepResult> {
  const total = all.length;
  const completed = all.filter((s) => s.status === "done").length;
  await setProgress(doc.id, { total, done: completed, current: sheet.name }, `Reading ${sheet.name} (${completed + 1} of ${total})…`);

  const { data: row } = await db.from("document_sheets").select("rendered_text, raw_output").eq("id", sheet.id).single();
  const context = (row?.raw_output as { _context?: string } | null)?._context ?? "";
  const { data: tender } = await db.from("tenders").select("*").eq("id", doc.tender_id).single();
  const { table } = await tenderCandidates(doc, tender?.requirements_doc_id ?? null);

  const prev = all.filter((s) => s.idx < sheet.idx && s.status === "done").pop();
  let previousSection: string | null = null;
  if (prev) {
    const { data: p } = await db.from("document_sheets").select("raw_output").eq("id", prev.id).single();
    const secs = (p?.raw_output as Extraction | null)?.sections ?? [];
    previousSection = secs.length ? secs[secs.length - 1].name : null;
  }

  const promptFor = (tenderTable: string | undefined) =>
    buildUserPrompt({
      role: doc.role,
      fileName: doc.file_name,
      tenderCurrency: tender?.currency ?? "INR",
      tenderItemsTable: tenderTable,
      documentText: row?.rendered_text ?? "",
      sheetName: sheet.name,
      chunkLabel: `${sheet.idx + 1} of ${total}`,
      previousSection,
      context: context || undefined,
    });
  // Leave room for the answer: ~35 tokens per extracted row, at least 2000.
  const wantOutput = Math.max(2000, Math.min(6000, (sheet.row_count ?? 30) * 70));
  const compact = GROQ_TPM <= 10000;
  const system = compact ? SYSTEM_PROMPT_COMPACT : SYSTEM_PROMPT;
  let userPrompt = promptFor(table);
  if (table && estimateTokens(system + userPrompt) + wantOutput > GROQ_TPM - 300) {
    // the optional tender-items hint doesn't fit this tier; deterministic matching still runs
    userPrompt = promptFor(undefined);
  }

  try {
    const result = await groqJsonCompletion<Extraction>(
      [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      {
        temperature: 0,
        maxRetries: 3,
        promptVersion: PROMPT_VERSION,
        maxCompletionTokens: wantOutput,
        reasoningEffort: "low",
        validate: (parsed) => {
          const r = ExtractionSchema.safeParse(parsed);
          return r.success ? { ok: true } : { ok: false, errors: r.error.issues.slice(0, 15).map((i) => `${i.path.join(".")}: ${i.message}`) };
        },
      }
    );
    const extraction = ExtractionSchema.parse(result.data);
    await db.from("document_sheets").update({ status: "done", kind: extraction.document.sheet_kind, raw_output: extraction, error: null }).eq("id", sheet.id);
    await db.from("llm_calls").insert({
      purpose: "extraction", document_id: doc.id, attempt: result.meta.attempts, model: result.meta.model, prompt_version: PROMPT_VERSION,
      tokens_in: result.meta.tokensIn, tokens_out: result.meta.tokensOut, latency_ms: result.meta.latencyMs, finish_reason: result.meta.finishReason, ok: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("document_sheets").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", sheet.id);
    await db.from("llm_calls").insert({ purpose: "extraction", document_id: doc.id, attempt: 1, model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", prompt_version: PROMPT_VERSION, ok: false, error: msg.slice(0, 500) });
  }

  const remaining = all.filter((s) => s.idx > sheet.idx && s.status === "pending").length;
  await setProgress(doc.id, { done: completed + 1 });
  return { done: false, phase: "extract", detail: `${sheet.name} read`, total, completed: total - remaining };
}

type FlatItem = { item: ExtractedItem; sectionKey: number; sheetName: string };

async function finalize(doc: Document): Promise<StepResult> {
  await db.from("documents").update({ status: "processing", status_detail: "Checking numbers, matching and filling gaps…" }).eq("id", doc.id);

  const { data: sheetRows } = await db.from("document_sheets").select("*").eq("document_id", doc.id).order("idx").returns<(DocumentSheet & { raw_output: Extraction | null })[]>();
  const sheets = sheetRows ?? [];
  const issues: Issue[] = (doc.issues ?? []).filter((i) => i.code === "duplicate_file");
  const good = sheets.filter((s) => s.status === "done" && s.raw_output && "sections" in s.raw_output);

  for (const s of sheets.filter((x) => x.status === "failed")) {
    issues.push({ code: "chunk_failed", severity: "error", category: "ingest", message: `"${s.name}" could not be read (${s.error ?? "unknown error"}). Items on that sheet are missing — use "Retry failed sheets".` });
  }
  if (good.length === 0) {
    await db.from("documents").update({ status: "failed", status_detail: "AI could not read any sheet", issues }).eq("id", doc.id);
    return { done: true, phase: "failed", detail: "Nothing could be read", total: sheets.length, completed: 0 };
  }

  // ---- merge sheets into one tree -------------------------------------------------
  type MSection = { name: string | null; source_ref: string | null; trade: string; sheet: string; items: ExtractedItem[] };
  const merged: MSection[] = [];
  let header: Extraction["document"] | null = null;
  const terms: Extraction["terms"] = [];
  const variantLabels: Record<string, string> = {};
  const seenRows = new Set<string>();
  for (const s of good) {
    const ex = s.raw_output!;
    header = header ?? ex.document;
    header = {
      ...header,
      title: header.title ?? ex.document.title,
      project_name: header.project_name ?? ex.document.project_name,
      document_date: header.document_date ?? ex.document.document_date,
      reference_no: header.reference_no ?? ex.document.reference_no,
      currency: header.currency ?? ex.document.currency,
      tax_rate_percent: header.tax_rate_percent ?? ex.document.tax_rate_percent,
      tax_basis: header.tax_basis !== "unknown" ? header.tax_basis : ex.document.tax_basis,
      party: { ...ex.document.party, ...Object.fromEntries(Object.entries(header.party).filter(([, v]) => v)) } as Extraction["document"]["party"],
      stated_total: ex.document.stated_total ?? header.stated_total,
    };
    Object.assign(variantLabels, ex.document.price_variant_labels ?? {});
    terms.push(...(ex.terms ?? []));
    if (s.kind === "summary" || s.kind === "cover") {
      const n = ex.sections.reduce((a, x) => a + x.items.length, 0);
      issues.push({ code: "sheet_skipped", severity: "info", category: "ingest", message: `Sheet "${s.name}" looks like a ${s.kind} page, so its ${n} line(s) were not counted as items.` });
      continue;
    }
    const base = s.name.split(" (part")[0];
    ex.sections.forEach((sec, secIdx) => {
      // drop rows a later chunk repeated from an earlier one (same sheet, same printed row)
      const fresh = sec.items.filter((it) => {
        if (it.source_row == null) return true;
        const key = `${base}|${it.source_row}`;
        if (seenRows.has(key)) return false;
        seenRows.add(key);
        return true;
      });
      const last = merged[merged.length - 1];
      const norm = (n: string | null) => (n ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const sameSheet = last && last.sheet.split(" (part")[0] === base;
      const continues = sameSheet && secIdx === 0 && (sec.continues_previous_section || !sec.name || norm(sec.name) === norm(last.name));
      if (continues) last.items.push(...fresh);
      else if (fresh.length || sec.items.length === 0) merged.push({ name: sec.name, source_ref: sec.source_ref, trade: sec.trade, sheet: s.name, items: fresh });
    });
  }
  header = header!;

  const flat: FlatItem[] = merged.flatMap((m, si) => m.items.map((item) => ({ item, sectionKey: si, sheetName: m.sheet })));
  const primaryVariant = pickPrimaryVariant(flat.map((f) => f.item));
  const priceVariants = Object.entries(variantLabels).map(([key, label]) => ({ key, label }));

  // ---- build line rows ---------------------------------------------------------------
  const { data: tender } = await db.from("tenders").select("*").eq("id", doc.tender_id).single();
  const { candidates } = await tenderCandidates(doc, tender?.requirements_doc_id ?? null);
  const stamp = new Date().toISOString();
  const lines: LineItem[] = [];
  let pos = 0;
  const matches =
    doc.role === "bid" && candidates.length
      ? matchAll(
          merged.flatMap((sec, si) => sec.items.map((item, ii) => ({ key: `${si}.${ii}`, source_ref: item.source_ref, name: item.name, description: item.description, unit: item.unit, quantity: item.quantity, section_name: sec.name, hint: item.tender_ref ?? null }))),
          candidates
        )
      : new Map();
  merged.forEach((sec, si) => {
    const sectionId = crypto.randomUUID();
    pos++;
    lines.push({
      id: sectionId, document_id: doc.id, parent_id: null, kind: "section", position: pos, item_code: String(si + 1), source_ref: sec.source_ref, name: sec.name,
      description: null, trade: sec.trade, unit_raw: null, unit: null, quantity: null, rate: null, amount: null, prices: [], quote_status: null, flags: [], remarks: null,
      attributes: {}, extraction_confidence: null, cell_meta: { trade: { src: "ai", note: "Trade category was inferred by AI", at: stamp } }, anomalies: [], converted: null, sheet_name: sec.sheet, source_row: null, edited_at: null,
      tender_line_id: null, match_method: null, match_confidence: null, match_note: null,
    });
    sec.items.forEach((item, ii) => {
      pos++;
      const primary = item.prices.find((p) => p.variant === primaryVariant) ?? item.prices[0] ?? null;
      let tenderLineId: string | null = null;
      let mm: LineItem["match_method"] = null;
      let mc: LineItem["match_confidence"] = null;
      let mn: string | null = null;
      if (doc.role === "bid" && candidates.length) {
        const m = matches.get(`${si}.${ii}`);
        tenderLineId = m?.tender_line_id ?? null;
        mm = m?.match_method ?? null;
        mc = m?.match_confidence ?? null;
        mn = m?.match_note ?? null;
        if (!tenderLineId) issues.push({ code: "unmatched_bid_item", severity: "info", category: "match", message: `${si + 1}.${ii + 1} ${item.name ?? ""} doesn't match any BOQ item — shown as an extra item offered.` });
      }
      lines.push({
        id: crypto.randomUUID(), document_id: doc.id, parent_id: sectionId, kind: "item", position: pos, item_code: `${si + 1}.${ii + 1}`, source_ref: item.source_ref, name: item.name,
        description: item.description, trade: null, unit_raw: item.unit, unit: normalizeUnit(item.unit), quantity: item.quantity, rate: primary?.rate ?? null, amount: primary?.amount ?? null,
        prices: item.prices, quote_status: item.quote_status, flags: item.flags, remarks: item.remarks, attributes: item.attributes ?? {}, extraction_confidence: "high",
        cell_meta: {}, anomalies: [], converted: null, sheet_name: sec.sheet, source_row: item.source_row ?? null, edited_at: null,
        tender_line_id: tenderLineId, match_method: mm, match_confidence: mc, match_note: mn,
      });
    });
  });

  // ---- fill gaps, convert units, flag the implausible ---------------------------------
  const itemLines = lines.filter((l) => l.kind === "item");
  recompute(lines, doc.field_rules, { primaryVariant, cause: "autofill" });
  const tenderById = new Map(candidates.map((c) => [c.id, c]));
  for (const l of itemLines) {
    if (l.tender_line_id) applyUnitConversion(l, tenderById.get(l.tender_line_id) ?? null);
  }
  recompute(lines, doc.field_rules, { primaryVariant, cause: "autofill" });

  const medians = await otherBidMedians(doc);
  const uMed = unitMedians(itemLines);
  const cur = header.currency ?? tender?.currency ?? "INR";
  for (const l of itemLines) {
    const t = l.tender_line_id ? tenderById.get(l.tender_line_id) : null;
    l.anomalies = checkPlausibility(l, { role: doc.role, currency: cur, unitMedian: l.unit ? uMed.get(l.unit) ?? null : null, tenderLine: t ? { quantity: t.quantity, rate: t.rate, unit: t.unit } : null, medianRate: l.tender_line_id ? medians.get(l.tender_line_id) ?? null : null });
  }

  // ---- persist lines in bulk --------------------------------------------------------
  await db.from("line_items").delete().eq("document_id", doc.id);
  const sectionsFirst = [...lines.filter((l) => l.kind === "section"), ...lines.filter((l) => l.kind === "item")];
  for (let i = 0; i < sectionsFirst.length; i += 150) {
    const { error } = await db.from("line_items").insert(sectionsFirst.slice(i, i + 150));
    if (error) {
      await fail(doc.id, `Saving rows failed: ${error.message}`);
      return { done: true, phase: "failed", detail: error.message, total: sheets.length, completed: sheets.length };
    }
  }
  await linkImagesToLines(doc.id, lines);

  // ---- document-level checks -------------------------------------------------------
  const computedTotal = itemLines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const pricedCount = itemLines.filter((l) => l.quote_status === "priced").length;
  if (priceVariants.length > 1) issues.push({ code: "multiple_price_variants", severity: "info", category: "ingest", message: `This document offers ${priceVariants.length} price options. Showing "${variantLabels[primaryVariant] ?? primaryVariant}" (lowest total) by default.` });
  const stated = header.stated_total;
  if (stated != null && computedTotal > 0 && Math.abs(computedTotal - stated) / Math.max(stated, 1) > 0.005) {
    issues.push({ code: "total_mismatch", severity: "warn", category: "totals", message: `Printed grand total (${stated.toLocaleString("en-IN")}) doesn't match the sum of line amounts (${computedTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}).` });
  }
  if (header.detected_kind !== "unknown" && header.detected_kind !== doc.role) {
    issues.push({ code: "role_mismatch", severity: "warn", category: "document", message: `Uploaded as a "${doc.role}" but it looks like a "${header.detected_kind}" document. Please double-check.` });
  }
  if (doc.role === "bid" && pricedCount === 0) issues.push({ code: "role_mismatch", severity: "warn", category: "document", message: "This bid has no priced items — did you mean to upload it as the tender requirements?" });

  // party name: document → file name hint → blank, always recorded as to how it was obtained
  const fieldMeta: Record<string, CellMeta> = {};
  const partyName = doc.party_name ?? header.party.name;
  if (doc.party_name) fieldMeta.party_name = { src: "manual", note: "Entered when uploading", at: stamp };
  else if (header.party.name) fieldMeta.party_name = { src: "document", at: stamp };
  if (!header.currency) fieldMeta.currency = { src: "autofill", note: "Not stated in the document; using the tender's currency", at: stamp };

  await db
    .from("documents")
    .update({
      status: "needs_review",
      status_detail: null,
      detected_kind: header.detected_kind,
      title: header.title,
      project_name: header.project_name,
      party_name: partyName,
      party: header.party,
      document_date: header.document_date,
      reference_no: header.reference_no,
      currency: header.currency ?? tender?.currency ?? "INR",
      tax_basis: header.tax_basis,
      tax_rate_percent: header.tax_rate_percent,
      stated_total: stated,
      computed_total: computedTotal,
      price_variants: priceVariants,
      primary_variant: primaryVariant,
      terms,
      issues,
      field_meta: fieldMeta,
      reviewed_at: null,
      extraction_meta: { prompt_version: PROMPT_VERSION, sheets: sheets.length, ok_sheets: good.length },
      raw_llm_output: null,
      progress: { total: sheets.length, done: sheets.length, phase: "done" },
    })
    .eq("id", doc.id);

  if (doc.role === "tender") await db.from("tenders").update({ requirements_doc_id: doc.id }).eq("id", doc.tender_id);
  // a revised bid only takes over once it has been read successfully
  if (doc.supersedes_id) await db.from("documents").update({ superseded_at: new Date().toISOString() }).eq("id", doc.supersedes_id).is("superseded_at", null);
  return { done: true, phase: "finalize", detail: "Ready for your review", total: sheets.length, completed: sheets.length };
}

async function otherBidMedians(doc: Document): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (doc.role !== "bid") return out;
  const { data: others } = await db.from("documents").select("id").eq("tender_id", doc.tender_id).eq("role", "bid").is("superseded_at", null).neq("id", doc.id);
  const ids = (others ?? []).map((o) => o.id);
  if (!ids.length) return out;
  const { data: lines } = await db.from("line_items").select("tender_line_id, rate").in("document_id", ids).not("tender_line_id", "is", null).gt("rate", 0);
  const byTender = new Map<string, number[]>();
  for (const l of lines ?? []) {
    if (!byTender.has(l.tender_line_id)) byTender.set(l.tender_line_id, []);
    byTender.get(l.tender_line_id)!.push(Number(l.rate));
  }
  for (const [k, v] of byTender) {
    if (v.length < 2) continue;
    const s = [...v].sort((a, b) => a - b);
    out.set(k, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  }
  return out;
}

/** Back-compat: run every step in one call (scripts / small files). */
export async function runExtraction(documentId: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const r = await runStep(documentId, i === 0 ? { restart: true } : {});
    if (r.done) return;
  }
}
