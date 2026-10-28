import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runAnalysis } from "@/lib/analysis/run";
import { previewOf } from "@/lib/analysis/preview";
import type { AnalysisResult } from "@/lib/types";

export const maxDuration = 120;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/analyses">) {
  const { id } = await ctx.params;
  const { data: analyses, error } = await db
    .from("analyses")
    .select("id, request_text, requested_type, template_key, playbook_id, status, response_type, title, description, created_at, input_snapshot, result")
    .eq("tender_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: activeBids } = await db.from("documents").select("id").eq("tender_id", id).eq("role", "bid").is("superseded_at", null);
  const activeBidIds = new Set((activeBids ?? []).map((b) => b.id));

  const withStale = (analyses ?? []).map((a) => {
    const snapshot = (a.input_snapshot as { bid_refs?: Record<string, string> }) ?? {};
    const usedDocIds = new Set(Object.values(snapshot.bid_refs ?? {}));
    const stale = usedDocIds.size > 0 && (usedDocIds.size !== activeBidIds.size || [...usedDocIds].some((d) => !activeBidIds.has(d)));
    const { result, ...rest } = a as typeof a & { result: AnalysisResult | null };
    return { ...rest, stale, preview: previewOf(result) };
  });

  return NextResponse.json({ analyses: withStale });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tenders/[id]/analyses">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { request_text, requested_type, template_key, force, playbook_id, params } = body;
  if (!request_text || typeof request_text !== "string") {
    return NextResponse.json({ error: "request_text is required" }, { status: 400 });
  }
  try {
    const result = await runAnalysis({
      tenderId: id,
      requestText: request_text,
      requestedType: requested_type || "auto",
      templateKey: template_key ?? null,
      playbookId: playbook_id ?? null,
      params: params ?? {},
      force: !!force,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
