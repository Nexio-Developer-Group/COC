import { formatINR } from "@/lib/format";

export default function Money({ value, currency = "INR" }: { value: number | null | undefined; currency?: string }) {
  return <span className="tabular-nums">{formatINR(value, currency)}</span>;
}
