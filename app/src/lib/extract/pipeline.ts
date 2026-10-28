import { db } from "@/lib/db";
import { groqJsonCompletion } from "@/lib/groq";
import { ExtractionSchema, type Extraction } from "./schema";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { normalizeUnit } from "@/lib/units";
import { matchBidItem, type MatchCandidate } from "@/lib/match";
import type { Document, Issue, LineItem, Price } from "@/lib/types";

const AMOUNT_TOLERANCE_ABS = 1;
const AMOUNT_TOLERANCE_PCT = 0.005;

function arithmeticOk(qty: number | null, rate: number | null, amount: number | null): boolean {
  if (qty == null || rate == null || amount == null) return true;
  const expected = qty * rate;
  const tolerance = Math.max(AMOUNT_TOLERANCE_ABS, Math.abs(expected) * AMOUNT_TOLERANCE_PCT);
  return Math.abs(expected - amount) <= tolerance;
}

function pickPrimaryVariant(itemsFlat: { prices: Price[] }[]): string {
  const totals = new Map<string, number>();
  for (const item of itemsFlat) {
    for (const p of item.prices) {
      if (p.amount == null) continue;
      totals.set(p.variant, (totals.get(p.variant) ?? 0) + p.amount);
    }
  }
  if (totals.size === 0) return "default";
  let best = "default";
  let bestTotal = Infinity;
  for (const [variant, total] of totals) {
    if (total < bestTotal) {
      bestTotal = total;
      best = variant;
    }
  }
  return best;
}

export async function runExtraction(documentId: string): Promise<void> {
  const { data: doc, error: docErr } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single<Document>();
  if (docErr || !doc) throw new Error(`Document not found: ${documentId}`);

  const { data: tender } = await db.from("tenders").select("*").eq("id", doc.tender_id).single();

  await db.from("documents").update({ status: "processing", status_detail: "Reading document…" }).eq("id", documentId);

  let tenderItemsTable: string | undefined;
  let tenderCandidates: (MatchCandidate & { section_name: string | null })[] = [];
  if (doc.role === "bid" && tender?.requirements_doc_id) {
    const { data: tenderLines } = await db
      .from("line_items")
      .select("*")
      .eq("document_id", tender.requirements_doc_id)
      .eq("kind", "item")
      .order("position");
    const sections = new Map<string, string | null>();
    {
      const { data: sectionRows } = await db
        .from("line_items")
        .select("*")
        .eq("document_id", tender.requirements_doc_id)
        .eq("kind", "section");
      for (const s of sectionRows ?? []) sections.set(s.id, s.name);
    }
    tenderCandidates = (tenderLines ?? []).map((l: LineItem) => ({
      id: l.id,
      item_code: l.item_code,
      source_ref: l.source_ref,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      section_name: l.parent_id ? sections.get(l.parent_id) ?? null : null,
    }));
    if (tenderCandidates.length > 0) {
      tenderItemsTable = tenderCandidates
        .map(
          (t) =>
            `${t.item_code} | ${t.section_name ?? ""} | ${t.source_ref ?? ""} | ${t.name ?? ""} | ${t.unit ?? ""} | ${t.quantity ?? ""}`
        )
        .join("\n");
    }
  }

  await db.from("documents").update({ status_detail: "Extracting structured data with AI…" }).eq("id", documentId);

  const userPrompt = buildUserPrompt({
    role: doc.role,
    fileName: doc.file_name,
    tenderCurrency: tender?.currency ?? "INR",
    tenderItemsTable,
    documentText: doc.rendered_text ?? "",
  });

  let extraction: Extraction;
  let llmMeta: { attempts: number; model: string; tokensIn?: number; tokensOut?: number; latencyMs: number };
  try {
    const result = await groqJsonCompletion<Extraction>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      {
        temperature: 0,
        maxRetries: 3,
        promptVersion: PROMPT_VERSION,
        maxCompletionTokens: 6000,
        reasoningEffort: "low",
        validate: (parsed) => {
          const r = ExtractionSchema.safeParse(parsed);
          if (r.success) return { ok: true };
          return { ok: false, errors: r.error.issues.slice(0, 15).map((i) => `${i.path.join(".")}: ${i.message}`) };
        },
      }
    );
    extraction = ExtractionSchema.parse(result.data);
    llmMeta = {
      attempts: result.meta.attempts,
      model: result.meta.model,
      tokensIn: result.meta.tokensIn,
      tokensOut: result.meta.tokensOut,
      latencyMs: result.meta.latencyMs,
    };
    await db.from("llm_calls").insert({
      purpose: "extraction",
      document_id: documentId,
      attempt: result.meta.attempts,
      model: result.meta.model,
      prompt_version: PROMPT_VERSION,
      tokens_in: result.meta.tokensIn,
      tokens_out: result.meta.tokensOut,
      latency_ms: result.meta.latencyMs,
      finish_reason: result.meta.finishReason,
      ok: true,
    });
  } catch (e) {
    await db.from("llm_calls").insert({
      purpose: "extraction",
      document_id: documentId,
      attempt: 1,
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      prompt_version: PROMPT_VERSION,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    await db
      .from("documents")
      .update({ status: "failed", status_detail: "AI extraction failed", issues: [{ code: "extraction_failed", severity: "error", message: e instanceof Error ? e.message : String(e) }] })
      .eq("id", documentId);
    return;
  }

  await db.from("documents").update({ status_detail: "Validating and matching…" }).eq("id", documentId);

  // Flatten for primary-variant selection + totals.
  const flatItems = extraction.sections.flatMap((s) => s.items);
  const primaryVariant = pickPrimaryVariant(flatItems);
  const priceVariantLabels = extraction.document.price_variant_labels ?? {};
  const priceVariants = Object.keys(priceVariantLabels).length
    ? Object.entries(priceVariantLabels).map(([key, label]) => ({ key, label }))
    : [];

  const issues: Issue[] = [];

  // Wipe + rewrite line tree (idempotent reprocessing).
  await db.from("line_items").delete().eq("document_id", documentId);

  let computedTotal = 0;
  let pricedCount = 0;
  const insertedLineIdsBySection: string[] = [];
  let sectionPos = 0;

  for (let si = 0; si < extraction.sections.length; si++) {
    const section = extraction.sections[si];
    sectionPos++;
    const sectionCode = String(si + 1);
    const { data: sectionRow, error: sErr } = await db
      .from("line_items")
      .insert({
        document_id: documentId,
        parent_id: null,
        kind: "section",
        position: sectionPos,
        item_code: sectionCode,
        source_ref: section.source_ref,
        name: section.name,
        trade: section.trade,
      })
      .select()
      .single();
    if (sErr || !sectionRow) continue;
    insertedLineIdsBySection.push(sectionRow.id);

    for (let ii = 0; ii < section.items.length; ii++) {
      const item = section.items[ii];
      sectionPos++;
      const itemCode = `${sectionCode}.${ii + 1}`;
      const primaryPrice = item.prices.find((p) => p.variant === primaryVariant) ?? item.prices[0] ?? null;
      const rate = primaryPrice?.rate ?? null;
      const amount = primaryPrice?.amount ?? null;

      if (item.quote_status === "priced") pricedCount++;
      if (amount != null) computedTotal += amount;

      for (const p of item.prices) {
        if (!arithmeticOk(item.quantity, p.rate, p.amount)) {
          issues.push({
            code: "amount_mismatch",
            severity: "warn",
            message: `${itemCode} ${item.name ?? ""}: ${item.quantity} × ${p.rate} ≠ ${p.amount} (variant ${p.variant})`,
          });
        }
      }

      let tenderLineId: string | null = null;
      let matchMethod: string | null = null;
      let matchConfidence: string | null = null;
      let matchNote: string | null = null;
      if (doc.role === "bid" && tenderCandidates.length > 0) {
        const m = matchBidItem(
          { source_ref: item.source_ref, name: item.name, unit: item.unit, quantity: item.quantity, section_name: section.name },
          item.tender_ref,
          tenderCandidates
        );
        tenderLineId = m.tender_line_id;
        matchMethod = m.match_method;
        matchConfidence = m.match_confidence;
        matchNote = m.match_note;
        if (!tenderLineId) {
          issues.push({
            code: "unmatched_bid_item",
            severity: "info",
            message: `${itemCode} ${item.name ?? ""} doesn't match any tender item — shown as an extra item offered`,
          });
        } else if (matchConfidence === "low") {
          issues.push({
            code: "low_confidence_match",
            severity: "warn",
            message: `${itemCode} ${item.name ?? ""} matched to the tender with low confidence — please verify`,
          });
        }
      }

      await db.from("line_items").insert({
        document_id: documentId,
        parent_id: sectionRow.id,
        kind: "item",
        position: sectionPos,
        item_code: itemCode,
        source_ref: item.source_ref,
        name: item.name,
        description: item.description,
        unit_raw: item.unit,
        unit: normalizeUnit(item.unit),
        quantity: item.quantity,
        rate,
        amount,
        prices: item.prices,
        quote_status: item.quote_status,
        flags: item.flags,
        remarks: item.remarks,
        attributes: item.attributes,
        extraction_confidence: "high",
        tender_line_id: tenderLineId,
        match_method: matchMethod,
        match_confidence: matchConfidence,
        match_note: matchNote,
      });
    }
  }

  if (priceVariants.length > 1) {
    issues.push({ code: "multiple_price_variants", severity: "info", message: `This document offers ${priceVariants.length} price options. Showing "${priceVariantLabels[primaryVariant] ?? primaryVariant}" (lowest total) by default.` });
  }

  const stated = extraction.document.stated_total;
  if (stated != null && computedTotal > 0) {
    const diffPct = Math.abs(computedTotal - stated) / Math.max(stated, 1);
    if (diffPct > 0.005) {
      issues.push({
        code: "total_mismatch",
        severity: "warn",
        message: `Printed grand total (${stated}) doesn't match the sum of line items we extracted (${computedTotal.toFixed(2)})`,
      });
    }
  }

  if (extraction.document.detected_kind !== "unknown" && extraction.document.detected_kind !== doc.role) {
    issues.push({
      code: "role_mismatch",
      severity: "warn",
      message: `This was uploaded as a "${doc.role}" but looks like a "${extraction.document.detected_kind}" document. Please double-check.`,
    });
  }
  if (doc.role === "bid" && pricedCount === 0) {
    issues.push({ code: "role_mismatch", severity: "warn", message: `This bid has no priced items — did you mean to upload it as the tender requirements?` });
  }

  const hasBlocking = issues.some((i) => i.severity === "error");
  const hasWarn = issues.some((i) => i.severity === "warn");
  const status = hasBlocking ? "needs_review" : hasWarn ? "needs_review" : "ready";

  await db
    .from("documents")
    .update({
      status,
      status_detail: null,
      detected_kind: extraction.document.detected_kind,
      title: extraction.document.title,
      project_name: extraction.document.project_name,
      party_name: extraction.document.party.name,
      party: extraction.document.party,
      document_date: extraction.document.document_date,
      reference_no: extraction.document.reference_no,
      currency: extraction.document.currency ?? tender?.currency ?? "INR",
      tax_basis: extraction.document.tax_basis,
      tax_rate_percent: extraction.document.tax_rate_percent,
      stated_total: extraction.document.stated_total,
      computed_total: computedTotal,
      price_variants: priceVariants,
      primary_variant: primaryVariant,
      terms: extraction.terms,
      issues,
      extraction_meta: { prompt_version: PROMPT_VERSION, ...llmMeta },
      raw_llm_output: extraction,
    })
    .eq("id", documentId);

  if (doc.role === "tender") {
    await db.from("tenders").update({ requirements_doc_id: documentId }).eq("id", doc.tender_id);
  }
}
