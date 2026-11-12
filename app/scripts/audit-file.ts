import fs from "fs";
import { readFile } from "../src/lib/ingest/readFile";
(async () => {
  for (const f of process.argv.slice(2)) {
    const r = await readFile(fs.readFileSync(f), f, "");
    console.log("==", f.split("/").pop()?.slice(0, 60));
    for (const s of r.sheets) {
      const a = s.audit;
      if (!a) continue;
      console.log(` ${s.name}: formulas ${a.formulaCount} | mismatches ${a.mismatches.length} | unverified ${a.unverified.length} | uncached ${a.uncached.length} | errors ${a.errors.length}`);
      for (const m of a.mismatches.slice(0, 3)) console.log("   mismatch", m.a, m.f, m.cached, "->", m.recalc);
      for (const u of a.unverified.slice(0, 3)) console.log("   unverified", u.a, u.f, "|", u.why);
      for (const e of a.errors.slice(0, 3)) console.log("   error", e.a, e.text);
    }
  }
})();
