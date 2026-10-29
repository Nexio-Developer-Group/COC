"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR, formatQty } from "@/lib/format";
import { REQ_TOLERANCE, type Comparison, type ComparisonCell } from "@/lib/compare";
import { Pill } from "./ui";
import Icon from "./ui/Icon";

type Mode = "rates" | "amounts" | "both";

function cellStyle(c: ComparisonCell | undefined, isMin: boolean, isMax: boolean): string {
  if (!c || c.status === "missing") return "text-brand-dark/30";
  if (c.status === "not_priced") return "text-brand-dark/40 italic";
  if (c.anomalies?.some((a) => a.startsWith("rate_outlier") || a.startsWith("implausible") || a === "negative_value")) return "cell-anomaly";
  if (c.flags.includes("MATERIAL_BY_CLIENT") || c.flags.includes("LABOUR_ONLY")) return "cell-manual";
  if (isMin) return "cell-low";
  if (isMax) return "cell-high";
  if (c.src === "autofill") return "cell-auto";
  if (c.src === "converted") return "cell-converted";
  if (c.src === "manual") return "cell-manual";
  return "";
}

export default function ComparisonGrid({ comparison, tenderId }: { comparison: Comparison; tenderId: string }) {
  const [mode, setMode] = useState<Mode>("rates");
  const [section, setSection] = useState<string>("all");
  const hasReq = comparison.requirementPricedItems > 0;
  const [showReq, setShowReq] = useState(true);
  const reqOn = hasReq && showReq;
  const lead = reqOn ? 5 : 4;
  const bids = useMemo(() => [...comparison.bids].sort((a, b) => a.rank - b.rank), [comparison.bids]);
  const sections = comparison.sections;
  const items = comparison.items.filter((i) => section === "all" || (i.sectionName ?? "General") === section);
  const cur = comparison.currency;

  const rows: React.ReactNode[] = [];
  let lastSection: string | null | undefined;
  for (const item of items) {
    if (item.sectionName !== lastSection) {
      lastSection = item.sectionName;
      rows.push(
        <tr key={`s-${item.itemCode}`} className="bg-brand-accent text-white">
          <td colSpan={lead + bids.length + 1} className="p-0 font-semibold"><div className="sticky left-0 w-max max-w-[100vw] px-3 py-2">{item.sectionName ?? "General"}</div></td>
        </tr>
      );
    }
    rows.push(
      <tr key={item.tenderLineId} className="border-t border-line hover:bg-brand-light-dull/60 group">
        <td className="px-3 py-1.5 text-brand-dark/45 sticky left-0 bg-white group-hover:bg-brand-light-dull">{item.itemCode}</td>
        <td className="px-3 py-1.5 sticky left-14 bg-white group-hover:bg-brand-light-dull min-w-[220px]">{item.name}</td>
        <td className="px-3 py-1.5 text-brand-dark/60">{item.unit ?? "—"}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(item.quantity)}</td>
        {reqOn && <td className="px-3 py-1.5 text-right tabular-nums bg-brand-light-dull/70 border-x border-line" title="The tender's own rate for this item">{item.tenderRate != null ? formatINR(mode === "amounts" ? item.tenderAmount : item.tenderRate, cur) : <span className="text-brand-dark/30">—</span>}</td>}
        {bids.map((b) => {
          const c = item.cells[b.documentId];
          const multi = item.minRate !== item.maxRate;
          const isMin = c?.status === "priced" && multi && c.rate === item.minRate;
          const isMax = c?.status === "priced" && multi && c.rate === item.maxRate;
          const tip = [c?.remarks, c?.converted ? `Unit converted ${c.converted}` : null, c?.src === "autofill" ? "Calculated for you" : null, c?.qtyMismatch ? "Quantity differs from your BOQ — amount uses your quantity" : null, c?.unitDiffers ? "Unit differs from your BOQ" : null, c?.rateVsReq != null ? `${c.rateVsReq > 0 ? "+" : ""}${(c.rateVsReq * 100).toFixed(1)}% vs requirement rate` : null, ...(c?.anomalies ?? []).map((a) => `⚠ ${a.replace(/_/g, " ")}`)].filter(Boolean).join("\n");
          return (
            <td key={b.documentId} title={tip || undefined} className={`grid-cell px-3 py-1.5 text-right tabular-nums ${cellStyle(c, !!isMin, !!isMax)}`}>
              {c?.status === "missing" && "×"}
              {c?.status === "not_priced" && "not quoted"}
              {c?.status === "included" && "included"}
              {c?.status === "excluded" && "excluded"}
              {c?.status === "priced" && (
                <Link href={`/tenders/${tenderId}/bids/${b.documentId}?row=${c.lineId}`} className="hover:underline">
                  {mode !== "amounts" && formatINR(c.rate, cur)}
                  {mode === "both" && <span className="block text-[11px] opacity-60">{formatINR(c.amount, cur)}</span>}
                  {mode === "amounts" && formatINR(c.amount, cur)}
                </Link>
              )}
              {reqOn && c?.status === "priced" && c.rateVsReq != null && Math.abs(c.rateVsReq) > 0.0005 && mode !== "amounts" && (
                <span className={`block text-[10px] ${c.rateVsReq > REQ_TOLERANCE ? "text-red-700" : c.rateVsReq < -REQ_TOLERANCE ? "text-green-700" : "text-brand-dark/45"}`}>{c.rateVsReq > 0 ? "+" : ""}{(c.rateVsReq * 100).toFixed(1)}% vs req</span>
              )}
              {c?.flags.includes("MATERIAL_BY_CLIENT") && <span title="Material by client" className="ml-1">🏷</span>}
              {c?.flags.includes("LABOUR_ONLY") && <span title="Labour only" className="ml-1">🛠</span>}
              {!!c?.images && <Icon name="image" className="w-3 h-3 inline ml-1 opacity-60" />}
            </td>
          );
        })}
        <td className="px-3 py-1.5 text-right text-xs text-brand-dark/45 whitespace-nowrap">{item.minRate != null ? `${formatINR(item.minRate, cur)} – ${formatINR(item.maxRate, cur)}` : ""}</td>
      </tr>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm">
          {(["rates", "amounts", "both"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-md capitalize ${mode === m ? "bg-brand-dark text-white" : "text-brand-dark/70 hover:bg-black/5"}`}>{m}</button>
          ))}
        </div>
        {hasReq && (
          <label className="inline-flex items-center gap-2 text-sm text-brand-dark/80 cursor-pointer select-none">
            <input type="checkbox" checked={showReq} onChange={(e) => setShowReq(e.target.checked)} className="accent-[var(--brand-primary,#2563eb)]" /> Measure against requirement
          </label>
        )}
        <select value={section} onChange={(e) => setSection(e.target.value)} className="text-sm border border-line rounded-lg px-3 py-2 bg-white">
          <option value="all">All sections</option>
          {sections.map((s) => <option key={s.name ?? "General"} value={s.name ?? "General"}>{s.name ?? "General"}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-brand-dark/55">
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded cell-low border border-black/10" />lowest</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded cell-high border border-black/10" />highest</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded cell-auto border border-black/10" />calculated</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded cell-converted border border-black/10" />unit converted</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded cell-manual border border-black/10" />client material / edited</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded cell-anomaly border border-black/10" />unrealistic</span>
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl overflow-x-auto scroll-thin">
        <table className="text-[13px] min-w-full border-collapse">
          <thead>
            <tr className="bg-brand-accent-dull text-white text-left text-xs">
              <th className="px-3 py-2.5 font-medium sticky left-0 bg-brand-accent-dull z-10 w-14">Code</th>
              <th className="px-3 py-2.5 font-medium sticky left-14 bg-brand-accent-dull z-10 min-w-[220px]">Item</th>
              <th className="px-3 py-2.5 font-medium w-16">Unit</th>
              <th className="px-3 py-2.5 font-medium w-20 text-right">Qty</th>
              {reqOn && <th className="px-3 py-2.5 font-medium text-right min-w-[110px] bg-brand-dark/30">Requirement<div className="text-[10px] font-normal opacity-80">{mode === "amounts" ? "amount" : "rate"}</div></th>}
              {bids.map((b) => (
                <th key={b.documentId} className="px-3 py-2 font-medium text-right min-w-[140px]">
                  <Link href={`/tenders/${tenderId}/bids/${b.documentId}`} className="hover:underline">{b.partyName ?? "Unknown"}</Link>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] bg-white/20 rounded px-1.5">L{b.rank}</span>
                    <Link href={`/tenders/${tenderId}/compare/${b.documentId}`} className="text-[10px] bg-white/20 hover:bg-white/35 rounded px-1.5">vs BOQ</Link>
                    {b.versionNo > 1 && <span className="text-[10px] bg-white/20 rounded px-1.5">v{b.versionNo}</span>}
                    {b.status !== "ready" && <span className="text-[10px] bg-amber-400 text-black rounded px-1.5">review</span>}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2.5 font-medium text-right w-40">Low – High</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
          <tfoot>
            {reqOn && <Foot label="Requirement total (same items)" bids={bids} lead={lead} f={(b) => (b.req.comparableItems ? formatINR(b.req.reqAmount, cur) : "—")} hint="The tender's own amount for exactly the items this contractor priced" />}
            {reqOn && <Foot label="Bid vs requirement" strong bids={bids} lead={lead} f={(b) => (b.req.variancePct == null ? "—" : `${b.req.variancePct > 0 ? "+" : ""}${(b.req.variancePct * 100).toFixed(1)}%  (${formatINR(b.req.bidAmount - b.req.reqAmount, cur)})`)} hint="Over those items: positive = dearer than the requirement" />}
            {reqOn && <Foot label="Items above / on / below requirement" bids={bids} lead={lead} f={(b) => `${b.req.over} / ${b.req.within} / ${b.req.under}`} hint={`"On" = within ±${REQ_TOLERANCE * 100}% of the requirement rate`} />}
            {reqOn && <Foot label="Requirement fit (0-100)" strong bids={bids} lead={lead} f={(b) => `${b.req.score}  ·  #${b.req.fitRank}`} hint="Coverage 50% · quantity/unit compliance 20% · price vs requirement 30%" />}
            <Foot label="Quoted total (as printed)" bids={bids} lead={lead} f={(b) => formatINR(b.statedTotal, cur)} />
            <Foot label="Like-for-like total" strong bids={bids} lead={lead} f={(b) => formatINR(b.likeForLikeTotal, cur)} hint="Only items every contractor priced — fair to compare" />
            <Foot label="…over how many items" bids={bids} lead={lead} f={(b) => (b.likeForLikeItems ? `${b.likeForLikeItems} items` : "all priced items")} />
            <Foot label="Everything this bid priced" bids={bids} lead={lead} f={(b) => formatINR(b.pricedTotal, cur)} />
            <Foot label="Rank" bids={bids} lead={lead} f={(b) => `L${b.rank}`} />
            <Foot label="Not priced / missing" bids={bids} lead={lead} f={(b) => `${b.notPricedCount} / ${b.missingCount}`} />
            <Foot label="Tax" bids={bids} lead={lead} f={(b) => (b.taxBasis && b.taxBasis !== "unknown" ? `${b.taxBasis}${b.taxRatePercent ? ` · ${b.taxRatePercent}%` : ""}` : "not stated")} />
            <Foot label="Items to check" bids={bids} lead={lead} f={(b) => String(b.issueCount)} />
          </tfoot>
        </table>
      </div>
      {comparison.extraItems.length > 0 && (
        <div className="mt-3 text-sm text-brand-dark/60 flex items-center gap-2"><Pill tone="info">{comparison.extraItems.length}</Pill> extra item(s) offered outside your BOQ (not counted in like-for-like totals).</div>
      )}
    </div>
  );
}

function Foot({ label, bids, f, strong, hint, lead }: { label: string; bids: Comparison["bids"]; lead: number; f: (b: Comparison["bids"][number]) => string; strong?: boolean; hint?: string }) {
  return (
    <tr className={`border-t ${strong ? "border-t-2 border-brand-dark/20 bg-brand-light-dull font-semibold" : "border-line"}`}>
      <td colSpan={lead} className="p-0 bg-inherit" title={hint}><div className="sticky left-0 w-max px-3 py-2">{label}</div></td>
      {bids.map((b) => <td key={b.documentId} className="px-3 py-2 text-right tabular-nums">{f(b)}</td>)}
      <td />
    </tr>
  );
}
