import { matchAll, type MatchCandidate } from "../src/lib/match";
const T = (id: string, code: string, ref: string, name: string, unit: string, qty: number, sec: string): MatchCandidate => ({ id, item_code: code, source_ref: ref, name, unit, quantity: qty, section_name: sec });
const tenders = [
  T("a", "1.1", "1", "Room Flooring", "sqm", 2127, "Civil Works"), T("b", "1.3", "3", "SPC Skirting", "rmt", 1654, "Civil Works"),
  T("c", "1.4", "4", "Toilet Flooring", "sqm", 1154, "Civil Works"), T("d", "1.8", "8", "Room Flooring", "sqm", 237, "Civil Works"),
  T("e", "1.9", "9", "Shower Ledge", "rmt", 189, "Civil Works"), T("f", "2.1", "1", "Room GYPSUM Ceiling", "sqm", 2363, "Gypsum & POP Punning and Paint work"),
];
const bids = [
  { key: "0", source_ref: "1", name: "Room Flooring", unit: "SQFT", quantity: 22893, section_name: "Civil Works", hint: "1.1" },
  { key: "1", source_ref: "3", name: "Toilet Flooring", unit: "SQFT", quantity: 12421, section_name: "Civil Works", hint: "1.4" },
  { key: "2", source_ref: "5", name: "Shower Ledge", unit: "RMT", quantity: 189, section_name: "Civil Works", hint: "1.3" }, // wrong hint
  { key: "3", source_ref: "8", name: "Room Flooring", unit: "SQMT", quantity: 237, section_name: "Civil Works", hint: null }, // duplicate name, qty decides
  { key: "4", source_ref: "1", name: "Room GYPSUM Ceiling", unit: "SQMT", quantity: 2363, section_name: "Gypsum & POP Punning and Paint work", hint: "1.1" }, // wrong hint
  { key: "5", source_ref: "1", name: "Marble polish", unit: "SQMT", quantity: 50, section_name: "Extras", hint: null },
];
const r = matchAll(bids, tenders);
const code = (k: string) => tenders.find((t) => t.id === r.get(k)?.tender_line_id)?.item_code ?? null;
const got = bids.map((b) => code(b.key));
const want = ["1.1", "1.4", "1.9", "1.8", "2.1", null];
console.log(JSON.stringify(got) === JSON.stringify(want) ? "MATCH OK" : `MATCH FAIL got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
for (const b of bids) console.log(b.name, "->", code(b.key), r.get(b.key)?.match_confidence, "|", r.get(b.key)?.match_note);
