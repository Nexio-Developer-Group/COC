"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/client/api";
import ReportCard, { type ReportRow } from "@/components/ReportCard";
import { Button, EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function ReportsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApi<{ analyses: ReportRow[] }>(`/api/tenders/${id}/analyses`, { refreshInterval: 8000 });
  return (
    <div>
      <PageHeader title="Reports" subtitle="Every answer you’ve generated for this tender — with a glimpse of what’s inside." actions={<Link href={`/tenders/${id}/ask`}><Button variant="primary" icon="spark">Ask or run a Playbook</Button></Link>} />
      {isLoading && !data ? <div className="py-16 text-center"><Spinner className="w-6 h-6" /></div> : (data?.analyses ?? []).length === 0 ? (
        <EmptyState icon="chart" title="No reports yet" text="Ask a question or run one of the starter Playbooks (tax summary, payment terms, scope gaps…)." action={<Link href={`/tenders/${id}/ask`}><Button variant="primary" icon="spark">Open Ask · Playbooks</Button></Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data!.analyses.map((a) => <ReportCard key={a.id} tenderId={id} report={a} />)}</div>
      )}
    </div>
  );
}
