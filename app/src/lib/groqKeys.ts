/**
 * Round-robin pool of Groq API keys. Each key has its own tokens-per-minute budget, so spreading
 * requests across keys multiplies throughput and keeps any single key from hitting its limit.
 *
 *   GROQ_API_KEYS=key1,key2,key3   (comma / space / newline separated)
 *   GROQ_API_KEY=key               (single-key fallback)
 */
type Slot = { key: string; coolUntil: number; dead: boolean };

let slots: Slot[] | null = null;
let cursor = 0;

function pool(): Slot[] {
  if (!slots) {
    const raw = [process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY].filter(Boolean).join(",");
    const keys = [...new Set(raw.split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean))];
    slots = keys.map((key) => ({ key, coolUntil: 0, dead: false }));
    // serverless instances each start at a different key so parallel cold starts don't all hit key #1
    cursor = slots.length ? Math.floor(Math.random() * slots.length) : 0;
  }
  return slots;
}

export function keyCount(): number {
  return pool().length;
}

export const keyLabel = (k: string) => `…${k.slice(-4)}`;

/** Next usable key in rotation. `waitMs` > 0 only when every key is cooling down (then it is the shortest wait). */
export function nextKey(exclude?: string): { key: string; slot: number; waitMs: number } {
  const p = pool();
  if (!p.length) throw new Error("No Groq API key configured (set GROQ_API_KEYS or GROQ_API_KEY)");
  const now = Date.now();
  const live = p.map((s, i) => ({ s, i })).filter(({ s }) => !s.dead);
  const candidates = live.length ? live : p.map((s, i) => ({ s, i }));
  for (let n = 0; n < p.length; n++) {
    const i = (cursor + n) % p.length;
    const c = candidates.find((x) => x.i === i);
    if (c && c.s.coolUntil <= now && c.s.key !== exclude) {
      cursor = (i + 1) % p.length;
      return { key: c.s.key, slot: i, waitMs: 0 };
    }
  }
  // everything is cooling down: take the one that frees up first
  const soonest = [...candidates].sort((a, b) => a.s.coolUntil - b.s.coolUntil)[0];
  cursor = (soonest.i + 1) % p.length;
  return { key: soonest.s.key, slot: soonest.i, waitMs: Math.max(0, soonest.s.coolUntil - now) };
}

export function markLimited(key: string, retryAfterMs: number) {
  const s = pool().find((x) => x.key === key);
  if (s) s.coolUntil = Date.now() + Math.max(500, retryAfterMs);
}

/** A key Groq rejected as invalid: stop using it for this process. */
export function markDead(key: string) {
  const s = pool().find((x) => x.key === key);
  if (s) s.dead = true;
}
