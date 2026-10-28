import crypto from "crypto";
import { db } from "@/lib/db";
import { buildComparison } from "@/lib/compare";
import { buildFactsPack } from "./factsPack";
import { buildUserPrompt, SYSTEM_PROMPT, PROMPT_VERSION } from "./prompts";
import { AnalysisEnvelopeSchema } from "./schema";
import { groqJsonCompletion } from "@/lib/groq";
import type { AnalysisResult } from "@/lib/types";

export async function runAnalysis(opts: {
  tenderId: string;
  requestText: string;
  requestedType: "auto" | "table" | "ranking" | "narrative";
  templateKey?: string | null;
  force?: boolean;
}): Promise<{ id: string }> {
  const comparison = await buildComparison(opts.tenderId);
  if (!comparison) throw new Error("This tender has no processed requirements document yet.");

  const factsPack = buildFactsPack(comparison, opts.requestText);
  const cacheKey = crypto
    .createHash("sha256")
    .update(
      [opts.requestText.trim().toLowerCase(), opts.requestedType, crypto.createHash("sha256").update(factsPack.text).digest("hex"), PROMPT_VERSION].join("|")
    )
    .digest("hex");

  if (!opts.force) {
    const { data: existing } = await db
      .from("analyses")
      .select("id")
      .eq("tender_id", opts.tenderId)
      .eq("cache_key", cacheKey)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { id: existing.id };
  }

  const { data: inserted, error: insertErr } = await db
    .from("analyses")
    .insert({
      tender_id: opts.tenderId,
      request_text: opts.requestText,
      requested_type: opts.requestedType,
      template_key: opts.templateKey ?? null,
      status: "running",
      cache_key: cacheKey,
      input_snapshot: { bid_refs: factsPack.bidRefs, reductions: factsPack.reductions, prompt_version: PROMPT_VERSION },
    })
    .select()
    .single();
  if (insertErr || !inserted) throw new Error(insertErr?.message ?? "Failed to create analysis");

  const forcedType = opts.requestedType !== "auto" ? opts.requestedType : undefined;
  const userPrompt = buildUserPrompt({ requestText: opts.requestText, reductions: factsPack.reductions, factsPackText: factsPack.text, forcedType });

  const validBidRefs = new Set(Object.keys(factsPack.bidRefs));

  try {
    const result = await groqJsonCompletion<AnalysisResult>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      {
        temperature: 0.2,
        maxRetries: 2,
        promptVersion: PROMPT_VERSION,
        maxCompletionTokens: 12000,
        reasoningEffort: "medium",
        validate: (parsed) => {
          const r = AnalysisEnvelopeSchema.safeParse(parsed);
          if (!r.success) {
            return { ok: false, errors: r.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) };
          }
          if (forcedType && r.data.response_type !== forcedType) {
            return { ok: false, errors: [`response_type must be "${forcedType}"`] };
          }
          const badRefs: string[] = [];
          const checkRef = (ref?: string) => {
            if (ref && !validBidRefs.has(ref)) badRefs.push(ref);
          };
          if (r.data.response_type === "ranking") {
            for (const e of r.data.body.entries) checkRef(e.bid_ref);
          }
          if (badRefs.length) return { ok: false, errors: [`Unknown bid_ref(s): ${badRefs.join(", ")}. Valid refs: ${[...validBidRefs].join(", ")}`] };
          return { ok: true };
        },
      }
    );

    await db.from("llm_calls").insert({
      purpose: "analysis",
      analysis_id: inserted.id,
      attempt: result.meta.attempts,
      model: result.meta.model,
      prompt_version: PROMPT_VERSION,
      tokens_in: result.meta.tokensIn,
      tokens_out: result.meta.tokensOut,
      latency_ms: result.meta.latencyMs,
      finish_reason: result.meta.finishReason,
      ok: true,
    });

    const envelope = result.data;
    await db
      .from("analyses")
      .update({
        status: "ready",
        response_type: envelope.response_type,
        title: envelope.title,
        description: envelope.description,
        answerable: envelope.answerable,
        result: envelope,
        llm_meta: { model: result.meta.model, attempts: result.meta.attempts },
      })
      .eq("id", inserted.id);
  } catch (e) {
    await db.from("llm_calls").insert({
      purpose: "analysis",
      analysis_id: inserted.id,
      attempt: 1,
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      prompt_version: PROMPT_VERSION,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    await db
      .from("analyses")
      .update({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      .eq("id", inserted.id);
  }

  return { id: inserted.id };
}
