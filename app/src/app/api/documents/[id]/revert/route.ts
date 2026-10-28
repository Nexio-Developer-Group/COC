import { NextRequest, NextResponse } from "next/server";
import { revertSeq } from "@/lib/docOps";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/revert">) {
  const { id } = await ctx.params;
  const { seq } = await req.json();
  const r = await revertSeq(id, Number(seq));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ seq: r.seq });
}
