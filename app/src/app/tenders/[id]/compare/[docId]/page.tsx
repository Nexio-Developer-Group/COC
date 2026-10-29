"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/client/api";
import type { Comparison } from "@/lib/compare";
import BidVsBoq from "@/components/BidVsBoq";
import Icon from "@/components/ui/Icon";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function ContractorComparePage() {
  const { id, docId } = useParams<{ id: string; docId: string }>();
  const { data, isLoading } = useApi<{ comparison: Comparison }>(`/api/tenders/${id}/comparison`);
  if (isLoading && !data) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;
  const c = data?.comparison;
  const bid = c?.bids.find((b) => b.documentId === docId);
  return (
    <div>
      <PageHeader
        back={<Link href={`/tenders/${id}/compare`} className="text-xs text-brand-dark/50 hover:text-brand-primary inline-flex items-center gap-1 mb-1"><Icon name="chevron" className="w-3 h-3 rotate-180" /> All contractors</Link>}
        title={bid ? `${bid.partyName ?? "Contractor"} vs requirements` : "Contractor comparison"}
        subtitle="Every BOQ item against this contractor’s quote — area summary first, then item by item. Instant, no AI."
      />
      {!c || !bid ? (
        <EmptyState icon="scale" title="Nothing to compare" text="This bid isn’t available yet — make sure it has been read, and the requirements are uploaded." />
      ) : (
        <BidVsBoq comparison={c} docId={docId} tenderId={id} />
      )}
    </div>
  );
}
