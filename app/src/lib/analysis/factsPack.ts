import type { Comparison } from "@/lib/compare";
import { formatQty } from "@/lib/format";
import { GROQ_TPM, estimateTokens } from "@/lib/groq";

export type FactsPack = {
  text: string;
  bidRefs: Record<string, string>; // B1 -> documentId
  reductions: string[];
};

/** Tokens available for data once the instructions (~1.6k) and the answer (~2.6k) are accounted for. */
const budgetTokens = () => Math.max(1800, Math.min(20000, GROQ_TPM - 4300));

export function buildFactsPack(comparison: Comparison, requestText: string): FactsPack {
  const sortedBids = [...comparison.bids].sort((a, b) => (a.partyName ?? "").localeCompare(b.partyName ?? ""));
  const bidRefs: Record<string, string> = {};
  sortedBids.forEach((b, i) => {
    bidRefs[`B${i + 1}`] = b.documentId;
  });
  const refByDoc = new Map(Object.entries(bidRefs).map(([ref, doc]) => [doc, ref]));
  const ref = (id: string) => refByDoc.get(id)!;

  const reductions: string[] = [];
  const lower = requestText.toLowerCase();
  const sectionFocus = comparison.sections.filter((s) => s.name && lower.includes(s.name.toLowerCase().split(/\s+/)[0]));
  const itemsInScope = sectionFocus.length ? comparison.items.filter((i) => sectionFocus.some((s) => s.name === i.sectionName)) : comparison.items;
  if (sectionFocus.length) reductions.push(`filtered to sections: ${sectionFocus.map((s) => s.name).join(", ")}`);

  const wantsTerms = /tax|gst|term|payment|warrant|valid|condition|exclu|advance|retention|scope|risk|recommend|award|compare/.test(lower);
  const wantsRates = /rate|item|price|cost|cheap|expens|section|civil|paint|floor|ceiling|electr|plumb|qty|quantit|mismatch|outlier|high|low|rank|value|total|gap|unpriced|missing|left out/.test(lower) || !wantsTerms;

  const head = `TENDER: ${comparison.tenderTitle} | currency ${comparison.currency} | ${comparison.items.length} items in ${comparison.sections.length} sections | ${comparison.bids.length} active bids`;

  const bidsBlock = [
    "BIDS",
    "ref | contractor | stated_total | like_for_like_total | computed_total | extras_total | not_priced | missing | issues | rank",
    ...sortedBids.map((b) => `${ref(b.documentId)} | ${b.partyName ?? "Unknown"} | ${b.statedTotal ?? "—"} | ${Math.round(b.likeForLikeTotal)} | ${Math.round(b.computedTotal)} | ${Math.round(b.extrasTotal)} | ${b.notPricedCount} | ${b.missingCount} | ${b.issueCount} | L${b.rank}`),
  ];
  const taxBlock = [
    "TAX & COMMERCIAL FACTS (as stated by each bidder)",
    "ref | contractor | tax_basis | tax_rate_percent | version | status | images_attached",
    ...sortedBids.map((b) => `${ref(b.documentId)} | ${b.partyName ?? "Unknown"} | ${b.taxBasis ?? "unknown"} | ${b.taxRatePercent ?? "not stated"} | v${b.versionNo} | ${b.status} | ${b.imageCount}`),
  ];
  const termsBlock = (perBid: number, chars: number) => [
    "TERMS & NOTES (verbatim; ref | category | text)",
    ...sortedBids.flatMap((b) => {
      const t = (b.terms ?? []).slice(0, perBid);
      return t.length ? t.map((x) => `${ref(b.documentId)} | ${x.category} | ${x.text.slice(0, chars)}${x.value ? ` [${x.value}]` : ""}`) : [`${ref(b.documentId)} | (no terms recorded)`];
    }),
  ];
  const itemsBlock = () => {
    const header = ["code", "section", "name", "unit", "qty", "min", "median", "max", ...sortedBids.map((b) => ref(b.documentId))];
    const rows = itemsInScope.map((item) => {
      const cells = sortedBids.map((b) => {
        const cell = item.cells[b.documentId];
        if (!cell || cell.status === "missing") return "x";
        if (cell.status === "not_priced") return "—";
        if (cell.status === "included") return "incl";
        if (cell.status === "excluded") return "excl";
        let v = cell.rate != null ? String(cell.rate) : "—";
        if (cell.flags.includes("MATERIAL_BY_CLIENT")) v += "c";
        if (cell.flags.includes("LABOUR_ONLY")) v += "l";
        if (cell.src === "autofill") v += "a";
        if (cell.converted) v += "u";
        if (cell.anomalies?.some((a) => a.startsWith("rate_outlier") || a.startsWith("implausible"))) v += "!";
        return v;
      });
      return [item.itemCode, item.sectionName ?? "", (item.name ?? "").slice(0, 40), item.unit ?? "", formatQty(item.quantity), item.minRate ?? "—", item.medianRate ?? "—", item.maxRate ?? "—", ...cells].join(" | ");
    });
    return ['TENDER ITEMS (rate per unit by bid; "—" not priced, "x" missing; suffix c=material by client, l=labour only, a=auto-calculated, u=unit converted, !=flagged unrealistic)', header.join(" | "), ...rows];
  };
  const sectionTotals = () => {
    const rows = comparison.sections.map((s) => {
      const totals = sortedBids.map((b) => Math.round(comparison.items.filter((i) => i.sectionName === s.name).reduce((sum, it) => sum + (it.cells[b.documentId]?.status === "priced" ? it.cells[b.documentId].amount ?? 0 : 0), 0)));
      return `${s.name ?? "General"} | ${totals.join(" | ")}`;
    });
    return ["SECTION TOTALS (priced amounts)", `section | ${sortedBids.map((b) => ref(b.documentId)).join(" | ")}`, ...rows];
  };
  const extras = comparison.extraItems.length
    ? ["EXTRA ITEMS OFFERED (not in tender)", "bid | name | unit | qty | rate | amount", ...comparison.extraItems.slice(0, 20).map((e) => `${refByDoc.get(e.documentId) ?? "?"} | ${e.name ?? ""} | ${e.unit ?? ""} | ${e.quantity ?? ""} | ${e.rate ?? ""} | ${e.amount ?? ""}`)]
    : [];

  const assemble = (parts: string[][]) => [head, "", ...parts.filter((p) => p.length).flatMap((p) => [...p, ""])].join("\n").trim();
  const tiers: { note: string | null; parts: () => string[][] }[] = [
    { note: null, parts: () => [bidsBlock, taxBlock, ...(wantsTerms ? [termsBlock(14, 170)] : []), ...(wantsRates ? [itemsBlock(), extras] : [sectionTotals()])] },
    { note: "terms shortened", parts: () => [bidsBlock, taxBlock, ...(wantsTerms ? [termsBlock(6, 120)] : []), ...(wantsRates ? [itemsBlock(), extras] : [sectionTotals()])] },
    { note: "line-level rates omitted; analysis is at section level due to size", parts: () => [bidsBlock, taxBlock, termsBlock(wantsTerms ? 6 : 3, 110), sectionTotals()] },
    { note: "line-level rates and most terms omitted due to size", parts: () => [bidsBlock, taxBlock, termsBlock(2, 90), sectionTotals().slice(0, 14)] },
  ];
  let text = "";
  for (const tier of tiers) {
    text = assemble(tier.parts());
    if (estimateTokens(text) <= budgetTokens()) {
      if (tier.note) reductions.push(tier.note);
      return { text, bidRefs, reductions };
    }
    if (tier.note) reductions.push(tier.note);
  }
  return { text, bidRefs, reductions: [...new Set(reductions)] };
}
