import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/line-items/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const allowed: Record<string, unknown> = {};

  if ("tender_line_id" in body) {
    allowed.tender_line_id = body.tender_line_id;
    allowed.match_method = "manual";
    allowed.match_confidence = body.tender_line_id ? "exact" : null;
    allowed.match_note = body.tender_line_id ? "Manually linked by user" : null;
  }
  for (const key of ["name", "unit_raw", "quantity"]) {
    if (key in body) allowed[key] = body[key];
  }

  const { data, error } = await db.from("line_items").update(allowed).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItem: data });
}
