import { NextResponse } from "next/server";
import { safeName, toCsv, type ExportDoc } from "./model";
import { toPdf } from "./pdf";
import { toXlsx } from "./xlsx";

export async function exportResponse(doc: ExportDoc, format: string, baseName: string): Promise<NextResponse> {
  const name = safeName(baseName);
  if (format === "csv") {
    return new NextResponse(toCsv(doc.sheets[0]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  }
  if (format === "pdf") {
    const buf = await toPdf(doc);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
  }
  const buf = await toXlsx(doc);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
}
