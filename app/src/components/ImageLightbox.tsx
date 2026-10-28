"use client";

import { useEffect, useRef, useState } from "react";
import { refresh, send, useApi } from "@/lib/client/api";
import type { DocumentImage } from "@/lib/types";
import { Button, Modal, Spinner } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

/** Full-screen viewer with next / previous. */
export function ImageViewer({ images, index, onClose, onIndex }: { images: { public_url: string; caption?: string | null; label?: string }[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % images.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, images.length, onClose, onIndex]);
  const img = images[index];
  if (!img) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center" onClick={onClose}>
      <button className="absolute top-4 right-4 text-white/80 hover:text-white p-2"><Icon name="x" className="w-6 h-6" /></button>
      {images.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }} className="absolute left-4 text-white/80 hover:text-white p-3 rotate-180"><Icon name="chevron" className="w-8 h-8" /></button>
          <button onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }} className="absolute right-4 text-white/80 hover:text-white p-3"><Icon name="chevron" className="w-8 h-8" /></button>
        </>
      )}
      <div className="max-w-[92vw] max-h-[88vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.public_url} alt={img.caption ?? ""} className="max-w-full max-h-[80vh] object-contain rounded-lg bg-white" />
        <div className="mt-3 text-white/85 text-sm text-center">{img.label}{img.caption ? ` — ${img.caption}` : ""} <span className="text-white/45 ml-2">{index + 1}/{images.length}</span></div>
      </div>
    </div>
  );
}

/** Pictures belonging to one row: view, caption, attach more, delete. */
export default function ImageLightbox({ documentId, lineId, lineLabel, readOnly, onClose }: { documentId: string; tenderId: string; lineId: string; lineLabel: string; readOnly?: boolean; onClose: () => void }) {
  const toast = useToast();
  const { data, mutate } = useApi<{ images: DocumentImage[] }>(`/api/documents/${documentId}`);
  const [view, setView] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgs = (data?.images ?? []).filter((i) => i.line_item_id === lineId);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    form.append("line_item_id", lineId);
    const res = await fetch(`/api/documents/${documentId}/images`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) return toast.push({ text: "Could not add pictures (max ~4 MB per request)", tone: "bad" });
    mutate();
    refresh("/gallery", "/images");
  }
  async function remove(id: string) {
    await send(`/api/images/${id}`, "DELETE");
    mutate();
    refresh("/images");
  }
  async function caption(id: string, text: string) {
    await send(`/api/images/${id}`, "PATCH", { caption: text });
    mutate();
  }

  return (
    <Modal open onClose={onClose} wide title={`Pictures · ${lineLabel}`} footer={<Button onClick={onClose}>Done</Button>}>
      {imgs.length === 0 ? (
        <p className="text-sm text-brand-dark/55 text-center py-8">No pictures on this row yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {imgs.map((im, i) => (
            <div key={im.id} className="border border-line rounded-xl overflow-hidden bg-brand-light-dull">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.public_url} alt="" onClick={() => setView(i)} className="w-full h-32 object-cover cursor-zoom-in" />
              <div className="p-2 flex items-center gap-1">
                <input defaultValue={im.caption ?? ""} placeholder="Add a caption" disabled={readOnly} onBlur={(e) => e.target.value !== (im.caption ?? "") && caption(im.id, e.target.value)} className="flex-1 min-w-0 text-xs bg-transparent outline-none" />
                {!readOnly && <button onClick={() => remove(im.id)} className="text-brand-dark/35 hover:text-red-600"><Icon name="trash" className="w-4 h-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <div className="mt-4">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Spinner /> : null} Attach pictures</Button>
        </div>
      )}
      {view !== null && <ImageViewer images={imgs.map((i) => ({ public_url: i.public_url, caption: i.caption, label: lineLabel }))} index={view} onClose={() => setView(null)} onIndex={setView} />}
    </Modal>
  );
}
