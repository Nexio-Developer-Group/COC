"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeFormula } from "@/lib/formula";
import { formatINR, formatQty } from "@/lib/format";
import { send } from "@/lib/client/api";
import { PROV_LABEL, anomaliesOf, cellClassFor, metaOf, provOf } from "@/lib/client/prov";
import type { LineItem } from "@/lib/types";
import FormulaDialog from "./FormulaDialog";
import HistoryDrawer from "./HistoryDrawer";
import ImageLightbox from "./ImageLightbox";
import { Button, Modal } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

export type TenderItemRef = { id: string; item_code: string; name: string | null; unit: string | null };

type Props = {
  documentId: string;
  tenderId: string;
  role: "tender" | "bid";
  currency: string;
  sections: LineItem[];
  items: LineItem[];
  imageCounts: Record<string, number>;
  tenderItems?: TenderItemRef[];
  readOnly?: boolean;
  focusId?: string | null;
  onChanged: () => void;
};

type NumField = "quantity" | "rate" | "amount";
type EditTarget = { id: string; field: string } | null;

const NUM_FIELDS: NumField[] = ["quantity", "rate", "amount"];

export default function BoqGrid({ documentId, tenderId, role, currency, sections, items, imageCounts, tenderItems, readOnly, focusId, onChanged }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<EditTarget>(null);
  const [draft, setDraft] = useState("");
  const [info, setInfo] = useState<EditTarget>(null);
  const [formulaFor, setFormulaFor] = useState<{ id: string; field: NumField; scope?: "cell" | "section" | "document" } | null>(null);
  const [conflict, setConflict] = useState<{ id: string; field: string; value: string; formula: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string | null } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const itemsBySection = useMemo(() => {
    const m = new Map<string, LineItem[]>();
    for (const it of items) {
      const k = it.parent_id ?? "none";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  }, [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    if (!focusId) return;
    const el = rowRefs.current[focusId];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(new Set([focusId]));
      setTimeout(() => setFlash(new Set()), 1600);
    }
  }, [focusId]);

  const flashLines = useCallback((ids: string[]) => {
    setFlash(new Set(ids));
    setTimeout(() => setFlash(new Set()), 1600);
  }, []);

  const save = useCallback(
    async (id: string, field: string, value: unknown, opts: { force?: boolean; restore?: boolean } = {}) => {
      setBusy(true);
      const r = await send(`/api/line-items/${id}`, "PATCH", { field, value, force: opts.force, restore: opts.restore });
      setBusy(false);
      if (r.status === 409 && r.data.conflict?.kind === "formula_override") {
        setConflict({ id, field, value: String(value ?? ""), formula: r.data.conflict.formula });
        return false;
      }
      if (!r.ok) {
        toast.push({ text: r.data.error ?? "Could not save that change", tone: "bad" });
        return false;
      }
      flashLines((r.data.lines ?? []).map((l: LineItem) => l.id));
      onChanged();
      for (const n of r.data.notices ?? []) {
        if (n.kind === "dependent_mismatch") {
          toast.push({
            text: n.message,
            tone: "warn",
            action: {
              label: "Recalculate",
              run: async () => {
                await send(`/api/documents/${documentId}/formula`, "POST", { field: "amount", expr: "quantity * rate", scope: "cell", line_id: n.lineId, mode: "apply", overwrite_ids: "all" });
                onChanged();
              },
            },
          });
        } else toast.push({ text: n.message, tone: "info" });
      }
      return true;
    },
    [documentId, flashLines, onChanged, toast]
  );

  function startEdit(line: LineItem, field: string) {
    if (readOnly) return;
    const cur = (line as unknown as Record<string, unknown>)[field];
    setDraft(cur == null ? "" : String(cur));
    setEditing({ id: line.id, field });
    setInfo(null);
  }
  async function commit() {
    if (!editing) return;
    const line = byId.get(editing.id);
    const { id, field } = editing;
    const isNum = NUM_FIELDS.includes(field as NumField);
    const current = line ? (line as unknown as Record<string, unknown>)[field] : null;
    setEditing(null);
    const same = (current ?? "") === (isNum ? (draft === "" ? "" : Number(draft.replace(/,/g, ""))) : draft);
    if (same) return;
    await save(id, field, isNum ? (draft.trim() === "" ? null : draft) : draft);
  }

  async function addRow(sectionId: string, afterId?: string) {
    setBusy(true);
    const r = await send(`/api/documents/${documentId}/lines`, "POST", { section_id: sectionId, after_line_id: afterId ?? null, values: { name: "New item" } });
    setBusy(false);
    if (!r.ok) return toast.push({ text: r.data.error ?? "Could not add a row", tone: "bad" });
    onChanged();
    toast.push({ text: "Row added — click any cell to fill it in.", tone: "ok" });
  }
  async function deleteRow(line: LineItem) {
    if (!confirm(`Delete ${line.item_code} ${line.name ?? ""}? You can undo this from the history panel.`)) return;
    const r = await send(`/api/line-items/${line.id}`, "DELETE");
    if (!r.ok) return toast.push({ text: r.data.error ?? "Could not delete", tone: "bad" });
    for (const n of r.data.notices ?? []) toast.push({ text: n.message, tone: "warn" });
    onChanged();
  }

  const showMatch = role === "bid" && !!tenderItems;

  function numCell(line: LineItem, field: NumField) {
    const meta = metaOf(line, field);
    const isEditing = editing?.id === line.id && editing.field === field;
    const raw = line[field];
    const val = raw == null ? null : Number(raw);
    const anomalies = anomaliesOf(line, field);
    const cls = cellClassFor(line, field);
    const notPriced = line.quote_status === "not_priced" && (field === "rate" || field === "amount") && (val == null || val === 0);
    const tip = [meta ? `${PROV_LABEL[provOf(line, field)]}${meta.formula ? ` — ${describeFormula(meta.formula, line.item_code)}` : ""}` : null, meta?.note, ...anomalies.map((a) => `⚠ ${a.message}`)].filter(Boolean).join("\n");

    return (
      <td className={`grid-cell relative px-2 py-1.5 text-right tabular-nums ${cls} ${flash.has(line.id) ? "flash" : ""}`} title={tip || undefined} onDoubleClick={() => startEdit(line, field)}>
        {isEditing ? (
          <input
            autoFocus
            value={draft}
            inputMode="decimal"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
              if (e.key === "Tab") {
                e.preventDefault();
                const next = NUM_FIELDS[NUM_FIELDS.indexOf(field) + 1];
                commit().then(() => next && startEdit(line, next));
              }
            }}
            className="w-24 text-right bg-white text-brand-dark border border-brand-primary rounded px-1.5 py-0.5 outline-none shadow-sm"
          />
        ) : (
          <button type="button" onClick={() => (readOnly ? undefined : startEdit(line, field))} className="inline-flex items-center justify-end gap-1.5 w-full min-h-[22px]">
            {meta?.formula && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setInfo(info?.id === line.id && info.field === field ? null : { id: line.id, field });
                }}
                className="text-[10px] font-semibold italic px-1 rounded bg-white/70 border border-current/30 cursor-pointer"
                title="Calculated by a formula — click for details"
              >
                fx
              </span>
            )}
            {!meta?.formula && (meta || anomalies.length > 0) && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setInfo(info?.id === line.id && info.field === field ? null : { id: line.id, field });
                }}
                className="opacity-60 hover:opacity-100 cursor-pointer"
                title="Where does this value come from?"
              >
                <Icon name={anomalies.length ? "warn" : "info"} className="w-3.5 h-3.5" />
              </span>
            )}
            {notPriced ? <span className="text-brand-dark/35 italic text-xs">not quoted</span> : val == null ? <span className="text-brand-dark/25">—</span> : field === "quantity" ? formatQty(val) : formatINR(val, currency)}
          </button>
        )}
        {info?.id === line.id && info.field === field && cellInfo(line, field)}
      </td>
    );
  }

  function cellInfo(line: LineItem, field: NumField) {
    const meta = metaOf(line, field);
    const anomalies = anomaliesOf(line, field);
    const src = provOf(line, field);
    return (
      <div className="absolute z-30 right-0 top-full mt-1 w-80 text-left bg-white text-brand-dark border border-line rounded-xl shadow-2xl p-3.5 text-[13px] font-normal no-underline" style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-semibold">{PROV_LABEL[src]}</span>
          <button onClick={() => setInfo(null)} className="text-brand-dark/40 hover:text-brand-dark"><Icon name="x" className="w-3.5 h-3.5" /></button>
        </div>
        {meta?.formula && src !== "converted" && (
          <div className="rounded-lg bg-brand-light-dull border border-line px-2.5 py-2 mb-2">
            <div className="text-[11px] uppercase tracking-wide text-brand-dark/45">Formula</div>
            <div className="font-mono text-xs mt-0.5">{meta.formula}</div>
            <div className="text-brand-dark/70 mt-1">{field[0].toUpperCase() + field.slice(1)} = {describeFormula(meta.formula, line.item_code)}</div>
          </div>
        )}
        {src === "converted" && line.converted && (
          <div className="rounded-lg bg-brand-light-dull border border-line px-2.5 py-2 mb-2">
            Your document said <b>{formatQty(line.converted.original_quantity)} {line.converted.from}</b> at <b>{formatINR(line.converted.original_rate, currency)}</b>. Converted to <b>{line.converted.to}</b> (× {formatQty(line.converted.factor)}) so it can be compared with your BOQ.
          </div>
        )}
        {meta?.original != null && src !== "converted" && <div className="text-brand-dark/70 mb-2">Document value: <b>{String(meta.original)}</b></div>}
        {meta?.note && !meta.formula && <div className="text-brand-dark/70 mb-2">{meta.note}</div>}
        {anomalies.map((a) => (
          <div key={a.code} className="flex gap-1.5 text-red-700 mb-1.5"><Icon name="warn" className="w-4 h-4 shrink-0 mt-0.5" /><span>{a.message}</span></div>
        ))}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {!readOnly && (field === "amount" || field === "rate" || field === "quantity") && (
            <Button size="sm" icon="fx" onClick={() => { setInfo(null); setFormulaFor({ id: line.id, field }); }}>{meta?.formula ? "Edit formula" : "Use a formula"}</Button>
          )}
          {!readOnly && meta?.formula && (
            <Button size="sm" onClick={async () => { setInfo(null); await send(`/api/documents/${documentId}/formula`, "POST", { field, expr: null, scope: "cell", line_id: line.id, mode: "apply" }); onChanged(); }}>Keep value, drop formula</Button>
          )}
          {!readOnly && meta && (
            <Button size="sm" icon="undo" onClick={async () => { setInfo(null); await save(line.id, field, null, { restore: true }); }}>
              {src === "converted" ? "Undo conversion" : "Back to document value"}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="history" onClick={() => { setInfo(null); setHistoryFor({ id: line.id }); }}>History</Button>
        </div>
      </div>
    );
  }

  function textCell(line: LineItem, field: "name" | "unit_raw" | "remarks", placeholder?: string, className = "") {
    const isEditing = editing?.id === line.id && editing.field === field;
    const shown = field === "unit_raw" ? line.unit ?? line.unit_raw : (line as unknown as Record<string, string | null>)[field];
    const cls = cellClassFor(line, field);
    return (
      <td className={`grid-cell px-2 py-1.5 ${cls} ${className}`} onDoubleClick={() => startEdit(line, field)} title={metaOf(line, field)?.note}>
        {isEditing ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" ? setEditing(null) : undefined)} className="w-full bg-white text-brand-dark border border-brand-primary rounded px-1.5 py-0.5 outline-none" />
        ) : (
          <span onClick={() => !readOnly && startEdit(line, field)} className={readOnly ? "" : "cursor-text block min-h-[22px]"}>
            {shown || <span className="text-brand-dark/25">{placeholder ?? "—"}</span>}
            {field === "unit_raw" && line.converted && <span className="ml-1 text-[10px] opacity-70" title={`was ${line.converted.from}`}>⇄</span>}
          </span>
        )}
      </td>
    );
  }

  const cols = 8 + (showMatch ? 1 : 0);

  return (
    <div>
      <div className="bg-white border border-line rounded-xl overflow-x-auto scroll-thin">
        <table className="w-full text-[13px] border-collapse min-w-[880px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-brand-accent-dull text-white text-left text-xs">
              <th className="px-3 py-2.5 font-medium w-14">Code</th>
              <th className="px-3 py-2.5 font-medium min-w-[220px]">Item</th>
              <th className="px-3 py-2.5 font-medium w-20">Unit</th>
              <th className="px-3 py-2.5 font-medium w-28 text-right">Qty</th>
              <th className="px-3 py-2.5 font-medium w-32 text-right">{role === "tender" ? "Budget rate" : "Rate"}</th>
              <th className="px-3 py-2.5 font-medium w-36 text-right">Amount</th>
              <th className="px-3 py-2.5 font-medium min-w-[160px]">Remarks</th>
              {showMatch && <th className="px-3 py-2.5 font-medium w-48">Matches your BOQ</th>}
              <th className="px-2 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const list = itemsBySection.get(section.id) ?? [];
              const subtotal = list.reduce((s, l) => s + (Number(l.amount) || 0), 0);
              return (
                <Fragment key={section.id}>
                  <tr className="bg-brand-accent text-white">
                    <td className="px-3 py-2 font-semibold" colSpan={cols - 2}>
                      <span className="opacity-70 mr-2">{section.item_code}</span>
                      {section.name ?? "General"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium" colSpan={2}>{formatINR(subtotal, currency)}</td>
                    <td />
                  </tr>
                  {list.map((line) => {
                    const open = expanded.has(line.id);
                    const imgs = imageCounts[line.id] ?? 0;
                    return (
                      <Fragment key={line.id}>
                        <tr ref={(el) => { rowRefs.current[line.id] = el; }} className={`border-t border-line align-top hover:bg-brand-light-dull/60 group ${flash.has(line.id) ? "flash" : ""}`}>
                          <td className="px-3 py-1.5 text-brand-dark/45 tabular-nums">{line.item_code}</td>
                          {textCell(line, "name", "Untitled item", "font-medium")}
                          {textCell(line, "unit_raw")}
                          {numCell(line, "quantity")}
                          {numCell(line, "rate")}
                          {numCell(line, "amount")}
                          <td className="px-2 py-1.5 text-xs text-brand-dark/65">
                            <div className="flex flex-wrap gap-1 items-center">
                              {line.remarks && <span className="text-brand-primary">{line.remarks}</span>}
                              {line.flags.map((f) => <span key={f} className="text-[10px] bg-brand-light px-1.5 py-0.5 rounded">{f.replace(/_/g, " ").toLowerCase()}</span>)}
                              {line.quote_status && line.quote_status !== "priced" && <span className="text-[10px] bg-brand-light px-1.5 py-0.5 rounded">{line.quote_status.replace("_", " ")}</span>}
                            </div>
                          </td>
                          {showMatch && (
                            <td className="px-2 py-1.5">
                              <select
                                disabled={readOnly}
                                value={line.tender_line_id ?? ""}
                                onChange={(e) => save(line.id, "tender_line_id", e.target.value || null)}
                                className={`w-full text-xs rounded-md border px-1.5 py-1 bg-white ${!line.tender_line_id ? "border-amber-300 text-amber-800" : line.match_confidence === "low" ? "border-amber-300" : "border-line"}`}
                                title={line.match_note ?? undefined}
                              >
                                <option value="">Extra item (not in BOQ)</option>
                                {tenderItems!.map((t) => (
                                  <option key={t.id} value={t.id}>{t.item_code} {t.name?.slice(0, 28)}</option>
                                ))}
                              </select>
                              {line.tender_line_id && line.match_confidence && <div className="text-[10px] text-brand-dark/45 mt-0.5">{line.match_confidence} match · {line.match_method}</div>}
                            </td>
                          )}
                          <td className="px-1 py-1.5 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                              {imgs > 0 && (
                                <button onClick={() => setLightbox(line.id)} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-1 rounded hover:bg-black/5 text-brand-contrast" title="View pictures for this row">
                                  <Icon name="image" className="w-3.5 h-3.5" />{imgs}
                                </button>
                              )}
                              {(line.description || line.anomalies.length > 0) && (
                                <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(line.id) ? n.delete(line.id) : n.add(line.id); return n; })} className="p-1 rounded hover:bg-black/5" title="Details">
                                  <Icon name="chevdown" className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
                                </button>
                              )}
                              {!readOnly && (
                                <details className="relative">
                                  <summary className="list-none cursor-pointer p-1 rounded hover:bg-black/5 [&::-webkit-details-marker]:hidden"><Icon name="dots" className="w-4 h-4" /></summary>
                                  <div className="absolute right-0 z-30 mt-1 w-52 bg-white border border-line rounded-xl shadow-xl py-1 text-[13px]">
                                    <MenuBtn icon="fx" onClick={() => setFormulaFor({ id: line.id, field: "amount" })}>Set a formula…</MenuBtn>
                                    <MenuBtn icon="plus" onClick={() => addRow(section.id, line.id)}>Add row below</MenuBtn>
                                    <MenuBtn icon="image" onClick={() => setLightbox(line.id)}>Pictures…</MenuBtn>
                                    <MenuBtn icon="history" onClick={() => setHistoryFor({ id: line.id })}>History of this row</MenuBtn>
                                    {line.converted && (
                                      <MenuBtn icon="undo" onClick={async () => { await send(`/api/documents/${documentId}/conversion`, "POST", { line_id: line.id, action: "revert" }); onChanged(); }}>Undo unit conversion</MenuBtn>
                                    )}
                                    <div className="border-t border-line my-1" />
                                    <MenuBtn icon="trash" danger onClick={() => deleteRow(line)}>Delete row</MenuBtn>
                                  </div>
                                </details>
                              )}
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-brand-light-dull/70 border-t border-line/60">
                            <td />
                            <td colSpan={cols - 1} className="px-3 py-2 text-xs text-brand-dark/70 space-y-1">
                              {line.description && <p className="leading-relaxed">{line.description}</p>}
                              {line.anomalies.map((a) => (
                                <p key={a.code} className="text-red-700 flex gap-1.5"><Icon name="warn" className="w-3.5 h-3.5 mt-0.5" />{a.message}</p>
                              ))}
                              {line.source_row && <p className="text-brand-dark/40">Row {line.source_row}{line.sheet_name ? ` of sheet “${line.sheet_name}”` : ""} in your file</p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!readOnly && (
                    <tr className="border-t border-line/60">
                      <td />
                      <td colSpan={cols - 1} className="px-3 py-1">
                        <button onClick={() => addRow(section.id)} className="text-xs text-brand-dark/45 hover:text-brand-primary inline-flex items-center gap-1"><Icon name="plus" className="w-3.5 h-3.5" /> Add a row to this section</button>
                        <span className="mx-2 text-brand-dark/20">·</span>
                        <button onClick={() => setFormulaFor({ id: list[0]?.id ?? "", field: "amount", scope: "section" })} className="text-xs text-brand-dark/45 hover:text-brand-primary inline-flex items-center gap-1"><Icon name="fx" className="w-3.5 h-3.5" /> Apply a formula to this section</button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {busy && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-brand-dark text-white text-xs px-3 py-1.5 rounded-full shadow-lg">Saving…</div>}

      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="This cell is calculated"
        footer={
          <>
            <Button onClick={() => setConflict(null)}>Cancel</Button>
            <Button onClick={() => { const c = conflict!; setConflict(null); setFormulaFor({ id: c.id, field: c.field as NumField }); }} icon="fx">Edit the formula instead</Button>
            <Button variant="primary" onClick={async () => { const c = conflict!; setConflict(null); await save(c.id, c.field, c.value, { force: true }); }}>Use my value</Button>
          </>
        }
      >
        {conflict && (
          <div className="text-sm space-y-2">
            <p>
              <b>{conflict.field[0].toUpperCase() + conflict.field.slice(1)}</b> is currently worked out as <b>{describeFormula(conflict.formula)}</b>.
            </p>
            <p className="text-brand-dark/65">If you type a value, this row stops following the formula (you can undo it from History). Or change the formula itself so it stays calculated.</p>
          </div>
        )}
      </Modal>

      {formulaFor && (
        <FormulaDialog
          documentId={documentId}
          items={items}
          sections={sections}
          initial={formulaFor}
          currency={currency}
          onClose={() => setFormulaFor(null)}
          onApplied={(ids) => { flashLines(ids); onChanged(); }}
        />
      )}
      <HistoryDrawer documentId={documentId} lineId={historyFor?.id ?? null} open={!!historyFor} onClose={() => setHistoryFor(null)} onReverted={onChanged} />
      {lightbox && <ImageLightbox documentId={documentId} tenderId={tenderId} lineId={lightbox} lineLabel={byId.get(lightbox) ? `${byId.get(lightbox)!.item_code} ${byId.get(lightbox)!.name ?? ""}` : ""} readOnly={readOnly} onClose={() => { setLightbox(null); onChanged(); }} />}
    </div>
  );
}

function MenuBtn({ icon, children, onClick, danger }: { icon: string; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { onClick(); (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); }}
      className={`w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-brand-light-dull ${danger ? "text-red-600" : ""}`}
    >
      <Icon name={icon} className="w-4 h-4" />{children}
    </button>
  );
}
