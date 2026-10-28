"use client";

import { useMemo } from "react";
import { send, useApi, refresh } from "@/lib/client/api";
import type { LineEdit } from "@/lib/types";
import { Button, Drawer, Pill, Spinner } from "./ui";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toasts";

const CAUSE: Record<string, { label: string; tone: "info" | "ok" | "warn" | "neutral" }> = {
  user: { label: "You edited", tone: "warn" }, formula: { label: "Formula applied", tone: "info" }, formula_removed: { label: "Formula removed", tone: "neutral" },
  revert: { label: "Undo", tone: "neutral" }, restore: { label: "Restored", tone: "neutral" }, add_row: { label: "Row added", tone: "ok" }, delete_row: { label: "Row deleted", tone: "warn" },
  variant_switch: { label: "Price option", tone: "info" }, recalc: { label: "Recalculated", tone: "info" }, conversion: { label: "Unit converted", tone: "info" },
};
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v));

export default function HistoryDrawer({ documentId, lineId, open, onClose, onReverted }: { documentId: string; lineId: string | null; open: boolean; onClose: () => void; onReverted: () => void }) {
  const toast = useToast();
  const url = open ? `/api/documents/${documentId}/history${lineId ? `?line_id=${lineId}` : ""}` : null;
  const { data, isLoading, mutate } = useApi<{ edits: LineEdit[] }>(url);
  const groups = useMemo(() => {
    const m = new Map<number, LineEdit[]>();
    for (const e of data?.edits ?? []) m.set(e.seq, [...(m.get(e.seq) ?? []), e]);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [data]);

  async function undo(seq: number) {
    const r = await send(`/api/documents/${documentId}/revert`, "POST", { seq });
    if (!r.ok) return toast.push({ text: r.data.error ?? "Could not undo", tone: "bad" });
    toast.push({ text: `Change #${seq} undone`, tone: "ok" });
    mutate();
    refresh(`/api/documents/${documentId}`);
    onReverted();
  }

  return (
    <Drawer open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Icon name="history" /> {lineId ? "History of this row" : "Change history"}</span>}>
      <div className="p-4 space-y-3">
        {isLoading && <Spinner />}
        {!isLoading && groups.length === 0 && <p className="text-sm text-brand-dark/50 text-center py-10">No changes yet. Everything shown is exactly as read from the file.</p>}
        {groups.map(([seq, edits]) => {
          const cause = CAUSE[edits[0].cause] ?? { label: edits[0].cause, tone: "neutral" as const };
          return (
            <div key={seq} className="border border-line rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><Pill tone={cause.tone}>{cause.label}</Pill><span className="text-xs text-brand-dark/45">#{seq} · {new Date(edits[0].created_at).toLocaleString()}</span></div>
                {edits[0].cause !== "revert" && edits[0].cause !== "delete_row" && <Button size="sm" icon="undo" onClick={() => undo(seq)}>Undo</Button>}
              </div>
              {edits[0].reason && <p className="text-xs text-brand-dark/60 mb-1.5">{edits[0].reason}</p>}
              <ul className="space-y-1 text-[13px]">
                {edits.slice(0, 12).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-brand-dark/45">{e.item_code}</span>
                    <b className="capitalize">{e.field.replace("_raw", "")}</b>
                    <span className="line-through text-brand-dark/45">{show(e.old_value)}</span>
                    <Icon name="chevron" className="w-3 h-3 text-brand-dark/35" />
                    <span className="font-medium">{show(e.new_value)}</span>
                    {e.new_meta?.formula && <span className="font-mono text-[11px] bg-brand-light px-1 rounded">{e.new_meta.formula}</span>}
                  </li>
                ))}
                {edits.length > 12 && <li className="text-xs text-brand-dark/45">+{edits.length - 12} more cells in this change</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}
