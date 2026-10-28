import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storeImages } from "@/lib/ingest/images";

/** Attach one or more picture files (site photos, samples, drawings) to a document or a specific row. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/images">) {
  const { id } = await ctx.params;
  const { data: doc } = await db.from("documents").select("tender_id").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const form = await req.formData();
  const lineId = (form.get("line_item_id") as string | null) || null;
  const caption = (form.get("caption") as string | null) || null;
  const files = form.getAll("files") as File[];
  if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });
  let added = 0;
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = (f.name.split(".").pop() || "png").toLowerCase();
    const n = await storeImages({ tenderId: doc.tender_id, documentId: id, images: [{ buffer: buf, mime: f.type || `image/${ext}`, ext, sheetName: null, anchorRow: null, anchorCol: null }], origin: "attached", caption });
    added += n;
  }
  if (lineId && added) {
    const { data: fresh } = await db.from("document_images").select("id").eq("document_id", id).is("line_item_id", null).eq("origin", "attached").order("created_at", { ascending: false }).limit(added);
    for (const r of fresh ?? []) await db.from("document_images").update({ line_item_id: lineId }).eq("id", r.id);
  }
  return NextResponse.json({ added });
}
