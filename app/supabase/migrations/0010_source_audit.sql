-- Deterministic audit of the workbook's own formulas/errors, captured at upload time (no AI involved).
alter table document_sheets add column if not exists source_audit jsonb;
