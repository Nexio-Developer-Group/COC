import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Fallback upload, step 2: join the pieces into the final stored file, then the normal "register" step carries on. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/documents/assemble">) {
  const { id: tenderId } = await ctx.params;
  const { upload_id, total, storage_path, mime_type } = await req.json();
  if (!/^[\w-]{8,64}$/.test(String(upload_id)) || !Number.isInteger(total) || total < 1 || total > 200 || !String(storage_path ?? "").startsWith(`${tenderId}/`)) {
    return NextResponse.json({ error: "upload_id, total and storage_path are required" }, { status: 400 });
  }
  const dir = `${tenderId}/_parts/${upload_id}`;
  const pieces: Buffer[] = [];
  for (let i = 0; i < total; i++) {
    const dl = await db.storage.from("tender-files").download(`${dir}/${i}`);
    if (dl.error || !dl.data) return NextResponse.json({ error: `Piece ${i + 1} of ${total} is missing — please try the upload again.` }, { status: 400 });
    pieces.push(Buffer.from(await dl.data.arrayBuffer()));
  }
  const whole = Buffer.concat(pieces);
  const up = await db.storage.from("tender-files").upload(storage_path, whole, { contentType: mime_type || "application/octet-stream", upsert: true });
  if (up.error) return NextResponse.json({ error: `Could not save the file: ${up.error.message}` }, { status: 500 });
  await db.storage.from("tender-files").remove(Array.from({ length: total }, (_, i) => `${dir}/${i}`));
  return NextResponse.json({ ok: true, size: whole.length });
}
