import JSZip from "jszip";

/** A formula cell's saved result, read straight from the file (the Excel library drops saved zeros). */
export type Cached = { n?: number; s?: string; e?: string };
export type CachedBook = Map<string, Map<string, Cached>>;

const unescapeXml = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** sheet name -> (cell address -> saved result), for cells that carry a formula. Best effort: never throws. */
export async function readCachedValues(buffer: Buffer): Promise<CachedBook> {
  const book: CachedBook = new Map();
  try {
    const zip = await JSZip.loadAsync(buffer);
    const wb = await zip.file("xl/workbook.xml")?.async("string");
    const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
    if (!wb || !rels) return book;
    const target = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
    }
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
      const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
      const path = rid ? target.get(rid) : undefined;
      if (!name || !path) continue;
      const xml = await zip.file(path)?.async("string");
      if (!xml) continue;
      const cells = new Map<string, Cached>();
      for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const body = c[2];
        if (!body || !/<f[\s>/]/.test(body)) continue;
        const addr = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (!addr || v === undefined) continue;
        const t = /\bt="([^"]+)"/.exec(c[1])?.[1];
        if (t === "e") cells.set(addr, { e: unescapeXml(v) });
        else if (t === "str" || t === "s") cells.set(addr, { s: unescapeXml(v) });
        else if (t === "b") cells.set(addr, { n: Number(v) });
        else if (Number.isFinite(Number(v))) cells.set(addr, { n: Number(v) });
      }
      book.set(unescapeXml(name), cells);
    }
  } catch {
    /* fall back to whatever the Excel library gave us */
  }
  return book;
}
