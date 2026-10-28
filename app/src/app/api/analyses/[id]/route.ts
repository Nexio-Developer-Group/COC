import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/analyses/[id]">) {
  const { id } = await ctx.params;
  const { data, error } = await db.from("analyses").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  return NextResponse.json({ analysis: data });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/analyses/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  if ("title" in body) allowed.title = body.title;
  const { data, error } = await db.from("analyses").update(allowed).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ analysis: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/analyses/[id]">) {
  const { id } = await ctx.params;
  const { error } = await db.from("analyses").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
