import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Fallback upload, step 1: receive one small piece of a big file (kept under the function body limit). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/documents/part">) {
  const { id: tenderId } = await ctx.params;
  const form = await req.formData();
  const uploadId = String(form.get("upload_id") ?? "");
  const index = Number(form.get("index"));
  const piece = form.get("piece") as File | null;
  if (!/^[\w-]{8,64}$/.test(uploadId) || !Number.isInteger(index) || index < 0 || !piece) return NextResponse.json({ error: "upload_id, index and piece are required" }, { status: 400 });
  const buf = Buffer.from(await piece.arrayBuffer());
  const up = await db.storage.from("tender-files").upload(`${tenderId}/_parts/${uploadId}/${index}`, buf, { contentType: "application/octet-stream", upsert: true });
  if (up.error) return NextResponse.json({ error: `Could not store the piece: ${up.error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, index });
}
