-- Per-cell provenance, anomalies, unit conversion, sheet tracking
alter table line_items add column if not exists cell_meta jsonb not null default '{}'::jsonb;
alter table line_items add column if not exists anomalies jsonb not null default '[]'::jsonb;
alter table line_items add column if not exists converted jsonb;
alter table line_items add column if not exists sheet_name text;
alter table line_items add column if not exists source_row int;
alter table line_items add column if not exists edited_at timestamptz;

-- Document-level provenance, formula rules, versioning, review
alter table documents add column if not exists field_meta jsonb not null default '{}'::jsonb;
alter table documents add column if not exists field_rules jsonb not null default '{}'::jsonb;
alter table documents add column if not exists version_no int not null default 1;
alter table documents add column if not exists edit_seq int not null default 0;
alter table documents add column if not exists reviewed_at timestamptz;
alter table documents add column if not exists progress jsonb not null default '{}'::jsonb;

alter table tenders add column if not exists ui_settings jsonb not null default '{}'::jsonb;

-- Each worksheet / chunk of an ingested file
create table if not exists document_sheets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  idx int not null,
  name text not null,
  kind text,
  row_count int,
  rendered_text text,
  raw_output jsonb,
  status text not null default 'pending',
  error text,
  image_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (document_id, idx)
);
create index if not exists document_sheets_doc on document_sheets(document_id, idx);

-- Every edit to a document or a cell, for history + revert
create table if not exists line_item_edits (
  id bigserial primary key,
  document_id uuid not null references documents(id) on delete cascade,
  line_item_id uuid references line_items(id) on delete set null,
  item_code text,
  seq int not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  old_meta jsonb,
  new_meta jsonb,
  reason text,
  cause text not null default 'user',
  created_at timestamptz not null default now()
);
create index if not exists line_item_edits_doc on line_item_edits(document_id, seq desc);
create index if not exists line_item_edits_line on line_item_edits(line_item_id, created_at desc);

-- Images extracted from / attached to documents
create table if not exists document_images (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  line_item_id uuid references line_items(id) on delete set null,
  sheet_name text,
  anchor_row int,
  anchor_col int,
  storage_path text not null,
  public_url text not null,
  mime_type text,
  file_size_bytes bigint,
  sha256 text,
  caption text,
  origin text not null default 'embedded',
  created_at timestamptz not null default now()
);
create index if not exists document_images_doc on document_images(document_id);
create index if not exists document_images_tender on document_images(tender_id);
create index if not exists document_images_line on document_images(line_item_id);

-- Reusable analyses ("Playbooks")
create table if not exists playbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  emoji text,
  instruction text not null,
  output_type text not null default 'auto',
  parameters jsonb not null default '[]'::jsonb,
  category text,
  is_builtin boolean not null default false,
  pinned boolean not null default false,
  run_count int not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table analyses add column if not exists playbook_id uuid references playbooks(id) on delete set null;
alter table analyses add column if not exists params jsonb not null default '{}'::jsonb;

alter table document_sheets disable row level security;
alter table line_item_edits disable row level security;
alter table document_images disable row level security;
alter table playbooks disable row level security;

-- Public bucket for images so they render in the app, exports and reports
insert into storage.buckets (id, name, public) values ('tender-images', 'tender-images', true) on conflict (id) do nothing;
drop policy if exists tender_images_all_anon on storage.objects;
create policy tender_images_all_anon on storage.objects for all to anon
  using (bucket_id = 'tender-images') with check (bucket_id = 'tender-images');

-- Built-in playbooks
insert into playbooks (name, description, emoji, instruction, output_type, category, is_builtin, pinned) values
('Tax & GST summary', 'Which bids include or exclude GST, the rates quoted, and what that does to real cost.', '🧾',
 'Give tax related information for every bid: whether prices are inclusive or exclusive of GST/taxes, the tax rate stated, any tax-related terms or notes, and flag bids whose totals are not directly comparable because of tax treatment.', 'table', 'Terms', true, true),
('Payment & commercial terms', 'Advance, milestones, retention, validity, and anything that changes cash flow.', '💳',
 'Compare payment and commercial terms across all bids: advance payment, milestones, retention, validity period, delivery/timeline, warranty. Point out which terms are most favourable and which are risky.', 'table', 'Terms', true, true),
('Scope gaps & exclusions', 'What each contractor left out, excluded, or expects the client to supply.', '🧩',
 'For each contractor list the BOQ items they left unpriced, missed, excluded, or marked as material-by-client or labour-only, and the estimated value of those gaps.', 'table', 'Scope', true, true),
('Odd rates to challenge', 'Rates far above or below the pack, worth a negotiation call.', '🔍',
 'Find rates that are more than 25% above or below the median for the same item and explain which ones look risky or worth challenging.', 'table', 'Price', true, false),
('Recommend an award', 'A written recommendation with price, completeness and risk.', '🏆',
 'Recommend which contractor to award this tender to, with a short written rationale covering like-for-like price, completeness, terms and risk.', 'narrative', 'Decision', true, true),
('Cost by section', 'Section-wise totals for every bid.', '📊',
 'Show section-wise like-for-like totals for every bid as a table, highlighting the cheapest bid in each section.', 'table', 'Price', true, false)
on conflict do nothing;
