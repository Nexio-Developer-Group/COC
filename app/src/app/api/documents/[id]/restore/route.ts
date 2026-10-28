import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Make an older submission the live one again (the current live version is kept as history). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/documents/[id]/restore">) {
  const { id } = await ctx.params;
  const { data: doc } = await db.from("documents").select("id, tender_id, role, party_name").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { data: all } = await db.from("documents").select("id, supersedes_id, superseded_at").eq("tender_id", doc.tender_id).eq("role", doc.role);
  const byId = new Map((all ?? []).map((d) => [d.id, d]));
  // walk to chain members
  const chain = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of all ?? []) {
      if (!chain.has(d.id) && ((d.supersedes_id && chain.has(d.supersedes_id)) || [...chain].some((c) => byId.get(c)?.supersedes_id === d.id))) {
        chain.add(d.id);
        grew = true;
      }
    }
  }
  const now = new Date().toISOString();
  for (const c of chain) {
    if (c === id) await db.from("documents").update({ superseded_at: null }).eq("id", c);
    else await db.from("documents").update({ superseded_at: byId.get(c)?.superseded_at ?? now }).eq("id", c);
  }
  return NextResponse.json({ ok: true });
}
