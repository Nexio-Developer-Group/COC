import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/documents/[id]/versions">) {
  const { id } = await ctx.params;
  const { data: doc } = await db.from("documents").select("tender_id, role").eq("id", id).single();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const { data: all } = await db.from("documents").select("id, version_no, file_name, created_at, superseded_at, supersedes_id, status, stated_total, computed_total, party_name").eq("tender_id", doc.tender_id).eq("role", doc.role).order("version_no");
  const chain = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of all ?? []) {
      if (!chain.has(d.id) && ((d.supersedes_id && chain.has(d.supersedes_id)) || (all ?? []).some((x) => chain.has(x.id) && x.supersedes_id === d.id))) {
        chain.add(d.id);
        grew = true;
      }
    }
  }
  return NextResponse.json({ versions: (all ?? []).filter((d) => chain.has(d.id)) });
}
