import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyUnitConversion, revertUnitConversion } from "@/lib/calc";
import { loadDoc } from "@/lib/docOps";
import type { LineItem } from "@/lib/types";

/** Turn a unit conversion off (back to the document's own numbers) or on again for one row. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/conversion">) {
  const { id } = await ctx.params;
  const { line_id, action } = await req.json();
  const bundle = await loadDoc(id);
  const line = bundle?.lines.find((l) => l.id === line_id);
  if (!bundle || !line) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (action === "revert") revertUnitConversion(line);
  else if (line.tender_line_id) {
    const { data: t } = await db.from("line_items").select("*").eq("id", line.tender_line_id).single<LineItem>();
    applyUnitConversion(line, t);
  }
  await db.from("line_items").update({ quantity: line.quantity, rate: line.rate, unit: line.unit, converted: line.converted, cell_meta: line.cell_meta, edited_at: new Date().toISOString() }).eq("id", line.id);
  const total = bundle.lines.filter((l) => l.kind === "item").reduce((s, l) => s + (l.amount ?? 0), 0);
  await db.from("documents").update({ computed_total: total }).eq("id", id);
  return NextResponse.json({ ok: true });
}
