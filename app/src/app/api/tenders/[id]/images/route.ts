import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Every image across the tender's requirements and live bids, with where it came from. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/images">) {
  const { id } = await ctx.params;
  const { data: docs } = await db.from("documents").select("id, role, party_name, file_name, version_no, superseded_at").eq("tender_id", id);
  const live = new Map((docs ?? []).filter((d) => !d.superseded_at).map((d) => [d.id, d]));
  const { data: images } = await db.from("document_images").select("*").eq("tender_id", id).order("created_at");
  const lineIds = [...new Set((images ?? []).map((i) => i.line_item_id).filter(Boolean))];
  const { data: lines } = lineIds.length ? await db.from("line_items").select("id, item_code, name, tender_line_id").in("id", lineIds) : { data: [] };
  const lineMap = new Map((lines ?? []).map((l) => [l.id, l]));
  const out = (images ?? [])
    .filter((i) => live.has(i.document_id))
    .map((i) => ({ ...i, source: live.get(i.document_id), line: i.line_item_id ? lineMap.get(i.line_item_id) ?? null : null }));
  return NextResponse.json({ images: out });
}
