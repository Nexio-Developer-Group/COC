import { db } from "@/lib/db";
import { buildComparison, type Comparison } from "@/lib/compare";
import { loadDoc } from "@/lib/docOps";
import type { AnalysisNarrativeBody, AnalysisRankingBody, AnalysisResult, AnalysisTableBody, Document, DocumentImage, LineItem } from "@/lib/types";
import type { Cell, ExportDoc, Row, Sheet, Tone } from "./model";

const provTone = (l: LineItem, field: "quantity" | "rate" | "amount"): Tone | undefined => {
  if (l.anomalies?.some((a) => a.field === field && a.severity !== "info")) return "flag";
  const src = l.cell_meta?.[field]?.src;
  return src === "autofill" ? "auto" : src === "converted" ? "converted" : src === "manual" ? "manual" : undefined;
};
const cell = (v: string | number | null, tone?: Tone, note?: string): Cell => (tone || note ? { v, tone, note } : v);

export function boqSheet(doc: Document, lines: LineItem[], name: string, withMatch = false): Sheet {
  const sections = lines.filter((l) => l.kind === "section");
  const rows: Row[] = [];
  for (const sec of sections) {
    rows.push({ band: true, cells: { code: `${sec.item_code}`, item: sec.name ?? "General" } });
    for (const l of lines.filter((x) => x.parent_id === sec.id)) {
      const notes = [l.remarks, ...(l.anomalies ?? []).map((a) => `⚠ ${a.message}`), l.converted ? `Converted ${l.converted.from}→${l.converted.to}` : null].filter(Boolean).join(" | ");
      rows.push({
        indent: true,
        cells: {
          code: l.item_code,
          item: l.name ?? "",
          desc: (l.description ?? "").slice(0, 300),
          unit: cell(l.unit ?? l.unit_raw, l.converted ? "converted" : undefined),
          qty: cell(l.quantity, provTone(l, "quantity"), l.cell_meta?.quantity?.note),
          rate: cell(l.quote_status === "not_priced" ? "Not quoted" : l.rate, provTone(l, "rate"), l.cell_meta?.rate?.note),
          amount: cell(l.quote_status === "not_priced" ? "—" : l.amount, provTone(l, "amount"), l.cell_meta?.amount?.note),
          remarks: notes,
          ...(withMatch ? { match: l.tender_line_id ? `${l.match_confidence} (${l.match_method})` : "extra item" } : {}),
        },
      });
    }
  }
  const total = lines.filter((l) => l.kind === "item").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  rows.push({ total: true, cells: { item: "Total (sum of line amounts)", amount: total } });
  if (doc.stated_total != null) rows.push({ total: true, cells: { item: "Total as printed in the document", amount: Number(doc.stated_total) } });
  const columns: Sheet["columns"] = [
    { key: "code", label: "Code", width: 8 },
    { key: "item", label: "Item", width: 30 },
    { key: "desc", label: "Description", width: 44 },
    { key: "unit", label: "Unit", width: 9 },
    { key: "qty", label: "Qty", width: 11, kind: "qty" },
    { key: "rate", label: "Rate", width: 13, kind: "money" },
    { key: "amount", label: "Amount", width: 16, kind: "money" },
    { key: "remarks", label: "Remarks / checks", width: 36 },
    ...(withMatch ? [{ key: "match", label: "Matches BOQ", width: 16 }] : []),
  ];
  const notes: string[] = [];
  for (const t of doc.terms ?? []) notes.push(`${t.category}: ${t.text}`);
  notes.push("Colour key: blue = calculated for you, teal = unit converted, yellow = edited by you, pink = unrealistic value.");
  return { name, title: name, columns, rows, notes };
}

export async function documentExport(documentId: string): Promise<{ doc: ExportDoc; images: DocumentImage[] } | null> {
  const bundle = await loadDoc(documentId);
  if (!bundle) return null;
  const { doc, lines } = bundle;
  const label = doc.role === "tender" ? "Requirements (BOQ)" : `Bid - ${doc.party_name ?? "Unknown contractor"}`;
  const sheet = boqSheet(doc, lines, label, doc.role === "bid");
  const { data: images } = await db.from("document_images").select("*").eq("document_id", documentId).returns<DocumentImage[]>();
  sheet.images = (images ?? []).map((i) => ({ url: i.public_url, caption: i.caption ?? i.sheet_name ?? undefined }));
  return { doc: { title: label, subtitle: `${doc.file_name}  ·  v${doc.version_no}  ·  ${doc.status.replace("_", " ")}`, sheets: [sheet], currency: doc.currency ?? "INR" }, images: images ?? [] };
}

export function comparisonSheets(c: Comparison): Sheet[] {
  const bids = [...c.bids].sort((a, b) => a.rank - b.rank);
  const rows: Row[] = [];
  let currentSection: string | null | undefined = undefined;
  for (const item of c.items) {
    if (item.sectionName !== currentSection) {
      currentSection = item.sectionName;
      rows.push({ band: true, cells: { code: "", item: currentSection ?? "General" } });
    }
    const cells: Row["cells"] = { code: item.itemCode, item: item.name ?? "", unit: item.unit, qty: item.quantity, req: item.tenderRate };
    for (const b of bids) {
      const x = item.cells[b.documentId];
      let v: string | number | null = "×";
      let tone: Tone | undefined;
      if (x) {
        if (x.status === "missing") v = "×";
        else if (x.status === "not_priced") v = "Not quoted";
        else if (x.status === "included") v = "Included";
        else if (x.status === "excluded") v = "Excluded";
        else {
          v = x.rate;
          if (item.minRate !== item.maxRate) tone = x.rate === item.minRate ? "good" : x.rate === item.maxRate ? "bad" : undefined;
          if (x.anomalies?.length) tone = "flag";
          else if (x.src === "autofill") tone = tone ?? "auto";
          else if (x.src === "converted") tone = tone ?? "converted";
          if (x.flags.includes("MATERIAL_BY_CLIENT") || x.flags.includes("LABOUR_ONLY")) tone = "warn";
        }
      }
      const note = x ? [x.remarks, x.converted ? `unit ${x.converted}` : null].filter(Boolean).join("; ") : "";
      cells[b.documentId] = cell(v, tone, note || undefined);
    }
    rows.push({ indent: true, cells });
  }
  const sumRow = (label: string, f: (b: (typeof bids)[number]) => string | number | null): Row => ({ total: true, cells: { item: label, ...Object.fromEntries(bids.map((b) => [b.documentId, f(b)])) } });
  if (c.requirementPricedItems > 0) {
    rows.push(sumRow("Requirement total (same items)", (b) => (b.req.comparableItems ? b.req.reqAmount : null)));
    rows.push(sumRow("Bid vs requirement", (b) => (b.req.variancePct == null ? null : `${b.req.variancePct > 0 ? "+" : ""}${(b.req.variancePct * 100).toFixed(1)}%`)));
    rows.push(sumRow("Items above / on / below requirement", (b) => `${b.req.over} / ${b.req.within} / ${b.req.under}`));
    rows.push(sumRow("Requirement fit (0-100)", (b) => `${b.req.score} (#${b.req.fitRank})`));
  }
  rows.push(sumRow("Quoted total (as printed)", (b) => b.statedTotal));
  rows.push(sumRow("Like-for-like total", (b) => b.likeForLikeTotal));
  rows.push(sumRow("Rank", (b) => `L${b.rank}`));
  rows.push(sumRow("Items not priced / missing", (b) => `${b.notPricedCount} / ${b.missingCount}`));
  rows.push(sumRow("Tax", (b) => (b.taxBasis ? `${b.taxBasis}${b.taxRatePercent ? ` ${b.taxRatePercent}%` : ""}` : "not stated")));
  const columns: Sheet["columns"] = [
    { key: "code", label: "Code", width: 8 },
    { key: "item", label: "Item", width: 30 },
    { key: "unit", label: "Unit", width: 9 },
    { key: "qty", label: "Qty", width: 11, kind: "qty" },
    { key: "req", label: "Requirement rate", width: 14, kind: "money" as const },
    ...bids.map((b) => ({ key: b.documentId, label: `${b.partyName ?? "Unknown"} (L${b.rank}${b.versionNo > 1 ? `, v${b.versionNo}` : ""})`, width: 17, kind: "money" as const })),
  ];
  const main: Sheet = { name: "Comparative Statement", title: `Comparative Statement - ${c.tenderTitle}`, columns, rows, notes: ["Green = lowest rate, orange = highest, blue = calculated for you, teal = unit converted, yellow = client-supplied material / labour only, pink = unrealistic value."] };

  const termRows: Row[] = [];
  for (const b of bids) for (const t of b.terms ?? []) termRows.push({ cells: { bid: b.partyName ?? "Unknown", cat: t.category, text: t.text, val: t.value } });
  const terms: Sheet = { name: "Terms & notes", title: "Terms & notes by contractor", columns: [{ key: "bid", label: "Contractor", width: 24 }, { key: "cat", label: "Category", width: 16 }, { key: "text", label: "Text", width: 70 }, { key: "val", label: "Value", width: 14 }], rows: termRows };
  return [main, ...(termRows.length ? [terms] : [])];
}

export async function comparisonExport(tenderId: string): Promise<ExportDoc | null> {
  const c = await buildComparison(tenderId);
  if (!c) return null;
  return { title: `Comparative Statement - ${c.tenderTitle}`, subtitle: `${c.bids.length} bids · ${c.items.length} items`, sheets: comparisonSheets(c), currency: c.currency };
}

export function analysisExport(a: { title: string | null; description: string | null; request_text: string; result: AnalysisResult }): ExportDoc {
  const r = a.result;
  const notes = [`Question: ${a.request_text}`, ...(r.assumptions ?? []).map((x) => `Assumption: ${x}`), ...(r.data_limitations ?? []).map((x) => `Limit: ${x}`)];
  const title = r.title || a.title || "Report";
  if (r.response_type === "table") {
    const b = r.body as AnalysisTableBody;
    const rows: Row[] = b.rows.map((row) => ({ cells: Object.fromEntries(b.columns.map((c) => [c.key, (row[c.key] ?? null) as string | number | null])) }));
    if (b.totals_row) rows.push({ total: true, cells: Object.fromEntries(b.columns.map((c) => [c.key, (b.totals_row?.[c.key] ?? null) as string | number | null])) });
    if (b.footnote) notes.unshift(b.footnote);
    return { title, subtitle: r.description, sheets: [{ name: "Result", title, columns: b.columns.map((c) => ({ key: c.key, label: c.label, kind: c.type === "currency" ? "money" : c.type === "quantity" || c.type === "number" ? "qty" : c.type === "percent" ? "pct" : "text", width: c.type === "text" ? 30 : 16 })), rows, notes }] };
  }
  if (r.response_type === "ranking") {
    const b = r.body as AnalysisRankingBody;
    const rows: Row[] = [...b.entries].sort((x, y) => x.rank - y.rank).map((e) => ({ cells: { rank: e.rank, contractor: e.contractor, score: e.score, headline: e.headline, strengths: e.strengths.join("; "), concerns: e.concerns.join("; ") } }));
    notes.unshift(`Method: ${b.method_note}`, `Criteria: ${b.criteria.map((c) => `${c.name} ${c.weight_percent}%`).join(", ")}`);
    return { title, subtitle: r.description, sheets: [{ name: "Ranking", title, columns: [{ key: "rank", label: "Rank", width: 7, kind: "qty" }, { key: "contractor", label: "Contractor", width: 24 }, { key: "score", label: "Score", width: 8, kind: "qty" }, { key: "headline", label: "Headline", width: 40 }, { key: "strengths", label: "Strengths", width: 40 }, { key: "concerns", label: "Concerns", width: 40 }], rows, notes }] };
  }
  const b = r.body as AnalysisNarrativeBody;
  const rows: Row[] = [
    ...(b.verdict ? [{ cells: { k: "Verdict", v: b.verdict } }] : []),
    ...b.key_figures.map((f) => ({ cells: { k: f.label, v: f.value } })),
    ...b.markdown.split("\n").filter((l) => l.trim()).map((l) => ({ cells: { k: l.startsWith("#") ? "" : "", v: l.replace(/^#+\s*/, "").replace(/\*\*/g, "") }, band: l.startsWith("#") })),
  ];
  return { title, subtitle: r.description, sheets: [{ name: "Report", title, columns: [{ key: "k", label: "", width: 24 }, { key: "v", label: "", width: 100 }], rows, notes }] };
}

/** Everything about a tender in one workbook / PDF. */
export async function packExport(tenderId: string): Promise<ExportDoc | null> {
  const { data: tender } = await db.from("tenders").select("*").eq("id", tenderId).single();
  if (!tender) return null;
  const sheets: Sheet[] = [];
  if (tender.requirements_doc_id) {
    const d = await documentExport(tender.requirements_doc_id);
    if (d) sheets.push(...d.doc.sheets);
  }
  const cmp = await comparisonExport(tenderId);
  if (cmp) sheets.push(...cmp.sheets);
  const { data: bids } = await db.from("documents").select("id").eq("tender_id", tenderId).eq("role", "bid").is("superseded_at", null).in("status", ["ready", "needs_review"]);
  for (const b of bids ?? []) {
    const d = await documentExport(b.id);
    if (d) sheets.push(...d.doc.sheets.map((s) => ({ ...s, name: s.name.slice(0, 28) })));
  }
  const { data: analyses } = await db.from("analyses").select("title, description, request_text, result").eq("tender_id", tenderId).eq("status", "ready").order("created_at", { ascending: false }).limit(8);
  for (const a of analyses ?? []) if (a.result) sheets.push(...analysisExport(a as never).sheets.map((s) => ({ ...s, name: `Report - ${(a.title ?? "").slice(0, 18)}` })));
  return { title: tender.title, subtitle: [tender.client_name, tender.location].filter(Boolean).join(" · "), sheets };
}
