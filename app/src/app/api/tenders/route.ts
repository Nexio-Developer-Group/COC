import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const { data: tenders, error } = await db
    .from("tenders")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (tenders ?? []).map((t) => t.id);
  const { data: docs } = ids.length
    ? await db.from("documents").select("id, tender_id, role, status, party_name, computed_total, superseded_at").in("tender_id", ids).is("superseded_at", null)
    : { data: [] };
  const { data: itemCounts } = ids.length ? await db.from("documents").select("id, tender_id").in("tender_id", ids).eq("role", "tender").is("superseded_at", null) : { data: [] };
  void itemCounts;
  const results = (tenders ?? []).map((t) => {
    const mine = (docs ?? []).filter((d) => d.tender_id === t.id);
    const bids = mine.filter((d) => d.role === "bid");
    const req = mine.find((d) => d.id === t.requirements_doc_id);
    const priced = bids.filter((b) => Number(b.computed_total) > 0 && ["ready", "needs_review"].includes(b.status)).sort((a, b) => Number(a.computed_total) - Number(b.computed_total));
    return {
      ...t,
      bid_count: bids.length,
      requirements_status: req?.status ?? null,
      needs_review_count: mine.filter((d) => d.status === "needs_review").length,
      processing_count: mine.filter((d) => d.status === "processing" || d.status === "uploaded").length,
      lowest: priced[0] ? { party: priced[0].party_name, total: Number(priced[0].computed_total) } : null,
    };
  });

  return NextResponse.json({ tenders: results });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, client_name, location, currency } = body;
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const { data, error } = await db
    .from("tenders")
    .insert({ title, client_name: client_name || null, location: location || null, currency: currency || "INR" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tender: data });
}
