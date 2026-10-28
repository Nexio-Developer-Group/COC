import ExcelJS from "exceljs";
import { cellTone, cellValue, type ExportDoc, type Tone } from "./model";

const TONE_FILL: Record<Tone, string> = {
  good: "FFE4F2E7", bad: "FFFBE3D7", warn: "FFFFF4CC", info: "FFE3ECFA", auto: "FFE3ECFA", converted: "FFDDF3EF", manual: "FFFFF4CC", flag: "FFFBD5D5",
};
const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.##;[>=100000]"₹"##\\,##\\,##0.##;"₹"##,##0.##';

export async function toXlsx(doc: ExportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TenderBoard";
  const used = new Set<string>();
  for (const sheet of doc.sheets) {
    let nm = sheet.name.replace(/[\\/*?:[\]]/g, " ").slice(0, 28).trim() || "Sheet";
    for (let n = 2; used.has(nm.toLowerCase()); n++) nm = `${nm.slice(0, 26)} ${n}`;
    used.add(nm.toLowerCase());
    const ws = wb.addWorksheet(nm);
    let r = 1;
    if (sheet.title || doc.title) {
      ws.getCell(r, 1).value = sheet.title ?? doc.title;
      ws.getCell(r, 1).font = { bold: true, size: 14, color: { argb: "FF5C311E" } };
      r++;
      if (doc.subtitle) {
        ws.getCell(r, 1).value = doc.subtitle;
        ws.getCell(r, 1).font = { color: { argb: "FF666666" } };
        r++;
      }
      r++;
    }
    const headerRow = r;
    sheet.columns.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5C311E" } };
      cell.alignment = { horizontal: c.align === "right" ? "right" : "left", vertical: "middle", wrapText: true };
      ws.getColumn(i + 1).width = c.width ?? (c.kind === "text" || !c.kind ? 28 : 16);
    });
    r++;
    for (const row of sheet.rows) {
      sheet.columns.forEach((c, i) => {
        const cell = ws.getCell(r, i + 1);
        const v = cellValue(row.cells[c.key]);
        cell.value = v as ExcelJS.CellValue;
        const tone = cellTone(row.cells[c.key]);
        if (typeof v === "number") {
          cell.alignment = { horizontal: "right" };
          if (c.kind === "money") cell.numFmt = INR;
          else if (c.kind === "qty") cell.numFmt = "#,##0.##";
          else if (c.kind === "pct") cell.numFmt = '0.0"%"';
        } else cell.alignment = { wrapText: true, vertical: "top", indent: row.indent ? 1 : 0 };
        if (tone) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } };
        if (row.band) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7E4228" } };
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        } else if (row.total) {
          cell.font = { bold: true };
          cell.border = { top: { style: "thin" } };
        }
        const note = row.cells[c.key];
        if (note && typeof note === "object" && note.note) cell.note = note.note;
      });
      r++;
    }
    ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: Math.min(2, sheet.columns.length - 1) }];
    if (sheet.notes?.length) {
      r++;
      ws.getCell(r, 1).value = "Notes";
      ws.getCell(r, 1).font = { bold: true };
      for (const n of sheet.notes) ws.getCell(++r, 1).value = n;
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
