import { normalizeUnit } from "./units";

export type MatchCandidate = {
  id: string;
  item_code: string;
  source_ref: string | null;
  name: string | null;
  unit: string | null;
  quantity: number | null;
  section_name: string | null;
};

export type MatchResult = {
  tender_line_id: string | null;
  match_method: "code" | "llm" | "manual" | null;
  match_confidence: "exact" | "high" | "low" | null;
  match_note: string | null;
};

function normRef(ref: string | null): string {
  if (!ref) return "";
  return ref.toLowerCase().replace(/^0+/, "").replace(/[.\s]+$/, "").trim();
}

function tokenSet(text: string | null): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/^[0-9.]+\.?\s*/, "")
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Matches one bid item to a tender line item. `llmRef` is the tender item_code
 * the extraction LLM proposed (if any). Falls back to a deterministic
 * source_ref / name+unit+qty match when the LLM gave nothing usable.
 */
export function matchBidItem(
  bidItem: { source_ref: string | null; name: string | null; unit: string | null; quantity: number | null; section_name: string | null },
  llmRef: string | null | undefined,
  tenderItems: MatchCandidate[]
): MatchResult {
  if (llmRef) {
    const byCode = tenderItems.find((t) => t.item_code === llmRef);
    if (byCode) {
      return {
        tender_line_id: byCode.id,
        match_method: "llm",
        match_confidence: "high",
        match_note: `LLM matched to tender item ${byCode.item_code} "${byCode.name ?? ""}"`,
      };
    }
  }

  const sectionCandidates = bidItem.section_name
    ? tenderItems.filter(
        (t) => jaccard(tokenSet(t.section_name), tokenSet(bidItem.section_name)) >= 0.5
      )
    : [];
  // Item numbers (source_ref) typically restart in every section, so a bare ref match is only
  // trustworthy once we've anchored to the matching section. Without that anchor, falling back
  // to the whole tender risks matching "item 1" in a bid's own extras block to "item 1" of some
  // unrelated tender section — so skip straight to the name+unit+qty check in that case.
  const pool = sectionCandidates.length > 0 ? sectionCandidates : tenderItems;

  const bidRef = normRef(bidItem.source_ref);
  if (bidRef && sectionCandidates.length > 0) {
    const byRef = sectionCandidates.find((t) => normRef(t.source_ref) === bidRef);
    if (byRef) {
      return {
        tender_line_id: byRef.id,
        match_method: "code",
        match_confidence: "exact",
        match_note: `Matched by item number "${bidItem.source_ref}" in the same section`,
      };
    }
  }

  const bidUnit = normalizeUnit(bidItem.unit);
  const nameTokens = tokenSet(bidItem.name);
  let best: MatchCandidate | null = null;
  let bestScore = 0;
  for (const t of pool) {
    const tUnit = normalizeUnit(t.unit);
    if (bidUnit && tUnit && bidUnit !== tUnit) continue;
    if (bidItem.quantity != null && t.quantity != null && t.quantity !== 0) {
      const diffPct = Math.abs(bidItem.quantity - t.quantity) / t.quantity;
      if (diffPct > 0.005) continue;
    }
    const score = jaccard(nameTokens, tokenSet(t.name));
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && bestScore >= 0.3) {
    return {
      tender_line_id: best.id,
      match_method: "code",
      match_confidence: "low",
      match_note: `Matched by unit + quantity + similar name (${Math.round(bestScore * 100)}% name match)`,
    };
  }

  return { tender_line_id: null, match_method: null, match_confidence: null, match_note: null };
}
