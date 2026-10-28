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
  match_method: "code" | "llm" | "code+llm" | "manual" | null;
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

// ---------------------------------------------------------------------------------------------
// Global one-to-one assignment. A bid line is only linked to a BOQ line when the evidence agrees
// (similar name, matching quantity after unit conversion, compatible unit, same numbering). The
// extraction model's tender_ref is a bonus, never the deciding factor.
// ---------------------------------------------------------------------------------------------
import { conversionFactor } from "./units";

export type BidItemInput = {
  key: string;
  source_ref: string | null;
  name: string | null;
  description?: string | null;
  unit: string | null;
  quantity: number | null;
  section_name: string | null;
  hint: string | null;
};

export function matchAll(bids: BidItemInput[], tenders: MatchCandidate[]): Map<string, MatchResult> {
  type Pair = { b: BidItemInput; t: MatchCandidate; score: number; nameSim: number; qtyClose: number; refMatch: boolean; hinted: boolean };
  const pairs: Pair[] = [];
  for (const b of bids) {
    const bTokens = tokenSet(b.name);
    const bUnit = normalizeUnit(b.unit);
    for (const t of tenders) {
      const tUnit = normalizeUnit(t.unit);
      const nameSim = jaccard(bTokens, tokenSet(t.name));
      const sectionSim = jaccard(tokenSet(b.section_name), tokenSet(t.section_name));
      let unitCompat = 0.5;
      let qty = b.quantity;
      if (bUnit && tUnit) {
        if (bUnit === tUnit) unitCompat = 1;
        else {
          const conv = conversionFactor(bUnit, tUnit);
          if (conv) {
            unitCompat = 0.9;
            if (qty != null) qty = qty * conv.factor;
          } else unitCompat = 0;
        }
      }
      let qtyClose = 0;
      if (qty != null && t.quantity != null && t.quantity > 0) {
        const d = Math.abs(qty - t.quantity) / t.quantity;
        qtyClose = d <= 0.005 ? 1 : d <= 0.05 ? 0.6 : 0;
      }
      const refMatch = !!b.source_ref && normRef(b.source_ref) === normRef(t.source_ref) && sectionSim >= 0.5;
      const hinted = !!b.hint && b.hint === t.item_code && (nameSim >= 0.15 || qtyClose >= 0.6);
      const score = 0.5 * nameSim + 0.2 * qtyClose + 0.08 * unitCompat + 0.07 * sectionSim + 0.07 * (refMatch ? 1 : 0) + 0.12 * (hinted ? 1 : 0);
      const plausible = nameSim >= 0.25 || (qtyClose >= 0.6 && unitCompat >= 0.9 && nameSim >= 0.1) || (hinted && qtyClose >= 0.6);
      if (plausible && score >= 0.3) pairs.push({ b, t, score, nameSim, qtyClose, refMatch, hinted });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const out = new Map<string, MatchResult>();
  const usedT = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.b.key) || usedT.has(p.t.id)) continue;
    out.set(p.b.key, {
      tender_line_id: p.t.id,
      match_method: p.hinted && p.refMatch ? "code+llm" : p.hinted ? "llm" : "code",
      match_confidence: (p.nameSim >= 0.6 && p.qtyClose === 1) || (p.refMatch && p.nameSim >= 0.5) ? "exact" : p.score >= 0.55 ? "high" : "low",
      match_note: `Matched to ${p.t.item_code} "${p.t.name ?? ""}": ${Math.round(p.nameSim * 100)}% name match${p.qtyClose === 1 ? ", same quantity" : p.qtyClose > 0 ? ", similar quantity" : ""}${p.refMatch ? ", same item number" : ""}${p.hinted ? ", confirmed by AI" : ""}`,
    });
    usedT.add(p.t.id);
  }
  for (const b of bids) if (!out.has(b.key)) out.set(b.key, { tender_line_id: null, match_method: null, match_confidence: null, match_note: null });
  return out;
}
