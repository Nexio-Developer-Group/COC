"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import DocumentView from "@/components/DocumentView";
import Icon from "@/components/ui/Icon";

export default function BidPage() {
  const { id, docId } = useParams<{ id: string; docId: string }>();
  return (
    <div>
      <Link href={`/tenders/${id}/bids`} className="text-xs text-brand-dark/50 hover:text-brand-primary inline-flex items-center gap-1 mb-3"><Icon name="chevron" className="w-3 h-3 rotate-180" /> All bids</Link>
      <DocumentView tenderId={id} documentId={docId} role="bid" />
    </div>
  );
}
