/**
 * A tiny, safe spreadsheet-style formula engine for BOQ rows.
 *
 * Expressions reference cells of the SAME row by field name (quantity, rate, amount)
 * or of ANOTHER row by item code:   [1.8].amount   or   [2.1].rate
 * Supported: + - * / ( ) numbers, SUM([1.1].amount, [1.2].amount), MIN, MAX, ROUND(x, n).
 *
 * Nothing here uses eval(); the expression is tokenised, parsed to an AST and evaluated.
 */

export type NumericField = "quantity" | "rate" | "amount";
export const NUMERIC_FIELDS: NumericField[] = ["quantity", "rate", "amount"];

export type CellRef = { row: string | null; field: NumericField }; // row=null => same row

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; row: string | null; field: NumericField }
  | { t: "fn"; name: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" | "," };

export type Ast =
  | { k: "num"; v: number }
  | { k: "ref"; row: string | null; field: NumericField }
  | { k: "neg"; e: Ast }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; l: Ast; r: Ast }
  | { k: "call"; name: string; args: Ast[] };

const FIELD_ALIASES: Record<string, NumericField> = {
  qty: "quantity",
  quantity: "quantity",
  rate: "rate",
  amount: "amount",
  amt: "amount",
  total: "amount",
};

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "×") {
      out.push({ t: "op", v: "*" });
      i++;
      continue;
    }
    if (c === "÷") {
      out.push({ t: "op", v: "/" });
      i++;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      out.push({ t: "op", v: c as "+" });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (Number.isNaN(v)) throw new FormulaError(`Bad number "${src.slice(i, j)}"`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === "[") {
      const end = src.indexOf("]", i);
      if (end < 0) throw new FormulaError("Missing ] in row reference");
      const row = src.slice(i + 1, end).trim();
      i = end + 1;
      if (src[i] !== ".") throw new FormulaError(`Reference [${row}] must be followed by .quantity, .rate or .amount`);
      i++;
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const f = FIELD_ALIASES[src.slice(i, j).toLowerCase()];
      if (!f) throw new FormulaError(`Unknown field "${src.slice(i, j)}" — use quantity, rate or amount`);
      out.push({ t: "ref", row, field: f });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_]/.test(src[j])) j++;
      const word = src.slice(i, j).toLowerCase();
      i = j;
      if (src[i] === "(") {
        out.push({ t: "fn", name: word.toUpperCase() });
        continue;
      }
      const f = FIELD_ALIASES[word];
      if (!f) throw new FormulaError(`Unknown name "${word}" — use quantity, rate, amount or [row].field`);
      out.push({ t: "ref", row: null, field: f });
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}"`);
  }
  return out;
}

export function parseFormula(src: string): Ast {
  const tokens = tokenize(src.replace(/^\s*=/, ""));
  let p = 0;
  const peek = () => tokens[p];
  const eatOp = (v: string) => {
    const t = tokens[p];
    if (t && t.t === "op" && t.v === v) {
      p++;
      return true;
    }
    return false;
  };

  function parseExpr(): Ast {
    let left = parseTerm();
    for (;;) {
      if (eatOp("+")) left = { k: "bin", op: "+", l: left, r: parseTerm() };
      else if (eatOp("-")) left = { k: "bin", op: "-", l: left, r: parseTerm() };
      else return left;
    }
  }
  function parseTerm(): Ast {
    let left = parseUnary();
    for (;;) {
      if (eatOp("*")) left = { k: "bin", op: "*", l: left, r: parseUnary() };
      else if (eatOp("/")) left = { k: "bin", op: "/", l: left, r: parseUnary() };
      else return left;
    }
  }
  function parseUnary(): Ast {
    if (eatOp("-")) return { k: "neg", e: parseUnary() };
    if (eatOp("+")) return parseUnary();
    return parseAtom();
  }
  function parseAtom(): Ast {
    const t = peek();
    if (!t) throw new FormulaError("Formula ended unexpectedly");
    if (t.t === "num") {
      p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "ref") {
      p++;
      return { k: "ref", row: t.row, field: t.field };
    }
    if (t.t === "fn") {
      p++;
      if (!eatOp("(")) throw new FormulaError(`Expected ( after ${t.name}`);
      const args: Ast[] = [];
      if (!eatOp(")")) {
        do args.push(parseExpr());
        while (eatOp(","));
        if (!eatOp(")")) throw new FormulaError("Missing ) in function call");
      }
      if (!["SUM", "MIN", "MAX", "ROUND", "ABS"].includes(t.name)) throw new FormulaError(`Unknown function ${t.name}`);
      return { k: "call", name: t.name, args };
    }
    if (t.t === "op" && t.v === "(") {
      p++;
      const e = parseExpr();
      if (!eatOp(")")) throw new FormulaError("Missing )");
      return e;
    }
    throw new FormulaError("Unexpected token in formula");
  }

  const ast = parseExpr();
  if (p < tokens.length) throw new FormulaError("Unexpected extra input at end of formula");
  return ast;
}

/** All cell references in a formula; same-row refs have row === null. */
export function collectRefs(ast: Ast): CellRef[] {
  const refs: CellRef[] = [];
  const walk = (a: Ast) => {
    if (a.k === "ref") refs.push({ row: a.row, field: a.field });
    else if (a.k === "neg") walk(a.e);
    else if (a.k === "bin") {
      walk(a.l);
      walk(a.r);
    } else if (a.k === "call") a.args.forEach(walk);
  };
  walk(ast);
  return refs;
}

export type RowValues = Partial<Record<NumericField, number | null>>;

/** Evaluates against resolver(rowCode|null, field). Returns null if any referenced cell is empty. */
export function evaluate(ast: Ast, resolve: (row: string | null, field: NumericField) => number | null): number | null {
  const ev = (a: Ast): number | null => {
    switch (a.k) {
      case "num":
        return a.v;
      case "ref":
        return resolve(a.row, a.field);
      case "neg": {
        const v = ev(a.e);
        return v == null ? null : -v;
      }
      case "bin": {
        const l = ev(a.l);
        const r = ev(a.r);
        if (l == null || r == null) return null;
        if (a.op === "+") return l + r;
        if (a.op === "-") return l - r;
        if (a.op === "*") return l * r;
        if (r === 0) return null;
        return l / r;
      }
      case "call": {
        const vals = a.args.map(ev);
        if (a.name === "SUM") return vals.reduce<number>((s, v) => s + (v ?? 0), 0);
        if (vals.some((v) => v == null)) return null;
        const nums = vals as number[];
        if (a.name === "MIN") return Math.min(...nums);
        if (a.name === "MAX") return Math.max(...nums);
        if (a.name === "ABS") return Math.abs(nums[0]);
        if (a.name === "ROUND") return Math.round(nums[0] * 10 ** (nums[1] ?? 0)) / 10 ** (nums[1] ?? 0);
        return null;
      }
    }
  };
  const v = ev(ast);
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000;
}

const FIELD_LABEL: Record<NumericField, string> = { quantity: "Quantity", rate: "Rate", amount: "Amount" };

/** Human-readable rendering: "Quantity (this row) × Rate (this row)". */
export function describeFormula(src: string, thisCode?: string): string {
  try {
    const tokens = tokenize(src.replace(/^\s*=/, ""));
    return tokens
      .map((t) => {
        if (t.t === "num") return String(t.v);
        if (t.t === "fn") return t.name;
        if (t.t === "ref") return t.row ? `${FIELD_LABEL[t.field]} of row ${t.row}` : `${FIELD_LABEL[t.field]}${thisCode ? ` of row ${thisCode}` : " (this row)"}`;
        return t.v === "*" ? "×" : t.v === "/" ? "÷" : t.v;
      })
      .join(" ")
      .replace(/\s+,/g, ",")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
  } catch {
    return src;
  }
}

/** Validates syntax + that the formula never references its own target cell in a cycle (same row only). */
export function validateFormula(src: string, target: NumericField, selfCode?: string): { ok: true; refs: CellRef[] } | { ok: false; error: string } {
  try {
    const ast = parseFormula(src);
    const refs = collectRefs(ast);
    if (refs.some((r) => (r.row === null || (selfCode && r.row === selfCode)) && r.field === target)) {
      return { ok: false, error: `A formula for ${FIELD_LABEL[target]} can't use ${FIELD_LABEL[target]} of the same row (circular).` };
    }
    return { ok: true, refs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const DEFAULT_RULES: Record<NumericField, string[]> = {
  amount: ["quantity * rate"],
  rate: ["amount / quantity"],
  quantity: ["amount / rate"],
};
