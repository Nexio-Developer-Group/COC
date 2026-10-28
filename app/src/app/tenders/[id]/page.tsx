"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/format";
import { useApi } from "@/lib/client/api";
import type { Comparison } from "@/lib/compare";
import type { Document, Tender } from "@/lib/types";
import ReportCard, { type ReportRow } from "@/components/ReportCard";
import UploadDialog from "@/components/UploadDialog";
import { Button, Card, ExportMenu, PageHeader, Pill, Spinner, statusPill } from "@/components/ui";
import Icon from "@/components/ui/Icon";

export default function TenderOverview() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApi<{ tender: Tender; requirementsDoc: Document | null; bids: Document[] }>(`/api/tenders/${id}`, { refreshInterval: 5000 });
  const cmp = useApi<{ comparison: Comparison }>(data?.requirementsDoc && data.bids.length ? `/api/tenders/${id}/comparison` : null);
  const reports = useApi<{ analyses: ReportRow[] }>(`/api/tenders/${id}/analyses`);
  const [upload, setUpload] = useState<"tender" | "bid" | null>(null);

  if (isLoading && !data) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;
  if (!data) return null;
  const { tender, requirementsDoc: req, bids } = data;
  const comparison = cmp.data?.comparison;
  const ranked = comparison ? [...comparison.bids].sort((a, b) => a.rank - b.rank) : [];
  const needsReview = bids.filter((b) => b.status === "needs_review").length + (req?.status === "needs_review" ? 1 : 0);

  const next = !req ? { text: "Upload your requirements (BOQ) to get started.", action: <Button variant="primary" icon="upload" onClick={() => setUpload("tender")}>Upload BOQ</Button> }
    : req.status === "needs_review" ? { text: "Review and confirm your BOQ — look at anything we filled in or flagged.", action: <Link href={`/tenders/${id}/requirements`}><Button variant="primary" icon="check">Review BOQ</Button></Link> }
    : bids.length === 0 ? { text: "Your BOQ is ready. Now upload the contractors’ bids.", action: <Button variant="primary" icon="upload" onClick={() => setUpload("bid")}>Upload bids</Button> }
    : needsReview > 0 ? { text: `${needsReview} document${needsReview > 1 ? "s need" : " needs"} a review before they count as ready.`, action: <Link href={`/tenders/${id}/bids`}><Button variant="primary" icon="check">Review bids</Button></Link> }
    : { text: "Everything is confirmed. Compare the bids or ask a question.", action: <Link href={`/tenders/${id}/compare`}><Button variant="primary" icon="scale">Open comparison</Button></Link> };

  return (
    <div className="space-y-5">
      <PageHeader
        title={tender.title}
        subtitle={[tender.client_name, tender.location, tender.currency].filter(Boolean).join(" · ")}
        actions={<><Button icon="upload" onClick={() => setUpload("bid")} disabled={!req}>Upload bids</Button><Link href={`/tenders/${id}/ask`}><Button icon="spark">Ask a question</Button></Link><ExportMenu base={`/api/tenders/${id}/export`} label="Export pack" /></>}
      />

      <Card className="p-4 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-brand-primary/10 to-transparent border-brand-primary/20">
        <div className="flex items-center gap-3 text-sm"><span className="w-8 h-8 rounded-full bg-brand-primary text-white flex items-center justify-center"><Icon name="chevron" /></span><span className="font-medium">{next.text}</span></div>
        {next.action}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><Icon name="list" /> Requirements</div>{req && <Pill tone={statusPill(req.status).tone}>{statusPill(req.status).label}</Pill>}</div>
          {req ? (
            <>
              <div className="text-sm text-brand-dark/60 mt-2 truncate">{req.file_name}</div>
              <div className="text-2xl font-semibold tabular-nums mt-3">{formatINR(req.computed_total == null ? null : Number(req.computed_total), tender.currency)}</div>
              <div className="text-xs text-brand-dark/45">budget total from your BOQ rates</div>
              <Link href={`/tenders/${id}/requirements`} className="inline-block mt-3 text-sm text-brand-contrast hover:underline">Open requirements →</Link>
            </>
          ) : <div className="mt-3 text-sm text-brand-dark/55">Not uploaded yet.</div>}
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><Icon name="users" /> Bids</div><Pill tone="accent">{bids.length}</Pill></div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {bids.slice(0, 5).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2"><Link href={`/tenders/${id}/bids/${b.id}`} className="truncate hover:text-brand-primary">{b.party_name ?? "Unnamed"}</Link><Pill tone={statusPill(b.status).tone}>{statusPill(b.status).label}</Pill></li>
            ))}
            {bids.length === 0 && <li className="text-brand-dark/55">No bids yet.</li>}
          </ul>
          <Link href={`/tenders/${id}/bids`} className="inline-block mt-3 text-sm text-brand-contrast hover:underline">Manage bids →</Link>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><Icon name="scale" /> Leaderboard</div></div>
          {ranked.length ? (
            <ol className="mt-3 space-y-2">
              {ranked.slice(0, 4).map((b) => (
                <li key={b.documentId} className="flex items-center gap-3 text-sm">
                  <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-semibold ${b.rank === 1 ? "bg-brand-primary text-white" : "bg-brand-light"}`}>{b.rank}</span>
                  <span className="flex-1 truncate">{b.partyName}</span>
                  <span className="tabular-nums text-brand-dark/70">{formatINR(b.likeForLikeTotal, tender.currency)}</span>
                </li>
              ))}
            </ol>
          ) : <div className="mt-3 text-sm text-brand-dark/55">Rankings appear once there’s a bid to compare.</div>}
          {ranked.length > 0 && <Link href={`/tenders/${id}/compare`} className="inline-block mt-3 text-sm text-brand-contrast hover:underline">Full comparison →</Link>}
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold">Recent reports</h2><Link href={`/tenders/${id}/reports`} className="text-sm text-brand-contrast hover:underline">All reports →</Link></div>
        {(reports.data?.analyses ?? []).length === 0 ? (
          <Card className="p-6 text-sm text-brand-dark/55 text-center">No reports yet. <Link href={`/tenders/${id}/ask`} className="text-brand-contrast hover:underline">Ask a question or run a Playbook →</Link></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{reports.data!.analyses.slice(0, 3).map((a) => <ReportCard key={a.id} tenderId={id} report={a} />)}</div>
        )}
      </div>

      {upload && <UploadDialog tenderId={id} role={upload} open onClose={() => setUpload(null)} onDone={() => undefined} />}
    </div>
  );
}
