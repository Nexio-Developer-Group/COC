import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const { data: tenders, error } = await db
    .from("tenders")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const t of tenders ?? []) {
    const { count: bidCount } = await db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("tender_id", t.id)
      .eq("role", "bid")
      .is("superseded_at", null);
    let requirementsStatus: string | null = null;
    if (t.requirements_doc_id) {
      const { data: reqDoc } = await db.from("documents").select("status").eq("id", t.requirements_doc_id).single();
      requirementsStatus = reqDoc?.status ?? null;
    }
    results.push({ ...t, bid_count: bidCount ?? 0, requirements_status: requirementsStatus });
  }

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
