# 01 — Canonical Schema (Tenders and Bids)

Status: design spec, build from this directly.
Related: `02-ingestion-pipeline.md` (how data gets in), `03-analysis-pipeline.md` (how it is used).

---

## 1. What the sample files taught us (design drivers)

The 9 sample xlsx files look alike, but they already show most of the mess the schema has to absorb. Every point below shaped a field in this schema.

| Observation in sample files | Consequence for schema |
|---|---|
| Sr.No **restarts in every section** (Civil 1-11, Gypsum 1-7, Balcony 1-3) | Sr.No alone is not an identity. The identity is section + sr.no, so a system-generated `item_code` like `1.8` is used |
| Duplicate item names ("Room Flooring" is item 1.1 AND 1.8, "Toilet Walls" is 1.5 AND 1.7) | Matching can never be done on name alone |
| Header cell for Sr.No is sometimes "```" (VK, KSB, OM INFRA) | Header detection is the LLM's job, not a hardcoded column map |
| Brijesh: **3 Rate columns and 3 Amount columns**, and the amounts are in **reverse order** of the rates (amount col I = rate col H x qty) | A line can carry several price variants. Rate and amount must be paired by arithmetic, not by column order |
| Brijesh/KSB: an **unnumbered sub-row under item 8** (RMT 237 @ 1850) | Items can have sub-items (depth 3 max) that roll up into the parent |
| Rate 0 / blank with amount 0 on SPC Flooring (most bidders) | Explicit `quote_status = not_priced`, never treated as "free" |
| Remarks like "Tile Provide by Client", "Labour rate", "STONE PROVIED BY CLIENT", "Need to detail discuss" | Keep raw `remarks` AND normalized `flags` (controlled vocab) so the remarks can be compared |
| Rajat: 12 numbered "Notes" rows that *look* like items (have a Sr.No) | Terms and conditions are a separate structure (`terms`), not line items |
| Brijesh: "Housekeeping - Include", "Electricity and water - by Client" | These are terms of the `site_facilities` category with a short value |
| OM INFRA: "Grand Total Amount (GST Excluding)"; RISEDECK: "GST 18%" | Document-level `tax_basis` + `tax_rate_percent` |
| Letterheads (OM INFRA address/date, KSB contact + GST no.) vs. contractor name only in the **file name** (Vinod Mistry, Brijesh Ji) | `party` object, with the file name passed to the LLM as a hint, and the user confirms the name |
| Stray far-right cells (col AR/AS: `340`, `sqm`) | Unknown cells go into the `attributes` bag. They are never dropped |
| Float noise (`914.9399999999999`) | Rounded at render time. Stored as `numeric(18,4)` |
| vyaas file: quantities, a few rates with no amounts, Grand Total 0 | Tender lines may carry an optional **reference/budget rate** |

The schema below is **not** shaped like this BOQ. It is a generic "document with an optional section tree of priced lines plus terms". The BOQ is just one instance. A furniture quote written as prose ("40 nos ergonomic chairs @ 6,500, 3 yr warranty, 4 weeks delivery") fits the same model: one section (name null), one item, `attributes.warranty_months = 36`, `attributes.lead_time_days = 28`.

---

## 2. Conceptual model

```
Tender (the project / RFQ)
 ├── Requirements document (role = tender)     ← exactly one active
 │     ├── terms[]
 │     └── line tree:  section → item → sub_item
 └── Bid documents (role = bid), one active per contractor
       ├── party (contractor), totals, tax basis, price variants, terms[]
       └── line tree:  section → item → sub_item
              item.tender_line_id ──► the tender line it prices (or null = extra item)

Analysis (per tender): request text → typed result (table | ranking | narrative)
```

- **Tender** = the project container (title, client, currency). It is not the file.
- **Document** = one uploaded file, after extraction. Tender requirements and bids use the **same** document and line shape, and `role` tells them apart. This is the core simplification: one extractor, one table component, one export.
- **Line** = a row in a tree. `kind` is `section` or `item`. Sub-items are `kind = item` with a parent that is an item.

### Depth rule
Max depth 3: `section (0) → item (1) → sub_item (2)`. Deeper source nesting (e.g. "Block A > Floor 2 > Toilets") is flattened by joining section names with ` › ` ("Block A › Floor 2 › Toilets"). Items with no section go into a section whose `name` is null. The UI shows it as "General".

---

## 3. Canonical fields

### 3.1 Document (header / metadata)

| Field | Type | Notes |
|---|---|---|
| `role` | `tender` \| `bid` | Declared by the uploader in the UI |
| `detected_kind` | `tender` \| `bid` \| `unknown` | What the LLM thinks it is. A mismatch with `role` raises a warning (e.g. a blank template uploaded as a bid) |
| `title` | text | Document title as written ("ITC FORTUNE GUWAHATI") |
| `project_name` | text null | |
| `party` | object | `{name, address, contact, tax_id, extra{}}`. For bids this is the contractor, for tenders the releaser/client |
| `document_date` | date null | ISO |
| `reference_no` | text null | Quote/RFQ number, "R0" revision tags, etc. |
| `currency` | ISO-4217 text | Default from the tender (INR) when the document is silent |
| `tax_basis` | `excluded` \| `included` \| `unknown` | |
| `tax_rate_percent` | numeric null | |
| `stated_total` | numeric null | Grand total **as printed**, for the primary variant |
| `computed_total` | numeric | Computed by code: sum of item amounts (sub-items included) |
| `price_variants` | jsonb `[{key, label, stated_total}]` | Empty for a single-price bid. Brijesh = 3 variants |
| `primary_variant` | text null | The variant key whose numbers live in `rate`/`amount` columns. Default = lowest-total variant. The user can switch it |
| `terms` | jsonb `[{category, text, value, source_rows[]}]` | category ∈ `tax, payment, validity, timeline, site_facilities, scope_inclusion, scope_exclusion, material, measurement, warranty, other` |
| `header_extra` | jsonb | Anything header-level that doesn't fit (site address, GSTIN, signatory) |
| `issues` | jsonb `[Issue]` | See 3.4 |

### 3.2 Line (section or item)

| Field | Type | Applies to | Notes |
|---|---|---|---|
| `kind` | `section` \| `item` | both | |
| `parent_id` | uuid null | both | section → null. item → section. sub_item → item |
| `position` | int | both | Order in source, 0-based, global across the document |
| `item_code` | text | both | **System-generated, stable key**: section ordinal, then item ordinal within section, then sub-item ordinal: `1`, `1.8`, `1.8.1`. Never taken from the LLM |
| `source_ref` | text null | both | Sr.No / item code **as printed** ("8", "2a", "C-14") |
| `name` | text null | both | Short name ("Room Flooring"). For sections: section heading |
| `description` | text null | item | Full spec text |
| `trade` | text null | section | One of: `civil, flooring, ceiling, painting, carpentry, furniture, electrical, plumbing, hvac, fire, glazing, metalwork, landscaping, general, other`. LLM-assigned. Makes "civil works only" analyses possible across any document |
| `unit_raw` | text null | item | As printed ("SQMT") |
| `unit` | text null | item | Normalized by code (see 3.5) |
| `quantity` | numeric null | item | |
| `rate` | numeric null | item | Rate of the primary variant. On tender lines = optional reference/budget rate |
| `amount` | numeric null | item | Amount of the primary variant |
| `prices` | jsonb `[{variant, rate, amount}]` | item | All variants. Single-price bids have one entry with variant `"default"` |
| `quote_status` | enum | item | `priced` (has rate/amount > 0) · `not_priced` (blank/0/"NQ") · `included` ("included in item X", "Include") · `excluded` (contractor explicitly excludes) · `not_applicable` (tender lines with no price expected) |
| `flags` | text[] | item | Controlled vocab: `MATERIAL_BY_CLIENT, LABOUR_ONLY, SUPPLY_ONLY, NEEDS_CLARIFICATION, PROVISIONAL, ALTERNATE_OFFERED, RATE_ONLY` (rate given, no amount) |
| `remarks` | text null | item | Raw remark text, verbatim |
| `attributes` | jsonb | both | **The extensibility bag.** Flat `{key: string \| number \| boolean}`, snake_case keys. Suggested keys (not required): `make_brand, model, size, finish, colour, warranty_months, lead_time_days, hsn_sac, location, drawing_ref, spec_ref, rate_kind` (`budget` on tender lines). Unrecognized source cells land here as `col_AR: 340` |
| `source_rows` | int[] | both | Row/line numbers in the rendered source (R5, L12). Drives the "show me where this came from" hover and the coverage check |
| `extraction_confidence` | `high` \| `low` | item | `low` if the validators had to flag something about this line |
| `tender_line_id` | uuid null | bid items | Link to the tender line this prices. Null = extra item |
| `match_method` | `code` \| `llm` \| `code+llm` \| `manual` \| null | bid items | |
| `match_confidence` | `exact` \| `high` \| `low` \| `conflict` \| null | bid items | |
| `match_note` | text null | bid items | Human-readable reason ("Sr.No 8 in Civil Works, unit + qty agree") |

### 3.3 Analysis
Defined in `03-analysis-pipeline.md`. Stored in `analyses` table (DDL below).

### 3.4 Issue object (shared by documents and lines)

```json
{ "code": "amount_mismatch", "severity": "warn", "line_id": "uuid|null",
  "source_rows": [11], "message": "839 x 151 = 1,26,689 but amount says 9,64,850",
  "data": { "expected": 126689, "found": 964850 } }
```
`severity` ∈ `info | warn | error`. Codes: `unaccounted_rows, value_not_in_source, amount_mismatch, total_mismatch, qty_mismatch, unit_mismatch, unmatched_bid_item, missing_tender_item, duplicate_link, match_conflict, low_confidence_match, role_mismatch, duplicate_file, multiple_price_variants, chunk_failed`.

Issues are **always shown** to the user (review screen + badges), never hidden. This is the "never silently drop" contract.

### 3.5 Unit normalization (code, not LLM)
Small dictionary in `lib/units.ts`, case-insensitive, punctuation stripped:
`sqmt|sqm|sq.m|m2|sq mtr → sqm` · `sqft|sft|sq.ft|ft2 → sqft` · `rmt|rm|mtr|m|running meter → rmt` · `rft|running ft → rft` · `nos|no|no.|each|ea|pcs|unit → nos` · `cum|m3|cu.m → cum` · `kg|kgs → kg` · `ls|lump sum|lumpsum|job → ls` · `set|sets → set`. Anything else: `unit = lower(trim(unit_raw))`. **No conversions in the demo.** A different normalized unit is flagged as `unit_mismatch`, not converted. Rationale: a wrong conversion is worse than a visible flag.

---

## 4. Bid ↔ tender matching strategy

Matching runs **once per bid, at upload time**, as part of ingestion. It is mostly code. The LLM only contributes a *hint* inside the same extraction call, so matching costs no extra LLM call.

### 4.1 Inputs
- Tender lines (active requirements doc): `item_code, section name, source_ref, name, unit, quantity`.
- Bid lines after extraction, each with an LLM-proposed `tender_ref` (an `item_code` from the tender list included in the bid extraction prompt, or null + `tender_ref_reason`).

### 4.2 Deterministic pass (`lib/match.ts`)
For every top-level bid item (sub-items inherit the parent's link):

1. **Section alignment.** Map each bid section to a tender section. First by normalized-name similarity (token-set Jaccard ≥ 0.6, after lowercasing and stripping punctuation and "&"/"and"). If that fails, by ordinal position when section counts are equal.
2. **Code candidate.** Within the aligned section, find the tender item with the same normalized `source_ref` (strip trailing `.`, leading zeros, spaces).
3. **Name+unit+qty candidate.** If no code candidate: tender item in the aligned section (then anywhere) with the same normalized `unit` and quantity within ±0.5%, choosing the highest name similarity (≥ 0.3). Name similarity = token-set Jaccard on names, with leading numbering like `"37."` removed.
4. Combine with the LLM hint:

| Deterministic result | LLM `tender_ref` | Outcome |
|---|---|---|
| code candidate, unit equal, (qty equal OR name sim ≥ 0.5) | same | `exact`, method `code+llm` |
| code candidate as above | null/different | `high`, method `code`, plus a `match_conflict` **info** issue if the LLM differs |
| name+unit+qty candidate | same | `high`, method `code+llm` |
| none | ref given, unit equal | `high` if name sim ≥ 0.3 or qty equal, else `low`. Method `llm` |
| none | ref given, unit differs | `low`, method `llm`, plus a `unit_mismatch` issue |
| candidate X | ref Y ≠ X, and neither rule is strong | use X, `conflict`, `match_conflict` **warn** issue |
| none | null | unmatched → **extra item** |

5. **Uniqueness.** If two top-level bid items link to the same tender item, keep the stronger one. The other becomes `low` + a `duplicate_link` issue. Sub-items are exempt because they intentionally share the parent's link.

### 4.3 Edge cases (explicit decisions)
- **Contractor skips a tender item (row absent):** no bid line exists. The comparison computes it as **"Missing"** at read time (no placeholder row is stored) and a `missing_tender_item` info issue is added to the bid.
- **Row present but blank/0 rate:** stored line with `quote_status = not_priced`, shown as **"Not quoted"**. Kept distinct from "Missing", because a blank row usually means "I chose not to price this" and a missing row may mean "I edited your BOQ".
- **Contractor adds items not in the tender:** `tender_line_id = null`. Shown in an **"Extra items offered"** block under the comparison. Counted in `computed_total`, **not** in like-for-like totals.
- **Sub-item pricing (Brijesh/KSB item 8 + RMT row):** the sub-item links to the same tender line. The comparison sums parent + sub-items into one cell ("₹7,14,299 + ₹3,80,906") with a "split" marker. Effective rate = total ÷ tender qty.
- **Quantity differs from tender:** `qty_mismatch` warn issue. The comparison's **Amount column is normalized** = bid rate × tender qty, with the stated amount in the tooltip. Rationale: bids must be compared on the tender's quantities or the totals lie.
- **Multiple price variants:** comparison uses `primary_variant` (default = lowest stated/computed total). A chip says "3 price options – using Option C" and the user can switch it on the bid page, which rewrites `rate`/`amount` from `prices`.
- **Manual fix:** on the bid review screen the user can re-link any bid item via a dropdown of tender items. This sets `match_method = manual`, `match_confidence = exact`.
- **Tender re-upload after bids exist:** blocked in the demo, with the message "Bids are linked to these requirements. Create a new tender instead." This avoids a re-matching migration.

---

## 5. Postgres DDL (Supabase)

Single-tenant demo: no `owner_id`/RLS policies. All access goes through Next.js server routes using the service-role key, never from the browser.

```sql
-- 0001_extensions_enums.sql
create extension if not exists pgcrypto;

create type doc_role        as enum ('tender','bid');
create type doc_status      as enum ('uploaded','parsing','extracting','validating','matching',
                                     'needs_review','ready','failed');
create type line_kind       as enum ('section','item');
create type quote_status    as enum ('priced','not_priced','included','excluded','not_applicable');
create type match_method    as enum ('code','llm','code+llm','manual');
create type match_conf      as enum ('exact','high','low','conflict');
create type analysis_type   as enum ('table','ranking','narrative');
create type analysis_status as enum ('running','ready','failed');

-- 0002_tenders.sql
create table tenders (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  client_name        text,
  location           text,
  currency           text not null default 'INR',
  notes              text,
  requirements_doc_id uuid,                      -- FK added after documents exists
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 0003_documents.sql
create table documents (
  id                 uuid primary key default gen_random_uuid(),
  tender_id          uuid not null references tenders(id) on delete cascade,
  role               doc_role not null,
  status             doc_status not null default 'uploaded',
  status_detail      text,                       -- e.g. "Reading chunk 2 of 3"
  -- raw file
  file_name          text not null,
  storage_path       text not null,              -- bucket 'tender-files': {tender_id}/{doc_id}/{file_name}
  mime_type          text,
  file_size_bytes    bigint,
  file_sha256        text not null,
  rendered_text      text,                       -- exact text sent to the LLM (for coverage checks, hover-source, reprocess)
  -- header (canonical)
  detected_kind      text,                       -- tender|bid|unknown
  title              text,
  project_name       text,
  party_name         text,                       -- contractor (bid) / client (tender); user-editable
  party              jsonb not null default '{}',
  document_date      date,
  reference_no       text,
  currency           text,
  tax_basis          text check (tax_basis in ('excluded','included','unknown')),
  tax_rate_percent   numeric(6,3),
  stated_total       numeric(18,4),
  computed_total     numeric(18,4),
  price_variants     jsonb not null default '[]',
  primary_variant    text,
  terms              jsonb not null default '[]',
  header_extra       jsonb not null default '{}',
  issues             jsonb not null default '[]',
  -- provenance
  extraction_meta    jsonb not null default '{}', -- {prompt_version, model, chunks, attempts, tokens_in, tokens_out, ms}
  raw_llm_output     jsonb,                      -- merged validated LLM JSON, kept verbatim
  supersedes_id      uuid references documents(id),
  superseded_at      timestamptz,                -- set when a newer revision for same contractor arrives
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on documents (tender_id, role) where superseded_at is null;
create index on documents (file_sha256);

alter table tenders add constraint tenders_requirements_doc_fk
  foreign key (requirements_doc_id) references documents(id) on delete set null;

-- 0004_line_items.sql
create table line_items (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents(id) on delete cascade,
  parent_id          uuid references line_items(id) on delete cascade,
  kind               line_kind not null,
  depth              smallint not null check (depth between 0 and 2),
  position           int not null,
  item_code          text not null,              -- system-generated: '1', '1.8', '1.8.1'
  source_ref         text,
  name               text,
  description        text,
  trade              text,
  unit_raw           text,
  unit               text,
  quantity           numeric(18,4),
  rate               numeric(18,4),
  amount             numeric(18,4),
  prices             jsonb not null default '[]', -- [{variant, rate, amount}]
  quote_status       quote_status,
  flags              text[] not null default '{}',
  remarks            text,
  attributes         jsonb not null default '{}',
  source_rows        int[] not null default '{}',
  extraction_confidence text check (extraction_confidence in ('high','low')),
  -- bid → tender link
  tender_line_id     uuid references line_items(id) on delete set null,
  match_method       match_method,
  match_confidence   match_conf,
  match_note         text,
  unique (document_id, item_code)
);
create index on line_items (document_id, position);
create index on line_items (tender_line_id);
create index on line_items using gin (attributes);

-- 0005_analyses.sql
create table analyses (
  id                 uuid primary key default gen_random_uuid(),
  tender_id          uuid not null references tenders(id) on delete cascade,
  request_text       text not null,
  requested_type     text not null default 'auto',   -- auto|table|ranking|narrative
  template_key       text,                           -- quick-pick used, if any
  status             analysis_status not null default 'running',
  response_type      analysis_type,
  title              text,
  description        text,
  answerable         boolean,
  result             jsonb,                          -- the validated envelope (see doc 03)
  validation         jsonb not null default '{}',    -- {ungrounded_numbers:[], warnings:[]}
  input_snapshot     jsonb not null,                 -- {requirements_doc_id, bid_doc_ids:[], facts_pack_hash, reductions:[]}
  cache_key          text,                           -- sha256(request_text|requested_type|facts_pack_hash|prompt_version)
  llm_meta           jsonb not null default '{}',
  error              text,
  created_at         timestamptz not null default now()
);
create index on analyses (tender_id, created_at desc);
create index on analyses (cache_key);

-- 0006_llm_calls.sql  (audit log: proves LLM use is restricted, helps debugging)
create table llm_calls (
  id                 bigserial primary key,
  purpose            text not null check (purpose in ('extraction','analysis')),
  document_id        uuid references documents(id) on delete set null,
  analysis_id        uuid references analyses(id) on delete set null,
  chunk_index        int,
  attempt            int not null,
  model              text not null,
  prompt_version     text not null,
  tokens_in          int,
  tokens_out         int,
  latency_ms         int,
  finish_reason      text,
  ok                 boolean not null,
  error              text,
  created_at         timestamptz not null default now()
);

-- updated_at trigger for tenders/documents (standard moddatetime or a 5-line plpgsql trigger)
```

Storage: private bucket `tender-files`, created in a migration (`insert into storage.buckets (id, name, public) values ('tender-files','tender-files', false)`). The server reads and writes it with the service-role key. The browser gets 10-minute signed URLs for "Download original".

### Why one `line_items` table for tender and bid lines
Same shape, same renderer, same exporter, and `tender_line_id` is a simple self-FK. The cost is one nullable link column on tender rows, which is negligible.

### Why jsonb for `prices`, `terms`, `attributes`, `issues`
They are read as a whole, shown as a whole and never joined on. Relational tables for them would add 4 tables and many joins for zero query benefit in a demo.
