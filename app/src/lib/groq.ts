const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class GroqJsonError extends Error {
  constructor(message: string, public raw?: string) {
    super(message);
    this.name = "GroqJsonError";
  }
}

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

export type GroqCallMeta = {
  attempts: number;
  model: string;
  promptVersion: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
  finishReason?: string;
};

/**
 * Calls Groq's chat completions endpoint in forced JSON mode, parses the
 * result, and (optionally) runs a caller-supplied validator. On JSON-parse
 * failure or validation failure, retries with the error fed back to the
 * model as a correction request — this is the one mechanism that keeps
 * gpt-oss-120b's output predictable enough to parse deterministically.
 */
export async function groqJsonCompletion<T = unknown>(
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    maxRetries?: number;
    promptVersion?: string;
    validate?: (parsed: unknown) => ValidateResult;
    maxCompletionTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
  } = {}
): Promise<{ data: T; meta: GroqCallMeta }> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const maxRetries = opts.maxRetries ?? 2;
  let currentMessages = messages;
  const start = Date.now();
  let lastFinishReason: string | undefined;
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let currentMaxTokens = opts.maxCompletionTokens ?? 16000;

  const doFetch = () =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: currentMessages,
        temperature: opts.temperature ?? 0.1,
        response_format: { type: "json_object" },
        max_completion_tokens: currentMaxTokens,
        reasoning_effort: opts.reasoningEffort ?? "low",
      }),
    });

  let rateLimitWaits = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res = await doFetch();

    // 429 (over the rolling TPM budget) and 413 (this request alone would exceed what's left in
    // the window) are the same rolling rate limit surfacing differently. 429 just needs a wait;
    // 413 means the request itself is too big for the hard per-request cap, so shrink the
    // reserved completion budget too — waiting alone never fixes a 413.
    while ((res.status === 429 || res.status === 413) && rateLimitWaits < 6) {
      rateLimitWaits++;
      const body = await res.text();
      if (!/tokens per minute|rate_limit/i.test(body)) break;
      if (res.status === 413) {
        currentMaxTokens = Math.max(2000, Math.floor(currentMaxTokens * 0.6));
      }
      const match = body.match(/try again in ([\d.]+)s/i);
      const waitMs = Math.min(match ? parseFloat(match[1]) * 1000 : 15000, 30000) + 250;
      await new Promise((r) => setTimeout(r, waitMs));
      res = await doFetch();
    }

    let content = "";
    if (!res.ok) {
      const text = await res.text();
      // Groq validates json_object output server-side before returning it. When the model's
      // output doesn't quite parse, it comes back as a 400 with the raw text in
      // `failed_generation` instead of normal content — treat that the same as a client-side
      // JSON.parse failure (feed it back and ask for a fix) instead of hard-failing the call.
      let failedGeneration: string | undefined;
      try {
        failedGeneration = JSON.parse(text)?.error?.failed_generation;
      } catch {
        // not JSON, nothing to salvage
      }
      if (res.status === 400 && failedGeneration) {
        content = failedGeneration;
      } else {
        throw new Error(`Groq API error ${res.status}: ${text}`);
      }
    } else {
      const data = await res.json();
      lastFinishReason = data.choices?.[0]?.finish_reason;
      lastUsage = data.usage;
      content = data.choices?.[0]?.message?.content ?? "";
    }

    // A response cut off mid-generation is NEVER acceptable, even if the truncated JSON
    // happens to still parse (e.g. it got cut right after a complete array element) — that
    // would silently drop every item after the cut. Push the completion budget as close to
    // the model's per-request ceiling as the prompt leaves room for, and retry.
    if (lastFinishReason === "length") {
      const promptTokens = lastUsage?.prompt_tokens ?? 0;
      currentMaxTokens = Math.max(currentMaxTokens, Math.min(7500, Math.max(1000, 7800 - promptTokens)));
      currentMessages = [
        ...messages,
        { role: "assistant", content },
        {
          role: "user",
          content:
            "Your previous response was cut off before finishing (ran out of output space) — it must never be treated as complete. Produce the FULL output again from the start, covering every row, but keep 'description' fields short (first sentence only, under 100 characters) and omit 'attributes' entirely when there is nothing to put in it, so the complete response fits.",
        },
      ];
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      currentMessages = [
        ...messages,
        { role: "assistant", content },
        {
          role: "user",
          content:
            "That was not valid JSON (it may be truncated or missing a brace/bracket somewhere). Respond again with ONLY a single complete, valid JSON object, no markdown fences, no prose, no trailing commas.",
        },
      ];
      continue;
    }

    const validation = opts.validate ? opts.validate(parsed) : { ok: true as const };
    if (validation.ok) {
      return {
        data: parsed as T,
        meta: {
          attempts: attempt + 1,
          model,
          promptVersion: opts.promptVersion ?? "unversioned",
          tokensIn: lastUsage?.prompt_tokens,
          tokensOut: lastUsage?.completion_tokens,
          latencyMs: Date.now() - start,
          finishReason: lastFinishReason,
        },
      };
    }

    currentMessages = [
      ...messages,
      { role: "assistant", content },
      {
        role: "user",
        content:
          "Your previous response failed validation. Fix ONLY these problems and return the COMPLETE corrected JSON object (not a diff, no commentary):\n" +
          validation.errors.map((e) => `- ${e}`).join("\n") +
          "\nRemember: output a single JSON object matching the schema exactly. No markdown, no prose.",
      },
    ];
  }

  throw new GroqJsonError(
    `Groq did not return valid/schema-conformant JSON after ${maxRetries + 1} attempts`,
    lastFinishReason
  );
}
