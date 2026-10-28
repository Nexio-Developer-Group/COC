import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const { data: doc, error } = await db.from("documents").select("*").eq("id", id).single();
  if (error || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data: sections } = await db.from("line_items").select("*").eq("document_id", id).eq("kind", "section").order("position");
  const { data: items } = await db.from("line_items").select("*").eq("document_id", id).eq("kind", "item").order("position");

  return NextResponse.json({ document: doc, sections: sections ?? [], items: items ?? [] });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  for (const key of ["party_name", "primary_variant", "tax_basis"]) {
    if (key in body) allowed[key] = body[key];
  }
  if ("mark_reviewed" in body && body.mark_reviewed) allowed.status = "ready";

  if ("primary_variant" in body) {
    const variant = body.primary_variant as string;
    const { data: items } = await db.from("line_items").select("*").eq("document_id", id).eq("kind", "item");
    for (const item of items ?? []) {
      const prices = (item.prices ?? []) as { variant: string; rate: number | null; amount: number | null }[];
      const chosen = prices.find((p) => p.variant === variant) ?? prices[0];
      if (chosen) {
        await db.from("line_items").update({ rate: chosen.rate, amount: chosen.amount }).eq("id", item.id);
      }
    }
    const { data: updatedItems } = await db.from("line_items").select("amount").eq("document_id", id).eq("kind", "item");
    const computedTotal = (updatedItems ?? []).reduce((sum, i) => sum + (i.amount ?? 0), 0);
    allowed.computed_total = computedTotal;
  }

  const { data, error } = await db.from("documents").update(allowed).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const { data: doc } = await db.from("documents").select("storage_path").eq("id", id).single();
  if (doc?.storage_path) await db.storage.from("tender-files").remove([doc.storage_path]);
  const { error } = await db.from("documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
