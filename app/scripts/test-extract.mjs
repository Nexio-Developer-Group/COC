import { extractRawText } from "../src/lib/extractRawText.ts";
import fs from "fs";

const file = process.argv[2];
const buf = fs.readFileSync(file);
const result = await extractRawText(buf, file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
console.log("sourceType:", result.sourceType, "truncated:", result.truncated, "length:", result.text.length);
console.log(result.text.slice(2000, 6000));
