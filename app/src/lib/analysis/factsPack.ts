import type { Comparison } from "@/lib/compare";
import { formatQty } from "@/lib/format";

export type FactsPack = {
  text: string;
  bidRefs: Record<string, string>; // B1 -> documentId
  reductions: string[];
};

export function buildFactsPack(comparison: Comparison, requestText: string): FactsPack {
  const sortedBids = [...comparison.bids].sort((a, b) => (a.partyName ?? "").localeCompare(b.partyName ?? ""));
  const bidRefs: Record<string, string> = {};
  sortedBids.forEach((b, i) => {
    bidRefs[`B${i + 1}`] = b.documentId;
  });
  const refByDoc = new Map(Object.entries(bidRefs).map(([ref, doc]) => [doc, ref]));

  const reductions: string[] = [];
  const lower = requestText.toLowerCase();
  const sectionFocus = comparison.sections.filter((s) => s.name && lower.includes(s.name.toLowerCase()));
  const itemsInScope = sectionFocus.length
    ? comparison.items.filter((i) => sectionFocus.some((s) => s.name === i.sectionName))
    : comparison.items;
  if (sectionFocus.length) reductions.push(`filtered to sections: ${sectionFocus.map((s) => s.name).join(", ")}`);

  const lines: string[] = [];
  lines.push(
    `TENDER: ${comparison.tenderTitle} | currency ${comparison.currency} | ${comparison.items.length} items in ${comparison.sections.length} sections | ${comparison.bids.length} active bids`
  );
  lines.push("");
  lines.push("BIDS");
  lines.push("ref | contractor | stated_total | like_for_like_total | computed_total | extras_total | not_priced | missing | issues | rank");
  for (const b of sortedBids) {
    const ref = refByDoc.get(b.documentId)!;
    lines.push(
      `${ref} | ${b.partyName ?? "Unknown"} | ${b.statedTotal ?? "—"} | ${b.likeForLikeTotal} | ${b.computedTotal} | ${b.extrasTotal} | ${b.notPricedCount} | ${b.missingCount} | ${b.issueCount} | L${b.rank}`
    );
  }
  lines.push("");
  lines.push('TENDER ITEMS (rate per unit by bid; "—" = not priced, "x" = missing)');
  const header = ["code", "section", "name", "unit", "qty", "min", "median", "max", ...sortedBids.map((b) => refByDoc.get(b.documentId)!)];
  lines.push(header.join(" | "));
  for (const item of itemsInScope) {
    const cells = sortedBids.map((b) => {
      const cell = item.cells[b.documentId];
      if (!cell) return "x";
      if (cell.status === "missing") return "x";
      if (cell.status === "not_priced") return "—";
      if (cell.status === "included") return "incl";
      if (cell.status === "excluded") return "excl";
      let v = cell.rate != null ? String(cell.rate) : "—";
      if (cell.flags.includes("MATERIAL_BY_CLIENT")) v += "c";
      if (cell.flags.includes("LABOUR_ONLY")) v += "l";
      return v;
    });
    lines.push(
      [
        item.itemCode,
        item.sectionName ?? "",
        item.name ?? "",
        item.unit ?? "",
        formatQty(item.quantity),
        item.minRate ?? "—",
        item.medianRate ?? "—",
        item.maxRate ?? "—",
        ...cells,
      ].join(" | ")
    );
  }

  if (comparison.extraItems.length > 0) {
    lines.push("");
    lines.push("EXTRA ITEMS OFFERED (not in tender)");
    lines.push("bid | name | unit | qty | rate | amount");
    for (const e of comparison.extraItems.slice(0, 30)) {
      const ref = refByDoc.get(e.documentId) ?? "?";
      lines.push(`${ref} | ${e.name ?? ""} | ${e.unit ?? ""} | ${e.quantity ?? ""} | ${e.rate ?? ""} | ${e.amount ?? ""}`);
    }
  }

  let text = lines.join("\n");
  const approxTokens = Math.ceil(text.length / 3.5);
  if (approxTokens > 20000) {
    // Drop to section totals only as a last resort.
    reductions.push("line-level rates omitted; analysis is at section level due to size");
    const sectionLines = ["SECTION TOTALS", "section | " + sortedBids.map((b) => refByDoc.get(b.documentId)).join(" | ")];
    for (const s of comparison.sections) {
      const totals = sortedBids.map((b) => {
        let sum = 0;
        for (const it of comparison.items.filter((i) => i.sectionName === s.name)) {
          const c = it.cells[b.documentId];
          if (c?.amount) sum += c.amount;
        }
        return sum;
      });
      sectionLines.push(`${s.name ?? "General"} | ${totals.join(" | ")}`);
    }
    text = [lines[0], "", "BIDS", lines.slice(2, 2 + sortedBids.length + 1).join("\n"), "", ...sectionLines].join("\n");
  }

  return { text, bidRefs, reductions };
}
