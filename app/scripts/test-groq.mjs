import { SYSTEM_PROMPT, buildUserPrompt } from "../src/lib/extract/prompts.ts";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/GROQ_API_KEY=(.*)/)[1].trim();
const model = env.match(/GROQ_MODEL=(.*)/)[1].trim();

const userPrompt = buildUserPrompt({
  role: "tender",
  fileName: "test.xlsx",
  tenderCurrency: "INR",
  documentText: `=== Sheet "Wet Works  (2)" — 5 non-empty rows ===
R1 | A:ITC FORTUNE GUWAHATI
R2 | A:Sr.No | B:Final Intronote | C:Description | D:Unit | E:Quantity | F:Rate | G:Amount
R4 | B:Civil Works
R5 | A:1 | B:Room Flooring | C:Providing and laying 8mm waste tiles. | D:SQMT | E:2127 | F:750`,
});

const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  }),
});
console.log("status:", res.status);
console.log(await res.text());
