import { z } from "zod";

export const PriceSchema = z.object({
  variant: z.string(),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
});

export const ItemSchema = z.object({
  source_ref: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  unit: z.string().nullable(),
  quantity: z.number().nullable(),
  prices: z.array(PriceSchema).default([]),
  quote_status: z.enum(["priced", "not_priced", "included", "excluded", "not_applicable"]),
  flags: z
    .array(
      z.enum([
        "MATERIAL_BY_CLIENT",
        "LABOUR_ONLY",
        "SUPPLY_ONLY",
        "NEEDS_CLARIFICATION",
        "PROVISIONAL",
        "ALTERNATE_OFFERED",
        "RATE_ONLY",
      ])
    )
    .default([]),
  remarks: z.string().nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  tender_ref: z.string().nullable().optional(),
  tender_ref_reason: z.string().nullable().optional(),
});

export const SectionSchema = z.object({
  name: z.string().nullable(),
  source_ref: z.string().nullable(),
  trade: z.enum([
    "civil",
    "flooring",
    "ceiling",
    "painting",
    "carpentry",
    "furniture",
    "electrical",
    "plumbing",
    "hvac",
    "fire",
    "glazing",
    "metalwork",
    "landscaping",
    "general",
    "other",
  ]),
  items: z.array(ItemSchema).default([]),
});

export const TermSchema = z.object({
  category: z.enum([
    "tax",
    "payment",
    "validity",
    "timeline",
    "site_facilities",
    "scope_inclusion",
    "scope_exclusion",
    "material",
    "measurement",
    "warranty",
    "other",
  ]),
  text: z.string(),
  value: z.string().nullable(),
});

export const ExtractionSchema = z.object({
  schema_version: z.string(),
  document: z.object({
    detected_kind: z.enum(["tender", "bid", "unknown"]),
    title: z.string().nullable(),
    project_name: z.string().nullable(),
    party: z.object({
      name: z.string().nullable(),
      address: z.string().nullable(),
      contact: z.string().nullable(),
      tax_id: z.string().nullable(),
    }),
    document_date: z.string().nullable(),
    reference_no: z.string().nullable(),
    currency: z.string().nullable(),
    tax_basis: z.enum(["excluded", "included", "unknown"]),
    tax_rate_percent: z.number().nullable(),
    stated_total: z.number().nullable(),
    price_variant_labels: z.record(z.string(), z.string()).default({}),
  }),
  sections: z.array(SectionSchema).default([]),
  terms: z.array(TermSchema).default([]),
  notes_for_reviewer: z.array(z.string()).default([]),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedItem = z.infer<typeof ItemSchema>;
export type ExtractedSection = z.infer<typeof SectionSchema>;
