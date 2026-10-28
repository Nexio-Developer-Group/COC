"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { refresh, send, useApi } from "@/lib/client/api";
import type { Tender, UiSettings } from "@/lib/types";
import { Button, Card, ExportMenu, PageHeader, Pill, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/Toasts";

export const COLOR_DEFS: { key: keyof NonNullable<UiSettings["colors"]>; label: string; hint: string; def: string }[] = [
  { key: "auto", label: "Calculated for you", hint: "Values that were missing and were worked out (e.g. amount = qty × rate)", def: "#e3ecfa" },
  { key: "converted", label: "Unit converted", hint: "Quantities / rates converted to your BOQ's unit", def: "#ddf3ef" },
  { key: "manual", label: "Edited by you", hint: "Cells you changed, and client-supplied material", def: "#fff4cc" },
  { key: "ai", label: "Inferred by AI", hint: "Things the AI guessed, like trade categories", def: "#efe7fa" },
  { key: "anomaly", label: "Looks unrealistic", hint: "Numbers that are unlikely in the real world", def: "#fbd5d5" },
  { key: "low", label: "Lowest rate", hint: "Cheapest bid on an item", def: "#e4f2e7" },
  { key: "high", label: "Highest rate", hint: "Most expensive bid on an item", def: "#fbe3d7" },
];

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, mutate } = useApi<{ tender: Tender }>(`/api/tenders/${id}`);
  const [f, setF] = useState({ title: "", client_name: "", location: "", currency: "INR", notes: "" });
  const [colors, setColors] = useState<Record<string, string>>({});
  const [hl, setHl] = useState(true);
  const [busy, setBusy] = useState(false);
  const t = data?.tender;
  useEffect(() => {
    if (!t) return;
    setF({ title: t.title, client_name: t.client_name ?? "", location: t.location ?? "", currency: t.currency, notes: t.notes ?? "" });
    setColors((t.ui_settings?.colors as Record<string, string>) ?? {});
    setHl(t.ui_settings?.showProvenance !== false);
  }, [t]);
  if (!t) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;

  async function saveDetails() {
    setBusy(true);
    const r = await send(`/api/tenders/${id}`, "PATCH", { ...f, client_name: f.client_name || null, location: f.location || null, notes: f.notes || null });
    setBusy(false);
    if (!r.ok) return toast.push({ text: r.data.error ?? "Could not save", tone: "bad" });
    toast.push({ text: "Details saved", tone: "ok" });
    mutate();
    refresh("/api/tenders");
  }
  async function saveColors(next: Record<string, string>, show = hl) {
    setColors(next);
    setHl(show);
    await send(`/api/tenders/${id}`, "PATCH", { ui_settings: { ...(t!.ui_settings ?? {}), colors: next, showProvenance: show } });
    mutate();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Details, how the tables are coloured, and actions for this tender." />
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">Details</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {([["title", "Tender name"], ["client_name", "Client"], ["location", "Site / location"], ["currency", "Currency"]] as const).map(([k, l]) => (
            <label key={k}><div className="text-xs font-medium text-brand-dark/60 mb-1">{l}</div><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="w-full border border-line rounded-lg px-3 py-2.5" /></label>
          ))}
          <label className="sm:col-span-2"><div className="text-xs font-medium text-brand-dark/60 mb-1">Notes</div><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className="w-full border border-line rounded-lg px-3 py-2.5" /></label>
        </div>
        <Button variant="primary" onClick={saveDetails} disabled={busy || !f.title.trim()}>{busy ? <Spinner /> : null}Save details</Button>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Cell colours</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hl} onChange={(e) => saveColors(colors, e.target.checked)} /> Show highlights</label>
        </div>
        <p className="text-sm text-brand-dark/60">Choose how each kind of value is highlighted in every table of this tender. Changes apply instantly.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {COLOR_DEFS.map((c) => (
            <div key={c.key} className="flex items-center gap-3 border border-line rounded-xl px-3 py-2.5">
              <input type="color" value={colors[c.key] ?? c.def} onChange={(e) => saveColors({ ...colors, [c.key]: e.target.value })} className="w-9 h-9 rounded-lg border border-line cursor-pointer bg-transparent p-0.5" />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{c.label}</div><div className="text-[11px] text-brand-dark/50 leading-snug">{c.hint}</div></div>
              <span className="px-2 py-1 rounded text-xs tabular-nums" style={{ background: colors[c.key] ?? c.def }}>₹1,250</span>
            </div>
          ))}
        </div>
        <Button size="sm" onClick={() => saveColors({})}>Reset to defaults</Button>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <ExportMenu base={`/api/tenders/${id}/export`} label="Export everything" />
          <Button icon="archive" onClick={async () => { if (confirm("Archive this tender? It leaves your list but nothing is deleted.")) { await send(`/api/tenders/${id}`, "PATCH", { archived_at: new Date().toISOString() }); refresh("/api/tenders"); router.push("/"); } }}>Archive</Button>
          <Button variant="danger" icon="trash" onClick={async () => { if (prompt(`This permanently deletes the tender, all bids, history and pictures.\nType the tender name to confirm:`) === t.title) { await send(`/api/tenders/${id}`, "DELETE"); refresh("/api/tenders"); router.push("/"); } }}>Delete permanently…</Button>
        </div>
        <Pill>Tender id: {id.slice(0, 8)}</Pill>
      </Card>
    </div>
  );
}
