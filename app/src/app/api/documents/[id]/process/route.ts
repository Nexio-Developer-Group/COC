import { NextRequest, NextResponse } from "next/server";
import { runStep } from "@/lib/extract/pipeline";

export const maxDuration = 300;

/** Runs ONE step (open file / read one sheet part / finalize). The client loops until done. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/process">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await runStep(id, { restart: !!body.restart, retryFailed: !!body.retry_failed });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
