"use client";

import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { refresh, send, useApi } from "@/lib/client/api";
import type { Document, DocumentImage } from "@/lib/types";
import { ImageViewer } from "@/components/ImageLightbox";
import { Button, Card, EmptyState, Menu, PageHeader, Spinner } from "@/components/ui";
import Icon from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toasts";

type Img = DocumentImage & { source: { id: string; role: string; party_name: string | null; version_no: number } | null; line: { item_code: string; name: string | null; tender_line_id: string | null } | null };

export default function GalleryPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data, isLoading, mutate } = useApi<{ images: Img[] }>(`/api/tenders/${id}/images`);
  const t = useApi<{ requirementsDoc: Document | null; bids: Document[] }>(`/api/tenders/${id}`);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<number | null>(null);
  const [target, setTarget] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const all = data?.images ?? [];
  const sources = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of all) m.set(i.document_id, i.source?.role === "tender" ? "Your requirements" : i.source?.party_name ?? "Contractor");
    return [...m.entries()];
  }, [all]);
  const shown = all.filter((i) => filter === "all" || i.document_id === filter);
  const docs = [...(t.data?.requirementsDoc ? [{ id: t.data.requirementsDoc.id, name: "Your requirements" }] : []), ...(t.data?.bids ?? []).map((b) => ({ id: b.id, name: b.party_name ?? "Bid" }))];

  async function upload(files: FileList | null) {
    const docId = target || docs[0]?.id;
    if (!files?.length || !docId) return;
    setBusy(true);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    const r = await fetch(`/api/documents/${docId}/images`, { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) return toast.push({ text: "Could not add pictures (about 4 MB per upload)", tone: "bad" });
    mutate();
    refresh("/images");
  }

  return (
    <div>
      <PageHeader
        title="Gallery"
        subtitle="Every picture found in your BOQ and the bids — plus anything you attach. They stay linked to the row they came from."
        actions={<>
          {docs.length > 0 && <select value={target} onChange={(e) => setTarget(e.target.value)} className="text-sm border border-line rounded-lg px-2.5 py-2 bg-white"><option value="">Add to…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button icon="upload" disabled={busy || !docs.length} onClick={() => fileRef.current?.click()}>{busy ? <Spinner /> : null}Add pictures</Button>
        </>}
      />
      {isLoading && !data ? <div className="py-16 text-center"><Spinner className="w-6 h-6" /></div> : all.length === 0 ? (
        <EmptyState icon="image" title="No pictures yet" text="Pictures embedded in Excel, Word or PDF files are picked up automatically when a document is read. You can also add photos or sample images by hand." />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-4">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>All ({all.length})</Chip>
            {sources.map(([did, name]) => <Chip key={did} active={filter === did} onClick={() => setFilter(did)}>{name} ({all.filter((i) => i.document_id === did).length})</Chip>)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {shown.map((im, i) => (
              <Card key={im.id} className="overflow-hidden group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.public_url} alt="" onClick={() => setView(i)} className="w-full h-36 object-cover cursor-zoom-in" />
                <div className="p-2.5 text-xs">
                  <div className="font-medium truncate">{im.source?.role === "tender" ? "Requirements" : im.source?.party_name ?? "Bid"}</div>
                  <div className="text-brand-dark/50 truncate">{im.line ? `Row ${im.line.item_code} ${im.line.name ?? ""}` : im.sheet_name ?? "Document-level"}</div>
                  {im.caption && <div className="text-brand-dark/65 mt-0.5 truncate">{im.caption}</div>}
                </div>
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100">
                  <Menu items={[{ label: "Delete picture", icon: "trash", danger: true, onClick: async () => { await send(`/api/images/${im.id}`, "DELETE"); mutate(); } }]} />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      {view !== null && <ImageViewer images={shown.map((i) => ({ public_url: i.public_url, caption: i.caption, label: `${i.source?.role === "tender" ? "Requirements" : i.source?.party_name ?? "Bid"}${i.line ? ` · ${i.line.item_code}` : ""}` }))} index={view} onClose={() => setView(null)} onIndex={setView} />}
    </div>
  );
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`text-xs px-3 py-1.5 rounded-full border ${active ? "bg-brand-dark text-white border-brand-dark" : "bg-white border-line hover:border-brand-primary/60"}`}>{children}</button>;
}
