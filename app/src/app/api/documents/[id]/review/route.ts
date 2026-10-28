import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveReview } from "@/lib/calc";
import { loadDoc } from "@/lib/docOps";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/review">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const bundle = await loadDoc(id);
  if (!bundle) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const extra = { ...(bundle.doc.header_extra ?? {}) } as { acks?: string[] };
  let acks = new Set(extra.acks ?? []);
  const review = deriveReview(bundle.doc, bundle.lines);

  if (body.action === "ack") for (const i of body.ids ?? []) acks.add(i);
  if (body.action === "unack") for (const i of body.ids ?? []) acks.delete(i);
  if (body.action === "ack_all") for (const i of review.issues) if (i.id && (!body.categories || body.categories.includes(i.category))) acks.add(i.id);

  const patch: Record<string, unknown> = { header_extra: { ...extra, acks: [...acks] } };
  if (body.action === "confirm") {
    patch.status = "ready";
    patch.reviewed_at = new Date().toISOString();
    patch.header_extra = { ...extra, acks: review.issues.map((i) => i.id).filter(Boolean) };
  }
  if (body.action === "reopen") {
    patch.status = "needs_review";
    patch.reviewed_at = null;
  }
  const { error } = await db.from("documents").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
