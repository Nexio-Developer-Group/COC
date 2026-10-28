import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AnalysisResult, AnalysisTableBody, AnalysisRankingBody, AnalysisNarrativeBody } from "@/lib/types";

/** Pictures relevant to a report: rows it mentions, or every picture of the bidders it talks about. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/analyses/[id]/images">) {
  const { id } = await ctx.params;
  const { data: a } = await db.from("analyses").select("tender_id, result, input_snapshot").eq("id", id).single();
  if (!a) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const result = a.result as AnalysisResult | null;
  const bidRefs = ((a.input_snapshot as { bid_refs?: Record<string, string> })?.bid_refs ?? {}) as Record<string, string>;

  const { data: docs } = await db.from("documents").select("id, role, party_name, superseded_at").eq("tender_id", a.tender_id).is("superseded_at", null);
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const { data: imgs } = await db.from("document_images").select("*").eq("tender_id", a.tender_id).order("created_at");
  const live = (imgs ?? []).filter((i) => docById.has(i.document_id));
  if (!live.length) return NextResponse.json({ groups: [], total: 0 });

  const lineIds = [...new Set(live.map((i) => i.line_item_id).filter(Boolean))] as string[];
  const { data: lines } = lineIds.length ? await db.from("line_items").select("id, item_code, name, tender_line_id").in("id", lineIds) : { data: [] };
  const lineMap = new Map((lines ?? []).map((l) => [l.id, l]));
  const tenderIds = [...new Set((lines ?? []).map((l) => l.tender_line_id).filter(Boolean))] as string[];
  const { data: tLines } = tenderIds.length ? await db.from("line_items").select("id, item_code").in("id", tenderIds) : { data: [] };
  const tCode = new Map((tLines ?? []).map((l) => [l.id, l.item_code]));

  // item codes and bidders mentioned by the result
  const codes = new Set<string>();
  const refs = new Set<string>();
  if (result?.response_type === "table") {
    const b = result.body as AnalysisTableBody;
    for (const r of b.rows) for (const c of b.columns.slice(0, 2)) { const m = /^(\d+(?:\.\d+)*)\b/.exec(String(r[c.key] ?? "")); if (m) codes.add(m[1]); }
    for (const c of b.columns) if ((c as { bid_ref?: string }).bid_ref) refs.add((c as { bid_ref?: string }).bid_ref!);
  }
  if (result?.response_type === "ranking") for (const e of (result.body as AnalysisRankingBody).entries) refs.add(e.bid_ref);
  if (result?.response_type === "narrative") for (const f of (result.body as AnalysisNarrativeBody).key_figures) if (f.bid_ref) refs.add(f.bid_ref);
  const refDocs = new Set([...refs].map((r) => bidRefs[r]).filter(Boolean));

  const label = (i: (typeof live)[number]) => {
    const l = i.line_item_id ? lineMap.get(i.line_item_id) : null;
    const tc = l ? (l.tender_line_id ? tCode.get(l.tender_line_id) : l.item_code) : null;
    return { ...i, item_code: tc ?? null, row_name: l?.name ?? null, source: docById.get(i.document_id) ?? null };
  };
  let chosen = live.map(label);
  const byCode = chosen.filter((i) => i.item_code && codes.has(i.item_code));
  if (byCode.length) chosen = byCode;
  else if (refDocs.size) chosen = chosen.filter((i) => refDocs.has(i.document_id));
  chosen = chosen.slice(0, 60);

  const groups = new Map<string, { title: string; images: typeof chosen }>();
  for (const i of chosen) {
    const key = i.document_id;
    const title = i.source?.role === "tender" ? "Your requirements" : i.source?.party_name ?? "Contractor";
    if (!groups.has(key)) groups.set(key, { title, images: [] });
    groups.get(key)!.images.push(i);
  }
  return NextResponse.json({ groups: [...groups.values()], total: chosen.length });
}
