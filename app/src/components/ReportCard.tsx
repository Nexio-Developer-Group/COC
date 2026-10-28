"use client";

import Link from "next/link";
import type { AnalysisPreview } from "@/lib/analysis/preview";
import { Card, Pill } from "./ui";
import Icon from "./ui/Icon";

export type ReportRow = {
  id: string; title: string | null; description: string | null; status: string; response_type: string | null; request_text: string; created_at: string; stale: boolean; playbook_id?: string | null; template_key?: string | null; preview: AnalysisPreview | null;
};

const TYPE = { table: { icon: "sheet", label: "Table" }, ranking: { icon: "star", label: "Ranking" }, narrative: { icon: "file", label: "Written report" } } as const;
const cellText = (v: string | number | null) => (v == null ? "—" : typeof v === "number" ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v) : v.length > 16 ? v.slice(0, 15) + "…" : v);

export function PreviewGlimpse({ p }: { p: AnalysisPreview }) {
  if (p.kind === "table") {
    return (
      <div className="rounded-lg border border-line overflow-hidden bg-white">
        <table className="w-full text-[10px] leading-tight">
          <thead><tr className="bg-brand-accent-dull text-white">{p.columns.map((c, i) => <th key={i} className={`px-1.5 py-1 font-medium ${i ? "text-right" : "text-left"} truncate max-w-[70px]`}>{c.slice(0, 14)}</th>)}</tr></thead>
          <tbody>
            {p.rows.map((r, i) => <tr key={i} className={i % 2 ? "bg-brand-light-dull" : ""}>{r.map((c, j) => <td key={j} className={`px-1.5 py-[3px] ${j ? "text-right tabular-nums" : ""} truncate`}>{cellText(c)}</td>)}</tr>)}
          </tbody>
        </table>
        <div className="text-[9px] text-brand-dark/40 px-1.5 py-0.5 border-t border-line">{p.rowCount} rows · {p.colCount} columns</div>
      </div>
    );
  }
  if (p.kind === "ranking") {
    const max = Math.max(...p.top.map((t) => t.score), 1);
    return (
      <div className="space-y-1.5">
        {p.top.map((t) => (
          <div key={t.rank} className="flex items-center gap-2 text-[11px]">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${t.rank === 1 ? "bg-brand-primary text-white" : "bg-brand-light"}`}>{t.rank}</span>
            <span className="w-24 truncate">{t.contractor}</span>
            <div className="flex-1 h-2 bg-brand-light rounded-full overflow-hidden"><div className="h-full bg-brand-contrast rounded-full" style={{ width: `${(t.score / max) * 100}%` }} /></div>
            <span className="tabular-nums text-brand-dark/60 w-6 text-right">{Math.round(t.score)}</span>
          </div>
        ))}
        {p.total > 3 && <div className="text-[10px] text-brand-dark/40">+{p.total - 3} more</div>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {p.verdict && <div className="text-[11px] bg-brand-contrast/8 border-l-2 border-brand-contrast rounded-r px-2 py-1.5 text-brand-contrast leading-snug line-clamp-2">{p.verdict}</div>}
      {p.figures.length > 0 && (
        <div className="flex gap-1.5">{p.figures.map((f, i) => <div key={i} className="flex-1 min-w-0 rounded-md bg-brand-light-dull border border-line px-1.5 py-1"><div className="text-[9px] text-brand-dark/45 truncate">{f.label}</div><div className="text-[11px] font-semibold tabular-nums truncate">{cellText(f.value)}</div></div>)}</div>
      )}
      {!p.verdict && <p className="text-[11px] text-brand-dark/55 line-clamp-3">{p.excerpt}</p>}
    </div>
  );
}

export default function ReportCard({ tenderId, report }: { tenderId: string; report: ReportRow }) {
  const t = report.response_type ? TYPE[report.response_type as keyof typeof TYPE] : null;
  return (
    <Link href={`/tenders/${tenderId}/reports/${report.id}`} className="block group">
      <Card className="p-4 h-full flex flex-col hover:shadow-md hover:border-brand-primary/40 transition">
        <div className="flex items-center justify-between gap-2 text-[11px] text-brand-dark/50 mb-2">
          <span className="inline-flex items-center gap-1.5">{t && <Icon name={t.icon} className="w-3.5 h-3.5" />}{t?.label ?? "Report"}{report.playbook_id && <Pill tone="accent">Playbook</Pill>}</span>
          <span>{new Date(report.created_at).toLocaleDateString()}</span>
        </div>
        <div className="font-semibold leading-snug group-hover:text-brand-primary line-clamp-2">{report.title ?? report.request_text}</div>
        {report.description && <p className="text-xs text-brand-dark/55 mt-1 line-clamp-2">{report.description}</p>}
        <div className="mt-3 flex-1">{report.status === "ready" && report.preview ? <PreviewGlimpse p={report.preview} /> : report.status === "failed" ? <Pill tone="bad">Couldn’t be produced</Pill> : <Pill tone="info">Running…</Pill>}</div>
        {report.stale && <div className="mt-3"><Pill tone="warn" title="The bids changed after this was written">Based on earlier bids — run again</Pill></div>}
      </Card>
    </Link>
  );
}
