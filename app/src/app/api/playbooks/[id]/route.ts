import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/playbooks/[id]">) {
  const { id } = await ctx.params;
  const b = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "description", "emoji", "instruction", "output_type", "category", "pinned", "parameters"]) if (k in b) patch[k] = b[k];
  if (typeof b.instruction === "string" && !("parameters" in b)) {
    const keys = [...new Set([...b.instruction.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m: RegExpMatchArray) => m[1]))] as string[];
    patch.parameters = keys.map((k) => ({ key: k, label: k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));
  }
  const { data, error } = await db.from("playbooks").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ playbook: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/playbooks/[id]">) {
  const { id } = await ctx.params;
  const { error } = await db.from("playbooks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
