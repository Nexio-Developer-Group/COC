"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AnalysisResultView from "@/components/AnalysisResultView";
import type { Analysis } from "@/lib/types";

export default function AnalysisReportPage() {
  const params = useParams<{ id: string; analysisId: string }>();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  useEffect(() => {
    fetch(`/api/analyses/${params.analysisId}`)
      .then((r) => r.json())
      .then((d) => setAnalysis(d.analysis));
  }, [params.analysisId]);

  if (!analysis) return <p className="text-brand-dark/60">Loading…</p>;

  return (
    <div>
      <Link href={`/tenders/${params.id}`} className="text-sm text-brand-primary hover:underline mb-4 inline-block">
        ← Back to tender
      </Link>

      {analysis.status === "running" && <p className="text-brand-dark/60">Still running…</p>}
      {analysis.status === "failed" && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded-md px-4 py-3 text-sm">
          This analysis failed: {analysis.error}
        </div>
      )}
      {analysis.status === "ready" && analysis.result && (
        <div>
          <div className="flex justify-end gap-2 mb-3">
            {analysis.response_type === "narrative" ? (
              <a href={`/api/analyses/${analysis.id}/export?format=md`} className="text-sm bg-brand-accent hover:bg-brand-accent-dull text-white px-3 py-1.5 rounded-md">
                Export Markdown
              </a>
            ) : (
              <>
                <a
                  href={`/api/analyses/${analysis.id}/export?format=xlsx`}
                  className="text-sm bg-brand-accent hover:bg-brand-accent-dull text-white px-3 py-1.5 rounded-md"
                >
                  Export Excel
                </a>
                <a href={`/api/analyses/${analysis.id}/export?format=csv`} className="text-sm border border-brand-light text-brand-dark px-3 py-1.5 rounded-md">
                  Export CSV
                </a>
              </>
            )}
          </div>
          <p className="text-xs text-brand-dark/40 mb-3">Asked: &quot;{analysis.request_text}&quot;</p>
          <AnalysisResultView result={analysis.result} />
        </div>
      )}
    </div>
  );
}
