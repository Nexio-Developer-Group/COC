"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import type { DocumentSheet } from "@/lib/types";
import { Card, Pill } from "./ui";

const ROLE_LABEL: Record<string, string> = { sr: "Sr.", name: "Item", desc: "Description", dim: "Dimension", unit: "Unit", qty: "Quantity", rate: "Rate", amount: "Amount", remarks: "Remarks" };

/** What the reader found in each sheet: which column holds what, the sections and counts, and printed vs added-up totals. */
export default function ImportSummary({ sheets, currency }: { sheets: DocumentSheet[]; currency: string }) {
  const [open, setOpen] = useState(false);
  const parsed = sheets.filter((s) => s.source_audit?.parse);
  if (parsed.length === 0) return null;
  const items = parsed.reduce((n, s) => n + s.source_audit!.parse!.counts.items, 0);
  return (
    <Card className="p-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-left">
        <div>
          <div className="font-medium">How this file was read</div>
          <div className="text-xs text-brand-dark/55">{parsed.length} sheet{parsed.length > 1 ? "s" : ""} · {items} items · read directly from the cells, no AI</div>
        </div>
        <span className="text-xs text-brand-primary">{open ? "Hide" : "Show details"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-5">
          {parsed.map((s) => {
            const p = s.source_audit!.parse!;
            const g = p.printedGrandTotal;
            const ok = g?.amount != null && Math.abs(g.amount - p.itemsTotal) <= Math.max(1, Math.abs(g.amount) * 0.005);
            return (
              <div key={s.id} className="border border-line rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <b>{s.name.trim()}</b>
                  <Pill tone="neutral">header row {p.headerRow}</Pill>
                  <Pill tone="neutral">{p.counts.items} items</Pill>
                  <Pill tone="neutral">{p.counts.priced} priced · {p.counts.unpriced} unpriced</Pill>
                  <Pill tone="neutral">{p.counts.notes} notes attached</Pill>
                  <Pill tone="neutral">{p.counts.subtotals + (g ? 1 : 0)} total lines left out</Pill>
                  {g?.amount != null && <Pill tone={ok ? "ok" : "warn"}>{ok ? "matches printed total" : "differs from printed total"}</Pill>}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] mb-2">
                  {Object.entries(p.columns).map(([role, c]) => (
                    <span key={role} className="bg-brand-light-dull rounded px-1.5 py-0.5">{ROLE_LABEL[role] ?? role}: column <b>{c!.col}</b> <span className="text-brand-dark/45">“{c!.header}”</span></span>
                  ))}
                </div>
                <table className="text-xs w-full">
                  <thead className="text-brand-dark/50 text-left"><tr><th className="py-1 pr-3 font-medium">Section (work head)</th><th className="py-1 pr-3 font-medium text-right">Items</th><th className="py-1 pr-3 font-medium text-right">Items add up to</th><th className="py-1 font-medium text-right">Printed subtotal</th></tr></thead>
                  <tbody>
                    {p.sections.map((x) => {
                      const bad = x.printedTotal != null && Math.abs(x.printedTotal - x.itemTotal) > Math.max(1, Math.abs(x.printedTotal) * 0.005);
                      return (
                        <tr key={x.row} className="border-t border-line">
                          <td className="py-1 pr-3">{x.name}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{x.items}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{formatINR(x.itemTotal, currency)}</td>
                          <td className={`py-1 text-right tabular-nums ${bad ? "text-amber-800 font-medium" : ""}`}>{x.printedTotal == null ? "—" : formatINR(x.printedTotal, currency)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-line font-medium">
                      <td className="py-1 pr-3">Sheet total</td><td className="py-1 pr-3 text-right tabular-nums">{p.counts.items}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{formatINR(p.itemsTotal, currency)}</td>
                      <td className="py-1 text-right tabular-nums">{g?.amount == null ? "not saved in file" : formatINR(g.amount, currency)}</td>
                    </tr>
                  </tbody>
                </table>
                {p.skippedRows.length > 0 && <div className="text-[11px] text-brand-dark/50 mt-2">Rows not recognised as an item, note or total: {p.skippedRows.join(", ")}.</div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
