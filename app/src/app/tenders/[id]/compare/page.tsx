"use client";

import { useParams } from "next/navigation";
import type { Comparison } from "@/lib/compare";
import { useApi } from "@/lib/client/api";
import ComparisonGrid from "@/components/ComparisonGrid";
import { EmptyState, ExportMenu, PageHeader, Spinner } from "@/components/ui";

export default function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useApi<{ comparison: Comparison }>(`/api/tenders/${id}/comparison`);
  if (isLoading && !data) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;
  const c = data?.comparison;
  return (
    <div>
      <PageHeader title="Comparative statement" subtitle="All bids side by side on your BOQ items. Instant — no AI involved." actions={c && c.bids.length > 0 ? <ExportMenu base={`/api/tenders/${id}/comparison/export`} /> : undefined} />
      {error || !c ? (
        <EmptyState icon="scale" title="Nothing to compare yet" text="Upload and read your requirements, then add at least one bid." />
      ) : c.bids.length === 0 ? (
        <EmptyState icon="users" title="No bids to compare yet" text="Bids appear here as soon as they’ve been read (you can still review them afterwards)." />
      ) : (
        <ComparisonGrid comparison={c} tenderId={id} />
      )}
    </div>
  );
}
