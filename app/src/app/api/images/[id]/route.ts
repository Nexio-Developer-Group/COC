import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/images/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if ("caption" in body) patch.caption = body.caption;
  if ("line_item_id" in body) patch.line_item_id = body.line_item_id;
  const { data, error } = await db.from("document_images").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ image: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/images/[id]">) {
  const { id } = await ctx.params;
  const { data: img } = await db.from("document_images").select("storage_path").eq("id", id).single();
  if (img) await db.storage.from("tender-images").remove([img.storage_path]);
  await db.from("document_images").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
