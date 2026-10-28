import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractRawText } from "@/lib/extractRawText";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/documents">) {
  const { id: tenderId } = await ctx.params;
  const { data: tender } = await db.from("tenders").select("*").eq("id", tenderId).single();
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const role = form.get("role") as string | null;
  const partyName = (form.get("party_name") as string | null) ?? null;
  const replaceDocumentId = form.get("replace_document_id") as string | null;

  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (role !== "tender" && role !== "bid") return NextResponse.json({ error: 'role must be "tender" or "bid"' }, { status: 400 });

  if (role === "tender" && tender.requirements_doc_id) {
    const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("tender_id", tenderId).eq("role", "bid");
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: "Bids are linked to these requirements. Create a new tender instead." }, { status: 409 });
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  const { data: dupe } = await db.from("documents").select("id, role, file_name").eq("tender_id", tenderId).eq("file_sha256", sha256).maybeSingle();

  let rendered;
  try {
    rendered = await extractRawText(buffer, file.name, file.type);
  } catch (e) {
    return NextResponse.json({ error: `Could not read this file: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }

  const docId = crypto.randomUUID();
  const storagePath = `${tenderId}/${docId}/${file.name}`;
  const { error: uploadErr } = await db.storage.from("tender-files").upload(storagePath, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadErr) return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });

  const issues = dupe
    ? [{ code: "duplicate_file", severity: "warn", message: `Identical file already uploaded as "${dupe.file_name}" (${dupe.role})` }]
    : [];

  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      id: docId,
      tender_id: tenderId,
      role,
      status: "uploaded",
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      file_size_bytes: buffer.length,
      file_sha256: sha256,
      rendered_text: rendered.text,
      party_name: partyName,
      issues,
    })
    .select()
    .single();
  if (insertErr || !doc) return NextResponse.json({ error: insertErr?.message ?? "Insert failed" }, { status: 500 });

  if (role === "bid" && replaceDocumentId) {
    await db.from("documents").update({ superseded_at: new Date().toISOString() }).eq("id", replaceDocumentId);
    await db.from("documents").update({ supersedes_id: replaceDocumentId }).eq("id", docId);
  }

  return NextResponse.json({ document: doc, truncated: rendered.truncated, sourceType: rendered.sourceType });
}
