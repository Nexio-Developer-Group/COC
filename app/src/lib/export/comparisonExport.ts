import ExcelJS from "exceljs";
import type { Comparison } from "@/lib/compare";

function cellText(comparison: Comparison, itemId: string, bidId: string): string {
  const item = comparison.items.find((i) => i.tenderLineId === itemId)!;
  const c = item.cells[bidId];
  if (!c) return "x";
  if (c.status === "missing") return "x";
  if (c.status === "not_priced") return "—";
  if (c.status === "included") return "Included";
  if (c.status === "excluded") return "Excluded";
  return c.rate != null ? String(c.rate) : "—";
}

export function comparisonToRows(comparison: Comparison): string[][] {
  const header = ["Code", "Section", "Item", "Unit", "Qty", ...comparison.bids.map((b) => b.partyName ?? "Unknown")];
  const rows: string[][] = [header];
  for (const item of comparison.items) {
    rows.push([
      item.itemCode,
      item.sectionName ?? "",
      item.name ?? "",
      item.unit ?? "",
      item.quantity != null ? String(item.quantity) : "",
      ...comparison.bids.map((b) => cellText(comparison, item.tenderLineId, b.documentId)),
    ]);
  }
  rows.push(["", "", "", "", "Stated Total", ...comparison.bids.map((b) => String(b.statedTotal ?? ""))]);
  rows.push(["", "", "", "", "Like-for-like Total", ...comparison.bids.map((b) => String(b.likeForLikeTotal))]);
  rows.push(["", "", "", "", "Rank (L)", ...comparison.bids.map((b) => `L${b.rank}`)]);
  return rows;
}

export function rowsToCsv(rows: string[][]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  return "﻿" + body; // BOM so Excel opens non-ASCII (₹) correctly
}

export async function comparisonToXlsx(comparison: Comparison): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Comparative Statement");
  const rows = comparisonToRows(comparison);
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7E4228" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });
  sheet.views = [{ state: "frozen", xSplit: 5, ySplit: 1 }];
  sheet.columns.forEach((col) => (col.width = 18));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
