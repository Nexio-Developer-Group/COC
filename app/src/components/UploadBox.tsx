"use client";

import { useRef, useState } from "react";

export default function UploadBox({
  tenderId,
  role,
  onUploaded,
  label,
}: {
  tenderId: string;
  role: "tender" | "bid";
  onUploaded: (documentId: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [partyName, setPartyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("role", role);
    if (role === "bid" && partyName) form.append("party_name", partyName);
    const res = await fetch(`/api/tenders/${tenderId}/documents`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Upload failed");
      setBusy(false);
      return;
    }
    // Kick off processing (LLM extraction) and wait for it.
    await fetch(`/api/documents/${data.document.id}/process`, { method: "POST" });
    setBusy(false);
    onUploaded(data.document.id);
  }

  return (
    <div className="border-2 border-dashed border-brand-light rounded-lg p-6 text-center bg-brand-light-dull">
      {role === "bid" && (
        <input
          className="w-full max-w-xs mx-auto mb-3 border border-brand-light rounded-md px-3 py-2 text-sm"
          placeholder="Contractor name (optional — we'll also read it from the file)"
          value={partyName}
          onChange={(e) => setPartyName(e.target.value)}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.pdf,.docx,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="bg-brand-primary hover:bg-brand-primary-dull disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-md"
      >
        {busy ? "Reading document with AI…" : label ?? "Upload file"}
      </button>
      <p className="text-xs text-brand-dark/50 mt-2">Excel, CSV, PDF, Word or text — any layout.</p>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
