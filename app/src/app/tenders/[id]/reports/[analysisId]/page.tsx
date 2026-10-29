"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { refresh, send, useApi } from "@/lib/client/api";
import { useJobs } from "@/lib/client/jobs";
import type { Analysis } from "@/lib/types";
import AnalysisResultView from "@/components/AnalysisResultView";
import { PlaybookEditor } from "@/components/Playbooks";
import { Button, ExportMenu, Menu, PageHeader, Pill, Spinner } from "@/components/ui";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toasts";

export default function ReportPage() {
  const { id, analysisId } = useParams<{ id: string; analysisId: string }>();
  const router = useRouter();
  const jobs = useJobs();
  const toast = useToast();
  const { data, mutate } = useApi<{ analysis: Analysis }>(`/api/analyses/${analysisId}`, { refreshInterval: (d) => (d?.analysis.status === "running" ? 3000 : 0) });
  const [save, setSave] = useState(false);
  const a = data?.analysis;
  if (!a) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;

  function rerun() {
    jobs.startAnalysis({
      tenderId: id,
      title: a!.title ?? "Report",
      subtitle: "Run again",
      run: () => send(`/api/tenders/${id}/analyses`, "POST", { request_text: a!.request_text, requested_type: a!.requested_type, force: true, playbook_id: a!.playbook_id, params: a!.params }),
    });
    toast.push({ text: "Running again in the background — progress is shown bottom-right.", tone: "info" });
  }

  return (
    <div>
      <PageHeader
        back={<Link href={`/tenders/${id}/reports`} className="text-xs text-brand-dark/50 hover:text-brand-primary inline-flex items-center gap-1 mb-1"><Icon name="chevron" className="w-3 h-3 rotate-180" /> All reports</Link>}
        title={a.title ?? "Report"}
        subtitle={<><span>{a.description}</span><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Pill>{new Date(a.created_at).toLocaleString()}</Pill>{a.playbook_id && <Pill tone="accent">From a Playbook</Pill>}</div></>}
        actions={a.status === "ready" ? <>
          <Button icon="spark" onClick={() => setSave(true)}>Save as Playbook</Button>
          <Button icon="undo" onClick={rerun}>Run again</Button>
          <ExportMenu base={`/api/analyses/${a.id}/export`} extras={a.response_type === "narrative" ? [{ label: "Markdown text (.md)", icon: "file", href: `/api/analyses/${a.id}/export?format=md` }] : undefined} />
          <Menu items={[
            { label: "Rename", icon: "edit", onClick: async () => { const t = prompt("Report title", a.title ?? ""); if (t) { await send(`/api/analyses/${a.id}`, "PATCH", { title: t }); mutate(); refresh("/analyses"); } } },
            { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (confirm("Delete this report?")) { await send(`/api/analyses/${a.id}`, "DELETE"); refresh("/analyses"); router.push(`/tenders/${id}/reports`); } } },
          ]} />
        </> : undefined}
      />
      <p className="text-xs text-brand-dark/45 -mt-2 mb-4">You asked: “{a.request_text}”</p>
      {a.status === "running" && <div className="py-10 text-center text-brand-dark/60"><Spinner className="w-6 h-6" /><div className="mt-2 text-sm">Still working on it…</div></div>}
      {a.status === "failed" && <div className="border border-red-200 bg-red-50 text-red-800 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3"><span>We couldn’t produce a reliable answer. {a.error?.slice(0, 160)}</span><Button onClick={rerun}>Try again</Button></div>}
      {a.status === "ready" && a.result && <AnalysisResultView result={a.result} analysisId={a.id} />}
      <PlaybookEditor open={save} onClose={() => setSave(false)} initial={{ from_analysis_id: a.id, name: a.title ?? "", description: a.description ?? "", instruction: a.request_text, output_type: a.requested_type !== "auto" ? a.requested_type : a.response_type ?? "auto" }} />
    </div>
  );
}
