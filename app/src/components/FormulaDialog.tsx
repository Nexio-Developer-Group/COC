"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { describeFormula } from "@/lib/formula";
import { formatINR, formatQty } from "@/lib/format";
import { send } from "@/lib/client/api";
import type { LineItem } from "@/lib/types";
import { Button, Modal, Pill, Spinner } from "./ui";
import Icon from "./ui/Icon";

type NumField = "quantity" | "rate" | "amount";
type PreviewRow = { lineId: string; itemCode: string; name: string | null; current: number | null; next: number | null; currentSrc: string; conflict: boolean; unchanged: boolean };

const DEFAULTS: Record<NumField, string> = { amount: "quantity * rate", rate: "amount / quantity", quantity: "amount / rate" };
const SRC_LABEL: Record<string, string> = { empty: "empty", document: "from your document", manual: "edited by you", converted: "unit-converted", autofill: "calculated" };

export default function FormulaDialog({
  documentId, items, sections, initial, currency, onClose, onApplied,
}: {
  documentId: string;
  items: LineItem[];
  sections: LineItem[];
  initial: { id: string; field: NumField; scope?: "cell" | "section" | "document" };
  currency: string;
  onClose: () => void;
  onApplied: (lineIds: string[]) => void;
}) {
  const line = items.find((i) => i.id === initial.id);
  const section = line ? sections.find((s) => s.id === line.parent_id) : undefined;
  const [field, setField] = useState<NumField>(initial.field);
  const existing = line?.cell_meta?.[field]?.formula;
  const [expr, setExpr] = useState(existing ?? DEFAULTS[initial.field]);
  const [scope, setScope] = useState<"cell" | "section" | "document">(initial.scope ?? "cell");
  const [saveRule, setSaveRule] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [refRow, setRefRow] = useState("");
  const [refField, setRefField] = useState<NumField>("amount");

  const body = useMemo(() => ({ field, expr, scope, line_id: initial.id || undefined, section_id: section?.id ?? line?.parent_id ?? undefined }), [field, expr, scope, initial.id, section?.id, line?.parent_id]);

  useEffect(() => {
    if (!expr.trim()) { setRows([]); setError(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await send(`/api/documents/${documentId}/formula`, "POST", { ...body, mode: "preview" });
      setLoading(false);
      if (!r.ok) { setError(r.data.error ?? "That formula doesn't work"); setRows([]); return; }
      setError(null);
      setRows(r.data.rows ?? []);
    }, 350);
    return () => clearTimeout(t);
  }, [body, expr, documentId]);

  const conflicts = rows.filter((r) => r.conflict);
  const willChange = rows.filter((r) => !r.unchanged && (!r.conflict || overwrite.has(r.lineId)));
  const insert = (text: string) => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? expr.length;
    setExpr((e) => e.slice(0, pos) + text + e.slice(pos));
    setTimeout(() => el?.focus(), 0);
  };
  const fmt = (n: number | null) => (n == null ? "—" : field === "quantity" ? formatQty(n) : formatINR(n, currency));

  async function apply() {
    setApplying(true);
    const r = await send(`/api/documents/${documentId}/formula`, "POST", { ...body, mode: "apply", overwrite_ids: [...overwrite], save_as_rule: saveRule && scope === "document" });
    setApplying(false);
    if (!r.ok) return setError(r.data.error ?? "Could not apply");
    onApplied(r.data.changed ?? []);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={<span className="inline-flex items-center gap-2"><Icon name="fx" /> Formula for {field}{line && scope === "cell" ? ` · row ${line.item_code}` : ""}</span>}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!error || !expr.trim() || applying || loading || willChange.length === 0} onClick={apply}>
            {applying ? <Spinner /> : null}
            {willChange.length === 0 ? "Nothing would change" : `Apply to ${willChange.length} row${willChange.length > 1 ? "s" : ""}`}
            {conflicts.length - [...overwrite].filter((id) => conflicts.some((c) => c.lineId === id)).length > 0 && ` · keep ${conflicts.length - [...overwrite].filter((id) => conflicts.some((c) => c.lineId === id)).length} existing`}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex gap-1.5">
          {(["amount", "rate", "quantity"] as NumField[]).map((f) => (
            <button key={f} onClick={() => { setField(f); setExpr(line?.cell_meta?.[f]?.formula ?? DEFAULTS[f]); }} className={`px-3 py-1.5 rounded-lg border text-sm capitalize ${field === f ? "bg-brand-dark text-white border-brand-dark" : "bg-white border-line hover:border-brand-primary/60"}`}>
              {f}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-dark/60 mb-1">{field[0].toUpperCase() + field.slice(1)} =</label>
          <input
            ref={inputRef}
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            spellCheck={false}
            className={`w-full font-mono text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 ${error ? "border-red-400 focus:ring-red-200" : "border-line focus:ring-brand-primary/25 focus:border-brand-primary"}`}
            placeholder="quantity * rate"
          />
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {(["quantity", "rate", "amount"] as NumField[]).filter((f) => f !== field).map((f) => (
              <button key={f} onClick={() => insert(f)} className="text-xs px-2 py-1 rounded-md bg-brand-light hover:bg-brand-primary/15 capitalize">{f}</button>
            ))}
            {["*", "/", "+", "-", "(", ")"].map((o) => (
              <button key={o} onClick={() => insert(` ${o} `)} className="text-xs w-7 py-1 rounded-md bg-brand-light hover:bg-brand-primary/15 font-mono">{o}</button>
            ))}
            <span className="mx-1 text-brand-dark/25">|</span>
            <select value={refRow} onChange={(e) => setRefRow(e.target.value)} className="text-xs border border-line rounded-md px-1.5 py-1 bg-white max-w-[180px]">
              <option value="">Use another row…</option>
              {items.filter((i) => i.id !== initial.id || scope !== "cell").map((i) => <option key={i.id} value={i.item_code}>{i.item_code} {i.name?.slice(0, 24)}</option>)}
            </select>
            {refRow && (
              <>
                <select value={refField} onChange={(e) => setRefField(e.target.value as NumField)} className="text-xs border border-line rounded-md px-1.5 py-1 bg-white">
                  {["amount", "rate", "quantity"].map((f) => <option key={f}>{f}</option>)}
                </select>
                <button onClick={() => { insert(`[${refRow}].${refField}`); setRefRow(""); }} className="text-xs px-2 py-1 rounded-md bg-brand-primary text-white">Insert</button>
              </>
            )}
          </div>
          {error ? (
            <p className="text-red-600 text-xs mt-2 flex gap-1"><Icon name="warn" className="w-4 h-4" />{error}</p>
          ) : expr.trim() ? (
            <p className="text-brand-dark/60 text-xs mt-2">In words: <b className="text-brand-dark">{field[0].toUpperCase() + field.slice(1)} = {describeFormula(expr, scope === "cell" ? line?.item_code : undefined)}</b></p>
          ) : null}
        </div>

        <div>
          <div className="text-xs font-medium text-brand-dark/60 mb-1.5">Apply it to</div>
          <div className="grid grid-cols-3 gap-2">
            {([["cell", "Just this row"], ["section", `This section${section ? ` (${section.name ?? "General"})` : ""}`], ["document", "Whole document"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setScope(k)} className={`text-left px-3 py-2 rounded-lg border text-[13px] ${scope === k ? "border-brand-primary bg-brand-primary/5 font-medium" : "border-line hover:border-brand-primary/50"}`}>{label}</button>
            ))}
          </div>
          {scope === "document" && (
            <label className="flex items-center gap-2 mt-2 text-[13px]">
              <input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} /> Also use this for any empty {field} in this document from now on
            </label>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-medium text-brand-dark/60">What will change {loading && <Spinner className="w-3 h-3 ml-1" />}</div>
            <div className="text-xs text-brand-dark/50">{rows.length} row{rows.length === 1 ? "" : "s"} · {rows.filter((r) => r.unchanged).length} already match</div>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 mb-2 text-[13px]">
              <div className="flex gap-2"><Icon name="warn" className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <b>{conflicts.length} row{conflicts.length > 1 ? "s" : ""} already {conflicts.length > 1 ? "have" : "has"} {field === "amount" ? "an" : "a"} {field} that doesn’t follow this formula.</b>
                  <div className="mt-0.5 text-amber-900/80">They’re <u>kept as they are</u> unless you tick them below. Nothing is overwritten silently.</div>
                  <div className="mt-1.5 flex gap-3 text-xs">
                    <button className="underline" onClick={() => setOverwrite(new Set(conflicts.map((c) => c.lineId)))}>Replace all of them</button>
                    <button className="underline" onClick={() => setOverwrite(new Set())}>Keep all of them</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="border border-line rounded-lg overflow-hidden max-h-64 overflow-y-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-brand-light-dull sticky top-0"><tr className="text-left text-brand-dark/55"><th className="px-2 py-1.5 w-8" /><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5 text-right">Now</th><th className="px-2 py-1.5 text-right">With formula</th><th className="px-2 py-1.5">Currently</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lineId} className={`border-t border-line ${r.conflict ? "bg-amber-50/70" : r.unchanged ? "text-brand-dark/45" : ""}`}>
                    <td className="px-2 py-1.5">{r.conflict && <input type="checkbox" checked={overwrite.has(r.lineId)} onChange={(e) => setOverwrite((s) => { const n = new Set(s); e.target.checked ? n.add(r.lineId) : n.delete(r.lineId); return n; })} />}</td>
                    <td className="px-2 py-1.5"><span className="text-brand-dark/45 mr-1">{r.itemCode}</span>{r.name?.slice(0, 34)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.current)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(r.next)}</td>
                    <td className="px-2 py-1.5">{r.unchanged ? <Pill tone="ok">already matches</Pill> : r.conflict ? <Pill tone="warn">{SRC_LABEL[r.currentSrc]}</Pill> : <Pill tone="info">{SRC_LABEL[r.currentSrc] ?? r.currentSrc}</Pill>}</td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-brand-dark/40">Type a formula to see its effect.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
