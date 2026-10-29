"use client";

import { useParams } from "next/navigation";
import type { Comparison } from "@/lib/compare";
import { useApi } from "@/lib/client/api";
import ContractorScorecards from "@/components/ContractorScorecards";
import ComparisonGrid from "@/components/ComparisonGrid";
import { formatINR } from "@/lib/format";
import { EmptyState, ExportMenu, PageHeader, Spinner } from "@/components/ui";

export default function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useApi<{ comparison: Comparison }>(`/api/tenders/${id}/comparison`);
  if (isLoading && !data) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;
  const c = data?.comparison;
  return (
    <div>
      <PageHeader title="Comparative statement" subtitle="All bids side by side — and measured against your own requirements (BOQ). Instant — no AI involved." actions={c && c.bids.length > 0 ? <ExportMenu base={`/api/tenders/${id}/comparison/export`} /> : undefined} />
      {error || !c ? (
        <EmptyState icon="scale" title="Nothing to compare yet" text="Upload and read your requirements, then add at least one bid." />
      ) : c.bids.length === 0 ? (
        <EmptyState icon="users" title="No bids to compare yet" text="Bids appear here as soon as they’ve been read (you can still review them afterwards)." />
      ) : (
        <>
          <RequirementBanner c={c} />
          <ContractorScorecards comparison={c} tenderId={id} />
          <ComparisonGrid comparison={c} tenderId={id} />
        </>
      )}
    </div>
  );
}

function RequirementBanner({ c }: { c: Comparison }) {
  if (c.requirementPricedItems === 0) {
    return <div className="mb-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-brand-dark/70">Your requirements have no reference rates yet, so bids are compared with each other and for coverage, quantity and unit. Add rates to the BOQ to measure prices against it too.</div>;
  }
  const best = [...c.bids].sort((a, b) => a.req.fitRank - b.req.fitRank)[0];
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-line bg-white px-4 py-3"><div className="text-xs text-brand-dark/55">Your requirement (BOQ)</div><div className="text-lg font-semibold tabular-nums">{formatINR(c.requirementTotal, c.currency)}</div><div className="text-xs text-brand-dark/50">{c.requirementPricedItems} of {c.items.length} items carry a reference rate{c.requirementStatedTotal ? ` · printed total ${formatINR(c.requirementStatedTotal, c.currency)}` : ""}</div></div>
      <div className="rounded-xl border border-line bg-white px-4 py-3"><div className="text-xs text-brand-dark/55">Closest to the requirement</div><div className="text-lg font-semibold">{best?.partyName ?? "—"}</div><div className="text-xs text-brand-dark/50">Fit {best?.req.score ?? 0}/100 · {best?.req.coveragePct ?? 0}% of items priced</div></div>
      <div className="rounded-xl border border-line bg-white px-4 py-3"><div className="text-xs text-brand-dark/55">How fit is scored</div><div className="text-sm">Coverage 50% · quantity &amp; unit match 20% · price vs requirement 30%</div></div>
    </div>
  );
}
