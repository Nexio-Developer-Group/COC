"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { formatINR, formatPercent, formatQty } from "@/lib/format";
import { useApi } from "@/lib/client/api";
import type { AnalysisNarrativeBody, AnalysisRankingBody, AnalysisResult, AnalysisTableBody } from "@/lib/types";
import { ImageViewer } from "./ImageLightbox";
import { Card } from "./ui";
import Icon from "./ui/Icon";

function formatCell(value: string | number | null | undefined, type: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (type === "currency") return Number.isNaN(n) ? String(value) : formatINR(n);
  if (type === "percent") return Number.isNaN(n) ? String(value) : formatPercent(n);
  if (type === "quantity" || type === "number") return Number.isNaN(n) ? String(value) : formatQty(n);
  return String(value);
}

function TableResult({ body }: { body: AnalysisTableBody }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = sort ? [...body.rows].sort((a, b) => { const x = a[sort.key], y = b[sort.key]; return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * sort.dir; }) : body.rows;
  return (
    <Card className="overflow-x-auto scroll-thin">
      <table className="text-[13px] min-w-full">
        <thead>
          <tr className="bg-brand-accent-dull text-white text-left text-xs">
            {body.columns.map((c, i) => (
              <th key={c.key} onClick={() => setSort(sort?.key === c.key ? { key: c.key, dir: (sort.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 })} className={`px-3 py-2.5 font-medium cursor-pointer select-none whitespace-nowrap ${i ? "text-right" : ""}`}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-t border-line ${i % 2 ? "bg-brand-light-dull/60" : ""}`}>
              {body.columns.map((c, ci) => (
                <td key={c.key} className={`px-3 py-2 ${ci ? "text-right tabular-nums" : ""} ${c.type === "text" && ci ? "text-left" : ""}`}>{formatCell(row[c.key], c.type)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {body.totals_row && (
          <tfoot><tr className="border-t-2 border-brand-dark/20 bg-brand-light font-semibold">{body.columns.map((c, ci) => <td key={c.key} className={`px-3 py-2 ${ci ? "text-right tabular-nums" : ""}`}>{formatCell(body.totals_row?.[c.key], c.type)}</td>)}</tr></tfoot>
        )}
      </table>
      {body.footnote && <p className="text-xs text-brand-dark/50 px-3 py-2 border-t border-line">{body.footnote}</p>}
    </Card>
  );
}

function RankingResult({ body }: { body: AnalysisRankingBody }) {
  const entries = [...body.entries].sort((a, b) => a.rank - b.rank);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">{body.criteria.map((c) => <span key={c.name} title={c.description} className="text-xs px-2.5 py-1 rounded-full bg-brand-contrast/10 text-brand-contrast">{c.name} · {c.weight_percent}%</span>)}</div>
      {entries.map((e) => (
        <Card key={e.bid_ref} className={`p-4 ${e.rank === 1 ? "border-brand-primary/50 shadow-md" : ""}`}>
          <div className="flex items-center gap-3">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold ${e.rank === 1 ? "bg-brand-primary text-white" : "bg-brand-light"}`}>{e.rank}</span>
            <div className="flex-1 min-w-0"><div className="font-semibold text-brand-contrast">{e.contractor}</div><div className="text-sm text-brand-dark/65">{e.headline}</div></div>
            <div className="w-40 hidden sm:block"><div className="h-2 rounded-full bg-brand-light overflow-hidden"><div className="h-full bg-brand-contrast rounded-full" style={{ width: `${e.score}%` }} /></div><div className="text-right text-xs text-brand-dark/55 mt-0.5 tabular-nums">{e.score}/100</div></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-3 text-[13px]">
            {e.strengths.length > 0 && <div><div className="text-xs font-semibold text-emerald-700 mb-1">✓ Strengths</div><ul className="space-y-0.5 text-brand-dark/75">{e.strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul></div>}
            {e.concerns.length > 0 && <div><div className="text-xs font-semibold text-amber-700 mb-1">⚠ Concerns</div><ul className="space-y-0.5 text-brand-dark/75">{e.concerns.map((s, i) => <li key={i}>• {s}</li>)}</ul></div>}
          </div>
          {e.key_figures.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{e.key_figures.map((f, i) => <div key={i} className="rounded-lg bg-brand-light-dull border border-line px-2.5 py-1.5"><div className="text-[10px] text-brand-dark/45">{f.label}</div><div className="text-sm font-semibold tabular-nums">{formatCell(f.value, f.type)}</div></div>)}</div>}
        </Card>
      ))}
      <p className="text-xs text-brand-dark/50">{body.method_note}</p>
    </div>
  );
}

function NarrativeResult({ body }: { body: AnalysisNarrativeBody }) {
  return (
    <div className="space-y-4">
      {body.verdict && <div className="rounded-xl border-l-4 border-brand-contrast bg-brand-contrast/5 px-4 py-3 text-brand-contrast font-medium">{body.verdict}</div>}
      {body.key_figures.length > 0 && <div className="flex flex-wrap gap-3">{body.key_figures.map((f, i) => <Card key={i} className="px-4 py-3 min-w-[150px]"><div className="text-[11px] text-brand-dark/45">{f.label}</div><div className="text-xl font-semibold tabular-nums">{formatCell(f.value, f.type)}</div></Card>)}</div>}
      <Card className="p-6">
        <div className="max-w-none text-[14px] leading-relaxed text-brand-dark/85 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h3]:font-semibold [&_h3]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-brand-dark/60">
          <ReactMarkdown allowedElements={["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "blockquote"]} unwrapDisallowed>{body.markdown}</ReactMarkdown>
        </div>
      </Card>
    </div>
  );
}

type ImgGroup = { title: string; images: { id: string; public_url: string; caption: string | null; item_code: string | null; row_name: string | null }[] };
function ReportImages({ analysisId }: { analysisId: string }) {
  const { data } = useApi<{ groups: ImgGroup[]; total: number }>(`/api/analyses/${analysisId}/images`);
  const [view, setView] = useState<{ g: number; i: number } | null>(null);
  if (!data || data.total === 0) return null;
  return (
    <div className="mt-8">
      <h3 className="font-semibold flex items-center gap-2 mb-3"><Icon name="image" /> Pictures related to this report <span className="text-xs font-normal text-brand-dark/45">({data.total})</span></h3>
      <div className="space-y-4">
        {data.groups.map((g, gi) => (
          <div key={gi}>
            <div className="text-xs font-medium text-brand-dark/55 mb-1.5">{g.title}</div>
            <div className="flex gap-2.5 overflow-x-auto scroll-thin pb-1">
              {g.images.map((im, ii) => (
                <figure key={im.id} className="shrink-0 w-36">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.public_url} alt="" onClick={() => setView({ g: gi, i: ii })} className="h-24 w-36 object-cover rounded-lg border border-line cursor-zoom-in" />
                  <figcaption className="text-[10px] text-brand-dark/50 mt-1 truncate">{im.item_code ? `${im.item_code} ` : ""}{im.row_name ?? im.caption ?? ""}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
      {view && <ImageViewer images={data.groups[view.g].images.map((i) => ({ public_url: i.public_url, caption: i.caption, label: `${data.groups[view.g].title}${i.item_code ? ` · ${i.item_code}` : ""}` }))} index={view.i} onClose={() => setView(null)} onIndex={(i) => setView({ g: view.g, i })} />}
    </div>
  );
}

export default function AnalysisResultView({ result, analysisId }: { result: AnalysisResult; analysisId?: string }) {
  return (
    <div>
      {!result.answerable && <div className="border border-amber-200 bg-amber-50 text-amber-800 rounded-lg px-3 py-2 text-sm mb-4">This couldn’t be fully answered from the uploaded data.</div>}
      {result.response_type === "table" && <TableResult body={result.body as AnalysisTableBody} />}
      {result.response_type === "ranking" && <RankingResult body={result.body as AnalysisRankingBody} />}
      {result.response_type === "narrative" && <NarrativeResult body={result.body as AnalysisNarrativeBody} />}
      {(result.assumptions.length > 0 || result.data_limitations.length > 0) && (
        <div className="mt-5 grid sm:grid-cols-2 gap-4 text-xs text-brand-dark/60">
          {result.assumptions.length > 0 && <div><div className="font-semibold text-brand-dark/70 mb-1">Assumptions</div><ul className="space-y-0.5">{result.assumptions.map((a, i) => <li key={i}>• {a}</li>)}</ul></div>}
          {result.data_limitations.length > 0 && <div><div className="font-semibold text-brand-dark/70 mb-1">Limits of this answer</div><ul className="space-y-0.5">{result.data_limitations.map((a, i) => <li key={i}>• {a}</li>)}</ul></div>}
        </div>
      )}
      {analysisId && <ReportImages analysisId={analysisId} />}
    </div>
  );
}
