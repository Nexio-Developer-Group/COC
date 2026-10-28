"use client";

import { useMemo, useState } from "react";
import { send } from "@/lib/client/api";
import type { Issue } from "@/lib/types";
import { Button, Drawer, Pill } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

const CATS: { key: string; label: string; hint: string; icon: string }[] = [
  { key: "plausibility", label: "Looks unrealistic", hint: "Numbers that add up but are unlikely in the real world.", icon: "warn" },
  { key: "conversion", label: "Unit conversions", hint: "Quantities and rates converted into your BOQ's units.", icon: "scale" },
  { key: "autofill", label: "Filled in for you", hint: "Values that weren't in the file and were calculated or inferred.", icon: "fx" },
  { key: "match", label: "BOQ matching", hint: "How bid lines were linked to your requirements.", icon: "link" },
  { key: "totals", label: "Totals", hint: "Printed totals vs. the sum of the lines.", icon: "chart" },
  { key: "document", label: "Document", hint: "Role, duplicates and other document-level checks.", icon: "file" },
  { key: "ingest", label: "Reading the file", hint: "Sheets that couldn't be read, skipped pages, price options.", icon: "eye" },
];

export default function ReviewPanel({
  documentId, issues, status, open, onClose, onChanged, onJump, onRetryFailed,
}: {
  documentId: string;
  issues: Issue[];
  status: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onJump: (lineId: string) => void;
  onRetryFailed?: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<string | null>(null);
  const [ackWarn, setAckWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const open_ = issues.filter((i) => !i.resolved);
  const byCat = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) m.set(i.category ?? "ingest", [...(m.get(i.category ?? "ingest") ?? []), i]);
    return m;
  }, [issues]);
  const cats = CATS.filter((c) => byCat.has(c.key));
  const active = tab && byCat.has(tab) ? tab : cats.find((c) => (byCat.get(c.key) ?? []).some((i) => !i.resolved))?.key ?? cats[0]?.key ?? null;
  const warnCount = open_.filter((i) => i.severity !== "info").length;

  async function post(body: unknown) {
    setBusy(true);
    const r = await send(`/api/documents/${documentId}/review`, "POST", body);
    setBusy(false);
    if (!r.ok) toast.push({ text: r.data.error ?? "Failed", tone: "bad" });
    onChanged();
    return r.ok;
  }

  return (
    <Drawer open={open} onClose={onClose} width="w-[520px]" title={<span className="inline-flex items-center gap-2"><Icon name="check" /> Review before it counts</span>}>
      <div className="flex flex-col min-h-full">
        <div className="px-5 pt-4 text-sm text-brand-dark/65">
          {status === "ready"
            ? "You confirmed this document. Anything you change from here on is still tracked."
            : "Nothing here is final until you confirm. Look through what was filled in, converted or flagged — fix it in the table, or tick “looks fine”."}
        </div>

        <div className="px-5 pt-3 flex flex-wrap gap-1.5">
          {cats.map((c) => {
            const left = (byCat.get(c.key) ?? []).filter((i) => !i.resolved).length;
            return (
              <button key={c.key} onClick={() => setTab(c.key)} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border ${active === c.key ? "bg-brand-dark text-white border-brand-dark" : "bg-white border-line hover:border-brand-primary/60"}`}>
                <Icon name={c.icon} className="w-3.5 h-3.5" />{c.label}
                <span className={`px-1.5 rounded-full text-[10px] ${left ? "bg-brand-primary text-white" : "bg-emerald-100 text-emerald-800"}`}>{left || "✓"}</span>
              </button>
            );
          })}
          {cats.length === 0 && <div className="text-sm text-brand-dark/50 py-6 w-full text-center">Nothing needs a second look — every value came straight from the file.</div>}
        </div>

        {active && (
          <div className="px-5 py-4 flex-1">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs text-brand-dark/55">{CATS.find((c) => c.key === active)?.hint}</p>
              <button disabled={busy} onClick={() => post({ action: "ack_all", categories: [active] })} className="text-xs text-brand-primary hover:underline whitespace-nowrap ml-3">All look fine</button>
            </div>
            <div className="space-y-2">
              {(byCat.get(active) ?? []).map((i) => (
                <div key={i.id ?? i.message} className={`rounded-xl border px-3 py-2.5 text-[13px] ${i.resolved ? "opacity-50 border-line bg-white" : i.severity === "error" ? "border-red-200 bg-red-50" : i.severity === "warn" ? "border-amber-200 bg-amber-50" : "border-line bg-brand-light-dull"}`}>
                  <div className="flex gap-2">
                    <Icon name={i.severity === "info" ? "info" : "warn"} className={`w-4 h-4 mt-0.5 shrink-0 ${i.severity === "error" ? "text-red-600" : i.severity === "warn" ? "text-amber-600" : "text-brand-dark/40"}`} />
                    <div className="flex-1">
                      <div>{i.message}</div>
                      <div className="flex gap-3 mt-1.5 text-xs">
                        {i.line_id && <button onClick={() => { onJump(i.line_id!); onClose(); }} className="text-brand-contrast hover:underline">Show in table</button>}
                        {i.code === "chunk_failed" && onRetryFailed && <button onClick={() => { onRetryFailed(); onClose(); }} className="text-brand-contrast hover:underline">Retry failed sheets</button>}
                        {i.id && (i.resolved ? <button onClick={() => post({ action: "unack", ids: [i.id] })} className="text-brand-dark/50 hover:underline">Undo</button> : <button onClick={() => post({ action: "ack", ids: [i.id] })} className="text-brand-dark/60 hover:underline">Looks fine</button>)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sticky bottom-0 bg-white border-t border-line px-5 py-4 space-y-2.5">
          {status !== "ready" && warnCount > 0 && (
            <label className="flex items-start gap-2 text-[13px] text-amber-900"><input type="checkbox" className="mt-0.5" checked={ackWarn} onChange={(e) => setAckWarn(e.target.checked)} />I’ve looked at the {warnCount} warning{warnCount > 1 ? "s" : ""} and I’m happy to use this document.</label>
          )}
          {status === "ready" ? (
            <Button className="w-full" onClick={() => post({ action: "reopen" })} disabled={busy}>Re-open for review</Button>
          ) : (
            <Button className="w-full" variant="primary" icon="check" disabled={busy || (warnCount > 0 && !ackWarn)} onClick={async () => { if (await post({ action: "confirm" })) { toast.push({ text: "Confirmed — this document now counts as ready.", tone: "ok" }); onClose(); } }}>
              Confirm & mark ready
            </Button>
          )}
          <div className="flex items-center justify-center gap-2 text-[11px] text-brand-dark/45">
            {open_.length} open <Pill tone={warnCount ? "warn" : "ok"}>{warnCount} warning{warnCount === 1 ? "" : "s"}</Pill>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
