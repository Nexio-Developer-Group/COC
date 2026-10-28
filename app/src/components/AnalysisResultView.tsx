import ReactMarkdown from "react-markdown";
import { formatINR, formatPercent, formatQty } from "@/lib/format";
import type { AnalysisResult, AnalysisTableBody, AnalysisRankingBody, AnalysisNarrativeBody } from "@/lib/types";

function formatCell(value: string | number | null | undefined, type: string): string {
  if (value === null || value === undefined) return "—";
  if (type === "currency") return formatINR(typeof value === "number" ? value : Number(value));
  if (type === "percent") return formatPercent(typeof value === "number" ? value : Number(value));
  if (type === "quantity") return formatQty(typeof value === "number" ? value : Number(value));
  return String(value);
}

function TableResult({ body }: { body: AnalysisTableBody }) {
  return (
    <div className="bg-white border border-brand-light rounded-lg overflow-x-auto">
      <table className="text-sm min-w-full">
        <thead className="bg-brand-light text-brand-dark/70 text-left">
          <tr>
            {body.columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.rows.map((row, i) => (
            <tr key={i} className="border-t border-brand-light">
              {body.columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.type !== "text" && c.type !== "flag" ? "text-right tabular-nums" : ""}`}>
                  {formatCell(row[c.key], c.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {body.totals_row && (
          <tfoot>
            <tr className="border-t-2 border-brand-dark/20 bg-brand-light-dull font-medium">
              {body.columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.type !== "text" ? "text-right" : ""}`}>
                  {formatCell(body.totals_row?.[c.key], c.type)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {body.footnote && <p className="text-xs text-brand-dark/50 px-3 py-2 border-t border-brand-light">{body.footnote}</p>}
    </div>
  );
}

function RankingResult({ body }: { body: AnalysisRankingBody }) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-brand-dark/60">
        Criteria: {body.criteria.map((c) => `${c.name} (${c.weight_percent}%)`).join(" · ")}
      </div>
      {body.entries.map((e) => (
        <div key={e.bid_ref} className="bg-white border border-brand-light rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-brand-dark">
              #{e.rank} {e.contractor}
            </div>
            <div className="text-lg font-semibold text-brand-primary">{e.score}/100</div>
          </div>
          <p className="text-sm text-brand-dark/70 mt-1">{e.headline}</p>
          <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
            {e.strengths.length > 0 && (
              <div>
                <div className="text-xs font-medium text-green-700 mb-1">Strengths</div>
                <ul className="list-disc list-inside text-brand-dark/70 space-y-0.5">
                  {e.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {e.concerns.length > 0 && (
              <div>
                <div className="text-xs font-medium text-amber-700 mb-1">Concerns</div>
                <ul className="list-disc list-inside text-brand-dark/70 space-y-0.5">
                  {e.concerns.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {e.key_figures.length > 0 && (
            <div className="flex gap-4 mt-3 text-xs text-brand-dark/60">
              {e.key_figures.map((f, i) => (
                <div key={i}>
                  {f.label}: <span className="font-medium">{formatCell(f.value, f.type)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-brand-dark/50">{body.method_note}</p>
    </div>
  );
}

function NarrativeResult({ body }: { body: AnalysisNarrativeBody }) {
  return (
    <div className="bg-white border border-brand-light rounded-lg p-6">
      {body.verdict && <p className="text-lg font-medium text-brand-dark mb-4">{body.verdict}</p>}
      <div className="prose prose-sm max-w-none text-brand-dark/80">
        <ReactMarkdown allowedElements={["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "blockquote"]} unwrapDisallowed>
          {body.markdown}
        </ReactMarkdown>
      </div>
      {body.key_figures.length > 0 && (
        <div className="flex gap-4 mt-4 pt-4 border-t border-brand-light text-sm">
          {body.key_figures.map((f, i) => (
            <div key={i}>
              <div className="text-xs text-brand-dark/50">{f.label}</div>
              <div className="font-medium">{formatCell(f.value, f.type)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnalysisResultView({ result }: { result: AnalysisResult }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-brand-dark">{result.title}</h2>
      <p className="text-sm text-brand-dark/60 mb-4">{result.description}</p>
      {!result.answerable && (
        <div className="border border-amber-200 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm mb-4">
          This couldn&apos;t be fully answered from the uploaded data.
        </div>
      )}
      {result.response_type === "table" && <TableResult body={result.body as AnalysisTableBody} />}
      {result.response_type === "ranking" && <RankingResult body={result.body as AnalysisRankingBody} />}
      {result.response_type === "narrative" && <NarrativeResult body={result.body as AnalysisNarrativeBody} />}

      {(result.assumptions.length > 0 || result.data_limitations.length > 0) && (
        <div className="mt-4 text-xs text-brand-dark/50 space-y-1">
          {result.assumptions.map((a, i) => (
            <p key={`a${i}`}>Assumption: {a}</p>
          ))}
          {result.data_limitations.map((d, i) => (
            <p key={`d${i}`}>Limitation: {d}</p>
          ))}
        </div>
      )}
    </div>
  );
}
