import { NextResponse } from "next/server";
import { buildComparison } from "@/lib/compare";

export async function GET(_req: Request, ctx: RouteContext<"/api/tenders/[id]/comparison">) {
  const { id } = await ctx.params;
  const comparison = await buildComparison(id);
  if (!comparison) return NextResponse.json({ error: "No processed requirements document for this tender yet" }, { status: 404 });
  return NextResponse.json({ comparison });
}
