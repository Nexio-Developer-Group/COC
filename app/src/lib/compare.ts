import { db } from "@/lib/db";
import type { Document, LineItem } from "@/lib/types";

export type ComparisonCell = {
  status: "priced" | "not_priced" | "missing" | "included" | "excluded";
  rate: number | null;
  amount: number | null;
  flags: string[];
  remarks: string | null;
  matchConfidence: string | null;
  lineId?: string;
  /** strongest non-document provenance on the rate/amount: autofill, converted or manual */
  src?: "document" | "autofill" | "converted" | "manual";
  anomalies?: string[];
  converted?: string | null;
  images?: number;
  qtyMismatch?: boolean;
};

export type ComparisonItemRow = {
  tenderLineId: string;
  itemCode: string;
  sourceRef: string | null;
  name: string | null;
  unit: string | null;
  quantity: number | null;
  /** the requirement's own rate / amount — the reference every bid is measured against */
  tenderRate: number | null;
  tenderAmount: number | null;
  sheetName: string | null;
  sectionName: string | null;
  minRate: number | null;
  maxRate: number | null;
  medianRate: number | null;
  cells: Record<string, ComparisonCell>; // keyed by bid document id
};

export type ComparisonBidSummary = {
  documentId: string;
  partyName: string | null;
  statedTotal: number | null;
  computedTotal: number;
  likeForLikeTotal: number;
  /** how many BOQ items every bid priced (the basis of likeForLikeTotal) */
  likeForLikeItems: number;
  /** this bid's total over every item it priced, whatever the others did */
  pricedTotal: number;
  extrasTotal: number;
  notPricedCount: number;
  missingCount: number;
  issueCount: number;
  taxBasis: string | null;
  taxRatePercent: number | null;
  versionNo: number;
  status: string;
  imageCount: number;
  terms: { category: string; text: string; value: string | null }[];
  rank: number;
};

export type Comparison = {
  tenderId: string;
  tenderTitle: string;
  currency: string;
  sections: { name: string | null; itemCodes: string[] }[];
  items: ComparisonItemRow[];
  bids: ComparisonBidSummary[];
  extraItems: { documentId: string; partyName: string | null; name: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null }[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function buildComparison(tenderId: string): Promise<Comparison | null> {
  const { data: tender } = await db.from("tenders").select("*").eq("id", tenderId).single();
  if (!tender || !tender.requirements_doc_id) return null;

  const { data: tenderDoc } = await db.from("documents").select("*").eq("id", tender.requirements_doc_id).single<Document>();
  const { data: bidDocs } = await db
    .from("documents")
    .select("*")
    .eq("tender_id", tenderId)
    .eq("role", "bid")
    .is("superseded_at", null)
    .in("status", ["ready", "needs_review"])
    .order("created_at")
    .returns<Document[]>();

  const { data: tenderSections } = await db
    .from("line_items")
    .select("*")
    .eq("document_id", tender.requirements_doc_id)
    .eq("kind", "section")
    .order("position")
    .returns<LineItem[]>();
  const { data: tenderItems } = await db
    .from("line_items")
    .select("*")
    .eq("document_id", tender.requirements_doc_id)
    .eq("kind", "item")
    .order("position")
    .returns<LineItem[]>();

  const sectionsById = new Map((tenderSections ?? []).map((s) => [s.id, s]));

  const items: ComparisonItemRow[] = (tenderItems ?? []).map((t) => ({
    tenderLineId: t.id,
    itemCode: t.item_code,
    sourceRef: t.source_ref,
    name: t.name,
    unit: t.unit,
    quantity: t.quantity,
    tenderRate: t.rate == null ? null : Number(t.rate),
    tenderAmount: t.amount != null ? Number(t.amount) : t.rate != null && t.quantity != null ? Number(t.rate) * Number(t.quantity) : null,
    sheetName: t.sheet_name,
    sectionName: t.parent_id ? sectionsById.get(t.parent_id)?.name ?? null : null,
    minRate: null,
    maxRate: null,
    medianRate: null,
    cells: {},
  }));
  const itemByTenderLineId = new Map(items.map((i) => [i.tenderLineId, i]));

  const bids: ComparisonBidSummary[] = [];
  const extraItems: Comparison["extraItems"] = [];

  for (const bidDoc of bidDocs ?? []) {
    const { data: bidLines } = await db
      .from("line_items")
      .select("*")
      .eq("document_id", bidDoc.id)
      .eq("kind", "item")
      .returns<LineItem[]>();

    const { data: imgRows } = await db.from("document_images").select("line_item_id").eq("document_id", bidDoc.id);
    const imgByLine = new Map<string, number>();
    for (const r of imgRows ?? []) if (r.line_item_id) imgByLine.set(r.line_item_id, (imgByLine.get(r.line_item_id) ?? 0) + 1);

    let computedTotal = 0;
    let pricedTotal = 0;
    let extrasTotal = 0;
    let notPricedCount = 0;

    for (const line of bidLines ?? []) {
      if (line.amount != null) computedTotal += Number(line.amount);
      if (!line.tender_line_id) {
        extrasTotal += Number(line.amount ?? 0);
        extraItems.push({
          documentId: bidDoc.id,
          partyName: bidDoc.party_name,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          rate: line.rate,
          amount: line.amount,
        });
        continue;
      }
      const row = itemByTenderLineId.get(line.tender_line_id);
      if (!row) continue;

      const qtyMismatch = row.quantity != null && line.quantity != null && Number(row.quantity) !== 0 && Math.abs(Number(line.quantity) - Number(row.quantity)) / Number(row.quantity) > 0.005;
      const amountNormalized = qtyMismatch && line.rate != null && row.quantity != null ? Number(line.rate) * Number(row.quantity) : line.amount == null ? null : Number(line.amount);

      const status: ComparisonCell["status"] =
        line.quote_status === "included"
          ? "included"
          : line.quote_status === "excluded"
          ? "excluded"
          : line.quote_status === "priced"
          ? "priced"
          : "not_priced";
      if (status === "not_priced") notPricedCount++;
      if (status === "priced" && amountNormalized != null) pricedTotal += amountNormalized;

      const metas = [line.cell_meta?.rate, line.cell_meta?.amount, line.cell_meta?.quantity];
      const src = metas.some((m) => m?.src === "manual") ? "manual" : metas.some((m) => m?.src === "converted") ? "converted" : metas.some((m) => m?.src === "autofill") ? "autofill" : "document";
      const earlier = row.cells[bidDoc.id];
      if (earlier && earlier.status === "priced" && status === "priced" && (amountNormalized ?? 0) > 0) {
        // a continuation line on the same BOQ item: add the amounts, show the effective rate
        earlier.amount = (earlier.amount ?? 0) + (amountNormalized ?? 0);
        earlier.rate = row.quantity ? earlier.amount / Number(row.quantity) : earlier.rate;
        earlier.flags = [...new Set([...earlier.flags, ...line.flags, "SPLIT"])];
        earlier.remarks = [earlier.remarks, line.remarks, "includes an additional line"].filter(Boolean).join(" · ");
        continue;
      }
      row.cells[bidDoc.id] = {
        status,
        rate: line.rate == null ? null : Number(line.rate),
        amount: amountNormalized == null ? line.amount : Number(amountNormalized),
        flags: line.flags,
        remarks: line.remarks,
        matchConfidence: line.match_confidence,
        lineId: line.id,
        src,
        anomalies: (line.anomalies ?? []).map((a) => a.code),
        converted: line.converted ? `${line.converted.from} → ${line.converted.to}` : null,
        images: imgByLine.get(line.id) ?? 0,
        qtyMismatch,
      };
    }

    const missingCount = items.filter((i) => !(bidDoc.id in i.cells)).length;
    for (const row of items) {
      if (!(bidDoc.id in row.cells)) {
        row.cells[bidDoc.id] = { status: "missing", rate: null, amount: null, flags: [], remarks: null, matchConfidence: null };
      }
    }

    const issueCount = (bidDoc.issues ?? []).filter((i) => i.severity !== "info").length;

    bids.push({
      documentId: bidDoc.id,
      partyName: bidDoc.party_name,
      statedTotal: bidDoc.stated_total,
      computedTotal,
      likeForLikeTotal: 0,
      likeForLikeItems: 0,
      pricedTotal,
      extrasTotal,
      notPricedCount,
      missingCount,
      issueCount,
      taxBasis: bidDoc.tax_basis,
      taxRatePercent: bidDoc.tax_rate_percent == null ? null : Number(bidDoc.tax_rate_percent),
      versionNo: bidDoc.version_no ?? 1,
      status: bidDoc.status,
      imageCount: imgRows?.length ?? 0,
      terms: bidDoc.terms ?? [],
      rank: 0,
    });
  }

  // Like-for-like = only the BOQ items EVERY bid priced, so a bid that skipped items can't look cheaper.
  const common = items.filter((i) => bids.length > 0 && bids.every((b) => i.cells[b.documentId]?.status === "priced" && i.cells[b.documentId].amount != null));
  for (const b of bids) {
    b.likeForLikeItems = common.length;
    b.likeForLikeTotal = common.length ? common.reduce((sum, i) => sum + (i.cells[b.documentId].amount ?? 0), 0) : b.pricedTotal;
  }

  // Rank by like-for-like total ascending (cheapest = L1); zero LFL (no priced items) ranks last.
  const ranked = [...bids].sort((a, b) => {
    const av = a.likeForLikeTotal || Infinity;
    const bv = b.likeForLikeTotal || Infinity;
    return av - bv;
  });
  ranked.forEach((b, idx) => {
    const target = bids.find((x) => x.documentId === b.documentId);
    if (target) target.rank = idx + 1;
  });

  for (const row of items) {
    const rates = Object.values(row.cells)
      .filter((c) => c.status === "priced" && c.rate != null)
      .map((c) => c.rate as number);
    row.minRate = rates.length ? Math.min(...rates) : null;
    row.maxRate = rates.length ? Math.max(...rates) : null;
    row.medianRate = median(rates);
  }

  const sections = (tenderSections ?? []).map((s) => ({
    name: s.name,
    itemCodes: items.filter((i) => i.sectionName === s.name).map((i) => i.itemCode),
  }));

  return {
    tenderId,
    tenderTitle: tender.title,
    currency: tenderDoc?.currency ?? tender.currency,
    sections,
    items,
    bids,
    extraItems,
  };
}
