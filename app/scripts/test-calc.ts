import { parseFormula, evaluate, validateFormula, describeFormula } from "../src/lib/formula";
import { recompute, previewFormula, applyUnitConversion, checkPlausibility } from "../src/lib/calc";
import { conversionFactor, normalizeUnit } from "../src/lib/units";
import type { LineItem } from "../src/lib/types";

const mk = (o: Partial<LineItem>): LineItem => ({ id: o.item_code!, document_id: "d", parent_id: null, kind: "item", position: 1, item_code: "1.1", source_ref: null, name: "x", description: null, trade: null, unit_raw: "sqft", unit: "sqft", quantity: null, rate: null, amount: null, prices: [], quote_status: "priced", flags: [], remarks: null, attributes: {}, extraction_confidence: "high", cell_meta: {}, anomalies: [], converted: null, sheet_name: null, source_row: null, edited_at: null, tender_line_id: null, match_method: null, match_confidence: null, match_note: null, ...o }) as LineItem;
let fails = 0;
const eq = (a: unknown, b: unknown, m: string) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fails++; console.log("FAIL", m, a, b); } else console.log("ok  ", m); };

eq(evaluate(parseFormula("quantity * rate"), (_r, f) => ({ quantity: 4, rate: 2.5, amount: 0 } as any)[f]), 10, "qty*rate");
eq(evaluate(parseFormula("[1.1].amount + [1.2].amount * 2"), (r, f) => r === "1.1" ? 10 : r === "1.2" ? 3 : 0), 16, "cross-row");
eq(evaluate(parseFormula("SUM([1.1].amount,[1.2].amount)"), (r) => r === "1.1" ? 10 : null), 10, "sum ignores empty");
eq(evaluate(parseFormula("amount / quantity"), (_r, f) => f === "quantity" ? 0 : 5), null, "div zero -> null");
eq(validateFormula("amount * 2", "amount").ok, false, "circular same-row");
eq(describeFormula("quantity * rate"), "Quantity (this row) × Rate (this row)", "describe");

// autofill: missing amount from qty*rate, missing rate from amount/qty
const a = mk({ item_code: "1.1", quantity: 10, rate: 5, amount: null });
const b = mk({ item_code: "1.2", quantity: 4, rate: null, amount: 100 });
const c = mk({ item_code: "1.3", quantity: 4, rate: 5, amount: 99, cell_meta: {} }); // document value must be kept
const ch = recompute([a, b, c], null);
eq([a.amount, b.rate, c.amount], [50, 25, 99], "autofill values, doc value kept");
eq([a.cell_meta.amount?.src, b.cell_meta.rate?.src, c.cell_meta.amount?.src], ["autofill", "autofill", undefined], "provenance");
// change qty -> autofilled amount follows, doc amount does not
a.quantity = 20; recompute([a, b, c], null);
eq(a.amount, 100, "autofilled amount follows qty edit");
// preview conflict: applying qty*rate to c (doc amount 99 vs 20) is a conflict
const pv = previewFormula([a, b, c], "amount", "quantity * rate");
if (pv.ok) eq(pv.rows.map((r) => [r.itemCode, r.conflict, r.unchanged]), [["1.1", false, true], ["1.2", false, true], ["1.3", true, false]], "preview conflicts");
// units
eq(conversionFactor("sqft", "sqm")?.factor.toFixed(6), "0.092903", "sqft->sqm");
eq(conversionFactor("sqm", "nos"), null, "no cross-dimension");
eq(normalizeUnit("Sq. Ft."), "sqft", "norm sq ft");
const bid = mk({ item_code: "2.1", quantity: 1000, rate: 100, amount: 100000, unit: "sqft", unit_raw: "sqft" });
applyUnitConversion(bid, { unit: "sqm", unit_raw: "SQMT" });
eq([bid.unit, bid.quantity, bid.rate, bid.amount], ["sqm", 92.90304, 1076.391042, 100000], "conversion keeps amount");
const an = checkPlausibility(mk({ item_code: "3", quantity: 10, rate: 90000, amount: 900000, unit: "sqm" }), { role: "bid", medianRate: 1000, tenderLine: { quantity: 10, rate: null, unit: "sqm" } });
eq(an.map((x) => x.code), ["rate_outlier_high"], "outlier");
// --- regressions from review ---
import { CircularFormulaError, revertUnitConversion } from "../src/lib/calc";
eq(validateFormula("[1.2].amount * 2", "amount", "1.2").ok, false, "self row code is circular");
const loopA = mk({ item_code: "9.1", quantity: 1, rate: 1, amount: 10, cell_meta: { amount: { src: "manual", formula: "[9.2].amount * 2" } } });
const loopB = mk({ item_code: "9.2", quantity: 1, rate: 1, amount: 5, cell_meta: { amount: { src: "manual", formula: "[9.1].amount + 1" } } });
let threw = false;
try { recompute([loopA, loopB], null); } catch (e) { threw = e instanceof CircularFormulaError; }
eq([threw, loopA.amount, loopB.amount], [true, 10, 5], "cycle throws and leaves values untouched");
const multi = mk({ item_code: "8.1", quantity: 1000, rate: 10, amount: 10000, unit: "sqft", unit_raw: "sqft", prices: [{ variant: "v1", rate: 10, amount: 10000 }, { variant: "v2", rate: 12, amount: 12000 }] });
applyUnitConversion(multi, { unit: "sqm", unit_raw: "sqm" });
eq(multi.prices.map((p) => p.rate), [107.639104, 129.166925], "all price options converted");
revertUnitConversion(multi);
eq([multi.unit, multi.quantity, multi.rate, multi.prices.map((p) => p.rate), multi.converted], ["sqft", 1000, 10, [10, 12], null], "revert restores everything");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
