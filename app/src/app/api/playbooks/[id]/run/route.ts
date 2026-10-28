import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runAnalysis } from "@/lib/analysis/run";

export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/playbooks/[id]/run">) {
  const { id } = await ctx.params;
  const { tender_id, params, force } = await req.json();
  if (!tender_id) return NextResponse.json({ error: "tender_id is required" }, { status: 400 });
  const { data: pb } = await db.from("playbooks").select("*").eq("id", id).single();
  if (!pb) return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
  const values: Record<string, string> = params ?? {};
  const missing = (pb.parameters as { key: string; label: string }[]).filter((p) => !values[p.key]?.trim());
  if (missing.length) return NextResponse.json({ error: `Please fill in: ${missing.map((m) => m.label).join(", ")}` }, { status: 400 });
  const text = String(pb.instruction).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => values[k] ?? "");
  try {
    const result = await runAnalysis({ tenderId: tender_id, requestText: text, requestedType: (pb.output_type as "auto") || "auto", templateKey: `playbook:${pb.name}`, playbookId: id, params: values, force: !!force });
    await db.from("playbooks").update({ run_count: (pb.run_count ?? 0) + 1, last_run_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
