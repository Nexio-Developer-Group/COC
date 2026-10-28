import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tenders/[id]">) {
  const { id } = await ctx.params;
  const { data: tender, error } = await db.from("tenders").select("*").eq("id", id).single();
  if (error || !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  let requirementsDoc = null;
  if (tender.requirements_doc_id) {
    const { data } = await db.from("documents").select("*").eq("id", tender.requirements_doc_id).single();
    requirementsDoc = data;
  }
  const { data: bids } = await db
    .from("documents")
    .select("*")
    .eq("tender_id", id)
    .eq("role", "bid")
    .is("superseded_at", null)
    .order("created_at");

  return NextResponse.json({ tender, requirementsDoc, bids: bids ?? [] });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  for (const key of ["title", "client_name", "location", "currency", "notes", "archived_at", "ui_settings"]) {
    if (key in body) allowed[key] = body[key];
  }
  const { data, error } = await db.from("tenders").update(allowed).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tender: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/tenders/[id]">) {
  const { id } = await ctx.params;
  const { data: docs } = await db.from("documents").select("storage_path").eq("tender_id", id);
  const { data: imgs } = await db.from("document_images").select("storage_path").eq("tender_id", id);
  if (docs?.length) await db.storage.from("tender-files").remove(docs.map((d) => d.storage_path));
  if (imgs?.length) await db.storage.from("tender-images").remove(imgs.map((i) => i.storage_path));
  await db.from("tenders").update({ requirements_doc_id: null }).eq("id", id);
  const { error } = await db.from("tenders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
