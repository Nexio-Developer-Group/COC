import { NextRequest, NextResponse } from "next/server";
import { buildComparison } from "@/lib/compare";
import { comparisonToRows, rowsToCsv, comparisonToXlsx } from "@/lib/export/comparisonExport";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/comparison/export">) {
  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") || "xlsx";
  const comparison = await buildComparison(id);
  if (!comparison) return NextResponse.json({ error: "No comparison available" }, { status: 404 });

  if (format === "csv") {
    const csv = rowsToCsv(comparisonToRows(comparison));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="comparative-statement.csv"`,
      },
    });
  }

  const buf = await comparisonToXlsx(comparison);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comparative-statement.xlsx"`,
    },
  });
}
