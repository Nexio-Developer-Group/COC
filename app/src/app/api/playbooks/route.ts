import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const { data, error } = await db.from("playbooks").select("*").order("pinned", { ascending: false }).order("run_count", { ascending: false }).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ playbooks: data ?? [] });
}

/** Create from scratch, or "Save as Playbook" from an existing report via from_analysis_id. */
export async function POST(req: NextRequest) {
  const b = await req.json();
  let { name, instruction, output_type, description, emoji, category, parameters } = b as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (b.from_analysis_id) {
    const { data: a } = await db.from("analyses").select("request_text, requested_type, response_type, title, description").eq("id", b.from_analysis_id).single();
    if (!a) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    instruction = instruction ?? a.request_text;
    output_type = output_type ?? (a.requested_type !== "auto" ? a.requested_type : a.response_type ?? "auto");
    name = name ?? a.title ?? "Saved question";
    description = description ?? a.description;
  }
  if (!name || !instruction) return NextResponse.json({ error: "A name and an instruction are required." }, { status: 400 });
  const keys = [...String(instruction).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  const params = parameters ?? [...new Set(keys)].map((k) => ({ key: k, label: k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));
  const { data, error } = await db
    .from("playbooks")
    .insert({ name, instruction, output_type: output_type || "auto", description: description || null, emoji: emoji || "✨", category: category || "Mine", parameters: params })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ playbook: data });
}
