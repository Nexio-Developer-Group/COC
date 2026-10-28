# 02 — Ingestion Pipeline (any file → canonical data)

Related: `01-canonical-schema.md` (target model + matching rules), `05-build-plan.md` (routes).

---

## 1. Pipeline overview

```
Upload (POST /api/tenders/:id/documents)              no LLM
  1. store file in Supabase Storage, sha256, create documents row (status=uploaded)
  2. duplicate check: same sha256 already in this tender → issue duplicate_file (warn, continue)

Process (POST /api/documents/:id/process)             the ONLY extraction LLM entry point
  3. parsing     detect type → render to addressed plain text (rendered_text)
  4. extracting  chunk if needed → Groq call(s) → JSON
  5. validating  zod schema → coverage → grounding → arithmetic → totals
                 (schema/coverage/grounding failures feed the retry loop)
  6. matching    bids only: deterministic matcher + LLM hint (doc 01 §4)
  7. persist     replace line_items for this document in one transaction
  8. status      ready | needs_review (any warn/error issue) | failed
```

Each step updates `documents.status` + `status_detail`, so the UI can poll `GET /api/documents/:id` and show "Reading chunk 2 of 3…".

**Execution model (demo):** the client calls `/process` right after upload and awaits it. The route sets `export const maxDuration = 300`. No job queue. If the browser closes mid-run the status shows where it stopped and a "Retry processing" button calls `/process` again. Processing is idempotent: it wipes and rewrites this document's lines.

---

## 2. File-type detection and rendering (step 3)

Detect by magic bytes first, then extension (`file-type` npm, falling back to the extension). The LLM always receives **addressed plain text**: every row or line has a stable number so the LLM can cite `source_rows`, and code can verify coverage and grounding.

| Type | Library | Rendering |
|---|---|---|
| xlsx / xls / xlsm / ods | `xlsx` (SheetJS) with `cellDates`, cached values only (formulas not evaluated) | Per sheet. See format below |
| csv / tsv | SheetJS (same path) | Same as one sheet |
| pdf | `unpdf` (pdfjs text) | Per page, one entry per text line: `L{n} \| text`. Keep `=== Page 3 ===` markers. If total text < 200 chars for > 1 page → **fail fast**: "This PDF looks scanned (image only). Please upload the Excel/Word version." No OCR in the demo |
| docx | `mammoth.convertToHtml` → walk HTML: paragraphs → `L{n} \| text`, tables → `R{n} \| A:… \| B:…` per table row with `=== Table k ===` markers | |
| txt / md | as-is, `L{n} \| text` | |
| anything else (images, zip, pptx) | reject at upload with a clear message | |

### Spreadsheet render format (the most important format)

```
=== Sheet "Wet Works (2)" — 33 rows, columns A–AS (non-empty cells only, COL:value) ===
R1 | A:ITC FORTUNE GUWAHATI
R2 | A:Sr.No | B:Final Intronote | C:Description | D:Unit | E:Quantity | F:Rate | G:Amount
R4 | B:Civil Works
R5 | A:1 | B:Room Flooring | C:Providing and laying 8mm waste tiles over cement mortar… | D:SQMT | E:2127 | F:1250 | G:2658750
R8 | A:4 | B:Toilet Flooring | C:… | D:SQMT | E:1154 | F:950 | G:1096300 | H:Tile Provide by Client
R29| A:1 | B:Floor Tile | C:Tile Flooring in Balcony Floor | D:SQMT | E:340 | AR:340 | AS:sqm
R33| D:Grand Total | G:20347940
```

Rules:
- Use real Excel row numbers and column letters. Skip fully empty rows and cells.
- Numbers: round to max 4 decimals and strip trailing zeros (`914.9399999999999` → `914.94`). No thousands separators.
- Dates → ISO `YYYY-MM-DD`.
- Merged cells: value in the top-left cell only.
- Trim cell text and collapse whitespace. Newlines inside a cell become ` / `.
- Cell text longer than 1,500 chars is truncated with `…[+N chars]`. Rare, and it protects the context.
- Hidden sheets: include, with `(hidden)` in the header line. Sheets with zero non-empty cells are skipped.

`rendered_text` is saved on the document. It is the single source for coverage/grounding checks and for the "where did this come from" hover in the UI.

---

## 3. Chunking (step 4)

- Token estimate = `ceil(chars / 3.5)`.
- **Threshold:** if the rendered content is over `EXTRACT_CHUNK_TOKENS` (config, default **12,000** input tokens), split it. Keep it conservative because Groq tier TPM limits can be lower than a single large request. Check your account's limits for `openai/gpt-oss-120b` and raise the constant if allowed.
- Split only **between rows/lines**, preferring a boundary just before a row that looks like a section header (one non-empty text cell, no numbers). Each sheet/page starts a new chunk boundary candidate.
- Every chunk after the first gets a **context preamble**: the first header block of the sheet (rows up to and including the first row with ≥ 3 non-empty text cells), marked `CONTEXT ONLY — already extracted, do not output these rows`.
- Chunks run **sequentially**. Chunk k+1's prompt gets `Previous chunk ended inside section: "<name>"` from chunk k's output. The LLM then sets `continues_previous_section: true` on its first section, and the merge step folds it in.
- **Merge:** concatenate sections (fold continuation), concatenate terms, union ignored/header rows. Document header fields come from the first chunk that has a non-null value. `stated_total` comes from the last chunk that has one.
- If finish_reason is `length` (output truncated), automatically **halve that chunk** and retry. This does not count as a validation attempt. Give up after 2 halvings → `chunk_failed` error issue with the row range.
- The sample files are about 35 rows (~5k tokens), so they run as a single chunk.

---

## 4. Groq call wrapper (shared with analysis)

`lib/llm/groq.ts → callGroqJson({ purpose, system, user, zodSchema, validate?, maxAttempts=3, maxTokens, reasoningEffort })`

Request body:
```json
{
  "model": "openai/gpt-oss-120b",
  "messages": [{"role":"system","content":"…"},{"role":"user","content":"…"}],
  "response_format": { "type": "json_object" },
  "temperature": 0,
  "seed": 7,
  "max_completion_tokens": 16000,
  "reasoning_effort": "low",
  "include_reasoning": false
}
```
- Extraction: `reasoning_effort: "low"` (it's transcription, speed matters). Analysis: `"medium"`.
- If Groq offers `response_format: {type: "json_schema", json_schema: {strict: true, schema}}` for this model at build time, it is a drop-in upgrade. The Zod + retry loop below stays regardless, because it is the real guarantee.
- Verify `reasoning_effort` / `include_reasoning` parameter names against current Groq docs at build time. If a param is rejected, drop it (it's an optimization, not a requirement).

Response handling (in order):
1. HTTP 429 → wait `retry-after` (cap 30 s). Doesn't count as an attempt. Max 3 waits.
2. HTTP 5xx / network error → one immediate retry. Doesn't count as an attempt.
3. `finish_reason == "length"` → return `{truncated: true}` to the caller (extraction halves the chunk, analysis retries asking for fewer rows).
4. Take `choices[0].message.content` and defensively strip ```` ```json ```` fences and any text before the first `{` and after the last `}`.
5. `JSON.parse` → fail = attempt error "Output was not valid JSON: <parser message>".
6. `zodSchema.safeParse` → fail = attempt error listing up to 20 issues as `path: message`.
7. `validate(parsed)` (caller-specific semantic checks) → returns `{fatal: string[], warnings: Issue[]}`. A non-empty `fatal` list = attempt error.
8. On attempt error, if attempts remain: append to messages
   - `{"role":"assistant","content": <previous raw output>}`, **only if** it is < 6k tokens (otherwise omit it to save context),
   - `{"role":"user","content": RETRY_TEMPLATE}` and call again.
9. Every call (success or fail) inserts a row into `llm_calls`.

```
RETRY_TEMPLATE:
Your previous response failed validation. Fix ONLY these problems and return the
COMPLETE corrected JSON object (not a diff, no commentary):
- <error 1>
- <error 2>
…
Remember: output a single JSON object matching the schema exactly. No markdown, no prose.
```

After `maxAttempts`:
- If the **last parsed output passed zod** but still has fatal semantic errors → **accept it**. Downgrade the fatal errors to `error` issues, set status `needs_review`. Data is never discarded because a checker is unhappy.
- If no attempt ever produced zod-valid JSON → that chunk fails. Add a `chunk_failed` issue with its row range and the raw rows' text, so the user still sees the content. Other chunks are kept. The document goes to `needs_review` (or `failed` if every chunk failed).

---

## 5. Extraction prompt

`PROMPT_VERSION = "extract-v1"`, stored in `extraction_meta`. Prompts live in `lib/extract/prompts.ts` as template strings and are versioned by constant.

### 5.1 System prompt (verbatim)

```
You are a meticulous data-entry clerk for construction, interiors, furniture, MEP and
procurement documents. You convert ONE document (a tender / bill of quantities / RFQ, or a
contractor's bid / quotation) into a single JSON object that matches the schema below.

You MUST output ONLY one valid JSON object. No markdown fences, no explanations, no text
before or after the JSON.

THE INPUT
- The document has been converted to text. Every row/line starts with an address:
  "R12 | A:… | B:…" (spreadsheet row 12, cells by column letter) or "L40 | text" (text line 40).
- Numbers are plain (no thousands separators). Treat them as exact.

WHAT TO PRODUCE
1. Document header: title, project, the party (for a bid: the contractor/vendor; for a
   tender: the client/releaser), date, reference no., currency, tax basis, stated grand total.
   The file name is a HINT for the party name when the content has no letterhead.
2. Sections: headings that group items ("Civil Works", "Electrical", "Block A - Toilets").
   Items that appear before any heading go in a section with "name": null.
3. Items: every priced or quantified line. An item usually has a quantity and/or unit and/or
   rate/amount. Use "sub_items" for an unnumbered continuation row that adds an extra
   unit/quantity/price component to the item directly above it.
4. Terms: notes, conditions, inclusions/exclusions, payment/validity/GST statements, site
   facilities ("Electricity and water - by Client"), even if they are numbered like items.
   A numbered row with no unit, quantity, rate or amount is a TERM, not an item.

STRICT RULES
- Copy text verbatim (fix nothing except trimming whitespace). Never invent values.
- Every number you output for quantity/rate/amount/stated_total MUST literally appear in the
  row(s) you cite in source_rows. If a value is not present, use null.
- Sr.No / item numbers often restart in each section; copy them as source_ref as printed.
- Rate vs amount: amount ~= quantity x rate. If there are several rate columns and several
  amount columns, they are PRICE VARIANTS: pair each rate with the amount that equals
  quantity x rate (column order may be reversed), and list them in "prices" using variant
  keys "v1","v2",… in left-to-right order of the RATE columns. Describe the variants in
  document.price_variants. With a single price, use one entry with variant "default".
- quote_status: "priced" if rate or amount > 0; "not_priced" if rate and amount are
  blank/0/"-"/"NQ"; "included" if the line says it is included elsewhere or "Include";
  "excluded" if the bidder explicitly excludes it; "not_applicable" for tender lines that
  carry no price at all.
- remarks: copy any remark text on the line verbatim (e.g. "Tile Provide by Client").
  Also set flags from this list only: MATERIAL_BY_CLIENT, LABOUR_ONLY, SUPPLY_ONLY,
  NEEDS_CLARIFICATION, PROVISIONAL, ALTERNATE_OFFERED, RATE_ONLY.
- attributes: put any other per-line facts here as flat key/value pairs with snake_case keys
  (e.g. make_brand, size, warranty_months, lead_time_days). Unlabelled stray cells go here as
  "col_<LETTER>": value. Never drop a cell value from an item row.
- section "trade": one of civil, flooring, ceiling, painting, carpentry, furniture,
  electrical, plumbing, hvac, fire, glazing, metalwork, landscaping, general, other.
- ACCOUNT FOR EVERY ROW: every row/line address in the content must appear exactly once in
  one of: a section's source_rows, an item's/sub-item's source_rows, a term's source_rows,
  "header_rows" (titles, letterhead, column headings), or "ignored_rows" (with a short
  reason, e.g. "blank subtotal 0", "page footer"). Rows marked CONTEXT ONLY are excluded.
- tender_ref (bids only): if a TENDER ITEMS list is provided, set tender_ref to the "ref" of
  the tender item this line prices (match on section, number, name, description, unit and
  quantity together; names repeat, so never match on name alone). Use null if it is not in
  the tender, and give a short tender_ref_reason.

OUTPUT SCHEMA (types shown as values; "|" means alternatives; arrays may be empty):
{
  "schema_version": "1",
  "document": {
    "detected_kind": "tender" | "bid" | "unknown",
    "title": string | null,
    "project_name": string | null,
    "party": { "name": string | null, "address": string | null, "contact": string | null,
               "tax_id": string | null, "extra": { } },
    "document_date": "YYYY-MM-DD" | null,
    "reference_no": string | null,
    "currency": "ISO 4217 code" | null,
    "tax_basis": "excluded" | "included" | "unknown",
    "tax_rate_percent": number | null,
    "stated_total": number | null,
    "price_variants": [ { "key": "v1", "label": string, "stated_total": number | null } ],
    "header_extra": { },
    "header_rows": [ int ],
    "ignored_rows": [ { "row": int, "reason": string } ]
  },
  "sections": [
    {
      "name": string | null,
      "source_ref": string | null,
      "trade": string,
      "continues_previous_section": boolean,
      "source_rows": [ int ],
      "items": [
        {
          "source_ref": string | null,
          "name": string | null,
          "description": string | null,
          "unit": string | null,
          "quantity": number | null,
          "prices": [ { "variant": string, "rate": number | null, "amount": number | null } ],
          "quote_status": "priced" | "not_priced" | "included" | "excluded" | "not_applicable",
          "flags": [ string ],
          "remarks": string | null,
          "attributes": { },
          "tender_ref": string | null,
          "tender_ref_reason": string | null,
          "source_rows": [ int ],
          "sub_items": [ { …same fields as an item, without "sub_items"… } ]
        }
      ]
    }
  ],
  "terms": [ { "category": "tax"|"payment"|"validity"|"timeline"|"site_facilities"|
               "scope_inclusion"|"scope_exclusion"|"material"|"measurement"|"warranty"|"other",
               "text": string, "value": string | null, "source_rows": [ int ] } ],
  "notes_for_reviewer": [ string ]
}

EXAMPLE (different document type, to show the shape — not related to your input):
Input:
L1 | QUOTATION - Sharma Furnishers, GSTIN 07ABCDE1234F1Z5, 12/03/2026
L2 | 1. Ergonomic chair, mesh back, 40 nos @ 6500 = 260000 (3 yr warranty)
L3 | 2. Workstation 1200x600, 40 nos @ 14200 = 568000, delivery 4 weeks
L4 | Prices excl. GST 18%. Validity 15 days.
Output:
{"schema_version":"1","document":{"detected_kind":"bid","title":"QUOTATION","project_name":null,
"party":{"name":"Sharma Furnishers","address":null,"contact":null,"tax_id":"07ABCDE1234F1Z5","extra":{}},
"document_date":"2026-03-12","reference_no":null,"currency":null,"tax_basis":"excluded",
"tax_rate_percent":18,"stated_total":null,"price_variants":[],"header_extra":{},
"header_rows":[1],"ignored_rows":[]},
"sections":[{"name":null,"source_ref":null,"trade":"furniture","continues_previous_section":false,
"source_rows":[],"items":[
{"source_ref":"1","name":"Ergonomic chair","description":"mesh back","unit":"nos","quantity":40,
"prices":[{"variant":"default","rate":6500,"amount":260000}],"quote_status":"priced","flags":[],
"remarks":null,"attributes":{"warranty_months":36},"tender_ref":null,"tender_ref_reason":null,
"source_rows":[2],"sub_items":[]},
{"source_ref":"2","name":"Workstation","description":"1200x600","unit":"nos","quantity":40,
"prices":[{"variant":"default","rate":14200,"amount":568000}],"quote_status":"priced","flags":[],
"remarks":null,"attributes":{"lead_time_days":28},"tender_ref":null,"tender_ref_reason":null,
"source_rows":[3],"sub_items":[]}]}],
"terms":[{"category":"tax","text":"Prices excl. GST 18%.","value":"18%","source_rows":[4]},
{"category":"validity","text":"Validity 15 days.","value":"15 days","source_rows":[4]}],
"notes_for_reviewer":[]}
```

The example is deliberately not a BOQ spreadsheet, to keep the model from overfitting to the sample shape. A term may share a row with another term. The coverage check allows a row to appear in multiple **terms**, but not in two items.

### 5.2 User prompt template

```
DECLARED ROLE (set by the uploader): {{role}}            // "tender" or "bid"
FILE NAME: {{file_name}}
TENDER CURRENCY (use if the document does not state one): {{tender_currency}}
{{#if role == "bid" && tenderItemsTable}}
TENDER ITEMS (use the "ref" value for tender_ref):
ref | section | sr | name | unit | qty
{{#each tenderItems}}{{item_code}} | {{section_name}} | {{source_ref}} | {{name}} | {{unit_raw}} | {{quantity}}
{{/each}}
{{/if}}
CHUNK {{k}} of {{n}} — rows {{firstRow}}–{{lastRow}}.{{#if prevSection}} Previous chunk ended inside section: "{{prevSection}}".{{/if}}
{{#if contextPreamble}}
--- CONTEXT ONLY (already extracted, do not output these rows) ---
{{contextPreamble}}
{{/if}}
--- DOCUMENT CONTENT ---
{{chunkText}}
--- END ---
Return the JSON object now.
```

The tender items table is only included if it is ≤ 6k tokens. For larger tenders, omit it: matching falls back to the deterministic pass only, and unmatched items surface for manual linking. Demo tenders are around 21 items (~1k tokens).

---

## 6. Validation (step 5), all code

Order matters: cheap structural checks first, and the first three feed the retry loop.

| # | Check | On failure |
|---|---|---|
| V1 | `JSON.parse` + Zod schema (`lib/extract/schema.ts`, mirrors §5.1 exactly, `.strict()` on objects except `attributes`/`extra`/`header_extra`) | **retry** with zod messages |
| V2 | **Coverage:** set of "data rows" in the chunk = rows/lines containing ≥ 1 numeric token **or** ≥ 2 non-empty cells. Every data row must be cited by a section/item/sub-item/term/header_rows/ignored_rows. Also: no row cited by two items | **retry** with "Rows R13, R37 were not accounted for. Their content: …" (include the row text). After the final attempt the leftovers become `unaccounted_rows` **error** issues carrying the raw row text |
| V3 | **Grounding:** each `quantity`, `rate`, `amount`, `stated_total` must appear (±0.01, or ±0.5% for values > 1000 to tolerate rounding) among the numeric tokens of its cited rows | **retry** listing offending fields. After the final attempt: `value_not_in_source` warn issue, line `extraction_confidence = low`, value kept |
| V4 | Arithmetic: for each price entry with all three of qty, rate, amount: `abs(qty*rate − amount) ≤ max(1, 0.5%)` | no retry. `amount_mismatch` warn issue (this is the source's own mistake and must be shown, not "fixed") |
| V5 | Totals: `computed_total` (sum of item+sub-item amounts, primary variant) vs `stated_total` (±0.5%) | no retry. `total_mismatch` warn issue |
| V6 | Role sanity: `detected_kind ≠ role`, or role = bid with zero priced items | `role_mismatch` warn issue ("This looks like an unpriced BOQ — did you mean to upload it as the tender?") |
| V7 | Price variants > 1 | `multiple_price_variants` info issue. Code picks `primary_variant` = lowest total |
| V8 | Units | Code normalizes `unit_raw → unit` (doc 01 §3.5) |

Post-validation, still in code: assign `item_code` (section ordinal → item ordinal → sub-item ordinal, 1-based), `position`, `depth`, and copy the primary variant into `rate`/`amount`.

## 7. Matching (step 6, bids only)

Exactly as specified in `01-canonical-schema.md §4`, run after validation. It writes `tender_line_id`, `match_*` columns and `missing_tender_item` / `unmatched_bid_item` / `match_conflict` / `duplicate_link` / `qty_mismatch` / `unit_mismatch` issues.

## 8. Persist + status (steps 7–8)

- One transaction: delete existing `line_items` for the document, then insert the tree (sections first so `parent_id` exists, or generate UUIDs client-side), then update the document header, `issues`, `computed_total`, `raw_llm_output`, `extraction_meta`.
- Bid for a contractor that already has an active bid in this tender (same normalized `party_name`): ask in the UI at upload time "Replace Vinod Mistry's existing bid?" If yes, set the old doc's `superseded_at` and the new doc's `supersedes_id`.
- Final status: `ready` if no `warn`/`error` issues, else `needs_review`. `needs_review` documents **are included** in comparisons (with a badge). The user clicks "Mark as reviewed" to set `ready`. Rationale: blocking the comparison on review would make the demo feel broken.

## 9. Partial-failure contract (summary)

1. A row is never silently lost. It is either in the structured data, in `ignored_rows` with a reason (visible in the review screen under "Rows we skipped"), or in an `unaccounted_rows` / `chunk_failed` issue showing its raw text.
2. A suspicious value is never silently fixed. It is kept, flagged, and shown with its source row.
3. A failed chunk never discards successful chunks.
4. The original file is always downloadable, and `rendered_text` is always stored, so "Reprocess" can be re-run after a prompt fix.
