import { z } from "zod";

const ColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "currency", "percent", "quantity", "flag"]),
});

const TableBodySchema = z.object({
  columns: z.array(ColumnSchema).min(1).max(14),
  rows: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]).optional()))
    .min(0)
    .max(500),
  totals_row: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable().optional(),
  footnote: z.string().nullable().optional(),
});

const RankingEntrySchema = z.object({
  rank: z.number().int().min(1),
  bid_ref: z.string(),
  contractor: z.string(),
  score: z.number().min(0).max(100),
  headline: z.string(),
  strengths: z.array(z.string()).max(5).default([]),
  concerns: z.array(z.string()).max(5).default([]),
  key_figures: z
    .array(z.object({ label: z.string(), value: z.number(), type: z.string() }))
    .max(4)
    .default([]),
});

const RankingBodySchema = z.object({
  criteria: z
    .array(z.object({ name: z.string(), weight_percent: z.number(), description: z.string() }))
    .min(1),
  entries: z.array(RankingEntrySchema).min(1).max(50),
  method_note: z.string(),
});

const NarrativeBodySchema = z.object({
  verdict: z.string().max(400).nullable(),
  key_figures: z
    .array(z.object({ label: z.string(), value: z.number(), type: z.string(), bid_ref: z.string().optional() }))
    .max(6)
    .default([]),
  markdown: z
    .string()
    .max(12000)
    .refine((md) => !/<[a-z]/i.test(md) && !md.includes("](") && !/\|\s*---/.test(md), {
      message: "narrative markdown must not contain HTML, links, or tables — use plain headings/paragraphs/lists only",
    }),
});

export const AnalysisEnvelopeSchema = z.discriminatedUnion("response_type", [
  z.object({
    response_type: z.literal("table"),
    answerable: z.boolean(),
    title: z.string().max(100),
    description: z.string().max(300),
    assumptions: z.array(z.string()).default([]),
    data_limitations: z.array(z.string()).default([]),
    body: TableBodySchema,
  }),
  z.object({
    response_type: z.literal("ranking"),
    answerable: z.boolean(),
    title: z.string().max(100),
    description: z.string().max(300),
    assumptions: z.array(z.string()).default([]),
    data_limitations: z.array(z.string()).default([]),
    body: RankingBodySchema,
  }),
  z.object({
    response_type: z.literal("narrative"),
    answerable: z.boolean(),
    title: z.string().max(100),
    description: z.string().max(300),
    assumptions: z.array(z.string()).default([]),
    data_limitations: z.array(z.string()).default([]),
    body: NarrativeBodySchema,
  }),
]);

export type AnalysisEnvelope = z.infer<typeof AnalysisEnvelopeSchema>;
