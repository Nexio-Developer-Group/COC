"use client";

import Link from "next/link";
import { useState } from "react";
import { formatINR } from "@/lib/format";
import { refresh, send, useApi } from "@/lib/client/api";
import type { Tender } from "@/lib/types";
import { Button, Card, EmptyState, Menu, PageHeader, Pill, Spinner } from "@/components/ui";
import Icon from "@/components/ui/Icon";

type Row = Tender & { bid_count: number; requirements_status: string | null; needs_review_count: number; processing_count: number; lowest: { party: string | null; total: number } | null };

export default function Dashboard() {
  const { data, isLoading } = useApi<{ tenders: Row[] }>("/api/tenders", { refreshInterval: 6000 });
  const [q, setQ] = useState("");
  const list = (data?.tenders ?? []).filter((t) => `${t.title} ${t.client_name} ${t.location}`.toLowerCase().includes(q.toLowerCase()));

  async function rename(t: Row) {
    const title = prompt("Rename tender", t.title);
    if (title && title !== t.title) { await send(`/api/tenders/${t.id}`, "PATCH", { title }); refresh("/api/tenders"); }
  }
  async function archive(t: Row) {
    if (confirm(`Archive “${t.title}”? It disappears from this list but nothing is deleted.`)) { await send(`/api/tenders/${t.id}`, "PATCH", { archived_at: new Date().toISOString() }); refresh("/api/tenders"); }
  }

  return (
    <div>
      <PageHeader
        title="Your tenders"
        subtitle="Upload requirements, collect bids, compare them like-for-like."
        actions={<><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="text-sm border border-line rounded-lg px-3 py-2 bg-white w-48" /><Link href="/tenders/new"><Button variant="primary" icon="plus">New tender</Button></Link></>}
      />
      {isLoading && <div className="py-16 text-center"><Spinner className="w-6 h-6" /></div>}
      {!isLoading && list.length === 0 && (
        <EmptyState icon="folder" title={q ? "Nothing matches that search" : "Start with your first tender"} text="Create a tender, upload your BOQ, then drop in each contractor’s bid. We read every sheet, fill the gaps we can, and flag anything that looks off." action={!q && <Link href="/tenders/new"><Button variant="primary" icon="plus">New tender</Button></Link>} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <Card key={t.id} className="p-5 flex flex-col hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/tenders/${t.id}`} className="min-w-0">
                <div className="font-semibold text-brand-dark leading-snug line-clamp-2 hover:text-brand-primary">{t.title}</div>
                <div className="text-xs text-brand-dark/50 mt-1">{[t.client_name, t.location].filter(Boolean).join(" · ") || "No client set"}</div>
              </Link>
              <Menu items={[
                { label: "Open", icon: "eye", href: `/tenders/${t.id}` },
                { label: "Comparison", icon: "scale", href: `/tenders/${t.id}/compare` },
                { label: "Rename", icon: "edit", onClick: () => rename(t) },
                { label: "Export full pack (Excel)", icon: "sheet", href: `/api/tenders/${t.id}/export?format=xlsx` },
                { label: "Export full pack (PDF)", icon: "pdf", href: `/api/tenders/${t.id}/export?format=pdf` },
                { label: "", divider: true },
                { label: "Archive", icon: "archive", danger: true, onClick: () => archive(t) },
              ]} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Pill tone={t.requirements_status === "ready" ? "ok" : t.requirements_status ? "warn" : "neutral"}>{t.requirements_status ? `BOQ ${t.requirements_status.replace("_", " ")}` : "No BOQ yet"}</Pill>
              <Pill tone="accent">{t.bid_count} bid{t.bid_count === 1 ? "" : "s"}</Pill>
              {t.needs_review_count > 0 && <Pill tone="warn">{t.needs_review_count} to review</Pill>}
              {t.processing_count > 0 && <Pill tone="info"><Spinner className="w-2.5 h-2.5" /> reading</Pill>}
            </div>
            <div className="mt-auto pt-4 flex items-end justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-brand-dark/40">Lowest bid</div>
                <div className="font-semibold tabular-nums">{t.lowest ? formatINR(t.lowest.total, t.currency) : "—"}</div>
                {t.lowest?.party && <div className="text-xs text-brand-dark/50 truncate max-w-[180px]">{t.lowest.party}</div>}
              </div>
              <Link href={`/tenders/${t.id}`} className="text-xs text-brand-contrast hover:underline inline-flex items-center gap-1">Open <Icon name="chevron" className="w-3.5 h-3.5" /></Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
