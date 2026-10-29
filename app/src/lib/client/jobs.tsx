"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { refresh, send } from "./api";
import { uploadAndProcess } from "./upload";

export type Job = {
  id: string;
  kind: "upload" | "analysis";
  title: string;
  subtitle?: string;
  detail: string;
  pct: number;
  status: "queued" | "running" | "done" | "error";
  href?: string;
  hrefLabel?: string;
  error?: string;
  finishedAt?: number;
};

type UploadOpts = { tenderId: string; file: File; role: "tender" | "bid"; partyName?: string | null; replaceDocumentId?: string | null };
type AnalysisOpts = { tenderId: string; title: string; subtitle?: string; run: () => Promise<{ ok: boolean; data: { id?: string; error?: string } }> };

type Ctx = {
  jobs: Job[];
  startUpload: (o: UploadOpts) => void;
  startAnalysis: (o: AnalysisOpts) => void;
  dismiss: (id: string) => void;
};
const JobsCtx = createContext<Ctx>({ jobs: [], startUpload: () => {}, startAnalysis: () => {}, dismiss: () => {} });
export const useJobs = () => useContext(JobsCtx);

const MAX_PARALLEL_UPLOADS = 3;
let counter = 0;

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const queue = useRef<{ id: string; run: () => Promise<void> }[]>([]);
  const active = useRef(0);

  const patch = useCallback((id: string, p: Partial<Job>) => setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...p } : j))), []);
  const dismiss = useCallback((id: string) => setJobs((cur) => cur.filter((j) => j.id !== id)), []);

  const pump = useCallback(() => {
    while (active.current < MAX_PARALLEL_UPLOADS && queue.current.length) {
      const next = queue.current.shift()!;
      active.current++;
      next.run().finally(() => {
        active.current--;
        pump();
      });
    }
  }, []);

  const startUpload = useCallback(
    (o: UploadOpts) => {
      const id = `job-${++counter}`;
      const run = async () => {
        patch(id, { status: "running", detail: "Uploading…", pct: 3 });
        const docId = await uploadAndProcess({
          tenderId: o.tenderId, file: o.file, role: o.role, partyName: o.partyName, replaceDocumentId: o.replaceDocumentId,
          onProgress: (p) => {
            if (p.phase === "error") patch(id, { status: "error", detail: p.error ?? "Failed", pct: 100, error: p.error, finishedAt: Date.now() });
            else if (p.phase === "done") patch(id, { status: "done", detail: "Ready for your review", pct: 100, finishedAt: Date.now(), href: o.role === "tender" ? `/tenders/${o.tenderId}/requirements` : `/tenders/${o.tenderId}/bids/${p.documentId}`, hrefLabel: "Review" });
            else patch(id, { status: "running", detail: p.detail, pct: p.pct });
          },
        });
        refresh(`/api/tenders/${o.tenderId}`, "/documents", "/comparison", "/api/tenders");
        void docId;
      };
      queue.current.push({ id, run });
      setJobs((cur) => [...cur, { id, kind: "upload", title: o.file.name, subtitle: o.role === "tender" ? "Requirements" : o.partyName || "Bid", detail: "Waiting for a free slot…", pct: 0, status: "queued" }]);
      pump();
    },
    [patch, pump]
  );

  const startAnalysis = useCallback(
    (o: AnalysisOpts) => {
      const id = `job-${++counter}`;
      setJobs((cur) => [...cur, { id, kind: "analysis", title: o.title, subtitle: o.subtitle ?? "Report", detail: "Reading the bids…", pct: 4, status: "running" }]);
      const t0 = Date.now();
      const timer = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        // time-based estimate: eases toward 92% so it never claims to be finished early
        const pct = Math.round(92 * (1 - Math.exp(-s / 22)));
        patch(id, { pct: Math.max(4, pct), detail: s < 8 ? "Reading the bids…" : s < 25 ? "Comparing rates and terms…" : "Writing your answer…" });
      }, 700);
      o.run()
        .then((r) => {
          clearInterval(timer);
          if (r.ok && r.data.id) {
            patch(id, { status: "done", pct: 100, detail: "Report is ready", finishedAt: Date.now(), href: `/tenders/${o.tenderId}/reports/${r.data.id}`, hrefLabel: "Open report" });
            refresh(`/api/tenders/${o.tenderId}/analyses`, "/api/playbooks");
          } else patch(id, { status: "error", pct: 100, detail: r.data.error ?? "We couldn’t produce a reliable answer", error: r.data.error ?? "failed", finishedAt: Date.now() });
        })
        .catch((e) => {
          clearInterval(timer);
          patch(id, { status: "error", pct: 100, detail: e instanceof Error ? e.message : "Failed", error: "failed", finishedAt: Date.now() });
        });
    },
    [patch]
  );

  // finished successes fade away on their own; errors stay until dismissed
  useEffect(() => {
    const t = setInterval(() => setJobs((cur) => cur.filter((j) => !(j.status === "done" && j.finishedAt && Date.now() - j.finishedAt > 20000))), 2000);
    return () => clearInterval(t);
  }, []);

  // the browser drives the reading, so warn before closing the tab mid-way
  const busy = jobs.some((j) => j.status === "running" || j.status === "queued");
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  const value = useMemo(() => ({ jobs, startUpload, startAnalysis, dismiss }), [jobs, startUpload, startAnalysis, dismiss]);
  return (
    <JobsCtx.Provider value={value}>
      {children}
      <JobToasts jobs={jobs} dismiss={dismiss} />
    </JobsCtx.Provider>
  );
}

function JobToasts({ jobs, dismiss }: { jobs: Job[]; dismiss: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[min(380px,calc(100vw-2rem))] flex flex-col gap-2 no-print" aria-live="polite">
      {jobs.length > 1 && (
        <button onClick={() => setCollapsed(!collapsed)} className="self-end text-xs bg-brand-dark text-white rounded-full px-3 py-1.5 shadow-lg flex items-center gap-1.5">
          {running > 0 ? `${running} running` : "Finished"} · {jobs.length} total <Icon name="chevdown" className={`w-3 h-3 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      )}
      <div className={`flex flex-col gap-2 max-h-[60vh] overflow-y-auto scroll-thin ${collapsed ? "hidden" : ""}`}>
        {jobs.map((j) => (
          <div key={j.id} className={`bg-white border rounded-xl shadow-xl px-3.5 py-3 ${j.status === "error" ? "border-red-300" : j.status === "done" ? "border-emerald-300" : "border-line"}`}>
            <div className="flex items-start gap-2.5">
              <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${j.status === "error" ? "bg-red-50 text-red-600" : j.status === "done" ? "bg-emerald-50 text-emerald-600" : "bg-brand-primary/10 text-brand-primary"}`}>
                {j.status === "done" ? <Icon name="check" /> : j.status === "error" ? <Icon name="warn" /> : <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate" title={j.title}>{j.title}</div>
                  {(j.status === "done" || j.status === "error") && <button onClick={() => dismiss(j.id)} className="text-brand-dark/35 hover:text-brand-dark shrink-0"><Icon name="x" className="w-3.5 h-3.5" /></button>}
                </div>
                <div className="text-[11px] text-brand-dark/45 truncate">{j.kind === "upload" ? "Reading file" : "Analysis"}{j.subtitle ? ` · ${j.subtitle}` : ""}</div>
                <div className="mt-2 h-1.5 rounded-full bg-brand-light overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${j.status === "error" ? "bg-red-500" : j.status === "done" ? "bg-emerald-500" : "bg-brand-primary"} ${j.status === "queued" ? "opacity-40" : ""}`} style={{ width: `${Math.max(j.pct, j.status === "queued" ? 4 : 2)}%` }} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5 text-xs">
                  <span className={`truncate ${j.status === "error" ? "text-red-600" : "text-brand-dark/60"}`} title={j.detail}>{j.detail}</span>
                  {j.status === "done" && j.href ? (
                    <Link href={j.href} onClick={() => dismiss(j.id)} className="text-brand-contrast font-medium whitespace-nowrap hover:underline">{j.hrefLabel ?? "Open"} →</Link>
                  ) : (
                    <span className="tabular-nums text-brand-dark/45 shrink-0">{j.status === "queued" ? "queued" : `${j.pct}%`}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
