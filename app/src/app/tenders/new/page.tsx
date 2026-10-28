"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { refresh, send } from "@/lib/client/api";
import { Button, Card, PageHeader, Spinner } from "@/components/ui";
import UploadDialog from "@/components/UploadDialog";

export default function NewTenderPage() {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", client_name: "", location: "", currency: "INR" });
  const [tenderId, setTenderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(thenUpload: boolean) {
    setBusy(true);
    setError(null);
    const r = await send("/api/tenders", "POST", form);
    setBusy(false);
    if (!r.ok) return setError(r.data.error ?? "Could not create the tender");
    refresh("/api/tenders");
    if (thenUpload) setTenderId(r.data.tender.id);
    else router.push(`/tenders/${r.data.tender.id}/requirements`);
  }
  const field = (k: keyof typeof form, label: string, ph?: string, required?: boolean) => (
    <label className="block">
      <span className="text-xs font-medium text-brand-dark/60">{label}{required && " *"}</span>
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={ph} className="mt-1 w-full border border-line rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/25 focus:border-brand-primary" />
    </label>
  );
  return (
    <div className="max-w-xl">
      <PageHeader title="New tender" subtitle="Give it a name, then upload the requirements (BOQ) — we’ll read every sheet." />
      <Card className="p-6 space-y-4">
        {field("title", "Tender name", "e.g. ITC Fortune Guwahati — interiors", true)}
        <div className="grid grid-cols-2 gap-4">{field("client_name", "Client", "ITC")}{field("location", "Site / location", "Guwahati")}</div>
        <label className="block w-40">
          <span className="text-xs font-medium text-brand-dark/60">Currency</span>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="mt-1 w-full border border-line rounded-lg px-3 py-2.5 text-sm bg-white">
            {["INR", "USD", "EUR", "GBP", "AED"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button variant="primary" icon="upload" disabled={!form.title.trim() || busy} onClick={() => create(true)}>{busy ? <Spinner /> : null}Create & upload BOQ</Button>
          <Button disabled={!form.title.trim() || busy} onClick={() => create(false)}>Create without a file</Button>
        </div>
      </Card>
      {tenderId && <UploadDialog tenderId={tenderId} role="tender" open onClose={() => router.push(`/tenders/${tenderId}/requirements`)} onDone={() => refresh(`/api/tenders/${tenderId}`)} />}
    </div>
  );
}
