import fs from "fs";
import { derivePairs } from "../src/lib/extract/variants";
const d = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const text: string = d.document.rendered_text;
console.log(text.split("\n").filter((l) => l.startsWith("R20 |") || l.startsWith("R19 |")).map((l) => l.slice(0, 40) + " ... " + l.slice(-70)));
console.log("row19", derivePairs(text, 19, 2363));
console.log("row20", derivePairs(text, 20, 586));
