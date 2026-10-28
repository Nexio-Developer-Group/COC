"use client";

import { useState } from "react";
import { refresh, send, useApi } from "@/lib/client/api";
import type { Playbook, Tender } from "@/lib/types";
import { PlaybookCard, PlaybookEditor, RunPlaybookDialog } from "@/components/Playbooks";
import { Button, Card, EmptyState, Modal, PageHeader, Spinner } from "@/components/ui";
import Icon from "@/components/ui/Icon";

export default function PlaybooksPage() {
  const { data, isLoading } = useApi<{ playbooks: Playbook[] }>("/api/playbooks");
  const tenders = useApi<{ tenders: Tender[] }>("/api/tenders");
  const [cat, setCat] = useState("All");
  const [edit, setEdit] = useState<Partial<Playbook> | null>(null);
  const [pick, setPick] = useState<Playbook | null>(null);
  const [tenderId, setTenderId] = useState("");
  const [run, setRun] = useState<{ pb: Playbook; tenderId: string } | null>(null);

  const all = data?.playbooks ?? [];
  const cats = ["All", ...new Set(all.map((p) => p.category ?? "Other"))];
  const list = all.filter((p) => cat === "All" || (p.category ?? "Other") === cat);

  return (
    <div>
      <PageHeader
        title="Playbooks"
        subtitle="Save a question once, run it on any tender. Think of them as your own reusable analyses — “Tax summary”, “Payment terms”, “Anything missing from the scope”."
        actions={<Button variant="primary" icon="plus" onClick={() => setEdit({})}>New Playbook</Button>}
      />
      <Card className="p-4 mb-5 bg-brand-primary/5 border-brand-primary/20 text-sm flex gap-3">
        <Icon name="spark" className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
        <div><b>How it works.</b> Write the question in plain words (or save any report as a Playbook). Pick a tender and press Run — the answer is built from that tender’s own BOQ and bids. Use <code className="bg-white px-1 rounded border border-line">{"{{section}}"}</code> in a question to be asked for a value each time.</div>
      </Card>
      <div className="flex flex-wrap gap-1.5 mb-4">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`text-xs px-3 py-1.5 rounded-full border ${cat === c ? "bg-brand-dark text-white border-brand-dark" : "bg-white border-line hover:border-brand-primary/60"}`}>{c}</button>)}</div>
      {isLoading && !data ? <div className="py-16 text-center"><Spinner className="w-6 h-6" /></div> : list.length === 0 ? (
        <EmptyState icon="spark" title="No Playbooks here yet" text="Create your first one — it takes a minute." action={<Button variant="primary" icon="plus" onClick={() => setEdit({})}>New Playbook</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((pb) => (
            <PlaybookCard key={pb.id} pb={pb} onRun={() => { setPick(pb); setTenderId(tenders.data?.tenders[0]?.id ?? ""); }} onEdit={() => setEdit(pb)}
              onPin={async () => { await send(`/api/playbooks/${pb.id}`, "PATCH", { pinned: !pb.pinned }); refresh("/api/playbooks"); }}
              onDelete={async () => { if (confirm(`Delete “${pb.name}”? Reports already made from it are kept.`)) { await send(`/api/playbooks/${pb.id}`, "DELETE"); refresh("/api/playbooks"); } }} />
          ))}
        </div>
      )}
      <Modal open={!!pick} onClose={() => setPick(null)} title={`Run “${pick?.name}” on…`} footer={<><Button onClick={() => setPick(null)}>Cancel</Button><Button variant="primary" icon="play" disabled={!tenderId} onClick={() => { setRun({ pb: pick!, tenderId }); setPick(null); }}>Continue</Button></>}>
        <select value={tenderId} onChange={(e) => setTenderId(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2.5 text-sm bg-white">
          {(tenders.data?.tenders ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </Modal>
      {run && <RunPlaybookDialog playbook={run.pb} tenderId={run.tenderId} onClose={() => setRun(null)} />}
      <PlaybookEditor open={!!edit} onClose={() => setEdit(null)} initial={edit ?? undefined} />
    </div>
  );
}
