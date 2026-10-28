import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveReview } from "@/lib/calc";
import { loadDoc, setPrimaryVariant } from "@/lib/docOps";
import type { DocumentImage, DocumentSheet } from "@/lib/types";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const bundle = await loadDoc(id);
  if (!bundle) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { doc, lines } = bundle;

  const [{ data: sheets }, { data: images }, { count: editCount }, { data: versions }] = await Promise.all([
    db.from("document_sheets").select("id, document_id, idx, name, kind, row_count, status, error, image_count").eq("document_id", id).order("idx").returns<DocumentSheet[]>(),
    db.from("document_images").select("*").eq("document_id", id).order("created_at").returns<DocumentImage[]>(),
    db.from("line_item_edits").select("id", { count: "exact", head: true }).eq("document_id", id),
    db.from("documents").select("id, version_no, file_name, created_at, superseded_at, supersedes_id, status, computed_total").eq("tender_id", doc.tender_id).eq("role", doc.role).order("version_no"),
  ]);

  const review = deriveReview(doc, lines);
  const imageCounts: Record<string, number> = {};
  for (const im of images ?? []) if (im.line_item_id) imageCounts[im.line_item_id] = (imageCounts[im.line_item_id] ?? 0) + 1;

  // version chain = this document plus everything linked by supersedes_id
  const chain = new Set<string>([id]);
  for (let i = 0; i < 20; i++) {
    let grew = false;
    for (const v of versions ?? []) {
      if (!chain.has(v.id) && ((v.supersedes_id && chain.has(v.supersedes_id)) || [...chain].some((c) => (versions ?? []).find((x) => x.id === c)?.supersedes_id === v.id))) {
        chain.add(v.id);
        grew = true;
      }
    }
    if (!grew) break;
  }

  return NextResponse.json({
    document: doc,
    sections: lines.filter((l) => l.kind === "section"),
    items: lines.filter((l) => l.kind === "item"),
    review,
    sheets: sheets ?? [],
    images: images ?? [],
    imageCounts,
    editCount: editCount ?? 0,
    versions: (versions ?? []).filter((v) => chain.has(v.id)),
  });
}

const DOC_FIELDS = ["party_name", "title", "project_name", "document_date", "reference_no", "currency", "tax_basis", "tax_rate_percent", "stated_total", "terms"];

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { data: current } = await db.from("documents").select("field_meta").eq("id", id).single();
  const patch: Record<string, unknown> = {};
  const meta = { ...(current?.field_meta ?? {}) } as Record<string, unknown>;
  const stamp = new Date().toISOString();
  for (const key of DOC_FIELDS) {
    if (key in body) {
      patch[key] = body[key] === "" ? null : body[key];
      meta[key] = { src: "manual", at: stamp, note: "Edited by you" };
    }
  }
  if (Object.keys(patch).length) patch.field_meta = meta;

  if ("primary_variant" in body) await setPrimaryVariant(id, body.primary_variant as string);

  if (Object.keys(patch).length) {
    const { error } = await db.from("documents").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data } = await db.from("documents").select("*").eq("id", id).single();
  return NextResponse.json({ document: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const { data: doc } = await db.from("documents").select("storage_path, tender_id, role, supersedes_id").eq("id", id).single();
  const { data: imgs } = await db.from("document_images").select("storage_path").eq("document_id", id);
  if (imgs?.length) await db.storage.from("tender-images").remove(imgs.map((i) => i.storage_path));
  if (doc?.storage_path) await db.storage.from("tender-files").remove([doc.storage_path]);
  // if this was the live version, bring back the one it replaced
  if (doc?.supersedes_id) await db.from("documents").update({ superseded_at: null }).eq("id", doc.supersedes_id);
  if (doc?.role === "tender") await db.from("tenders").update({ requirements_doc_id: null }).eq("id", doc.tender_id).eq("requirements_doc_id", id);
  const { error } = await db.from("documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
