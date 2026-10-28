import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectType } from "@/lib/ingest/readFile";
import type { Document } from "@/lib/types";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/documents">) {
  const { id } = await ctx.params;
  const { data } = await db.from("documents").select("id, role, status, file_name, party_name, version_no, superseded_at, supersedes_id, created_at, stated_total, computed_total").eq("tender_id", id).order("created_at");
  return NextResponse.json({ documents: data ?? [] });
}

type Registration = {
  document_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size: number;
  role: "tender" | "bid";
  party_name?: string | null;
  replace_document_id?: string | null;
};

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/documents">) {
  const { id: tenderId } = await ctx.params;
  const { data: tender } = await db.from("tenders").select("*").eq("id", tenderId).single();
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  let reg: Registration;
  let buffer: Buffer | null = null;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
    buffer = Buffer.from(await file.arrayBuffer());
    const documentId = crypto.randomUUID();
    const path = `${tenderId}/${documentId}/${file.name.replace(/[^\w.\- ()]+/g, "_")}`;
    const up = await db.storage.from("tender-files").upload(path, buffer, { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
    reg = {
      document_id: documentId, storage_path: path, file_name: file.name, mime_type: file.type, size: buffer.length, role: form.get("role") as "tender" | "bid",
      party_name: (form.get("party_name") as string | null) ?? null, replace_document_id: (form.get("replace_document_id") as string | null) ?? null,
    };
  } else {
    reg = await req.json();
  }

  if (reg.role !== "tender" && reg.role !== "bid") return NextResponse.json({ error: 'role must be "tender" or "bid"' }, { status: 400 });
  if (detectType(reg.file_name, reg.mime_type ?? "") === "image") {
    return NextResponse.json({ error: "Images can't be a tender or bid on their own — attach them to a document instead." }, { status: 422 });
  }

  if (reg.role === "tender" && tender.requirements_doc_id) {
    const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("tender_id", tenderId).eq("role", "bid");
    if ((count ?? 0) > 0) return NextResponse.json({ error: "Bids are linked to these requirements. Edit the BOQ in place, or create a new tender." }, { status: 409 });
  }

  if (!buffer) {
    const dl = await db.storage.from("tender-files").download(reg.storage_path);
    if (dl.error || !dl.data) return NextResponse.json({ error: `Uploaded file not found: ${dl.error?.message ?? ""}` }, { status: 400 });
    buffer = Buffer.from(await dl.data.arrayBuffer());
  }
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const { data: dupe } = await db.from("documents").select("id, role, file_name").eq("tender_id", tenderId).eq("file_sha256", sha256).limit(1).maybeSingle();

  let versionNo = 1;
  let partyName = reg.party_name ?? null;
  if (reg.role === "bid" && reg.replace_document_id) {
    const { data: old } = await db.from("documents").select("version_no, party_name").eq("id", reg.replace_document_id).single();
    versionNo = (old?.version_no ?? 1) + 1;
    partyName = partyName ?? old?.party_name ?? null;
  }

  const issues = dupe ? [{ code: "duplicate_file", severity: "warn", category: "ingest", message: `An identical file was already uploaded as "${dupe.file_name}" (${dupe.role}).` }] : [];
  const { data: doc, error } = await db
    .from("documents")
    .insert({
      id: reg.document_id, tender_id: tenderId, role: reg.role, status: "uploaded", file_name: reg.file_name, storage_path: reg.storage_path, mime_type: reg.mime_type || null,
      file_size_bytes: buffer.length, file_sha256: sha256, party_name: partyName, issues, version_no: versionNo, supersedes_id: reg.role === "bid" ? reg.replace_document_id ?? null : null,
    })
    .select()
    .single<Document>();
  if (error || !doc) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  return NextResponse.json({ document: doc });
}
