import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Step 1 of upload: hand the browser a one-time URL so big files go straight to storage (no 4.5MB function limit). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/documents/sign">) {
  const { id: tenderId } = await ctx.params;
  const { file_name } = await req.json();
  if (!file_name) return NextResponse.json({ error: "file_name is required" }, { status: 400 });
  const documentId = crypto.randomUUID();
  const safe = String(file_name).replace(/[^\w.\- ()]+/g, "_");
  const path = `${tenderId}/${documentId}/${safe}`;
  const { data, error } = await db.storage.from("tender-files").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not prepare upload" }, { status: 500 });
  return NextResponse.json({ document_id: documentId, storage_path: path, token: data.token, signed_url: data.signedUrl });
}
