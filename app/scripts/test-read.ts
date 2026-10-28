import fs from "fs";
import { readFile, chunkSheet } from "../src/lib/ingest/readFile";
(async () => {
  const f = process.argv[2];
  const r = await readFile(fs.readFileSync(f), f, "");
  console.log("type", r.sourceType, "sheets", r.sheets.map((s) => `${s.name}:${s.rowCount}rows/${s.imageCount}img`), "images", r.images.map((i) => `${i.sheetName}@r${i.anchorRow} ${i.buffer.length}B`));
  for (const s of r.sheets) console.log(`--- ${s.name} (${chunkSheet(s).length} chunk)\n${s.text.slice(0, 500)}`);
})();
