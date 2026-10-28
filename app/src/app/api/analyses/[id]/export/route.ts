import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analysisExport } from "@/lib/export/builders";
import { exportResponse } from "@/lib/export/respond";
import type { AnalysisNarrativeBody, AnalysisResult } from "@/lib/types";

export const maxDuration = 120;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/analyses/[id]/export">) {
  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") ?? "xlsx";
  const { data: a } = await db.from("analyses").select("title, description, request_text, result").eq("id", id).single();
  if (!a?.result) return NextResponse.json({ error: "No result to export" }, { status: 404 });
  const result = a.result as AnalysisResult;
  if (format === "md") {
    const body = result.body as AnalysisNarrativeBody;
    const md = result.response_type === "narrative"
      ? `# ${result.title}\n\n${result.description}\n\n${body.verdict ? `**Verdict:** ${body.verdict}\n\n` : ""}${body.markdown}`
      : `# ${result.title}\n\n${result.description}`;
    return new NextResponse(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="report.md"` } });
  }
  return exportResponse(analysisExport({ title: a.title, description: a.description, request_text: a.request_text, result }), format, result.title || "report");
}
