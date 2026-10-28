# 05 — Build Plan (solo engineer, demo scope)

Read `01`–`04` first. This file is the order of work. Every step should end with something you can click.

---

## 0. Scope guardrails: explicitly SKIP these

| Skip | Do instead |
|---|---|
| Auth, users, orgs, RLS policies | Single tenant. All DB/storage access goes through Next.js route handlers with `SUPABASE_SERVICE_ROLE_KEY`, server-side only. The browser never talks to Supabase directly. (Optional: one `DEMO_PASSWORD` basic-auth check in `middleware.ts` if the demo URL is public) |
| Contractor self-service portal | The releaser uploads bids on the contractors' behalf. (Stretch, only if time remains: a `/submit/[token]` page that is just the upload box) |
| Job queue / background workers / realtime | Long synchronous route handlers (`maxDuration` 300) + client polling of status |
| OCR for scanned PDFs, images, pptx | Reject with a clear message |
| Unit conversion, currency conversion, tax normalization | Flag only |
| Tender re-upload once bids exist | Blocked with a message |
| Rich line editing | Only: edit qty/unit/name on tender lines (before bids), re-link a bid line, switch price variant, edit contractor name |
| Versioned history UI | `supersedes_id` stored, no UI beyond "Replace earlier bid?" |
| i18n, mobile-first layouts | Desktop-first. It must not break at 1024px |
| Unit/e2e test suites | A handful of focused unit tests (listed in §5) + the manual demo script |

---

## 1. Stack and packages

- Next.js (App Router, TypeScript) + Tailwind. Put the palette in `tailwind.config` `theme.extend.colors` (`primary`, `primary-dull`, `dark`, …, `ok-bg`/`ok-fg`, `bad-bg`/`bad-fg`, `warn-bg`/`warn-fg` from doc 04 §0).
- `@supabase/supabase-js` (server only).
- `xlsx` (SheetJS) for parsing xlsx/xls/csv. `unpdf` for PDF text. `mammoth` for docx. `file-type` for magic-byte detection.
- `zod` for all LLM schemas.
- `exceljs` for formatted Excel export. CSV is written by hand (BOM + RFC4180 quoting).
- `react-markdown` (with `allowedElements`) for narrative results.
- No UI kit is required. Hand-rolled Tailwind components are fine. No table library: the grids are custom with `position: sticky`.
- Groq: plain `fetch` to `https://api.groq.com/openai/v1/chat/completions` (no SDK needed).

Env (`.env.local`): `GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_MODEL=openai/gpt-oss-120b`, `EXTRACT_CHUNK_TOKENS=12000`, `ANALYSIS_INPUT_TOKENS=20000`. (A `.env` already exists at the repo root. Check what it contains and move the keys to `.env.local` with these names.)

---

## 2. Supabase migrations (in this order)

`supabase/migrations/`, DDL in doc 01 §5:
1. `0001_extensions_enums.sql`: pgcrypto + all enums
2. `0002_tenders.sql`
3. `0003_documents.sql` + the deferred FK `tenders.requirements_doc_id`
4. `0004_line_items.sql`
5. `0005_analyses.sql`
6. `0006_llm_calls.sql`
7. `0007_updated_at_triggers.sql`
8. `0008_storage_bucket.sql`: private bucket `tender-files`

Then generate TS types (`supabase gen types typescript`) into `lib/db/types.ts`.

---

## 3. Code layout

```
lib/
  db/server.ts            supabase client (service role), typed
  db/types.ts             generated
  format.ts               INR formatting (₹2,03,47,940 and ₹2.03 Cr), qty, dates
  units.ts                unit normalization (doc 01 §3.5)
  llm/groq.ts             callGroqJson + retry loop + llm_calls logging (doc 02 §4)
  ingest/detect.ts        file-type detection
  ingest/render-sheet.ts  xlsx/csv → addressed text (doc 02 §2)
  ingest/render-pdf.ts, render-docx.ts, render-text.ts
  ingest/chunk.ts         chunking + context preamble (doc 02 §3)
  extract/prompts.ts      system + user templates, PROMPT_VERSION
  extract/schema.ts       zod schema mirroring doc 02 §5.1
  extract/validate.ts     V1–V8 (coverage, grounding, arithmetic, totals…)
  extract/merge.ts        chunk merge, item_code assignment, primary variant
  extract/persist.ts      transactional write of document + line tree
  extract/pipeline.ts     orchestrates steps 3–8, updates status/status_detail
  match.ts                bid ↔ tender matcher (doc 01 §4)
  compare.ts              buildComparison (doc 03 §2), the single source of numbers
  analysis/factsPack.ts   render + reductions + numberSet (doc 03 §4)
  analysis/prompts.ts, analysis/schema.ts, analysis/validate.ts, analysis/run.ts
  export/xlsx.ts          BOQ, comparative statement, table/ranking results
  export/csv.ts
app/
  page.tsx                                   tender list
  tenders/new/page.tsx
  tenders/[id]/page.tsx                      tabs via ?tab=requirements|compare|bids|reports|ask
  tenders/[id]/bids/[docId]/page.tsx
  tenders/[id]/reports/[analysisId]/page.tsx
  api/...                                    see §4
components/
  BoqTable.tsx            used for Requirements + single bid (section bands, expandable descriptions, source hover)
  ComparisonGrid.tsx      comparative statement (sticky cols, tints, markers, footer metrics)
  ResultTable.tsx, ResultRanking.tsx, ResultNarrative.tsx
  UploadDropzone.tsx, ProcessingProgress.tsx (polls status)
  IssuesDrawer.tsx        "Things to check"
  Tabs.tsx, Money.tsx, Badge.tsx, ExportButton.tsx
```

---

## 4. API routes

All are route handlers under `app/api`. JSON in/out unless noted. **Only two routes ever call the LLM** (marked 🤖).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tenders` | List tenders with counts + L1 summary (uses `compare.ts` lightweight totals) |
| POST | `/api/tenders` | Create tender `{title, client_name?, location?, currency?}` |
| GET | `/api/tenders/:id` | Tender + requirements doc header + active bids summary |
| PATCH | `/api/tenders/:id` | Rename / edit fields / archive |
| POST | `/api/tenders/:id/documents` | **multipart** upload `{file, role: tender\|bid, party_name?, replace_document_id?}` → Storage + `documents` row (status `uploaded`), sha256 duplicate check. No LLM. Rejects tender upload if bids exist |
| POST | `/api/documents/:id/process` 🤖 | Runs the ingestion pipeline (doc 02). Idempotent. `maxDuration = 300`. Returns the final document summary |
| GET | `/api/documents/:id` | Document header, status/status_detail, issues, line tree (polled during processing) |
| GET | `/api/documents/:id/file` | Redirect to a 10-min signed URL of the original |
| PATCH | `/api/documents/:id` | `{party_name?, primary_variant?, mark_reviewed?, tax_basis?}`. Switching the variant rewrites line rate/amount from `prices` |
| DELETE | `/api/documents/:id` | Delete a bid (and its storage object) |
| PATCH | `/api/line-items/:id` | Tender line: `{name?, unit_raw?, quantity?}` (only if no bids). Bid line: `{tender_line_id \| null}` → `match_method=manual`. Resolves related issues |
| GET | `/api/tenders/:id/comparison` | `buildComparison` result (no LLM) |
| GET | `/api/tenders/:id/comparison/export?format=xlsx\|csv` | File download |
| GET | `/api/documents/:id/export?format=xlsx\|csv` | BOQ / bid file download |
| GET | `/api/tenders/:id/analyses` | List: id, title, description, response_type, created_at, stale flag |
| POST | `/api/tenders/:id/analyses` 🤖 | `{request_text, requested_type, template_key?, force?}` → cache hit or new run (doc 03 §3). `maxDuration = 120` |
| GET | `/api/analyses/:id` | Full result + validation + snapshot |
| PATCH | `/api/analyses/:id` | Rename `{title}` |
| DELETE | `/api/analyses/:id` | Delete |
| GET | `/api/analyses/:id/export?format=xlsx\|csv\|md` | File download |

---

## 5. Build order (milestones)

**M1: Skeleton (½ day).** Next app, Tailwind palette, top bar + logo, migrations applied, `lib/db/server.ts`. Tender list + create tender (no file). ✔ You can create and list tenders.

**M2: Upload + render, no LLM (½ day).** Upload route, Storage, sha256. `render-sheet.ts` + the other renderers. A temporary debug view that shows `rendered_text`. ✔ All 9 sample files render into clean `R5 | A:1 | B:Room Flooring …` text. Check that the floats are rounded and that the far-right `AR/AS` cells appear.

**M3: Extraction (1–1½ days).** `groq.ts` with retry + logging, prompts, zod schema, validators V1–V8, merge, persist, pipeline + status polling. Requirements tab with `BoqTable`. ✔ The tender file shows 21 items in 3 sections, and the issues drawer works.
- Unit tests (vitest, pure functions, no LLM): `render-sheet` on one sample file (snapshot), coverage checker, grounding checker, amount-pairing check (Brijesh row 11 reversed columns), `units.ts`, `format.ts` Indian grouping.

**M4: Bids + matching (1 day).** Bid upload (multi-file), tender-items list injected into the prompt, `match.ts`, single bid page, re-link dropdown, price-variant switch, "Replace earlier bid?". ✔ All 7 bids are linked with `exact`/`high` confidence on all 21 items.

**M5: Comparative Statement (1 day).** `compare.ts`, `ComparisonGrid`, footer metrics, tints/markers, xlsx + csv export. ✔ The numbers match §6 expected values exactly.

**M6: Analyses (1 day).** Facts pack, prompts, zod discriminated union, validation A1–A6, cache, 3 result renderers, reports list + staleness, quick picks, exports. ✔ The 6 quick picks each return a valid result.

**M7: Polish (½ day).** Empty states, error states, loading copy, plain-language issue text, 1024px check.

Total ≈ 6–7 working days.

---

## 6. Demo / test plan with the 9 sample files (all in `E:\COC1\`)

### Roles
| File | Use as |
|---|---|
| `vyaas ITC FORTUNE GUWAHATI FOR CONTRACTORS.xlsx` | **The tender (Requirements).** Quantities for all 21 items, Grand Total 0, and a few reference rates without amounts (750, 900, 1100, 4000), which should appear as "Budget rate" |
| `vyaas ITC FORTUNE GUWAHATI FOR CONTRACTORS - Copy.xlsx` | **Negative test.** Upload it as a *bid*. Expect a `duplicate_file` warning (same sha256 as the tender) + a `role_mismatch` warning ("looks like an unpriced BOQ") |
| `ITC FORTUNE GUWAHATI FOR CONTRACTORS ( Vinod Mistry ).xlsx` | Bid. Contractor name from the **file name** |
| `ITC FORTUNE GUWAHATI FOR CONTRACTORS Brijesh Ji..xlsx` | Bid. **3 price variants**, reversed amount columns, sub-row under item 8, site-facility terms |
| `ITC FORTUNE GUWAHATI FOR CONTRACTORS Rajat Sharma Paras Bhai Vendor.xlsx` | Bid. The only bid pricing SPC items. 12 numbered notes that must become **terms, not items** |
| `ITC FORTUNE GUWAHATI FOR Civil (KSB INTERIOR).xlsx` | Bid. Letterhead with contact + GSTIN, header cell "```", sub-row under item 8 |
| `ITC_FORTUNE_GUWAHATI RISEDECK.xlsx` | Bid. Title "( RISE DECK)" is the contractor hint. Rate 0 on SPC rows. GST 18% note |
| `OM INFRA Quote R0  ITC FORTUNE GUWAHATI FOR CONTRACTORS.xlsx` | Bid. Letterhead + date 2026-09-13, "GST Excluding" total, remark "Need to detail discuss" |
| `VK INTERIORE GUWAHATI RATE (3).xlsx` | Bid. "TILES/STONE PROVIED BY CLIENT" remarks on 10 civil items (MATERIAL_BY_CLIENT) |

### Expected values (verified from the files; the app must reproduce these exactly)

| Bid | Stated = computed total | Like-for-like (excl. SPC 1.2/1.3) | Expected rank (LFL) | Must-see flags |
|---|---|---|---|---|
| Rise Deck | 1,88,15,100 | 1,88,15,100 | L1 | SPC rows not priced (rate 0). Term: service lift by client, GST 18% |
| Brijesh Ji (variant v3 = lowest) | 1,95,75,630 | 1,95,75,630 | L2 | 3 variants: totals **1,95,75,630 / 1,98,33,454 / 2,32,93,157**. Item 8 sub-row (237 rmt @ 1,850) priced only in the other two variants. Terms "Include"/"by Client" |
| KSB Interior | 1,97,02,212.78 | 1,97,02,212.78 | L3 | Item 8 split: 7,14,299.04 + 3,80,906.40. Party GSTIN captured |
| Vinod Mistry | 2,03,47,940 | 2,03,47,940 | L4 | MATERIAL_BY_CLIENT on 1.4–1.11. LABOUR_ONLY on 2.1–2.3, 2.7 |
| VK Interiore | 2,16,42,732.28 | 2,16,42,732.28 | L5 | MATERIAL_BY_CLIENT on 1.1, 1.4–1.11 |
| Rajat Sharma | 3,16,57,240 | 2,80,89,860 | L6 | Priced SPC (35,67,380). 12 terms (GST excluded, 25% advance, 30-day validity, …) |
| OM Infra | 3,02,80,500 | 3,02,80,500 | L7 | tax_basis = excluded. Item 1.8 remark → NEEDS_CLARIFICATION |

(Brijesh: the amount columns are in reverse order of the rate columns. Rate col H ↔ amount col I = 1,95,75,630. If extraction pairs by column order, V4 will raise amount_mismatch on nearly every row. That is the signal it went wrong.)

### Manual verification checklist
1. **Tender:** 3 sections (Civil Works 11, Gypsum & POP Punning and Paint work 7, Additional Items for Balcony 3) = **21 items**. Item codes `1.1–1.11`, `2.1–2.7`, `3.1–3.3`. Duplicate names (1.1 / 1.8 "Room Flooring") are both present. Stray `340 / sqm` cells appear in `attributes` of 3.1–3.3. No row is missing (the issues drawer has no `unaccounted_rows`).
2. **Each bid:** every one of the 21 tender items is linked (`exact` or `high`). Zero extra items. SPC 1.2/1.3 show "—" (not priced) for all except Rajat.
3. **Brijesh:** 3 price options chip, default v3. Switching to v1 changes the quoted total to 2,32,93,157 and re-ranks.
4. **Rajat:** the notes appear under Terms, not as items numbered 1–12.
5. **Comparative Statement:** the footer matches the table above. Item 1.1 lowest = Rise Deck ₹850 (green), highest = OM Infra ₹1,750 (orange). VK's ₹1,184.04 cell has the 🏷 marker and the warning tint.
6. **Excel export** of the comparative statement opens in Excel with frozen panes, brown section bands and correct Indian number formats.
7. **Analyses:** run all 6 quick picks. Check that (a) every result validates and renders, (b) "Compare total cost" figures equal the table above (no dotted-underline on totals), (c) "Rank by value for money" mentions that Vinod/VK prices exclude client-supplied tiles/stone and that Rajat is the only complete bid, (d) re-running the same quick pick returns the saved answer instantly, (e) a nonsense request ("what's the weather in Guwahati") returns `answerable: false` narrative.
8. **Restrictive LLM usage:** `select purpose, count(*) from llm_calls group by 1` shows only `extraction` (one or a few per upload) and `analysis` (one per non-cached run). Opening pages, comparisons and exports create **zero** rows.
9. **Generality smoke test** (not from the samples): paste a 5-line plain-text furniture quote into a `.txt` and upload it as a bid on a new tender with a tiny `.csv` tender. It should extract into 1 unnamed section with `attributes` like `warranty_months`.

---

## 7. Known risks + pragmatic mitigations

| Risk | Mitigation already in the design |
|---|---|
| gpt-oss-120b JSON drift | json_object mode + verbatim schema in prompt + zod + 3-attempt feedback loop. Upgrade to `json_schema` strict if Groq supports it for the model |
| Groq TPM limits on smaller tiers | Conservative chunk size, `retry-after` handling, token budgets as env constants |
| Hallucinated numbers in extraction | Grounding check V3 against cited source rows |
| Hallucinated numbers in analysis | Code-computed facts pack + grounding check A5 + UI dotted-underline |
| Silent data loss | Coverage check V2 + `ignored_rows` + `unaccounted_rows` issues |
| Long requests on hosting | `maxDuration`. Run the demo locally or on a plan that allows 300 s functions |
