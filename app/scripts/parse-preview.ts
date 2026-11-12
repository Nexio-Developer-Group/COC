import fs from "fs";
import { readFile } from "../src/lib/ingest/readFile";
(async () => {
  for (const f of process.argv.slice(2)) {
    const r = await readFile(fs.readFileSync(f), f, "");
    console.log("==", f.split("/").pop()?.slice(0, 50));
    for (const s of r.sheets) {
      const p = s.parsed;
      if (!p) { console.log(` ${s.name}: NOT a classic BOQ -> AI path`); continue; }
      const v = p.preview;
      console.log(` ${s.name}: header row ${v.headerRow} cols ${Object.entries(v.columns).map(([k, c]) => `${k}=${c!.col}`).join(" ")}`);
      console.log(`   items ${v.counts.items} (priced ${v.counts.priced}, unpriced ${v.counts.unpriced}, extra lines ${v.counts.continuation}) | notes ${v.counts.notes} | subtotals ${v.counts.subtotals} | skipped ${v.counts.skipped} ${v.skippedRows.slice(0, 8)}`);
      console.log(`   itemsTotal ${Math.round(v.itemsTotal * 100) / 100} | printed grand ${JSON.stringify(v.printedGrandTotal)} | tax ${v.taxNote}`);
      console.log("   sections:", v.sections.map((x) => `${x.name}(${x.items}, items ${Math.round(x.itemTotal)} vs printed ${x.printedTotal == null ? "-" : Math.round(x.printedTotal)})`).join("; "));
    }
  }
})();
