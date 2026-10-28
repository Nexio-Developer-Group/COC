"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Badge, { statusTone } from "@/components/Badge";
import Money from "@/components/Money";
import UploadBox from "@/components/UploadBox";
import BoqTable from "@/components/BoqTable";
import IssuesList from "@/components/IssuesList";
import ComparisonGrid from "@/components/ComparisonGrid";
import type { Comparison } from "@/lib/compare";
import type { Document, LineItem, Tender } from "@/lib/types";

type TabKey = "requirements" | "bids" | "compare" | "analyses";

const QUICK_PICKS = [
  { key: "compare_cost", label: "Compare total cost", text: "Compare the total cost across all bids, using like-for-like totals, and explain any gaps." },
  { key: "rank_value", label: "Rank by value for money", text: "Rank the contractors by overall value for money, considering price, completeness, and remarks like material-by-client." },
  { key: "flag_mismatch", label: "Flag quantity/rate mismatches", text: "Flag any line items where a bid's quantity doesn't match the tender, or where rates look unusually high or low compared to the median." },
  { key: "civil_only", label: "Civil works comparison", text: "Compare bids on the Civil Works section only, as a table." },
  { key: "missing_items", label: "What's not priced", text: "List, per bid, which tender items were left unpriced or missing, as a table." },
  { key: "recommend", label: "Recommend a contractor", text: "Recommend which contractor to award this tender to, with a short written rationale covering price, completeness and risk." },
];

export default function TenderDetailPage() {
  const params = useParams<{ id: string }>();
  const tenderId = params.id;
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("requirements");
  const [tender, setTender] = useState<Tender | null>(null);
  const [requirementsDoc, setRequirementsDoc] = useState<Document | null>(null);
  const [bids, setBids] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTender = useCallback(async () => {
    const res = await fetch(`/api/tenders/${tenderId}`);
    const data = await res.json();
    setTender(data.tender);
    setRequirementsDoc(data.requirementsDoc);
    setBids(data.bids ?? []);
    setLoading(false);
  }, [tenderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    loadTender();
  }, [loadTender]);

  if (loading || !tender) return <p className="text-brand-dark/60">Loading…</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-dark">{tender.title}</h1>
        <p className="text-sm text-brand-dark/60 mt-1">
          {tender.client_name ? `${tender.client_name} · ` : ""}
          {tender.location ?? ""}
        </p>
      </div>

      <div className="flex gap-1 border-b border-brand-light mb-6">
        {(["requirements", "bids", "compare", "analyses"] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${
              tab === t ? "border-brand-primary text-brand-primary" : "border-transparent text-brand-dark/60 hover:text-brand-dark"
            }`}
          >
            {t}
            {t === "bids" && bids.length > 0 && <span className="ml-1 text-xs text-brand-dark/40">({bids.length})</span>}
          </button>
        ))}
      </div>

      {tab === "requirements" && (
        <RequirementsTab tenderId={tenderId} requirementsDoc={requirementsDoc} onChange={loadTender} />
      )}
      {tab === "bids" && <BidsTab tenderId={tenderId} bids={bids} onChange={loadTender} />}
      {tab === "compare" && <CompareTab tenderId={tenderId} hasRequirements={!!requirementsDoc} />}
      {tab === "analyses" && (
        <AnalysesTab tenderId={tenderId} hasRequirements={!!requirementsDoc} onOpenAnalysis={(id) => router.push(`/tenders/${tenderId}/reports/${id}`)} />
      )}
    </div>
  );
}

function RequirementsTab({ tenderId, requirementsDoc, onChange }: { tenderId: string; requirementsDoc: Document | null; onChange: () => void }) {
  const [sections, setSections] = useState<LineItem[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!requirementsDoc) return;
    const res = await fetch(`/api/documents/${requirementsDoc.id}`);
    const data = await res.json();
    setSections(data.sections ?? []);
    setItems(data.items ?? []);
  }, [requirementsDoc]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
    if (requirementsDoc && requirementsDoc.status === "processing") {
      pollRef.current = setInterval(async () => {
        await onChange();
      }, 2500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementsDoc?.status]);

  if (!requirementsDoc) {
    return <UploadBox tenderId={tenderId} role="tender" onUploaded={onChange} label="Upload the tender / BOQ document" />;
  }

  if (requirementsDoc.status === "uploaded" || requirementsDoc.status === "processing") {
    return (
      <div className="bg-white border border-brand-light rounded-lg p-6 text-center text-brand-dark/60">
        {requirementsDoc.status_detail ?? "Reading this document with AI…"}
      </div>
    );
  }

  if (requirementsDoc.status === "failed") {
    return (
      <div>
        <IssuesList issues={requirementsDoc.issues} />
        <button
          onClick={async () => {
            await fetch(`/api/documents/${requirementsDoc.id}/process`, { method: "POST" });
            onChange();
          }}
          className="bg-brand-primary text-white px-4 py-2 rounded-md text-sm"
        >
          Retry processing
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-brand-dark/60">
          {requirementsDoc.title} · {items.length} items in {sections.length} sections
        </div>
        <Badge tone={statusTone(requirementsDoc.status)}>{requirementsDoc.status.replace("_", " ")}</Badge>
      </div>
      <IssuesList issues={requirementsDoc.issues} />
      <BoqTable sections={sections} items={items} currency={requirementsDoc.currency ?? "INR"} />
    </div>
  );
}

function BidsTab({ tenderId, bids, onChange }: { tenderId: string; bids: Document[]; onChange: () => void }) {
  return (
    <div>
      <div className="mb-4">
        <UploadBox tenderId={tenderId} role="bid" onUploaded={onChange} label="Upload a contractor's bid" />
      </div>
      {bids.length === 0 ? (
        <p className="text-brand-dark/60 text-sm">No bids uploaded yet.</p>
      ) : (
        <div className="bg-white border border-brand-light rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-light text-brand-dark/70 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Contractor</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Stated total</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.id} className="border-t border-brand-light hover:bg-brand-light-dull">
                  <td className="px-4 py-3">
                    <Link href={`/tenders/${tenderId}/bids/${b.id}`} className="font-medium text-brand-primary hover:underline">
                      {b.party_name ?? "Unknown contractor"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-brand-dark/60">{b.file_name}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(b.status)}>{b.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money value={b.stated_total} currency={b.currency ?? "INR"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompareTab({ tenderId, hasRequirements }: { tenderId: string; hasRequirements: boolean }) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasRequirements) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
      setLoading(false);
      return;
    }
    fetch(`/api/tenders/${tenderId}/comparison`)
      .then((r) => r.json())
      .then((d) => setComparison(d.comparison ?? null))
      .finally(() => setLoading(false));
  }, [tenderId, hasRequirements]);

  if (!hasRequirements) return <p className="text-brand-dark/60 text-sm">Upload the tender requirements first.</p>;
  if (loading) return <p className="text-brand-dark/60">Loading…</p>;
  if (!comparison || comparison.bids.length === 0) return <p className="text-brand-dark/60 text-sm">No bids to compare yet.</p>;

  return (
    <div>
      <div className="flex justify-end gap-2 mb-3">
        <a href={`/api/tenders/${tenderId}/comparison/export?format=xlsx`} className="text-sm bg-brand-accent hover:bg-brand-accent-dull text-white px-3 py-1.5 rounded-md">
          Export Excel
        </a>
        <a href={`/api/tenders/${tenderId}/comparison/export?format=csv`} className="text-sm border border-brand-light text-brand-dark px-3 py-1.5 rounded-md">
          Export CSV
        </a>
      </div>
      <ComparisonGrid comparison={comparison} tenderId={tenderId} />
      {comparison.extraItems.length > 0 && (
        <div className="mt-4 text-sm text-brand-dark/60">
          <strong>{comparison.extraItems.length}</strong> extra item(s) offered outside the tender scope.
        </div>
      )}
    </div>
  );
}

function AnalysesTab({ tenderId, hasRequirements, onOpenAnalysis }: { tenderId: string; hasRequirements: boolean; onOpenAnalysis: (id: string) => void }) {
  type AnalysisRow = { id: string; title: string | null; description: string | null; status: string; response_type: string | null; request_text: string; created_at: string; stale: boolean };
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [requestText, setRequestText] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tenders/${tenderId}/analyses`);
    const data = await res.json();
    setAnalyses(data.analyses ?? []);
  }, [tenderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
  }, [load]);

  async function runAnalysis(text: string, templateKey?: string) {
    setRunning(true);
    const res = await fetch(`/api/tenders/${tenderId}/analyses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_text: text, requested_type: "auto", template_key: templateKey }),
    });
    const data = await res.json();
    setRunning(false);
    if (res.ok && data.id) {
      onOpenAnalysis(data.id);
    }
  }

  if (!hasRequirements) return <p className="text-brand-dark/60 text-sm">Upload the tender requirements first.</p>;

  return (
    <div>
      <div className="bg-white border border-brand-light rounded-lg p-4 mb-6">
        <label className="block text-sm font-medium text-brand-dark mb-2">Ask for an analysis</label>
        <textarea
          className="w-full border border-brand-light rounded-md px-3 py-2 text-sm mb-2"
          rows={3}
          placeholder="e.g. Which contractor gives the best value on civil works, and why?"
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {QUICK_PICKS.map((q) => (
              <button
                key={q.key}
                onClick={() => runAnalysis(q.text, q.key)}
                disabled={running}
                className="text-xs border border-brand-light hover:border-brand-primary px-2.5 py-1 rounded-full text-brand-dark/70"
              >
                {q.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => runAnalysis(requestText)}
            disabled={running || !requestText.trim()}
            className="bg-brand-primary hover:bg-brand-primary-dull disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md text-sm whitespace-nowrap ml-3"
          >
            {running ? "Analysing…" : "Run analysis"}
          </button>
        </div>
      </div>

      {analyses.length === 0 ? (
        <p className="text-brand-dark/60 text-sm">No analyses yet — try one of the quick picks above.</p>
      ) : (
        <div className="space-y-2">
          {analyses.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpenAnalysis(a.id)}
              className="w-full text-left bg-white border border-brand-light hover:border-brand-primary rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-brand-dark">{a.title ?? a.request_text}</div>
                <div className="flex items-center gap-2">
                  {a.stale && <Badge tone="warn">based on earlier bids</Badge>}
                  <Badge tone={a.status === "ready" ? "ok" : a.status === "failed" ? "bad" : "info"}>{a.status}</Badge>
                </div>
              </div>
              {a.description && <p className="text-sm text-brand-dark/60 mt-1">{a.description}</p>}
              <p className="text-xs text-brand-dark/40 mt-1">{new Date(a.created_at).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
