"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { refresh, send } from "@/lib/client/api";
import type { Playbook } from "@/lib/types";
import { Button, Card, Modal, Pill, Spinner } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

const OUTPUTS = [
  { v: "auto", label: "Let it choose" }, { v: "table", label: "Table" }, { v: "ranking", label: "Ranking" }, { v: "narrative", label: "Written report" },
];
const EMOJI = ["✨", "🧾", "💳", "🧩", "🔍", "🏆", "📊", "⚖️", "🛠️", "📦", "🕒", "🔒"];

export function PlaybookEditor({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: Partial<Playbook> & { from_analysis_id?: string }; onSaved?: (p: Playbook) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", description: "", instruction: "", output_type: "auto", emoji: "✨", category: "Mine" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ name: initial?.name ?? "", description: initial?.description ?? "", instruction: initial?.instruction ?? "", output_type: initial?.output_type ?? "auto", emoji: initial?.emoji ?? "✨", category: initial?.category ?? "Mine" });
  }, [open, initial]);
  const vars = [...new Set([...f.instruction.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];

  async function save() {
    setBusy(true);
    const r = initial?.id
      ? await send(`/api/playbooks/${initial.id}`, "PATCH", f)
      : await send("/api/playbooks", "POST", { ...f, from_analysis_id: initial?.from_analysis_id });
    setBusy(false);
    if (!r.ok) return toast.push({ text: r.data.error ?? "Could not save", tone: "bad" });
    refresh("/api/playbooks");
    toast.push({ text: `Saved “${r.data.playbook.name}” to your Playbooks`, tone: "ok" });
    onSaved?.(r.data.playbook);
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} wide title={initial?.id ? "Edit Playbook" : "New Playbook"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim() || !f.instruction.trim() || busy} onClick={save}>{busy ? <Spinner /> : null}Save Playbook</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-brand-dark/60">A Playbook is a question you ask often, saved once. Run it on any tender with one click.</p>
        <div className="flex gap-3">
          <div>
            <div className="text-xs font-medium text-brand-dark/60 mb-1">Icon</div>
            <div className="grid grid-cols-6 gap-1 w-48">{EMOJI.map((e) => <button key={e} onClick={() => setF({ ...f, emoji: e })} className={`h-8 rounded-md text-lg ${f.emoji === e ? "bg-brand-primary/15 ring-1 ring-brand-primary" : "hover:bg-black/5"}`}>{e}</button>)}</div>
          </div>
          <label className="flex-1"><div className="text-xs font-medium text-brand-dark/60 mb-1">Name</div><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tax & GST summary" className="w-full border border-line rounded-lg px-3 py-2.5" /></label>
        </div>
        <label className="block"><div className="text-xs font-medium text-brand-dark/60 mb-1">What does it tell you? (shown on the card)</div><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Which bids include GST, at what rate, and what that does to real cost." className="w-full border border-line rounded-lg px-3 py-2.5" /></label>
        <label className="block"><div className="text-xs font-medium text-brand-dark/60 mb-1">The question</div><textarea value={f.instruction} onChange={(e) => setF({ ...f, instruction: e.target.value })} rows={4} placeholder="Give tax related information for every bid…" className="w-full border border-line rounded-lg px-3 py-2.5" /></label>
        <div className="text-xs text-brand-dark/55">Tip: use <code className="bg-brand-light px-1 rounded">{"{{section}}"}</code> anywhere in the question to ask for a value each time you run it (e.g. “Compare bids on {"{{section}}"} only”).{vars.length > 0 && <> Will ask for: <b>{vars.join(", ")}</b>.</>}</div>
        <div>
          <div className="text-xs font-medium text-brand-dark/60 mb-1">Show the answer as</div>
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5">{OUTPUTS.map((o) => <button key={o.v} onClick={() => setF({ ...f, output_type: o.v })} className={`px-3 py-1.5 rounded-md text-sm ${f.output_type === o.v ? "bg-brand-dark text-white" : "hover:bg-black/5"}`}>{o.label}</button>)}</div>
        </div>
      </div>
    </Modal>
  );
}

/** Runs a playbook on a tender: asks for any {{variables}}, shows progress, opens the report. */
export function RunPlaybookDialog({ playbook, tenderId, onClose }: { playbook: Playbook; tenderId: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);
  const needs = playbook.parameters ?? [];

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setStage((s) => Math.min(s + 1, 2)), 9000);
    return () => clearInterval(t);
  }, [running]);

  async function run(force = false) {
    setRunning(true);
    const r = await send(`/api/playbooks/${playbook.id}/run`, "POST", { tender_id: tenderId, params: values, force });
    setRunning(false);
    if (!r.ok) return toast.push({ text: r.data.error ?? "Couldn’t run this Playbook", tone: "bad" });
    refresh("/api/playbooks", `/api/tenders/${tenderId}/analyses`);
    router.push(`/tenders/${tenderId}/reports/${r.data.id}`);
    onClose();
  }
  useEffect(() => { if (needs.length === 0) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <Modal open onClose={() => !running && onClose()} title={<span>{playbook.emoji} {playbook.name}</span>} footer={needs.length > 0 && !running ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="play" onClick={() => run()}>Run</Button></> : undefined}>
      {running ? (
        <div className="py-6 text-center">
          <Spinner className="w-7 h-7 text-brand-primary" />
          <div className="mt-3 font-medium">{["Reading the bids…", "Comparing rates and terms…", "Writing your answer…"][stage]}</div>
          <div className="text-xs text-brand-dark/50 mt-1">Usually 20–60 seconds.</div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-brand-dark/65">{playbook.description}</p>
          {needs.map((p) => (
            <label key={p.key} className="block"><div className="text-xs font-medium text-brand-dark/60 mb-1">{p.label}</div><input autoFocus value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} placeholder={p.placeholder} className="w-full border border-line rounded-lg px-3 py-2.5" /></label>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function PlaybookCard({ pb, onRun, onEdit, onPin, onDelete }: { pb: Playbook; onRun: () => void; onEdit?: () => void; onPin?: () => void; onDelete?: () => void }) {
  return (
    <Card className="p-4 flex flex-col hover:shadow-md transition-shadow group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center text-xl shrink-0">{pb.emoji ?? "✨"}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug">{pb.name}</div>
          <div className="text-xs text-brand-dark/55 mt-0.5 line-clamp-2">{pb.description ?? pb.instruction}</div>
        </div>
        {onPin && <button onClick={onPin} title={pb.pinned ? "Unpin" : "Pin to the top"} className={`p-1 ${pb.pinned ? "text-brand-primary" : "text-brand-dark/25 hover:text-brand-primary"}`}><Icon name="star" className="w-4 h-4" /></button>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {pb.category && <Pill tone="accent">{pb.category}</Pill>}
        <Pill>{pb.output_type === "auto" ? "any format" : pb.output_type === "narrative" ? "written report" : pb.output_type}</Pill>
        {pb.parameters?.length > 0 && <Pill tone="info">asks {pb.parameters.length} thing{pb.parameters.length > 1 ? "s" : ""}</Pill>}
        {pb.is_builtin && <Pill>starter</Pill>}
      </div>
      <div className="mt-auto pt-3 flex items-center justify-between">
        <span className="text-[11px] text-brand-dark/40">{pb.run_count ? `Run ${pb.run_count}×` : "Not run yet"}</span>
        <div className="flex items-center gap-1">
          {onEdit && <button onClick={onEdit} className="p-1.5 text-brand-dark/35 hover:text-brand-dark opacity-0 group-hover:opacity-100"><Icon name="edit" className="w-4 h-4" /></button>}
          {onDelete && !pb.is_builtin && <button onClick={onDelete} className="p-1.5 text-brand-dark/35 hover:text-red-600 opacity-0 group-hover:opacity-100"><Icon name="trash" className="w-4 h-4" /></button>}
          <Button size="sm" variant="primary" icon="play" onClick={onRun}>Run</Button>
        </div>
      </div>
    </Card>
  );
}
