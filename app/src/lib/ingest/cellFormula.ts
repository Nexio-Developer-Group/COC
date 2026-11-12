/**
 * Tiny, deliberately narrow formula evaluator used to re-check a workbook's own cached results.
 * Supports numbers, same-sheet cell references, + - * /, parentheses and SUM(range). Anything else throws
 * UnsupportedFormula, which callers report as "could not be verified" — never as a guessed number.
 */
export class UnsupportedFormula extends Error {}

const colNum = (c: string) => c.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => { let s = ""; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

/** `get` returns the cell's numeric value, or null when the cell is blank / not a number. */
export function evaluateCellFormula(formula: string, get: (address: string) => number | null): number {
  const s = formula.replace(/^=/, "").trim();
  let i = 0;
  const ws = () => { while (s[i] === " ") i++; };
  const rest = () => s.slice(i);

  function expr(): number {
    let v = term();
    ws();
    while (s[i] === "+" || s[i] === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; ws(); }
    return v;
  }
  function term(): number {
    let v = factor();
    ws();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++]; const r = factor();
      if (op === "/") { if (r === 0) throw new UnsupportedFormula("division by zero"); v /= r; } else v *= r;
      ws();
    }
    return v;
  }
  function factor(): number {
    ws();
    const c = s[i];
    if (c === "-") { i++; return -factor(); }
    if (c === "+") { i++; return factor(); }
    if (c === "(") { i++; const v = expr(); ws(); if (s[i] !== ")") throw new UnsupportedFormula("unbalanced parentheses"); i++; return v; }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?%?/.exec(rest());
    if (num) { i += num[0].length; return num[0].endsWith("%") ? Number(num[0].slice(0, -1)) / 100 : Number(num[0]); }
    const sum = /^SUM\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)/i.exec(rest());
    if (sum) {
      i += sum[0].length;
      const [c1, c2] = [colNum(sum[1]), colNum(sum[3])].sort((a, b) => a - b);
      const [r1, r2] = [Number(sum[2]), Number(sum[4])].sort((a, b) => a - b);
      if ((c2 - c1 + 1) * (r2 - r1 + 1) > 5000) throw new UnsupportedFormula("range too large");
      let total = 0;
      for (let r = r1; r <= r2; r++) for (let cc = c1; cc <= c2; cc++) total += get(`${colName(cc)}${r}`) ?? 0; // SUM ignores blanks and text, like Excel
      return total;
    }
    const ref = /^\$?([A-Z]{1,3})\$?(\d+)(?![\d(!A-Za-z])/i.exec(rest());
    if (ref) {
      i += ref[0].length;
      const v = get(`${ref[1].toUpperCase()}${ref[2]}`);
      if (v === null) throw new UnsupportedFormula(`${ref[1]}${ref[2]} is blank or not a number`);
      return v;
    }
    throw new UnsupportedFormula(`unsupported near "${rest().slice(0, 14)}"`);
  }

  const v = expr();
  ws();
  if (i !== s.length) throw new UnsupportedFormula(`unsupported near "${rest().slice(0, 14)}"`);
  return v;
}
