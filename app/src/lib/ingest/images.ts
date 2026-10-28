import crypto from "crypto";
import { db } from "@/lib/db";
import type { LineItem } from "@/lib/types";
import type { ExtractedImage } from "./readFile";

const BUCKET = "tender-images";

export async function storeImages(opts: {
  tenderId: string;
  documentId: string;
  images: ExtractedImage[];
  origin: "embedded" | "attached";
  caption?: string | null;
}) {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const img of opts.images) {
    const sha = crypto.createHash("sha256").update(img.buffer).digest("hex");
    if (seen.has(sha)) continue; // logos repeat on every sheet
    seen.add(sha);
    const path = `${opts.tenderId}/${opts.documentId}/${sha.slice(0, 16)}.${img.ext || "png"}`;
    const up = await db.storage.from(BUCKET).upload(path, img.buffer, { contentType: img.mime, upsert: true });
    if (up.error) continue;
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    rows.push({
      tender_id: opts.tenderId,
      document_id: opts.documentId,
      sheet_name: img.sheetName,
      anchor_row: img.anchorRow,
      anchor_col: img.anchorCol,
      storage_path: path,
      public_url: data.publicUrl,
      mime_type: img.mime,
      file_size_bytes: img.buffer.length,
      sha256: sha,
      caption: opts.caption ?? null,
      origin: opts.origin,
    });
  }
  if (rows.length) await db.from("document_images").insert(rows);
  return rows.length;
}

/** Attaches each embedded image to the item row it sits on (or just below), same sheet. */
export async function linkImagesToLines(documentId: string, lines: LineItem[]) {
  const { data: imgs } = await db.from("document_images").select("id, sheet_name, anchor_row").eq("document_id", documentId).is("line_item_id", null).not("anchor_row", "is", null);
  if (!imgs?.length) return;
  const items = lines.filter((l) => l.kind === "item" && l.source_row != null);
  for (const img of imgs) {
    const sheetBase = (img.sheet_name ?? "").split(" (part")[0];
    const cands = items.filter((l) => (l.sheet_name ?? "").split(" (part")[0] === sheetBase && (l.source_row as number) <= (img.anchor_row as number) + 1);
    if (!cands.length) continue;
    const best = cands.reduce((a, b) => ((b.source_row as number) > (a.source_row as number) ? b : a));
    if ((img.anchor_row as number) - (best.source_row as number) > 12) continue;
    await db.from("document_images").update({ line_item_id: best.id }).eq("id", img.id);
  }
}
