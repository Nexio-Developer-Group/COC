# 03 — Analysis Pipeline (free-text request → typed, renderable result)

Related: `01-canonical-schema.md` (data), `02-ingestion-pipeline.md` §4 (shared Groq wrapper + retry loop).

---

## 1. Principles

1. **Code computes, the LLM interprets.** All arithmetic (totals, like-for-like totals, rate spreads, min/max, counts) is done in code by the comparison engine (§2) *before* the LLM is called. The LLM selects, ranks, explains and formats. This is the main defence against hallucinated numbers.
2. **The LLM is called only when the user presses "Run analysis".** The default Comparative Statement (bid-vs-tender table) is pure code and needs no LLM.
3. **Three output types only:** `table`, `ranking`, `narrative`. One JSON envelope, validated by Zod, retried on failure, and stored verbatim.
4. **Same request on the same data returns the stored result** (cache key), unless the user explicitly clicks "Run again".

---

## 2. Comparison engine (code, no LLM): `lib/compare.ts`

A single function, `buildComparison(tenderId) → Comparison`, used by **the Comparative Statement UI, its Excel export, and the analysis facts pack**. Every consumer therefore sees the same numbers.

Inputs: the active requirements doc's item lines, plus all active bids (`superseded_at is null`, status ∈ ready/needs_review).

For every tender item `t` and bid `b`:
- `lines` = bid items with `tender_line_id = t.id` (including sub-items).
- `cell.status`: `priced` | `not_priced` (line present, no price) | `missing` (no line) | `included` | `excluded`.
- `cell.rate` = primary rate of the top-level line.
- `cell.amount_stated` = sum of amounts of the line and its sub-items.
- `cell.amount_normalized` = if the bid qty ≠ tender qty: `rate × t.quantity` (+ sub-item amounts scaled by the same ratio). Otherwise equal to `amount_stated`.
- `cell.effective_rate` = `amount_normalized / t.quantity`.
- `cell.flags` = union of line flags (MATERIAL_BY_CLIENT, LABOUR_ONLY, …), plus `split` if sub-items exist and `qty_mismatch` / `unit_mismatch` from issues.
- `cell.remarks` = the line's remarks.

Per tender item row: `min_rate`, `max_rate`, `median_rate`, `spread_pct = (max−min)/min` over priced cells, `priced_by` count, and `l_rank` per bid (L1 = cheapest effective rate).

Per bid (column footer):

| Metric | Definition |
|---|---|
| `stated_total` | From the document, as printed |
| `computed_total` | Sum of all bid item amounts (incl. extras), primary variant |
| `matched_total` | Σ `amount_normalized` over tender items |
| `like_for_like_total` | Σ `amount_normalized` over tender items that **every** active bid priced |
| `gap_filled_total` | `matched_total` + Σ over items this bid didn't price of (`median_rate` of bids that did × tender qty). Items nobody priced are excluded, and the count is shown |
| `extras_total` | Σ amounts of bid lines with no tender link |
| `not_priced_count`, `missing_count`, `material_by_client_count`, `labour_only_count`, `issue_count` | |
| `tax_basis`, `tax_rate_percent`, `price_variant_label` | |
| `overall_rank` | L1/L2/… by `like_for_like_total` |

Why `like_for_like_total` drives the default rank: in the sample data, Rajat (₹3.17 Cr) is the only bidder that priced SPC Flooring + Skirting (₹35.7 L). Ranking on raw totals would punish the most complete bid.

---

## 3. Request flow

```
POST /api/tenders/:id/analyses  { request_text, requested_type: "auto"|"table"|"ranking"|"narrative", template_key? }
 1. comparison = buildComparison(tenderId)
 2. factsPack  = renderFactsPack(comparison, request_text)   → text + reductions[] + numberSet
 3. cache_key  = sha256(request_text.trim().toLowerCase() | requested_type | sha256(factsPack) | PROMPT_VERSION)
    → if a ready analysis with this cache_key exists and !force → return it (no LLM call)
 4. insert analyses row (status=running, input_snapshot)
 5. callGroqJson(system, user, AnalysisEnvelopeSchema, validateAnalysis, maxAttempts=3,
                 reasoning_effort="medium", max_completion_tokens=12000)
 6. post-process: grounding check, map bid refs → document ids, store
 7. status=ready (or failed with error text; the request text is kept so the user can retry)
```

Synchronous request with `maxDuration = 120`. The UI shows a progress state ("Reading 7 bids…", "Writing your table…"; these are cosmetic and time-based).

---

## 4. Facts pack (context assembly)

The LLM never sees JSONB or raw documents. It gets a **compact, labelled, pipe-delimited text pack** built from `Comparison`. Bids are referred to by short refs `B1…Bn` (sorted by contractor name) and tender items by `item_code`. The values below are illustrative, not real. The real expected totals are in doc 05 §5.

```
TENDER: ITC Fortune Guwahati | currency INR | 21 items in 3 sections | 7 active bids

BIDS
ref | contractor | stated_total | like_for_like | gap_filled | extras | tax | not_priced | missing | mat_by_client | labour_only | variants | issues
B1 | Brijesh Ji | 19575630 | 18123456 | 19980000 | 0 | unknown | 2 | 0 | 0 | 0 | 3 (using v3, lowest) | 1
B2 | KSB Interior | 19702212.78 | … | … | 0 | unknown | 2 | 0 | 0 | 0 | 1 | 0
…

TENDER ITEMS (rate per unit by bid; "—" = not priced, "×" = missing; suffix: c=material by client, l=labour only, s=split, q=qty mismatch)
code | section | name | unit | qty | min | median | max | B1 | B2 | B3 | B4 | B5 | B6 | B7
1.1 | Civil Works | Room Flooring | sqm | 2127 | 850 | 1184.04 | 1750 | 1050 | 914.94 | 1250 | 1750 | 1025 | 850 | 1184.04c
1.2 | Civil Works | SPC Flooring | sqm | 2127 | 1510 | 1510 | 1510 | — | — | — | — | 1510 | — | —
…

ITEM DESCRIPTIONS (first 140 chars)
1.1 | Providing and laying 8mm waste tiles over cement mortar…
…

SECTION TOTALS (like-for-like amount by bid)
section | trade | B1 | B2 | …
Civil Works | flooring | … 

EXTRA ITEMS OFFERED (not in tender)
bid | name | unit | qty | rate | amount
(none)

REMARKS & TERMS (verbatim, truncated to 160 chars each, max 15 per bid)
B3 | item 1.4 | Tile Provide by Client
B5 | term:tax | The quoted price does not include GST/taxes…
…

DATA ISSUES (warn/error only)
B1 | item 1.8 | split pricing: 7,65,036 + 4,38,450
…
```

### Size control (deterministic, in this order)
Budget: `ANALYSIS_INPUT_TOKENS` (default 20,000 tokens for the facts pack; raise it if the Groq tier allows. The model context is about 131k).

1. Always include BIDS, SECTION TOTALS, EXTRA ITEMS, DATA ISSUES.
2. **Section focus:** if the request mentions a section name or trade word (case-insensitive token match against section names + `trade` values, e.g. "civil", "paint", "electrical"), the TENDER ITEMS table includes only those sections. Reduction note: `"filtered to sections: Civil Works"`.
3. Drop ITEM DESCRIPTIONS → `"descriptions omitted"`.
4. Truncate REMARKS & TERMS to 5 per bid → `"terms truncated"`.
5. If more than 12 bids: keep the 12 lowest by like-for-like in item columns. The others stay in the BIDS table only → `"item rates shown for 12 of N bids"`.
6. If still over budget: replace the TENDER ITEMS table with SECTION TOTALS only → `"line-level rates omitted; analysis is at section level"`.

`reductions[]` is passed to the LLM ("DATA LIMITATIONS: …") and stored in `input_snapshot`. The LLM must repeat relevant limitations in `data_limitations`, and the UI shows them under the result.

`numberSet` = every numeric token in the facts pack (as numbers). It is used for the grounding check (§7).

---

## 5. Output contract: one envelope, three body types

```json
{
  "response_type": "table" | "ranking" | "narrative",
  "answerable": true,
  "title": "string, ≤ 80 chars, names the subject (e.g. 'Civil Works – rate comparison')",
  "description": "string, ≤ 240 chars, one or two sentences: what this shows + the headline finding",
  "assumptions": ["string", "…"],
  "data_limitations": ["string", "…"],
  "body": { … one of the three shapes below … }
}
```

`answerable: false` is allowed only with `response_type: "narrative"`, explaining what data is missing (e.g. "The bids contain no information on contractor experience"). It is stored and shown like any result. This is how off-topic or impossible requests stay inside the contract.

### 5.1 `table`: comparison/listing data (renders as a sortable grid, exports to CSV/xlsx)

```json
{
  "columns": [
    { "key": "c1", "label": "Item", "type": "text" },
    { "key": "c2", "label": "Unit", "type": "text" },
    { "key": "c3", "label": "Tender Qty", "type": "quantity" },
    { "key": "c4", "label": "Brijesh Ji", "type": "currency", "bid_ref": "B1" }
  ],
  "rows": [
    { "c1": "1.1 Room Flooring", "c2": "sqm", "c3": 2127, "c4": 1050, "_group": "Civil Works" }
  ],
  "highlights": [ { "row": 0, "col": "c4", "tone": "good" } ],
  "totals_row": { "c1": "Total", "c4": 18123456 } ,
  "footnote": "string | null"
}
```
- `type` ∈ `text | number | currency | percent | quantity | flag`. Currency is formatted by the app (₹, Indian grouping) and the LLM emits raw numbers. `percent` is emitted as a number (12.5 = 12.5%).
- Cell values: string, number, or null. No nested objects.
- `_group` (optional, string): the app renders group header rows (like section bands in the BOQ).
- `tone` ∈ `good | bad | warn | info`.
- Limits: 2–14 columns, 1–500 rows, column keys `c1…c14`, `totals_row` optional.

### 5.2 `ranking`: ordered judgement (renders as a leaderboard)

```json
{
  "criteria": [ { "name": "Like-for-like price", "weight_percent": 60, "description": "…" },
                { "name": "Completeness", "weight_percent": 25, "description": "…" },
                { "name": "Terms risk", "weight_percent": 15, "description": "…" } ],
  "entries": [
    { "rank": 1, "bid_ref": "B6", "contractor": "Rise Deck", "score": 86,
      "headline": "Lowest like-for-like price; 2 items not priced",
      "strengths": ["…"], "concerns": ["…"],
      "key_figures": [ { "label": "Like-for-like total", "value": 18815100, "type": "currency" } ] }
  ],
  "method_note": "string"
}
```
- `weight_percent` sums to 100 (±1). `rank` runs 1…n with no gaps. Ties are allowed via equal `score` but ranks stay unique. `score` is 0–100.
- Every active bid must appear exactly once, unless the request explicitly scopes to fewer (e.g. "top 3"). In that case `method_note` must say so.
- Limits: 1–50 entries, ≤ 5 strengths/concerns each, ≤ 4 key_figures each.

### 5.3 `narrative`: verdict/report (renders as a formatted report, exports as .md/.docx-like text)

```json
{
  "verdict": "string ≤ 200 chars | null",
  "key_figures": [ { "label": "Lowest like-for-like bid", "value": 18815100, "type": "currency", "bid_ref": "B6" } ],
  "markdown": "## Summary\n…"
}
```
- Allowed markdown: `##`/`###` headings, paragraphs, `-`/`1.` lists, `**bold**`, `*italic*`, `>` quotes. **No** tables (use `table`), links, images, HTML or code blocks. The renderer uses `react-markdown` with `allowedElements` to enforce this. Validation rejects `<`, `|---`, `![`, `](`.
- Limits: markdown ≤ 12,000 chars, ≤ 6 key_figures.

### How the type is chosen
- `requested_type ≠ auto` → the prompt says "response_type MUST be X", and validation enforces it.
- `auto` → the system prompt rule: *"Use `table` when the answer is per-item or per-bid figures someone would put in a spreadsheet; `ranking` when the user asks to rank, choose, shortlist or score contractors; `narrative` for explanations, summaries, risks or recommendations."*

Why the LLM never emits CSV: CSV is an **export format of `table`**, generated by the app. Asking the model for raw CSV loses typing, quoting rules and highlights.

---

## 6. Prompts

`PROMPT_VERSION = "analysis-v1"`

### 6.1 System prompt (verbatim)

```
You are a senior quantity surveyor and procurement analyst helping a client compare
contractor bids against their tender (bill of quantities). You answer ONE analysis request
using ONLY the data provided, and you reply with ONE JSON object in the exact format below.

Output ONLY valid JSON. No markdown fences, no text before or after the JSON.

DATA RULES
- All figures you show must come from the provided data. Copy numbers exactly as given.
  Do not recompute totals that are already provided (like_for_like, gap_filled, stated).
  Simple derived figures (a difference or percentage between two provided numbers) are
  allowed; put them in their own clearly-labelled column/figure.
- Refer to bids by their contractor name in text, and set "bid_ref" (B1, B2, …) where the
  schema has it. Refer to items as "<code> <name>" (e.g. "1.8 Room Flooring").
- "—" means the contractor left the item unpriced; "×" means the item is missing from the bid.
  Never treat these as zero cost. Suffix c = material supplied by client (rate is not
  comparable to a full-supply rate), l = labour only, s = split pricing, q = quantity mismatch.
- Prefer like-for-like totals when comparing overall price and say so in "assumptions".
- If the request cannot be answered from this data, return response_type "narrative" with
  "answerable": false and explain what is missing.
- Mention every DATA LIMITATION that affects the answer in "data_limitations".

CHOOSING response_type
- "table": per-item or per-bid figures a person would put in a spreadsheet.
- "ranking": ranking, choosing, shortlisting or scoring contractors.
- "narrative": explanations, summaries, risks, recommendations.
{{#if forcedType}}- For this request response_type MUST be "{{forcedType}}".{{/if}}

OUTPUT FORMAT
{ envelope + the three body shapes exactly as in §5, written out in full with the limits }
```
(The builder pastes the full §5 shapes + limits into this block. The prompt must be self-contained.)

### 6.2 User prompt template

```
ANALYSIS REQUEST (from the client):
"""{{request_text}}"""

{{#if reductions.length}}DATA LIMITATIONS: {{reductions | join("; ")}}{{/if}}

DATA:
{{factsPack}}

Return the JSON object now.
```

---

## 7. Validation (`validateAnalysis`), all code

| # | Check | On failure |
|---|---|---|
| A1 | JSON.parse + Zod discriminated union on `response_type` (strict objects, limits from §5) | retry with messages |
| A2 | Forced type respected; `answerable:false` only with narrative | retry |
| A3 | Referential: every `bid_ref` ∈ {B1…Bn}. Every item code mentioned in table cells `^\d+(\.\d+)*` must exist. Ranking covers all bids (unless `method_note` says scoped). Ranks contiguous. Weights sum to 100±1 | retry |
| A4 | Markdown restrictions (narrative) | retry |
| A5 | **Grounding:** every numeric cell / key_figure value / ranking key_figure is compared to `numberSet` (match if within ±0.5% or ±1). Ungrounded values are listed in `validation.ungrounded_numbers` with location | **no retry** (derived differences/percentages are legitimate). The UI marks those cells with a dotted underline and the tooltip "Calculated by AI from the bid data — double-check". If > 30% of numeric cells are ungrounded → one retry with the feedback "Use the provided figures; do not recompute totals" |
| A6 | Size limits exceeded / `finish_reason: length` | retry once with "Return at most 100 rows; summarise the rest in footnote" |

Post-process: attach `bid_document_id` next to each `bid_ref` (from the B-ref map stored in `input_snapshot.bid_refs`), so the UI can link to bid pages even after more bids arrive.

---

## 8. Storage and listing

The row in `analyses` (DDL in doc 01):
- `title`, `description` come from the envelope, for list display without parsing `result`.
- `result` = the full validated envelope.
- `input_snapshot` = `{ requirements_doc_id, bid_refs: {B1: doc_id, …}, bid_doc_ids, facts_pack_hash, reductions, prompt_version }`.
- **Staleness:** the list view compares `input_snapshot.bid_doc_ids` with the current active bid set. If they differ: badge "Based on 6 of 7 current bids — Run again". Runs are never auto-rerun (restrictive LLM usage).
- Rename/delete allowed. There are no edits to `result`.

## 9. Exports

| Result type | Exports |
|---|---|
| table | **Excel (.xlsx)** via `exceljs`: header row bold on `#7E4228`/white text, `_group` bands, frozen first column + header, currency columns formatted `₹ #,##,##0`, highlight tones as light fills, footnote + assumptions + limitations on a second sheet "Notes". **CSV** (raw values, UTF-8 with BOM so Excel opens ₹ correctly) |
| ranking | Excel/CSV, flattened to rows: rank, contractor, score, headline, strengths (joined "; "), concerns, key figures as columns |
| narrative | Markdown (.md) download + "Copy text". No Excel |
