import type { Anomaly, CellMeta, LineItem } from "@/lib/types";

export type Prov = "document" | "autofill" | "converted" | "manual" | "ai";

export const PROV_LABEL: Record<Prov, string> = {
  document: "From your document",
  autofill: "Calculated for you",
  converted: "Unit converted",
  manual: "Edited by you",
  ai: "Inferred by AI",
};

export function metaOf(line: LineItem, field: string): CellMeta | undefined {
  return (line.cell_meta as Record<string, CellMeta | undefined>)?.[field];
}
export function provOf(line: LineItem, field: string): Prov {
  return (metaOf(line, field)?.src as Prov) ?? "document";
}
export function anomaliesOf(line: LineItem, field: string): Anomaly[] {
  return (line.anomalies ?? []).filter((a) => a.field === field && a.severity !== "info");
}
export function cellClassFor(line: LineItem, field: string): string {
  if (anomaliesOf(line, field).length) return "cell-anomaly";
  const p = provOf(line, field);
  return p === "autofill" ? "cell-auto" : p === "converted" ? "cell-converted" : p === "manual" ? "cell-manual" : p === "ai" ? "cell-ai" : "";
}
