import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const { id } = await ctx.params;
  const { data: doc } = await db.from("documents").select("storage_path").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { data, error } = await db.storage.from("tender-files").createSignedUrl(doc.storage_path, 600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
