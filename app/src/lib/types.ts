export type DocRole = "tender" | "bid";
export type DocStatus = "uploaded" | "processing" | "ready" | "needs_review" | "failed";
export type QuoteStatus = "priced" | "not_priced" | "included" | "excluded" | "not_applicable";

export type Issue = {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  line_id?: string | null;
  data?: Record<string, unknown>;
};

export type Price = { variant: string; rate: number | null; amount: number | null };

export type Tender = {
  id: string;
  title: string;
  client_name: string | null;
  location: string | null;
  currency: string;
  notes: string | null;
  requirements_doc_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Document = {
  id: string;
  tender_id: string;
  role: DocRole;
  status: DocStatus;
  status_detail: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  file_sha256: string;
  rendered_text: string | null;
  detected_kind: string | null;
  title: string | null;
  project_name: string | null;
  party_name: string | null;
  party: { name?: string | null; address?: string | null; contact?: string | null; tax_id?: string | null };
  document_date: string | null;
  reference_no: string | null;
  currency: string | null;
  tax_basis: "excluded" | "included" | "unknown" | null;
  tax_rate_percent: number | null;
  stated_total: number | null;
  computed_total: number | null;
  price_variants: { key: string; label: string }[];
  primary_variant: string | null;
  terms: { category: string; text: string; value: string | null }[];
  issues: Issue[];
  extraction_meta: Record<string, unknown>;
  supersedes_id: string | null;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LineItem = {
  id: string;
  document_id: string;
  parent_id: string | null;
  kind: "section" | "item";
  position: number;
  item_code: string;
  source_ref: string | null;
  name: string | null;
  description: string | null;
  trade: string | null;
  unit_raw: string | null;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  prices: Price[];
  quote_status: QuoteStatus | null;
  flags: string[];
  remarks: string | null;
  attributes: Record<string, unknown>;
  extraction_confidence: "high" | "low" | null;
  tender_line_id: string | null;
  match_method: "code" | "llm" | "code+llm" | "manual" | null;
  match_confidence: "exact" | "high" | "low" | "conflict" | null;
  match_note: string | null;
};

export type Analysis = {
  id: string;
  tender_id: string;
  request_text: string;
  requested_type: string;
  template_key: string | null;
  status: "running" | "ready" | "failed";
  response_type: "table" | "ranking" | "narrative" | null;
  title: string | null;
  description: string | null;
  answerable: boolean | null;
  result: AnalysisResult | null;
  validation: Record<string, unknown>;
  input_snapshot: Record<string, unknown>;
  cache_key: string | null;
  llm_meta: Record<string, unknown>;
  error: string | null;
  created_at: string;
};

export type AnalysisColumn = { key: string; label: string; type: "text" | "number" | "currency" | "percent" | "quantity" | "flag" };
export type AnalysisTableBody = {
  columns: AnalysisColumn[];
  rows: Record<string, string | number | null | undefined>[];
  totals_row?: Record<string, string | number | null> | null;
  footnote?: string | null;
};
export type AnalysisRankingEntry = {
  rank: number;
  bid_ref: string;
  contractor: string;
  score: number;
  headline: string;
  strengths: string[];
  concerns: string[];
  key_figures: { label: string; value: number; type: string }[];
};
export type AnalysisRankingBody = {
  criteria: { name: string; weight_percent: number; description: string }[];
  entries: AnalysisRankingEntry[];
  method_note: string;
};
export type AnalysisNarrativeBody = {
  verdict: string | null;
  key_figures: { label: string; value: number; type: string; bid_ref?: string }[];
  markdown: string;
};

export type AnalysisResult = {
  response_type: "table" | "ranking" | "narrative";
  answerable: boolean;
  title: string;
  description: string;
  assumptions: string[];
  data_limitations: string[];
  body: AnalysisTableBody | AnalysisRankingBody | AnalysisNarrativeBody;
};
