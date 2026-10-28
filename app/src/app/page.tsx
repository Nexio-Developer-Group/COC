"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Badge, { statusTone } from "@/components/Badge";

type TenderRow = {
  id: string;
  title: string;
  client_name: string | null;
  location: string | null;
  currency: string;
  created_at: string;
  bid_count: number;
  requirements_status: string | null;
};

export default function Home() {
  const [tenders, setTenders] = useState<TenderRow[] | null>(null);

  useEffect(() => {
    fetch("/api/tenders")
      .then((r) => r.json())
      .then((d) => setTenders(d.tenders ?? []));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-brand-dark">Tenders</h1>
          <p className="text-sm text-brand-dark/60 mt-1">Upload a tender, collect bids, get a clear comparison.</p>
        </div>
      </div>

      {tenders === null && <p className="text-brand-dark/60">Loading…</p>}

      {tenders !== null && tenders.length === 0 && (
        <div className="bg-white border border-brand-light rounded-lg p-10 text-center">
          <p className="text-brand-dark/70 mb-4">No tenders yet.</p>
          <Link href="/tenders/new" className="bg-brand-primary hover:bg-brand-primary-dull text-white font-medium px-5 py-2.5 rounded-md inline-block">
            Create your first tender
          </Link>
        </div>
      )}

      {tenders !== null && tenders.length > 0 && (
        <div className="bg-white border border-brand-light rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-light text-brand-dark/70 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Requirements</th>
                <th className="px-4 py-3 font-medium">Bids</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {tenders.map((t) => (
                <tr key={t.id} className="border-t border-brand-light hover:bg-brand-light-dull">
                  <td className="px-4 py-3">
                    <Link href={`/tenders/${t.id}`} className="font-medium text-brand-primary hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-brand-dark/70">{t.client_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t.requirements_status ? <Badge tone={statusTone(t.requirements_status)}>{t.requirements_status}</Badge> : <Badge tone="neutral">not uploaded</Badge>}
                  </td>
                  <td className="px-4 py-3 text-brand-dark/70">{t.bid_count}</td>
                  <td className="px-4 py-3 text-brand-dark/50">{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
