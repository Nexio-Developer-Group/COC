export function formatINR(value: number | null | undefined, currency = "INR"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const symbol = currency === "INR" ? "₹" : currency + " ";
  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
  return `${symbol}${formatted}`;
}

export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
