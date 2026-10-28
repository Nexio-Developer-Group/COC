import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyEdit, deleteLine } from "@/lib/docOps";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/line-items/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { data: row } = await db.from("line_items").select("document_id").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  // legacy shape: { tender_line_id } or { name } etc.
  const field = body.field ?? Object.keys(body).find((k) => !["force", "reason", "value", "restore"].includes(k));
  const value = "field" in body ? body.value : body[field];
  const result = await applyEdit(row.document_id, id, { field, value, force: !!body.force, reason: body.reason ?? null, restore: !!body.restore });
  if (!result.ok) return NextResponse.json({ error: result.error, conflict: result.conflict ?? null }, { status: result.conflict ? 409 : 400 });
  return NextResponse.json({ lines: result.lines, notices: result.notices, seq: result.seq });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/line-items/[id]">) {
  const { id } = await ctx.params;
  const { data: row } = await db.from("line_items").select("document_id, kind").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (row.kind !== "item") return NextResponse.json({ error: "Only item rows can be deleted here." }, { status: 400 });
  const result = await deleteLine(row.document_id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ notices: result.notices, seq: result.seq });
}
