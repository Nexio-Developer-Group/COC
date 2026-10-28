import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/history">) {
  const { id } = await ctx.params;
  const lineId = req.nextUrl.searchParams.get("line_id");
  let q = db.from("line_item_edits").select("*").eq("document_id", id).order("id", { ascending: false }).limit(300);
  if (lineId) q = q.eq("line_item_id", lineId);
  const { data } = await q;
  return NextResponse.json({ edits: data ?? [] });
}
