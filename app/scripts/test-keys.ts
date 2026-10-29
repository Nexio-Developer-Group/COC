import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
import fs from "fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
(async () => {
  const { groqJsonCompletion } = await import("../src/lib/groq");
  const { keyCount } = await import("../src/lib/groqKeys");
  console.log("keys in pool:", keyCount());
  const calls = Array.from({ length: 8 }, (_, i) => groqJsonCompletion<{ n: number }>([{ role: "user", content: `Return JSON {"n": ${i}}` }], { maxCompletionTokens: 200, reasoningEffort: "low" }));
  const res = await Promise.all(calls);
  const used = res.map((r) => r.meta.keyUsed);
  console.log("keys used per call:", used.join(" "));
  const counts = used.reduce<Record<string, number>>((a, k) => ((a[k!] = (a[k!] ?? 0) + 1), a), {});
  console.log("distribution:", JSON.stringify(counts));
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
