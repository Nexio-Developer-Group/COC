"use client";

import { useRef, useState } from "react";
import { useJobs } from "@/lib/client/jobs";
import { Button, Modal } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

type Item = { id: number; file: File; party: string };

/** Picks files and hands them to the background job queue; reading continues after the dialog closes. */
export default function UploadDialog({
  tenderId, role, open, onClose, replace,
}: {
  tenderId: string;
  role: "tender" | "bid";
  open: boolean;
  onClose: () => void;
  replace?: { id: string; partyName: string | null } | null;
  onDone?: (ids: string[]) => void;
}) {
  const jobs = useJobs();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const multi = role === "bid" && !replace;

  function add(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => !/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name));
    setItems((cur) => [...(multi ? cur : []), ...(multi ? list : list.slice(0, 1)).map((f, i) => ({ id: Date.now() + i, file: f, party: "" }))]);
  }
  function start() {
    for (const it of items) {
      jobs.startUpload({ tenderId, file: it.file, role, partyName: replace?.partyName ?? (it.party || null), replaceDocumentId: replace?.id ?? null });
    }
    toast.push({ text: `Reading ${items.length} file${items.length > 1 ? "s" : ""} in the background — keep working, progress is shown bottom-right.`, tone: "info" });
    setItems([]);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => { setItems([]); onClose(); }}
      wide
      title={replace ? `Upload a revised bid${replace.partyName ? ` for ${replace.partyName}` : ""}` : role === "tender" ? "Upload your requirements (BOQ)" : "Upload bids"}
      footer={
        <>
          <Button onClick={() => { setItems([]); onClose(); }}>Cancel</Button>
          <Button variant="primary" icon="upload" disabled={!items.length} onClick={start}>{`Read ${items.length || ""} file${items.length === 1 ? "" : "s"}`}</Button>
        </>
      }
    >
      {replace && (
        <div className="mb-3 text-[13px] bg-blue-50 text-blue-900 border border-blue-200 rounded-lg px-3 py-2">
          The current bid stays in the version history. The new file replaces it in the comparison once it has been read successfully.
        </div>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed text-center py-9 transition-colors ${drag ? "border-brand-primary bg-brand-primary/5" : "border-line hover:border-brand-primary/50 bg-brand-light-dull/60"}`}
      >
        <Icon name="upload" className="w-7 h-7 mx-auto text-brand-accent" />
        <div className="mt-2 font-medium">{multi ? "Drop one or many bid files here" : "Drop the file here"}, or click to browse</div>
        <div className="text-xs text-brand-dark/50 mt-1">Excel (all sheets are read), PDF, Word, CSV or text. Pictures inside the file are kept too.</div>
        <input ref={inputRef} type="file" multiple={multi} accept=".xlsx,.xlsm,.csv,.pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />
      </div>

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((it) => (
            <li key={it.id} className="border border-line rounded-xl px-3.5 py-3 flex items-center gap-3">
              <Icon name="sheet" className="w-5 h-5 text-brand-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.file.name}</div>
                <div className="text-[11px] text-brand-dark/45">{(it.file.size / 1024).toFixed(0)} KB</div>
              </div>
              {role === "bid" && !replace && (
                <input value={it.party} onChange={(e) => setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, party: e.target.value } : x)))} placeholder="Contractor name (optional)" className="text-xs border border-line rounded-lg px-2.5 py-1.5 w-52" />
              )}
              <button onClick={() => setItems((c) => c.filter((x) => x.id !== it.id))} className="text-brand-dark/35 hover:text-red-600"><Icon name="x" /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-brand-dark/45 mt-3">Files are read in the background, up to 3 at a time, so you can add more or keep browsing while they finish.</p>
    </Modal>
  );
}
