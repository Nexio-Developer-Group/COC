import Link from "next/link";
import Money from "@/components/Money";
import { formatQty } from "@/lib/format";
import type { Comparison } from "@/lib/compare";

function cellClass(status: string, isMin: boolean, isMax: boolean): string {
  if (status === "missing") return "text-brand-dark/30";
  if (status === "not_priced") return "text-brand-dark/40 italic";
  if (isMin) return "bg-green-50 text-green-800 font-medium";
  if (isMax) return "bg-orange-50 text-orange-800";
  return "";
}

export default function ComparisonGrid({ comparison, tenderId }: { comparison: Comparison; tenderId: string }) {
  const bids = [...comparison.bids].sort((a, b) => a.rank - b.rank);

  return (
    <div className="bg-white border border-brand-light rounded-lg overflow-x-auto">
      <table className="text-sm min-w-full">
        <thead className="bg-brand-light text-brand-dark/70 text-left">
          <tr>
            <th className="px-3 py-2 font-medium sticky left-0 bg-brand-light z-10 w-16">Code</th>
            <th className="px-3 py-2 font-medium sticky left-16 bg-brand-light z-10 min-w-[220px]">Item</th>
            <th className="px-3 py-2 font-medium w-20">Unit</th>
            <th className="px-3 py-2 font-medium w-20 text-right">Qty</th>
            {bids.map((b) => (
              <th key={b.documentId} className="px-3 py-2 font-medium text-right min-w-[130px]">
                <Link href={`/tenders/${tenderId}/bids/${b.documentId}`} className="hover:underline">
                  {b.partyName ?? "Unknown"}
                </Link>
                <div className="text-[10px] font-normal text-brand-dark/50">L{b.rank}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.items.map((item) => (
            <tr key={item.tenderLineId} className="border-t border-brand-light">
              <td className="px-3 py-2 text-brand-dark/50 sticky left-0 bg-white">{item.itemCode}</td>
              <td className="px-3 py-2 sticky left-16 bg-white">{item.name}</td>
              <td className="px-3 py-2 text-brand-dark/70">{item.unit ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(item.quantity)}</td>
              {bids.map((b) => {
                const cell = item.cells[b.documentId];
                const isMin = cell?.status === "priced" && cell.rate === item.minRate && item.minRate !== item.maxRate;
                const isMax = cell?.status === "priced" && cell.rate === item.maxRate && item.minRate !== item.maxRate;
                return (
                  <td key={b.documentId} className={`px-3 py-2 text-right ${cellClass(cell?.status ?? "missing", isMin, isMax)}`}>
                    {cell?.status === "missing" && "×"}
                    {cell?.status === "not_priced" && "Not quoted"}
                    {cell?.status === "included" && "Included"}
                    {cell?.status === "excluded" && "Excluded"}
                    {cell?.status === "priced" && <Money value={cell.rate} currency={comparison.currency} />}
                    {cell?.flags.includes("MATERIAL_BY_CLIENT") && <span title="Material by client" className="ml-1">🏷</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-brand-dark/20 bg-brand-light-dull font-medium">
            <td className="px-3 py-2 sticky left-0 bg-brand-light-dull" colSpan={4}>
              Like-for-like total
            </td>
            {bids.map((b) => (
              <td key={b.documentId} className="px-3 py-2 text-right">
                <Money value={b.likeForLikeTotal} currency={comparison.currency} />
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-3 py-2 sticky left-0 bg-white text-brand-dark/60" colSpan={4}>
              Stated total (as printed)
            </td>
            {bids.map((b) => (
              <td key={b.documentId} className="px-3 py-2 text-right text-brand-dark/60">
                <Money value={b.statedTotal} currency={comparison.currency} />
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-3 py-2 sticky left-0 bg-white text-brand-dark/60" colSpan={4}>
              Rank
            </td>
            {bids.map((b) => (
              <td key={b.documentId} className="px-3 py-2 text-right text-brand-dark/60">
                L{b.rank}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
