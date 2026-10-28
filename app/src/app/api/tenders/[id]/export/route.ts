import { NextRequest, NextResponse } from "next/server";
import { packExport } from "@/lib/export/builders";
import { exportResponse } from "@/lib/export/respond";

export const maxDuration = 180;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/export">) {
  const { id } = await ctx.params;
  const doc = await packExport(id);
  if (!doc) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  return exportResponse(doc, req.nextUrl.searchParams.get("format") ?? "xlsx", `${doc.title}-pack`);
}
