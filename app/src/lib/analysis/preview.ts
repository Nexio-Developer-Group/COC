import type { AnalysisNarrativeBody, AnalysisRankingBody, AnalysisResult, AnalysisTableBody } from "@/lib/types";

export type AnalysisPreview =
  | { kind: "table"; columns: string[]; rows: (string | number | null)[][]; rowCount: number; colCount: number }
  | { kind: "ranking"; top: { rank: number; contractor: string; score: number }[]; total: number }
  | { kind: "narrative"; verdict: string | null; figures: { label: string; value: number; type: string }[]; excerpt: string };

/** A tiny, cheap-to-render summary of a result so list cards can show a glimpse of the real thing. */
export function previewOf(result: AnalysisResult | null): AnalysisPreview | null {
  if (!result) return null;
  if (result.response_type === "table") {
    const b = result.body as AnalysisTableBody;
    const cols = b.columns.slice(0, 4);
    return {
      kind: "table",
      columns: cols.map((c) => c.label),
      rows: b.rows.slice(0, 4).map((r) => cols.map((c) => (r[c.key] ?? null) as string | number | null)),
      rowCount: b.rows.length,
      colCount: b.columns.length,
    };
  }
  if (result.response_type === "ranking") {
    const b = result.body as AnalysisRankingBody;
    return { kind: "ranking", top: [...b.entries].sort((a, c) => a.rank - c.rank).slice(0, 3).map((e) => ({ rank: e.rank, contractor: e.contractor, score: e.score })), total: b.entries.length };
  }
  const b = result.body as AnalysisNarrativeBody;
  return { kind: "narrative", verdict: b.verdict, figures: b.key_figures.slice(0, 3), excerpt: b.markdown.replace(/[#*>`_-]/g, "").replace(/\s+/g, " ").trim().slice(0, 160) };
}
