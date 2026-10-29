"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import DocumentView from "@/components/DocumentView";
import Icon from "@/components/ui/Icon";
import { Button } from "@/components/ui";

export default function BidPage() {
  const { id, docId } = useParams<{ id: string; docId: string }>();
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Link href={`/tenders/${id}/bids`} className="text-xs text-brand-dark/50 hover:text-brand-primary inline-flex items-center gap-1"><Icon name="chevron" className="w-3 h-3 rotate-180" /> All bids</Link>
        <Link href={`/tenders/${id}/compare/${docId}`}><Button size="sm" variant="primary" icon="scale">Compare with requirements</Button></Link>
      </div>
      <DocumentView tenderId={id} documentId={docId} role="bid" />
    </div>
  );
}
