import { NextResponse } from "next/server";
import { runExtraction } from "@/lib/extract/pipeline";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]/process">) {
  const { id } = await ctx.params;
  try {
    await runExtraction(id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
