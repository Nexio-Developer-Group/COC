/** Canonical unit codes + conversion between units of the same physical dimension. */

type Dim = "area" | "length" | "volume" | "weight" | "count" | "lump" | "time" | "other";

const UNIT_MAP: Record<string, string> = {
  // area
  sqmt: "sqm", sqm: "sqm", "sq m": "sqm", "sq mt": "sqm", "sq mtr": "sqm", sqmtr: "sqm", "sq meter": "sqm", "sq metre": "sqm", "square meter": "sqm", "square metre": "sqm", m2: "sqm", "m²": "sqm", smt: "sqm",
  sqft: "sqft", sft: "sqft", "sq ft": "sqft", "sq feet": "sqft", "square feet": "sqft", "square foot": "sqft", ft2: "sqft", "ft²": "sqft",
  sqyd: "sqyd", "sq yd": "sqyd", "sq yard": "sqyd",
  // length
  rmt: "rmt", rm: "rmt", mtr: "rmt", mt: "rmt", m: "rmt", meter: "rmt", metre: "rmt", meters: "rmt", metres: "rmt", "running meter": "rmt", "running metre": "rmt", "running mtr": "rmt", "r mt": "rmt", rmtr: "rmt",
  rft: "rft", "running ft": "rft", "running feet": "rft", "running foot": "rft", ft: "rft", feet: "rft", foot: "rft",
  mm: "mm", cm: "cm", inch: "inch", inches: "inch", in: "inch", yard: "yard", yd: "yard",
  // volume
  cum: "cum", m3: "cum", "m³": "cum", "cu m": "cum", "cu mt": "cum", "cubic meter": "cum", "cubic metre": "cum",
  cft: "cft", "cu ft": "cft", "cubic feet": "cft", "cubic foot": "cft", ft3: "cft",
  ltr: "litre", litre: "litre", liter: "litre", litres: "litre", liters: "litre", l: "litre",
  // weight
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
  ton: "tonne", tons: "tonne", tonne: "tonne", tonnes: "tonne", mton: "tonne", "metric ton": "tonne",
  qtl: "quintal", quintal: "quintal",
  // count
  nos: "nos", no: "nos", each: "nos", ea: "nos", pcs: "nos", pc: "nos", piece: "nos", pieces: "nos", unit: "nos", units: "nos", number: "nos", numbers: "nos",
  doz: "dozen", dozen: "dozen", pair: "pair", pairs: "pair",
  // lump
  ls: "ls", "lump sum": "ls", lumpsum: "ls", job: "ls", lot: "ls",
  set: "set", sets: "set",
  // time
  day: "day", days: "day", month: "month", months: "month", hour: "hour", hours: "hour", hr: "hour",
  percent: "%", "%": "%",
};

const DIM: Record<string, Dim> = {
  sqm: "area", sqft: "area", sqyd: "area",
  rmt: "length", rft: "length", mm: "length", cm: "length", inch: "length", yard: "length",
  cum: "volume", cft: "volume", litre: "volume",
  kg: "weight", tonne: "weight", quintal: "weight",
  nos: "count", dozen: "count", pair: "count",
  ls: "lump", set: "lump",
  day: "time", month: "time", hour: "time",
};

/** Size of each unit in the base unit of its dimension (sqm, rmt, cum, kg, nos). */
const TO_BASE: Record<string, number> = {
  sqm: 1, sqft: 0.09290304, sqyd: 0.83612736,
  rmt: 1, rft: 0.3048, mm: 0.001, cm: 0.01, inch: 0.0254, yard: 0.9144,
  cum: 1, cft: 0.028316847, litre: 0.001,
  kg: 1, tonne: 1000, quintal: 100,
  nos: 1, dozen: 12, pair: 2,
  day: 1, month: 30, hour: 1 / 8,
};

export function normalizeUnit(unitRaw: string | null | undefined): string | null {
  if (!unitRaw) return null;
  const key = unitRaw.toLowerCase().trim().replace(/\s+/g, " ");
  const loose = key.replace(/[.\-_/]/g, " ").replace(/\s+/g, " ").trim();
  const stripped = key.replace(/[.\s]/g, "");
  return UNIT_MAP[key] ?? UNIT_MAP[loose] ?? UNIT_MAP[stripped] ?? (stripped || null);
}

export function unitDimension(unit: string | null | undefined): Dim {
  if (!unit) return "other";
  return DIM[unit] ?? "other";
}

export type UnitConversion = { from: string; to: string; factor: number };

/**
 * Factor such that quantity_in_target = quantity_in_source * factor
 * (and rate_in_target = rate_in_source / factor). Null when the units are equal,
 * unknown, or measure different things (e.g. sqm vs nos) — never guess across dimensions.
 */
export function conversionFactor(from: string | null, to: string | null): UnitConversion | null {
  if (!from || !to || from === to) return null;
  const df = unitDimension(from);
  const dt = unitDimension(to);
  if (df !== dt || df === "other" || df === "lump") return null;
  const a = TO_BASE[from];
  const b = TO_BASE[to];
  if (!a || !b) return null;
  return { from, to, factor: a / b };
}

/** True when two units are both known but cannot be converted into each other. */
export function unitsIncompatible(a: string | null, b: string | null): boolean {
  if (!a || !b || a === b) return false;
  return conversionFactor(a, b) === null;
}

export const UNIT_LABEL: Record<string, string> = {
  sqm: "sq.m", sqft: "sq.ft", sqyd: "sq.yd", rmt: "r.m", rft: "r.ft", cum: "cu.m", cft: "cu.ft",
  kg: "kg", tonne: "tonne", quintal: "quintal", nos: "nos", ls: "lump sum", set: "set",
};
