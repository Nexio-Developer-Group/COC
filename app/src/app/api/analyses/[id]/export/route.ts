import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rowsToCsv } from "@/lib/export/comparisonExport";
import type { AnalysisResult, AnalysisTableBody, AnalysisRankingBody, AnalysisNarrativeBody } from "@/lib/types";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/analyses/[id]/export">) {
  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") || "xlsx";
  const { data: analysis } = await db.from("analyses").select("*").eq("id", id).single();
  if (!analysis || !analysis.result) return NextResponse.json({ error: "No result to export" }, { status: 404 });
  const result = analysis.result as AnalysisResult;
  const safeTitle = (result.title || "analysis").replace(/[^a-z0-9]+/gi, "-").slice(0, 60);

  if (result.response_type === "narrative") {
    const body = result.body as AnalysisNarrativeBody;
    const md = `# ${result.title}\n\n${result.description}\n\n${body.verdict ? `**Verdict:** ${body.verdict}\n\n` : ""}${body.markdown}`;
    return new NextResponse(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${safeTitle}.md"` },
    });
  }

  let rows: string[][];
  if (result.response_type === "table") {
    const body = result.body as AnalysisTableBody;
    rows = [body.columns.map((c) => c.label), ...body.rows.map((r) => body.columns.map((c) => String(r[c.key] ?? "")))];
    if (body.totals_row) rows.push(body.columns.map((c) => String(body.totals_row?.[c.key] ?? "")));
  } else {
    const body = result.body as AnalysisRankingBody;
    rows = [
      ["Rank", "Contractor", "Score", "Headline", "Strengths", "Concerns"],
      ...body.entries.map((e) => [String(e.rank), e.contractor, String(e.score), e.headline, e.strengths.join("; "), e.concerns.join("; ")]),
    ];
  }

  if (format === "csv") {
    return new NextResponse(rowsToCsv(rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeTitle}.csv"` },
    });
  }

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Result");
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 20));
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(Buffer.from(buf)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeTitle}.xlsx"`,
    },
  });
}
