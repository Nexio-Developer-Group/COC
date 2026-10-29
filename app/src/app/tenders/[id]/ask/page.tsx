"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { send, useApi } from "@/lib/client/api";
import { useJobs } from "@/lib/client/jobs";
import type { Playbook } from "@/lib/types";
import { PlaybookCard, PlaybookEditor, RunPlaybookDialog } from "@/components/Playbooks";
import { Button, Card, PageHeader } from "@/components/ui";
import Icon from "@/components/ui/Icon";

const TYPES = [{ v: "auto", l: "Let us choose" }, { v: "table", l: "Table" }, { v: "ranking", l: "Ranking" }, { v: "narrative", l: "Written report" }];

export default function AskPage() {
  const { id } = useParams<{ id: string }>();
  const jobs = useJobs();
  const { data } = useApi<{ playbooks: Playbook[] }>("/api/playbooks");
  const [text, setText] = useState("");
  const [type, setType] = useState("auto");
  const [runPb, setRunPb] = useState<Playbook | null>(null);
  const [edit, setEdit] = useState<Partial<Playbook> | null>(null);

  function ask() {
    const q = text.trim();
    jobs.startAnalysis({
      tenderId: id,
      title: q.length > 70 ? q.slice(0, 68) + "…" : q,
      subtitle: type === "auto" ? "Question" : type,
      run: () => send(`/api/tenders/${id}/analyses`, "POST", { request_text: q, requested_type: type }),
    });
    setText("");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ask · Playbooks" subtitle="Ask anything about this tender’s bids — or run a saved Playbook. Answers only use your BOQ and bids." />
      <Card className="p-5">
        <label className="block text-sm font-medium mb-2">Ask a question</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. Which contractor is cheapest for painting work, and by how much?" className="w-full border border-line rounded-xl px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/25 focus:border-brand-primary" />
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-sm">{TYPES.map((t) => <button key={t.v} onClick={() => setType(t.v)} className={`px-3 py-1.5 rounded-md ${type === t.v ? "bg-brand-dark text-white" : "hover:bg-black/5 text-brand-dark/70"}`}>{t.l}</button>)}</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-brand-dark/45 hidden sm:inline">Runs in the background — ask several at once</span>
            <Button variant="primary" icon="spark" disabled={!text.trim()} onClick={ask}>Run analysis</Button>
          </div>
        </div>
      </Card>

      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Icon name="spark" className="text-brand-primary" /> Playbooks</h2>
            <p className="text-sm text-brand-dark/55">Questions you ask often, saved once. Run them on any tender.</p>
          </div>
          <Button icon="plus" onClick={() => setEdit({})}>New Playbook</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(data?.playbooks ?? []).map((pb) => <PlaybookCard key={pb.id} pb={pb} onRun={() => setRunPb(pb)} />)}
        </div>
      </div>
      {runPb && <RunPlaybookDialog playbook={runPb} tenderId={id} onClose={() => setRunPb(null)} />}
      <PlaybookEditor open={!!edit} onClose={() => setEdit(null)} initial={edit ?? undefined} />
    </div>
  );
}
