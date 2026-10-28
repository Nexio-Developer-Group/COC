"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Badge, { statusTone } from "@/components/Badge";
import Money from "@/components/Money";
import BoqTable from "@/components/BoqTable";
import IssuesList from "@/components/IssuesList";
import type { Document, LineItem } from "@/lib/types";

export default function BidDetailPage() {
  const params = useParams<{ id: string; docId: string }>();
  const [doc, setDoc] = useState<Document | null>(null);
  const [sections, setSections] = useState<LineItem[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);

  useEffect(() => {
    fetch(`/api/documents/${params.docId}`)
      .then((r) => r.json())
      .then((d) => {
        setDoc(d.document);
        setSections(d.sections ?? []);
        setItems(d.items ?? []);
      });
  }, [params.docId]);

  if (!doc) return <p className="text-brand-dark/60">Loading…</p>;

  const matchedCount = items.filter((i) => i.tender_line_id).length;
  const extraCount = items.length - matchedCount;

  return (
    <div>
      <Link href={`/tenders/${params.id}`} className="text-sm text-brand-primary hover:underline mb-4 inline-block">
        ← Back to tender
      </Link>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">{doc.party_name ?? "Unknown contractor"}</h1>
          <p className="text-sm text-brand-dark/60 mt-1">
            {doc.file_name} · {matchedCount} matched to tender, {extraCount} extra
          </p>
        </div>
        <div className="text-right">
          <Badge tone={statusTone(doc.status)}>{doc.status.replace("_", " ")}</Badge>
          <div className="text-lg font-semibold text-brand-dark mt-1">
            <Money value={doc.stated_total} currency={doc.currency ?? "INR"} />
          </div>
        </div>
      </div>

      {doc.price_variants.length > 1 && (
        <div className="border border-blue-200 bg-blue-50 text-blue-800 rounded-md px-3 py-2 text-sm mb-4">
          This bid offers {doc.price_variants.length} price options. Showing the lowest-total option by default.
        </div>
      )}

      <IssuesList issues={doc.issues} />

      {doc.terms.length > 0 && (
        <div className="bg-white border border-brand-light rounded-lg p-4 mb-4">
          <h2 className="text-sm font-semibold text-brand-dark mb-2">Terms &amp; conditions</h2>
          <ul className="text-sm text-brand-dark/70 space-y-1">
            {doc.terms.map((t, i) => (
              <li key={i}>
                <span className="text-xs uppercase text-brand-dark/40 mr-2">{t.category}</span>
                {t.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <BoqTable sections={sections} items={items} currency={doc.currency ?? "INR"} showMatch />
    </div>
  );
}
