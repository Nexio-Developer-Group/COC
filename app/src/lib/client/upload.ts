"use client";
import { createClient } from "@supabase/supabase-js";
import { send } from "./api";

export type UploadProgress = { phase: "uploading" | "registering" | "reading" | "done" | "error"; detail: string; pct: number; documentId?: string; error?: string };

/** how long to wait on the direct-to-storage upload before falling back to the app server */
const DIRECT_TIMEOUT_MS = 20000;
/** Vercel functions accept request bodies up to ~4.5MB */
const SERVER_UPLOAD_MAX = 4 * 1024 * 1024;

const supa = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string);

/** Browser -> storage directly (no function body limit), then the server reads it one step at a time. */
export async function uploadAndProcess(opts: {
  tenderId: string;
  file: File;
  role: "tender" | "bid";
  partyName?: string | null;
  replaceDocumentId?: string | null;
  onProgress: (p: UploadProgress) => void;
}): Promise<string | null> {
  const { tenderId, file, role, onProgress } = opts;
  try {
    onProgress({ phase: "uploading", detail: "Uploading your file…", pct: 5 });
    const sign = await send(`/api/tenders/${tenderId}/documents/sign`, "POST", { file_name: file.name });
    if (!sign.ok) throw new Error(sign.data.error ?? "Could not prepare upload");
    const { document_id, storage_path, token } = sign.data;

    // Straight to storage first (no function size limit). Some networks block or stall the storage domain,
    // so if that errors or hangs, send the file through this app's own server instead (small files only).
    let direct: string | null = null;
    try {
      const up = await Promise.race([
        supa().storage.from("tender-files").uploadToSignedUrl(storage_path, token, file, { contentType: file.type || "application/octet-stream" }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), DIRECT_TIMEOUT_MS)),
      ]);
      if (up.error) direct = up.error.message;
    } catch (e) {
      direct = e instanceof Error ? e.message : String(e);
    }

    let docId = document_id;
    if (direct === null) {
      onProgress({ phase: "registering", detail: "Checking the file…", pct: 15, documentId: document_id });
      const reg = await send(`/api/tenders/${tenderId}/documents`, "POST", {
        document_id, storage_path, file_name: file.name, mime_type: file.type, size: file.size, role,
        party_name: opts.partyName || null, replace_document_id: opts.replaceDocumentId || null,
      });
      if (!reg.ok) throw new Error(reg.data.error ?? "Could not register the file");
    } else {
      if (file.size > SERVER_UPLOAD_MAX) throw new Error(`Upload failed (${direct}). This file is too large to send through the app's server — check that your network can reach Supabase storage, or try again on another connection.`);
      onProgress({ phase: "registering", detail: "Uploading via the app server…", pct: 10 });
      const form = new FormData();
      form.append("file", file);
      form.append("role", role);
      if (opts.partyName) form.append("party_name", opts.partyName);
      if (opts.replaceDocumentId) form.append("replace_document_id", opts.replaceDocumentId);
      const res = await fetch(`/api/tenders/${tenderId}/documents`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      docId = data.document?.id ?? document_id;
    }
    const documentId = docId;

    let total = 1;
    for (let i = 0; i < 80; i++) {
      const r = await send(`/api/documents/${documentId}/process`, "POST", {});
      if (!r.ok) throw new Error(r.data.error ?? "Processing failed");
      total = Math.max(total, r.data.total || 1);
      const done = r.data.completed ?? 0;
      onProgress({ phase: "reading", detail: r.data.done ? "Finishing up…" : r.data.phase === "extract" ? `Reading sheet ${Math.min(done + 1, total)} of ${total} with AI…` : "Opening your file…", pct: 20 + Math.round((done / total) * 70), documentId });
      if (r.data.done) {
        if (r.data.phase === "failed") throw new Error(r.data.detail || "Could not read the file");
        break;
      }
    }
    onProgress({ phase: "done", detail: "Ready for your review", pct: 100, documentId });
    return documentId;
  } catch (e) {
    onProgress({ phase: "error", detail: "Something went wrong", pct: 100, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
