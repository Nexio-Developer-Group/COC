"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatINR } from "@/lib/format";
import { REQ_TOLERANCE, type Comparison } from "@/lib/compare";
import { Pill } from "./ui";

type Card = {
  b: Comparison["bids"][number];
  lowest: number;
  priced: number;
  coverage: number;
  anomalies: number;
  gap: number | null;
  strengths: string[];
  watch: string[];
};

const termOf = (b: Comparison["bids"][number], cat: string) => b.terms.find((t) => t.category === cat);

export function buildScorecards(c: Comparison): Card[] {
  const bids = [...c.bids].sort((a, b) => a.rank - b.rank);
  const total = c.items.length;
  const l1 = bids[0]?.likeForLikeTotal ?? 0;
  const cards = bids.map((b): Card => {
    let lowest = 0, priced = 0, anomalies = 0;
    for (const item of c.items) {
      const cell = item.cells[b.documentId];
      if (!cell) continue;
      if (cell.status === "priced") {
        priced++;
        if (item.minRate !== item.maxRate && cell.rate === item.minRate) lowest++;
      }
      if (cell.anomalies?.length) anomalies++;
    }
    const coverage = total ? Math.round((priced / total) * 100) : 0;
    const gap = l1 > 0 && b.rank > 1 ? ((b.likeForLikeTotal - l1) / l1) * 100 : null;
    return { b, lowest, priced, coverage, anomalies, gap, strengths: [], watch: [] };
  });

  const mostLowest = Math.max(0, ...cards.map((k) => k.lowest));
  const validity = (k: Card) => termOf(k.b, "validity");
  for (const k of cards) {
    const { b } = k;
    if (b.rank === 1) k.strengths.push("Lowest like-for-like total (L1)");
    else if (k.gap !== null && k.gap <= 5) k.strengths.push(`Within ${k.gap.toFixed(1)}% of the lowest total`);
    const rq = b.req;
    if (c.requirementPricedItems > 0 && rq.variancePct != null) {
      const v = (Math.abs(rq.variancePct) * 100).toFixed(1);
      if (rq.variancePct <= 0) k.strengths.push(`${v}% below the requirement on ${rq.comparableItems} comparable items`);
      else if (rq.variancePct <= REQ_TOLERANCE) k.strengths.push(`Within ${v}% of the requirement on ${rq.comparableItems} comparable items`);
      else k.watch.push(`${v}% above the requirement on ${rq.comparableItems} comparable items`);
    }
    if (rq.over > 0 && rq.over >= rq.comparableItems / 2) k.watch.push(`${rq.over} of ${rq.comparableItems} rates are above the requirement rate`);
    if (rq.qtyDeviations > 0) k.watch.push(`${rq.qtyDeviations} quantit${rq.qtyDeviations > 1 ? "ies differ" : "y differs"} from the requirement`);
    if (rq.unitDeviations > 0) k.watch.push(`${rq.unitDeviations} unit${rq.unitDeviations > 1 ? "s differ" : " differs"} from the requirement`);
    if (rq.uncertainMatches > 0) k.watch.push(`${rq.uncertainMatches} item${rq.uncertainMatches > 1 ? "s" : ""} only loosely matched to a requirement line`);
    if (k.lowest > 0) k.strengths.push(`Lowest rate on ${k.lowest} item${k.lowest > 1 ? "s" : ""}${k.lowest === mostLowest && cards.length > 1 ? " — most of any contractor" : ""}`);
    if (total && k.coverage === 100) k.strengths.push("Priced every BOQ item");
    else if (k.coverage >= 90) k.strengths.push(`Priced ${k.coverage}% of BOQ items`);
    if (b.missingCount === 0 && b.notPricedCount === 0) k.strengths.push("No missing or unquoted items");
    if (k.anomalies === 0 && b.issueCount === 0) k.strengths.push("No flagged or unrealistic rates");
    if (b.taxBasis && b.taxBasis !== "unknown") k.strengths.push(`Tax stated clearly (${b.taxBasis}${b.taxRatePercent ? ` · ${b.taxRatePercent}%` : ""})`);
    if (termOf(b, "payment")) k.strengths.push(`Payment terms stated: ${termOf(b, "payment")!.value ?? termOf(b, "payment")!.text}`);
    if (validity(k)) k.strengths.push(`Offer validity: ${validity(k)!.value ?? validity(k)!.text}`);
    if (termOf(b, "warranty")) k.strengths.push(`Warranty offered: ${termOf(b, "warranty")!.value ?? termOf(b, "warranty")!.text}`);
    if (termOf(b, "timeline")) k.strengths.push(`Timeline committed: ${termOf(b, "timeline")!.value ?? termOf(b, "timeline")!.text}`);

    if (b.missingCount > 0) k.watch.push(`${b.missingCount} BOQ item${b.missingCount > 1 ? "s" : ""} missing`);
    if (b.notPricedCount > 0) k.watch.push(`${b.notPricedCount} item${b.notPricedCount > 1 ? "s" : ""} not quoted`);
    if (k.anomalies > 0) k.watch.push(`${k.anomalies} unrealistic rate${k.anomalies > 1 ? "s" : ""}`);
    if (k.gap !== null && k.gap > 5) k.watch.push(`${k.gap.toFixed(1)}% above the lowest total`);
    if (!b.taxBasis || b.taxBasis === "unknown") k.watch.push("Tax basis not stated");
    if (b.status !== "ready") k.watch.push("Bid still needs review");
  }
  return cards;
}

export default function ContractorScorecards({ comparison, tenderId }: { comparison: Comparison; tenderId: string }) {
  const cards = useMemo(() => buildScorecards(comparison), [comparison]);
  const cur = comparison.currency;
  if (cards.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-semibold">Ranking &amp; contractor highlights</h2>
        <span className="text-xs text-brand-dark/50">Worked out from the table below, measured against your requirements — no AI</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((k) => (
          <div key={k.b.documentId} className="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className={`w-8 h-8 rounded-full text-sm flex items-center justify-center font-semibold shrink-0 ${k.b.rank === 1 ? "bg-brand-primary text-white" : "bg-brand-light"}`}>L{k.b.rank}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/tenders/${tenderId}/bids/${k.b.documentId}`} className="font-medium text-brand-contrast hover:underline truncate block">{k.b.partyName ?? "Unknown"}</Link>
                <div className="text-sm tabular-nums">{formatINR(k.b.likeForLikeTotal, cur)}{k.gap !== null && <span className="text-xs text-brand-dark/50"> · +{k.gap.toFixed(1)}% vs L1</span>}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Pill tone="neutral">{k.coverage}% priced</Pill>
                <span title="Requirement fit: coverage 50% · quantity/unit compliance 20% · price vs requirement 30%" className="text-[11px] text-brand-dark/60">Fit {k.b.req.score}/100 · #{k.b.req.fitRank}</span>
              </div>
            </div>
            <Link href={`/tenders/${tenderId}/compare/${k.b.documentId}`} className="text-xs text-brand-contrast hover:underline -mt-1">Compare with requirements →</Link>
            <ul className="space-y-1 text-sm">
              {k.strengths.length === 0 && <li className="text-brand-dark/40">No standout strengths yet.</li>}
              {k.strengths.map((s) => <li key={s} className="flex gap-2"><span className="text-green-700 shrink-0">✓</span><span>{s}</span></li>)}
            </ul>
            {k.watch.length > 0 && (
              <ul className="space-y-1 text-xs text-amber-800 border-t border-line pt-2">
                {k.watch.map((s) => <li key={s} className="flex gap-2"><span className="shrink-0">!</span><span>{s}</span></li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
