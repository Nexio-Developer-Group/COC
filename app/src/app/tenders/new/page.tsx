"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewTenderPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/tenders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, client_name: clientName || undefined, location: location || undefined }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    router.push(`/tenders/${data.tender.id}`);
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-brand-dark mb-6">New tender</h1>
      <form onSubmit={handleSubmit} className="bg-white border border-brand-light rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-brand-dark mb-1">Title *</label>
          <input
            className="w-full border border-brand-light rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            placeholder="e.g. ITC Fortune Guwahati — Interior Works"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-dark mb-1">Client name</label>
          <input
            className="w-full border border-brand-light rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-dark mb-1">Location</label>
          <input
            className="w-full border border-brand-light rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !title}
          className="bg-brand-primary hover:bg-brand-primary-dull disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-md"
        >
          {submitting ? "Creating…" : "Create tender"}
        </button>
      </form>
    </div>
  );
}
