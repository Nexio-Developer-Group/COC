export type Tone = "good" | "bad" | "warn" | "info" | "auto" | "converted" | "manual" | "flag";

export type Col = { key: string; label: string; width?: number; align?: "left" | "right" | "center"; kind?: "text" | "money" | "qty" | "pct" };
export type Cell = string | number | null | { v: string | number | null; tone?: Tone; note?: string };
export type Row = { cells: Record<string, Cell>; band?: boolean; total?: boolean; indent?: boolean };

export type Sheet = {
  name: string;
  title?: string;
  columns: Col[];
  rows: Row[];
  notes?: string[];
  images?: { url: string; caption?: string }[];
};

export type ExportDoc = { title: string; subtitle?: string; sheets: Sheet[]; currency?: string };

export const cellValue = (c: Cell | undefined): string | number | null => (c && typeof c === "object" ? c.v : c ?? null);
export const cellTone = (c: Cell | undefined): Tone | undefined => (c && typeof c === "object" ? c.tone : undefined);

export function toCsv(sheet: Sheet): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [sheet.columns.map((c) => esc(c.label)).join(",")];
  for (const r of sheet.rows) lines.push(sheet.columns.map((c) => esc(String(cellValue(r.cells[c.key]) ?? ""))).join(","));
  return "﻿" + lines.join("\r\n");
}

export const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";
