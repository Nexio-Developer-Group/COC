import { NextRequest, NextResponse } from "next/server";
import { documentExport } from "@/lib/export/builders";
import { exportResponse } from "@/lib/export/respond";

export const maxDuration = 120;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/export">) {
  const { id } = await ctx.params;
  const out = await documentExport(id);
  if (!out) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return exportResponse(out.doc, req.nextUrl.searchParams.get("format") ?? "xlsx", out.doc.title);
}
