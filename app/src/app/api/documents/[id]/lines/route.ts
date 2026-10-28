import { NextRequest, NextResponse } from "next/server";
import { addLine } from "@/lib/docOps";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/lines">) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.section_id) return NextResponse.json({ error: "section_id is required" }, { status: 400 });
  const r = await addLine(id, { sectionId: body.section_id, afterLineId: body.after_line_id ?? null, values: body.values ?? {} });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ seq: r.seq });
}
