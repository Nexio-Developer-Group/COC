import Money from "@/components/Money";
import { formatQty } from "@/lib/format";
import type { LineItem } from "@/lib/types";

export default function BoqTable({
  sections,
  items,
  currency,
  showMatch,
}: {
  sections: LineItem[];
  items: LineItem[];
  currency: string;
  showMatch?: boolean;
}) {
  const itemsBySection = new Map<string, LineItem[]>();
  for (const item of items) {
    const key = item.parent_id ?? "none";
    if (!itemsBySection.has(key)) itemsBySection.set(key, []);
    itemsBySection.get(key)!.push(item);
  }

  return (
    <div className="bg-white border border-brand-light rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-brand-light text-brand-dark/70 text-left">
          <tr>
            <th className="px-3 py-2 font-medium w-16">Code</th>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium w-20">Unit</th>
            <th className="px-3 py-2 font-medium w-24 text-right">Qty</th>
            <th className="px-3 py-2 font-medium w-28 text-right">Rate</th>
            <th className="px-3 py-2 font-medium w-32 text-right">Amount</th>
            {showMatch && <th className="px-3 py-2 font-medium w-32">Match</th>}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => {
            const sectionItems = itemsBySection.get(section.id) ?? [];
            return (
              <>
                <tr key={section.id} className="bg-brand-accent/10">
                  <td className="px-3 py-2 font-semibold text-brand-accent" colSpan={showMatch ? 7 : 6}>
                    {section.item_code} {section.name ?? "General"}
                  </td>
                </tr>
                {sectionItems.map((item) => (
                  <tr key={item.id} className="border-t border-brand-light align-top">
                    <td className="px-3 py-2 text-brand-dark/50">{item.item_code}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-brand-dark">{item.name}</div>
                      {item.description && <div className="text-xs text-brand-dark/50 mt-0.5 line-clamp-2">{item.description}</div>}
                      {item.remarks && <div className="text-xs text-brand-primary mt-0.5">{item.remarks}</div>}
                      {item.flags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {item.flags.map((f) => (
                            <span key={f} className="text-[10px] bg-brand-light text-brand-dark/70 px-1.5 py-0.5 rounded">
                              {f.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-brand-dark/70">{item.unit ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(item.quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      {item.quote_status === "not_priced" ? <span className="text-brand-dark/40">Not quoted</span> : <Money value={item.rate} currency={currency} />}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {item.quote_status === "not_priced" ? "—" : <Money value={item.amount} currency={currency} />}
                    </td>
                    {showMatch && (
                      <td className="px-3 py-2 text-xs">
                        {item.tender_line_id ? (
                          <span className={item.match_confidence === "low" ? "text-amber-700" : "text-green-700"}>
                            {item.match_confidence} ({item.match_method})
                          </span>
                        ) : (
                          <span className="text-brand-dark/40">extra item</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
