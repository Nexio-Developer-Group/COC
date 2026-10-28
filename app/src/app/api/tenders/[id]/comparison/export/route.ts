import { NextRequest, NextResponse } from "next/server";
import { comparisonExport } from "@/lib/export/builders";
import { exportResponse } from "@/lib/export/respond";

export const maxDuration = 120;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/comparison/export">) {
  const { id } = await ctx.params;
  const doc = await comparisonExport(id);
  if (!doc) return NextResponse.json({ error: "No comparison available" }, { status: 404 });
  return exportResponse(doc, req.nextUrl.searchParams.get("format") ?? "xlsx", "comparative-statement");
}
