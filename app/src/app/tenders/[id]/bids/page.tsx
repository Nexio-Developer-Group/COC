"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/format";
import { useApi } from "@/lib/client/api";
import type { Document } from "@/lib/types";
import UploadDialog from "@/components/UploadDialog";
import { Button, Card, EmptyState, PageHeader, Pill, Spinner, statusPill } from "@/components/ui";

type Row = { id: string; role: string; status: string; file_name: string; party_name: string | null; version_no: number; superseded_at: string | null; supersedes_id: string | null; created_at: string; stated_total: number | null; computed_total: number | null };

export default function BidsPage() {
  const { id } = useParams<{ id: string }>();
  const t = useApi<{ tender: { currency: string; requirements_doc_id: string | null }; bids: Document[] }>(`/api/tenders/${id}`, { refreshInterval: 4000 });
  const all = useApi<{ documents: Row[] }>(`/api/tenders/${id}/documents`, { refreshInterval: 4000 });
  const [upload, setUpload] = useState(false);
  const [older, setOlder] = useState(false);
  if (t.isLoading && !t.data) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;
  const bids = t.data?.bids ?? [];
  const cur = t.data?.tender.currency ?? "INR";
  const oldRows = (all.data?.documents ?? []).filter((d) => d.role === "bid" && d.superseded_at);
  return (
    <div>
      <PageHeader title="Bids" subtitle="One file per contractor. Upload a revised file any time — earlier submissions are kept in the version history." actions={<Button variant="primary" icon="upload" onClick={() => setUpload(true)} disabled={!t.data?.tender.requirements_doc_id}>Upload bids</Button>} />
      {!t.data?.tender.requirements_doc_id && <Card className="p-4 mb-4 text-sm bg-amber-50 border-amber-200 text-amber-900">Upload the requirements first so bids can be matched against your BOQ. <Link className="underline" href={`/tenders/${id}/requirements`}>Go to requirements</Link></Card>}
      {bids.length === 0 ? (
        <EmptyState icon="users" title="No bids yet" text="Drop in one or many files — each becomes a bid. We read the contractor name from the file when we can." action={<Button variant="primary" icon="upload" onClick={() => setUpload(true)} disabled={!t.data?.tender.requirements_doc_id}>Upload bids</Button>} />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-light/60 text-left text-xs text-brand-dark/60"><tr><th className="px-4 py-2.5 font-medium">Contractor</th><th className="px-4 py-2.5 font-medium">File</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium text-right">Sum of lines</th><th className="px-4 py-2.5 font-medium text-right">As printed</th><th className="px-4 py-2.5 font-medium">Uploaded</th></tr></thead>
            <tbody>
              {bids.map((b) => {
                const st = statusPill(b.status);
                return (
                  <tr key={b.id} className="border-t border-line hover:bg-brand-light-dull/60">
                    <td className="px-4 py-3"><Link href={`/tenders/${id}/bids/${b.id}`} className="font-medium text-brand-contrast hover:underline">{b.party_name ?? "Unnamed contractor"}</Link>{b.version_no > 1 && <span className="ml-2"><Pill tone="accent">v{b.version_no}</Pill></span>}</td>
                    <td className="px-4 py-3 text-brand-dark/55 max-w-[240px] truncate">{b.file_name}</td>
                    <td className="px-4 py-3"><Pill tone={st.tone}>{st.label}</Pill></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatINR(b.computed_total == null ? null : Number(b.computed_total), cur)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-brand-dark/55">{formatINR(b.stated_total == null ? null : Number(b.stated_total), cur)}</td>
                    <td className="px-4 py-3 text-brand-dark/50">{new Date(b.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {oldRows.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setOlder(!older)} className="text-sm text-brand-dark/55 hover:text-brand-dark">{older ? "Hide" : "Show"} {oldRows.length} earlier submission{oldRows.length > 1 ? "s" : ""}</button>
          {older && (
            <Card className="mt-2 overflow-hidden">
              <table className="w-full text-sm"><tbody>
                {oldRows.map((d) => (
                  <tr key={d.id} className="border-t first:border-t-0 border-line text-brand-dark/65">
                    <td className="px-4 py-2.5"><Link href={`/tenders/${id}/bids/${d.id}`} className="hover:underline">{d.party_name ?? "Unnamed"}</Link> <Pill>v{d.version_no} · replaced</Pill></td>
                    <td className="px-4 py-2.5 truncate max-w-[260px]">{d.file_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(d.computed_total == null ? null : Number(d.computed_total), cur)}</td>
                    <td className="px-4 py-2.5 text-right">{new Date(d.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody></table>
            </Card>
          )}
        </div>
      )}
      {upload && <UploadDialog tenderId={id} role="bid" open onClose={() => { setUpload(false); t.mutate(); all.mutate(); }} onDone={() => { t.mutate(); all.mutate(); }} />}
    </div>
  );
}
