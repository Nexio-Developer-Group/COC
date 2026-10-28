"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { formatINR } from "@/lib/format";
import { refresh, send, useApi } from "@/lib/client/api";
import type { Document, DocumentImage, DocumentSheet, Issue, LineItem } from "@/lib/types";
import BoqGrid, { type TenderItemRef } from "./BoqGrid";
import HistoryDrawer from "./HistoryDrawer";
import { ImageViewer } from "./ImageLightbox";
import ReviewPanel from "./ReviewPanel";
import UploadDialog from "./UploadDialog";
import { Button, Card, ExportMenu, Menu, Modal, Pill, Spinner, statusPill } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

type DocPayload = {
  document: Document;
  sections: LineItem[];
  items: LineItem[];
  review: { issues: Issue[]; counts: Record<string, number> };
  sheets: DocumentSheet[];
  images: DocumentImage[];
  imageCounts: Record<string, number>;
  editCount: number;
  versions: { id: string; version_no: number; file_name: string; created_at: string; superseded_at: string | null; status: string; computed_total: number | null }[];
};

export default function DocumentView({ tenderId, documentId, role }: { tenderId: string; documentId: string; role: "tender" | "bid" }) {
  const toast = useToast();
  const { data, mutate, isLoading } = useApi<DocPayload>(`/api/documents/${documentId}`, { refreshInterval: (d) => (d && (d.document.status === "processing" || d.document.status === "uploaded") ? 2500 : 0) });
  const tenderRes = useApi<{ tender: { requirements_doc_id: string | null } }>(role === "bid" ? `/api/tenders/${tenderId}` : null);
  const reqId = tenderRes.data?.tender.requirements_doc_id;
  const reqDoc = useApi<DocPayload>(role === "bid" && reqId ? `/api/documents/${reqId}` : null);
  const tenderItems: TenderItemRef[] | undefined = reqDoc.data?.items.map((i) => ({ id: i.id, item_code: i.item_code, name: i.name, unit: i.unit }));

  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  const changed = useCallback(() => {
    mutate();
    refresh(`/api/tenders/${tenderId}`, "/comparison");
  }, [mutate, tenderId]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const r = await send(`/api/documents/${documentId}`, "PATCH", body);
    if (!r.ok) toast.push({ text: r.data.error ?? "Could not save", tone: "bad" });
    changed();
  }, [documentId, changed, toast]);

  async function retry(failedOnly: boolean) {
    setRetrying(true);
    for (let i = 0; i < 60; i++) {
      const r = await send(`/api/documents/${documentId}/process`, "POST", { restart: i === 0 && !failedOnly, retry_failed: i === 0 && failedOnly });
      mutate();
      if (!r.ok || r.data.done) break;
    }
    setRetrying(false);
    changed();
  }

  const unresolved = useMemo(() => (data?.review.issues ?? []).filter((i) => !i.resolved), [data]);
  if (isLoading && !data) return <div className="py-20 text-center text-brand-dark/50"><Spinner className="w-6 h-6" /></div>;
  if (!data) return null;
  const { document: doc, sections, items, images, imageCounts, sheets, versions } = data;
  const st = statusPill(doc.status);
  const isCurrent = !doc.superseded_at;
  const warnCount = unresolved.filter((i) => i.severity !== "info").length;
  const processing = doc.status === "processing" || doc.status === "uploaded";
  const currency = doc.currency ?? "INR";
  const mismatch = doc.stated_total != null && doc.computed_total != null && Math.abs(Number(doc.computed_total) - Number(doc.stated_total)) / Math.max(Number(doc.stated_total), 1) > 0.005;
  const variants = doc.price_variants ?? [];

  return (
    <div className="space-y-4">
      {/* status banner */}
      {processing && (
        <Card className="p-4 flex items-center gap-3 border-sky-200 bg-sky-50"><Spinner className="w-5 h-5 text-sky-700" /><div className="text-sm text-sky-900">{doc.status_detail ?? "Reading this file…"}{doc.progress?.total ? ` (${doc.progress.done ?? 0}/${doc.progress.total})` : ""}</div></Card>
      )}
      {doc.status === "failed" && (
        <Card className="p-4 border-red-200 bg-red-50 flex items-center justify-between gap-3">
          <div className="text-sm text-red-900"><b>We couldn’t read this file.</b> {doc.status_detail}</div>
          <Button variant="danger" onClick={() => retry(false)} disabled={retrying}>{retrying ? <Spinner /> : null}Try again</Button>
        </Card>
      )}
      {!isCurrent && (
        <Card className="p-4 border-amber-200 bg-amber-50 flex items-center justify-between gap-3">
          <div className="text-sm text-amber-900"><b>This is an older submission (v{doc.version_no}).</b> It is kept for reference and isn’t used in the comparison.</div>
          <Button variant="primary" onClick={async () => { await send(`/api/documents/${documentId}/restore`, "POST"); changed(); toast.push({ text: `v${doc.version_no} is now the current submission`, tone: "ok" }); }}>Make this the current one</Button>
        </Card>
      )}
      {doc.status === "needs_review" && isCurrent && (
        <Card className="p-4 border-amber-200 bg-amber-50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-amber-900 flex items-start gap-2">
            <Icon name="warn" className="w-5 h-5 mt-0.5 text-amber-600" />
            <div>
              <b>Please review before this counts as ready.</b>
              <div className="text-amber-900/80">{unresolved.length} thing{unresolved.length === 1 ? "" : "s"} to look at{warnCount ? ` (${warnCount} warning${warnCount > 1 ? "s" : ""})` : ""} — values we filled in, unit conversions, and numbers that look unrealistic are highlighted in the table.</div>
            </div>
          </div>
          <Button variant="primary" icon="check" onClick={() => setReviewOpen(true)}>Review & confirm</Button>
        </Card>
      )}

      {/* header facts */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {role === "bid" ? (
                <InlineText value={doc.party_name ?? ""} placeholder="Contractor name" onSave={(v) => patch({ party_name: v })} className="text-xl font-semibold" />
              ) : (
                <InlineText value={doc.title ?? doc.project_name ?? "Requirements"} placeholder="Title" onSave={(v) => patch({ title: v })} className="text-xl font-semibold" />
              )}
              <Pill tone={st.tone}>{st.label}</Pill>
              {doc.version_no > 1 && <Pill tone="accent">v{doc.version_no}</Pill>}
            </div>
            <div className="text-xs text-brand-dark/50 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              <a href={`/api/documents/${documentId}/file`} className="inline-flex items-center gap-1 hover:text-brand-primary"><Icon name="file" className="w-3.5 h-3.5" />{doc.file_name}</a>
              <span>{items.length} items · {sections.length} sections</span>
              {sheets.length > 0 && <span>{sheets.length} sheet part{sheets.length > 1 ? "s" : ""} read</span>}
              {images.length > 0 && <span className="inline-flex items-center gap-1"><Icon name="image" className="w-3.5 h-3.5" />{images.length} picture{images.length > 1 ? "s" : ""}</span>}
              <span>Uploaded {new Date(doc.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="check" onClick={() => setReviewOpen(true)}>Review{unresolved.length ? <span className="ml-1 bg-brand-primary text-white rounded-full text-[10px] px-1.5">{unresolved.length}</span> : null}</Button>
            <Button icon="history" onClick={() => setHistoryOpen(true)}>History{data.editCount ? ` (${data.editCount})` : ""}</Button>
            {role === "bid" && <Button icon="upload" onClick={() => setUploadOpen(true)}>Upload revised bid</Button>}
            {versions.length > 1 && <Button icon="copy" onClick={() => setVersionsOpen(true)}>Versions ({versions.length})</Button>}
            <ExportMenu base={`/api/documents/${documentId}/export`} />
            <Menu items={[
              { label: "Re-read the original file", icon: "undo", onClick: () => confirm("Read the file again? Your manual edits to this document will be replaced.") && retry(false) },
              ...(sheets.some((s) => s.status === "failed") ? [{ label: "Retry failed sheets", icon: "undo", onClick: () => retry(true) }] : []),
              { label: "Delete this document", icon: "trash", danger: true, onClick: async () => { if (confirm("Delete this document and its pictures?")) { await send(`/api/documents/${documentId}`, "DELETE"); refresh(`/api/tenders/${tenderId}`); location.href = `/tenders/${tenderId}/${role === "bid" ? "bids" : "requirements"}`; } } },
            ]} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-5 pt-4 border-t border-line text-sm">
          <Stat label="Sum of line amounts" value={formatINR(doc.computed_total == null ? null : Number(doc.computed_total), currency)} tone={mismatch ? "warn" : undefined} />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-brand-dark/45">Total as printed</div>
            <InlineText value={doc.stated_total == null ? "" : String(doc.stated_total)} placeholder="not stated" numeric display={(v) => formatINR(Number(v), currency)} className="font-semibold tabular-nums" onSave={(v) => patch({ stated_total: v === "" ? null : Number(v) })} />
            {mismatch && <div className="text-[11px] text-amber-700">differs from the sum of lines</div>}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-brand-dark/45">Tax</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <select value={doc.tax_basis ?? "unknown"} onChange={(e) => patch({ tax_basis: e.target.value })} className="text-sm border border-line rounded-md px-1.5 py-1 bg-white">
                <option value="unknown">Not stated</option><option value="excluded">Excluded</option><option value="included">Included</option>
              </select>
              <InlineText value={doc.tax_rate_percent == null ? "" : String(doc.tax_rate_percent)} placeholder="%" numeric onSave={(v) => patch({ tax_rate_percent: v === "" ? null : Number(v) })} className="w-12" />
            </div>
          </div>
          <div><div className="text-[11px] uppercase tracking-wide text-brand-dark/45">Reference</div><InlineText value={doc.reference_no ?? ""} placeholder="—" onSave={(v) => patch({ reference_no: v })} /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-brand-dark/45">Document date</div><InlineText value={doc.document_date ?? ""} placeholder="YYYY-MM-DD" onSave={(v) => patch({ document_date: v })} /></div>
          {variants.length > 1 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-brand-dark/45">Price option</div>
              <select value={doc.primary_variant ?? ""} onChange={(e) => patch({ primary_variant: e.target.value })} className="text-sm border border-line rounded-md px-1.5 py-1 bg-white mt-0.5">
                {variants.map((v) => <option key={v.key} value={v.key}>{v.label || v.key}</option>)}
              </select>
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-brand-dark/55 px-1">
        <span className="font-medium text-brand-dark/70">Colour key</span>
        <Key cls="cell-auto" label="calculated for you" /><Key cls="cell-converted" label="unit converted" /><Key cls="cell-manual" label="edited by you" /><Key cls="cell-anomaly" label="looks unrealistic" />
        <span className="ml-auto">Click a cell to edit · <b className="font-semibold">fx</b>/ⓘ shows where a value came from</span>
      </div>

      {sections.length === 0 && !processing ? (
        <Card className="p-8 text-center text-sm text-brand-dark/55">No rows were found in this document.</Card>
      ) : (
        <BoqGrid
          documentId={documentId}
          tenderId={tenderId}
          role={role}
          currency={currency}
          sections={sections}
          items={items}
          imageCounts={imageCounts}
          tenderItems={role === "bid" ? tenderItems : undefined}
          readOnly={!isCurrent || processing}
          focusId={focusId}
          onChanged={changed}
        />
      )}

      {/* terms */}
      <TermsCard terms={doc.terms ?? []} readOnly={!isCurrent} onSave={(terms) => patch({ terms })} />

      {/* pictures */}
      {images.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3"><div className="font-semibold text-sm flex items-center gap-2"><Icon name="image" /> Pictures in this document ({images.length})</div><Link href={`/tenders/${tenderId}/gallery`} className="text-xs text-brand-contrast hover:underline">Open gallery →</Link></div>
          <div className="flex gap-2.5 overflow-x-auto scroll-thin pb-1">
            {images.map((im, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={im.id} src={im.public_url} alt="" onClick={() => setView(i)} className="h-24 w-32 object-cover rounded-lg border border-line cursor-zoom-in shrink-0" />
            ))}
          </div>
        </Card>
      )}
      {view !== null && <ImageViewer images={images.map((i) => ({ public_url: i.public_url, caption: i.caption, label: i.sheet_name ?? "" }))} index={view} onClose={() => setView(null)} onIndex={setView} />}

      <ReviewPanel documentId={documentId} issues={data.review.issues} status={doc.status} open={reviewOpen} onClose={() => setReviewOpen(false)} onChanged={changed} onJump={(id) => { setFocusId(id); setTimeout(() => setFocusId(null), 2000); }} onRetryFailed={() => retry(true)} />
      <HistoryDrawer documentId={documentId} lineId={null} open={historyOpen} onClose={() => setHistoryOpen(false)} onReverted={changed} />
      {role === "bid" && (
        <UploadDialog tenderId={tenderId} role="bid" open={uploadOpen} onClose={() => setUploadOpen(false)} replace={{ id: documentId, partyName: doc.party_name }} onDone={(ids) => { refresh(`/api/tenders/${tenderId}`); if (ids[0]) location.href = `/tenders/${tenderId}/bids/${ids[0]}`; }} />
      )}
      <Modal open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Submission versions" footer={<Button onClick={() => setVersionsOpen(false)}>Close</Button>}>
        <ul className="space-y-2">
          {[...versions].sort((a, b) => b.version_no - a.version_no).map((v) => (
            <li key={v.id} className={`border rounded-xl px-3.5 py-3 flex items-center justify-between gap-3 ${v.id === documentId ? "border-brand-primary bg-brand-primary/5" : "border-line"}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">Version {v.version_no} {!v.superseded_at && <Pill tone="ok">current</Pill>} {v.id === documentId && <Pill tone="accent">viewing</Pill>}</div>
                <div className="text-xs text-brand-dark/50 truncate">{v.file_name} · {new Date(v.created_at).toLocaleString()} · {formatINR(v.computed_total == null ? null : Number(v.computed_total))}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {v.id !== documentId && <a href={`/tenders/${tenderId}/${role === "bid" ? "bids" : "requirements"}/${v.id}`} className="text-xs px-2.5 py-1.5 rounded-lg border border-line hover:border-brand-primary">View</a>}
                {v.superseded_at && <Button size="sm" onClick={async () => { await send(`/api/documents/${v.id}/restore`, "POST"); setVersionsOpen(false); changed(); refresh(`/api/documents/${v.id}`); toast.push({ text: `v${v.version_no} is current again`, tone: "ok" }); }}>Make current</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function Key({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-3.5 h-3.5 rounded ${cls} border border-black/10`} />{label}</span>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-brand-dark/45">{label}</div><div className={`font-semibold tabular-nums mt-0.5 ${tone === "warn" ? "text-amber-700" : ""}`}>{value}</div></div>;
}

export function InlineText({ value, onSave, placeholder, numeric, className = "", display }: { value: string; onSave: (v: string) => void; placeholder?: string; numeric?: boolean; className?: string; display?: (v: string) => string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (editing) {
    return (
      <input
        autoFocus
        value={v}
        inputMode={numeric ? "decimal" : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); if (v !== value) onSave(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); setEditing(false); } }}
        className={`border border-brand-primary rounded-md px-1.5 py-0.5 outline-none bg-white ${className}`}
      />
    );
  }
  return (
    <button onClick={() => { setV(value); setEditing(true); }} className={`text-left hover:bg-brand-primary/5 rounded px-1 -mx-1 min-w-[2ch] ${className}`} title="Click to edit">
      {value ? (display ? display(value) : value) : <span className="text-brand-dark/30 font-normal">{placeholder ?? "—"}</span>}
    </button>
  );
}

function TermsCard({ terms, readOnly, onSave }: { terms: Document["terms"]; readOnly?: boolean; onSave: (t: Document["terms"]) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, { t: Document["terms"][number]; i: number }[]>();
    terms.forEach((t, i) => m.set(t.category, [...(m.get(t.category) ?? []), { t, i }]));
    return [...m.entries()];
  }, [terms]);
  if (terms.length === 0 && readOnly) return null;
  return (
    <Card className="p-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-left">
        <span className="font-semibold text-sm flex items-center gap-2"><Icon name="list" /> Terms & notes <Pill>{terms.length}</Pill></span>
        <Icon name="chevdown" className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {groups.map(([cat, list]) => (
            <div key={cat}>
              <div className="text-[11px] uppercase tracking-wide text-brand-dark/45 mb-1">{cat.replace(/_/g, " ")}</div>
              <ul className="space-y-1">
                {list.map(({ t, i }) => (
                  <li key={i} className="text-[13px] flex items-start gap-2 group">
                    <span className="flex-1">{t.text}{t.value && <span className="ml-1.5 text-brand-accent font-medium">[{t.value}]</span>}</span>
                    {!readOnly && <button onClick={() => onSave(terms.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 text-brand-dark/35 hover:text-red-600"><Icon name="x" className="w-3.5 h-3.5" /></button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!readOnly && <AddTerm onAdd={(t) => onSave([...terms, t])} />}
        </div>
      )}
    </Card>
  );
}
function AddTerm({ onAdd }: { onAdd: (t: Document["terms"][number]) => void }) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState("other");
  return (
    <div className="flex gap-2 pt-2 border-t border-line">
      <select value={cat} onChange={(e) => setCat(e.target.value)} className="text-xs border border-line rounded-md px-1.5 bg-white">
        {["tax", "payment", "validity", "timeline", "site_facilities", "scope_inclusion", "scope_exclusion", "material", "measurement", "warranty", "other"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
      </select>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a term or note…" className="flex-1 text-sm border border-line rounded-md px-2.5 py-1.5" />
      <Button size="sm" disabled={!text.trim()} onClick={() => { onAdd({ category: cat, text: text.trim(), value: null }); setText(""); }}>Add</Button>
    </div>
  );
}
