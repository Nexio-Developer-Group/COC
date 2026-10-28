const UNIT_MAP: Record<string, string> = {
  sqmt: "sqm", sqm: "sqm", "sq.m": "sqm", m2: "sqm", "sq mtr": "sqm", sqmtr: "sqm",
  sqft: "sqft", sft: "sqft", "sq.ft": "sqft", ft2: "sqft",
  rmt: "rmt", rm: "rmt", mtr: "rmt", m: "rmt", meter: "rmt", metre: "rmt", meters: "rmt", "running meter": "rmt", "running mtr": "rmt",
  rft: "rft", "running ft": "rft",
  nos: "nos", no: "nos", "no.": "nos", each: "nos", ea: "nos", pcs: "nos", unit: "nos", units: "nos",
  cum: "cum", m3: "cum", "cu.m": "cum",
  kg: "kg", kgs: "kg",
  ls: "ls", "lump sum": "ls", lumpsum: "ls", job: "ls",
  set: "set", sets: "set",
};

export function normalizeUnit(unitRaw: string | null | undefined): string | null {
  if (!unitRaw) return null;
  const key = unitRaw.toLowerCase().trim().replace(/[.\s]+/g, (m) => (m === "." ? "." : " ")).trim();
  const stripped = key.replace(/\./g, "").trim();
  return UNIT_MAP[key] ?? UNIT_MAP[stripped] ?? stripped;
}
