import { NextRequest, NextResponse } from "next/server";
import { applyFormula } from "@/lib/docOps";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/formula">) {
  const { id } = await ctx.params;
  const b = await req.json();
  if (!["quantity", "rate", "amount"].includes(b.field)) return NextResponse.json({ error: "field must be quantity, rate or amount" }, { status: 400 });
  const r = await applyFormula(id, {
    field: b.field,
    expr: b.expr ?? null,
    scope: b.scope ?? "cell",
    lineId: b.line_id,
    sectionId: b.section_id,
    mode: b.mode === "apply" ? "apply" : "preview",
    overwriteIds: b.overwrite_ids,
    saveAsRule: !!b.save_as_rule,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
