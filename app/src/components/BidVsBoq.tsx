"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR, formatQty } from "@/lib/format";
import type { Comparison, ComparisonItemRow } from "@/lib/compare";
import { Card, Pill } from "./ui";

type Filter = "all" | "cheaper" | "costlier" | "unquoted";

type Row = {
  item: ComparisonItemRow;
  status: string;
  bidRate: number | null;
  bidAmount: number | null;
  /** BOQ − contractor; positive = contractor is cheaper than the requirement */
  rateDiff: number | null;
  ratePct: number | null;
  both: boolean;
  remarks: string | null;
  anomaly: boolean;
};

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const signed = (n: number | null, cur: string) => (n == null ? "—" : n === 0 ? "—" : formatINR(n, cur));

function sum(rows: Row[], f: (r: Row) => number | null) {
  return rows.reduce((t, r) => t + (r.both ? f(r) ?? 0 : 0), 0);
}

export default function BidVsBoq({ comparison, docId, tenderId }: { comparison: Comparison; docId: string; tenderId: string }) {
  const bid = comparison.bids.find((b) => b.documentId === docId);
  const [filter, setFilter] = useState<Filter>("all");
  const cur = comparison.currency;

  const rows: Row[] = useMemo(
    () =>
      comparison.items.map((item) => {
        const c = item.cells[docId];
        const priced = c?.status === "priced";
        const both = priced && item.tenderRate != null && c.rate != null;
        const rateDiff = both ? item.tenderRate! - c!.rate! : null;
        return {
          item,
          status: c?.status ?? "missing",
          bidRate: c?.rate ?? null,
          bidAmount: c?.amount ?? null,
          rateDiff,
          ratePct: both && item.tenderRate ? rateDiff! / item.tenderRate : null,
          both: both && item.tenderAmount != null && c.amount != null,
          remarks: [c?.remarks, c?.qtyMismatch ? "Quantity differs from BOQ — amount uses BOQ quantity" : null].filter(Boolean).join(" · ") || null,
          anomaly: !!c?.anomalies?.length,
        };
      }),
    [comparison, docId]
  );

  if (!bid) return null;

  const matches = (r: Row) =>
    filter === "all" ? true : filter === "cheaper" ? (r.rateDiff ?? 0) > 0 : filter === "costlier" ? (r.rateDiff ?? 0) < 0 : r.status !== "priced";

  // area (sheet) → section → rows, in BOQ order
  const areas = new Map<string, Map<string, Row[]>>();
  for (const r of rows) {
    const a = r.item.sheetName ?? "All items";
    const s = r.item.sectionName ?? "General";
    if (!areas.has(a)) areas.set(a, new Map());
    const m = areas.get(a)!;
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(r);
  }

  const boqAll = sum(rows, (r) => r.item.tenderAmount);
  const bidAll = sum(rows, (r) => r.bidAmount);
  const saved = boqAll - bidAll;
  const cheaper = rows.filter((r) => (r.rateDiff ?? 0) > 0).length;
  const costlier = rows.filter((r) => (r.rateDiff ?? 0) < 0).length;
  const unquoted = rows.filter((r) => r.status !== "priced").length;
  const noRef = rows.filter((r) => r.status === "priced" && r.item.tenderRate == null).length;

  const tone = (d: number | null) => (d == null || d === 0 ? "" : d > 0 ? "cell-low" : "cell-high");

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Requirement (BOQ)" value={formatINR(boqAll, cur)} hint="Items priced by this contractor" />
        <Stat label={bid.partyName ?? "Contractor"} value={formatINR(bidAll, cur)} hint={`Rank L${bid.rank} overall`} />
        <Stat label={saved >= 0 ? "Below the BOQ" : "Above the BOQ"} value={`${formatINR(Math.abs(saved), cur)} · ${boqAll ? pct(Math.abs(saved) / boqAll) : "—"}`} tone={saved >= 0 ? "good" : "bad"} />
        <Stat label="Items" value={`${cheaper} cheaper · ${costlier} costlier`} hint={`${unquoted} not quoted${noRef ? ` · ${noRef} with no BOQ rate` : ""}`} />
      </div>

      {[...areas.entries()].map(([area, sections]) => {
        const all = [...sections.values()].flat();
        return (
          <section key={area} className="space-y-3">
            <h2 className="text-lg font-semibold">{area}</h2>

            <Card className="overflow-x-auto">
              <table className="text-[13px] min-w-full">
                <thead className="bg-brand-accent-dull text-white text-left text-xs">
                  <tr>
                    <th className="px-3 py-2 w-12">Sr.</th>
                    <th className="px-3 py-2">Particulars</th>
                    <th className="px-3 py-2 text-right">BOQ amount</th>
                    <th className="px-3 py-2 text-right">{bid.partyName ?? "Contractor"} amount</th>
                    <th className="px-3 py-2 text-right">Difference</th>
                    <th className="px-3 py-2 text-right w-20">% diff</th>
                    <th className="px-3 py-2 text-right w-24">Not quoted</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sections.entries()].map(([sec, rs], i) => {
                    const b = sum(rs, (r) => r.item.tenderAmount), c = sum(rs, (r) => r.bidAmount), d = b - c;
                    return (
                      <tr key={sec} className="border-t border-line">
                        <td className="px-3 py-2 text-brand-dark/50">{i + 1}</td>
                        <td className="px-3 py-2">{sec}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(b, cur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(c, cur)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${tone(d)}`}>{signed(d, cur)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${tone(d)}`}>{b ? pct(d / b) : "—"}</td>
                        <td className="px-3 py-2 text-right text-brand-dark/50">{rs.filter((r) => r.status !== "priced").length || "—"}</td>
                      </tr>
                    );
                  })}
                  {(() => {
                    const b = sum(all, (r) => r.item.tenderAmount), c = sum(all, (r) => r.bidAmount), d = b - c;
                    return (
                      <tr className="border-t-2 border-brand-dark/20 bg-brand-light-dull font-semibold">
                        <td />
                        <td className="px-3 py-2">Total amount</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(b, cur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(c, cur)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${tone(d)}`}>{signed(d, cur)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${tone(d)}`}>{b ? pct(d / b) : "—"}</td>
                        <td />
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </Card>

            <Card className="overflow-x-auto">
              <table className="text-[13px] min-w-full border-collapse">
                <thead className="bg-brand-accent-dull text-white text-left text-xs">
                  <tr>
                    <th className="px-3 py-2 w-14">Code</th>
                    <th className="px-3 py-2 min-w-[220px]">Item</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">BOQ rate</th>
                    <th className="px-3 py-2 text-right">BOQ amount</th>
                    <th className="px-3 py-2 text-right">Contractor rate</th>
                    <th className="px-3 py-2 text-right">Contractor amount</th>
                    <th className="px-3 py-2 text-right">Rate difference</th>
                    <th className="px-3 py-2 text-right">Rate %</th>
                    <th className="px-3 py-2 min-w-[180px]">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sections.entries()].map(([sec, rs]) => {
                    const shown = rs.filter(matches);
                    if (shown.length === 0) return null;
                    return [
                      <tr key={`h-${sec}`} className="bg-brand-accent text-white"><td colSpan={11} className="px-3 py-1.5 font-semibold">{sec}</td></tr>,
                      ...shown.map((r) => (
                        <tr key={r.item.tenderLineId} className="border-t border-line hover:bg-brand-light-dull/60">
                          <td className="px-3 py-1.5 text-brand-dark/45">{r.item.itemCode}</td>
                          <td className="px-3 py-1.5">{r.item.name}</td>
                          <td className="px-3 py-1.5 text-brand-dark/60">{r.item.unit ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(r.item.quantity)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(r.item.tenderRate, cur)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(r.item.tenderAmount, cur)}</td>
                          {r.status === "priced" ? (
                            <>
                              <td className={`px-3 py-1.5 text-right tabular-nums ${r.anomaly ? "cell-anomaly" : tone(r.rateDiff)}`}>{formatINR(r.bidRate, cur)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(r.bidAmount, cur)}</td>
                            </>
                          ) : (
                            <td colSpan={2} className="px-3 py-1.5 text-right italic text-brand-dark/40">{r.status === "missing" ? "not in bid" : r.status === "not_priced" ? "not quoted" : r.status}</td>
                          )}
                          <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.rateDiff)}`}>{signed(r.rateDiff, cur)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${tone(r.rateDiff)}`}>{pct(r.ratePct)}</td>
                          <td className="px-3 py-1.5 text-brand-dark/60 text-xs">{r.remarks}</td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </Card>
          </section>
        );
      })}
      <div className="flex gap-3 text-xs text-brand-dark/55 items-center">
        <Pill tone="ok">green</Pill> contractor cheaper than the BOQ · <Pill tone="warn">red</Pill> costlier · difference = BOQ − contractor
      </div>
      <FilterBar value={filter} onChange={setFilter} />
      <Link href={`/tenders/${tenderId}/compare`} className="text-sm text-brand-contrast hover:underline">← Back to all-contractor comparison</Link>
    </div>
  );
}

function FilterBar({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const opts: [Filter, string][] = [["all", "All items"], ["cheaper", "Cheaper than BOQ"], ["costlier", "Costlier than BOQ"], ["unquoted", "Not quoted"]];
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white border border-line rounded-full shadow-lg p-1 flex gap-1 text-xs z-20">
      {opts.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-full ${value === v ? "bg-brand-primary text-white" : "hover:bg-black/5"}`}>{l}</button>
      ))}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-brand-dark/55 truncate">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-1 ${tone === "good" ? "text-green-700" : tone === "bad" ? "text-orange-800" : ""}`}>{value}</div>
      {hint && <div className="text-xs text-brand-dark/45 mt-0.5">{hint}</div>}
    </Card>
  );
}
