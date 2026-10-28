import JSZip from "jszip";
import type { ExtractedImage } from "./readFile";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const rels = (xml: string) => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({ id: attr(m[0], "Id")!, target: attr(m[0], "Target")!, type: attr(m[0], "Type") ?? "" }));

const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

/** Pictures anchored on worksheets, read straight from the zip (independent of the cell parser). */
export async function extractXlsxImages(buffer: Buffer, minBytes = 1500): Promise<ExtractedImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (p: string) => zip.file(p)?.async("string") ?? null;
  const wbXml = await read("xl/workbook.xml");
  const wbRels = await read("xl/_rels/workbook.xml.rels");
  if (!wbXml || !wbRels) return [];
  const relMap = new Map(rels(wbRels).map((r) => [r.id, r.target]));
  const out: ExtractedImage[] = [];

  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = (attr(m[0], "name") ?? "Sheet").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const rid = attr(m[0], "r:id");
    const target = rid ? relMap.get(rid) : null;
    if (!target) continue;
    const sheetPath = resolve("xl/workbook.xml", target);
    const sheetRels = await read(sheetPath.replace(/([^/]+)$/, "_rels/$1.rels"));
    if (!sheetRels) continue;
    for (const dr of rels(sheetRels).filter((r) => r.type.endsWith("/drawing"))) {
      const drawingPath = resolve(sheetPath, dr.target);
      const drawingXml = await read(drawingPath);
      const drawingRels = await read(drawingPath.replace(/([^/]+)$/, "_rels/$1.rels"));
      if (!drawingXml || !drawingRels) continue;
      const imgRel = new Map(rels(drawingRels).map((r) => [r.id, r.target]));
      const anchors = [...drawingXml.matchAll(/<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/g)];
      for (const a of anchors) {
        const block = a[0];
        const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(block)?.[1];
        if (!embed) continue;
        const mediaTarget = imgRel.get(embed);
        if (!mediaTarget) continue;
        const mediaPath = resolve(drawingPath, mediaTarget);
        const file = zip.file(mediaPath);
        if (!file) continue;
        const buf = Buffer.from(await file.async("uint8array"));
        if (buf.length < minBytes) continue;
        const ext = (mediaPath.split(".").pop() || "png").toLowerCase();
        const row = /<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/.exec(block)?.[1];
        const col = /<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>/.exec(block)?.[1];
        out.push({ buffer: buf, mime: MIME[ext] ?? "image/png", ext, sheetName: name, anchorRow: row != null ? Number(row) + 1 : null, anchorCol: col != null ? Number(col) + 1 : null });
      }
    }
  }
  return out;
}

/** Copy of the workbook with drawing parts removed, for loaders that choke on them. */
export async function stripDrawings(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const path of Object.keys(zip.files)) {
    if (/^xl\/(drawings|media)\//.test(path)) {
      zip.remove(path);
      continue;
    }
    if (path === "[Content_Types].xml") {
      const xml = await zip.file(path)!.async("string");
      zip.file(path, xml.replace(/<Override\b[^>]*\/drawings\/[^>]*\/>/g, ""));
      continue;
    }
    if (/^xl\/worksheets\/_rels\/.*\.rels$/.test(path)) {
      const xml = await zip.file(path)!.async("string");
      zip.file(path, xml.replace(/<Relationship\b[^>]*\/drawing"[^>]*\/>/g, "").replace(/<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*\/>/g, ""));
    } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) {
      const xml = await zip.file(path)!.async("string");
      zip.file(path, xml.replace(/<drawing\b[^>]*\/>/g, "").replace(/<legacyDrawing\b[^>]*\/>/g, ""));
    }
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}
