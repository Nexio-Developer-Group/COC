# TenderBoard (COC)

Upload a tender's BOQ and contractors' bids, get them read into one canonical table, compare them
like-for-like, edit anything with a full audit trail, and ask questions or run reusable **Playbooks**.

## How it works
1. **Upload** – files go straight from the browser to Supabase Storage (no function size limit).
2. **Read** – every Excel sheet / PDF / Word / CSV is read part by part (`/api/documents/:id/process`
   runs one step per call). Pictures are pulled out of the file and stored in the public `tender-images` bucket.
3. **Fill, convert, check** – missing amounts/rates/quantities are calculated and tagged as *autofill*
   (with the formula), units are converted to the BOQ's unit, and unrealistic values are flagged.
4. **Review** – nothing is "ready" until a person confirms it. Every filled/converted/flagged cell is highlighted.
5. **Edit** – every cell is editable; formulas (`quantity * rate`, `[1.2].amount`, …) can be applied to a row,
   section or the whole document, with an overlay showing rows whose existing values don't follow the formula.
   All changes are logged and undoable. Revised bids become new versions; old versions stay viewable.
6. **Compare & ask** – comparative statement is plain code (no AI). Reports / Playbooks use Groq on a compact facts pack.
7. **Export** – Excel, PDF and CSV for requirements, each bid, the comparison, every report and a full tender pack.

## Run it
```bash
cd app
cp .env.example .env.local   # fill in Supabase + Groq
npm install
npm run dev                  # http://localhost:3000
```
Database: apply `app/supabase/migrations/*.sql` (the base tables follow `docs/design/01-canonical-schema.md`).
Scripts: `npx tsx scripts/test-calc.ts` (formula/autofill/unit tests), `npx tsx scripts/test-match.ts` (matcher tests).

## Layout
- `src/lib/formula.ts` safe formula engine · `calc.ts` autofill / conversion / plausibility / review
- `src/lib/docOps.ts` edits, formulas, undo, versions · `extract/pipeline.ts` stepwise ingestion · `match.ts` BOQ matching
- `src/lib/export/*` Excel + PDF · `src/lib/analysis/*` facts pack + Groq analyses
- `src/components/BoqGrid.tsx` the editable table · `src/app/tenders/[id]/*` pages

## Data accuracy: how values are checked

The AI reads each sheet, but it is never the last word on a number:

1. **Upload-time audit (no AI).** While the workbook is opened, every formula is re-checked against its own saved result with a small, deliberately narrow evaluator (`+ − × ÷`, brackets, `%`, same-sheet cells, `SUM(range)`). The result is stored per sheet in `document_sheets.source_audit` and turned into review issues: `formula_mismatch` (saved result ≠ recalculation, both numbers shown), `excel_error` (`#VALUE!`, `#REF!`…), `formula_not_calculated` (saved without a result) and `formula_unverified` (uses another function/sheet/workbook, so it cannot be re-checked). Nothing is silently "fixed".
2. **Source check of every extracted number.** After extraction, each quantity, rate and amount is compared with the numbers printed in the sheet row it came from (`source_row`). A value that matches a cell (or is the product/quotient of two that do) is confirmed. A value that matches nothing is replaced by the sheet's own number when its column is unambiguous (the row is marked as corrected, with the cell address), otherwise it is flagged `not_in_source`.
3. **Blank names are restored from the sheet**, not guessed.
4. **No auto-confirm over errors.** A document cannot be confirmed while an error-level issue (unread sheet, formula mismatch, Excel error) is unacknowledged.
5. **Prompt hardening.** Cell text is treated as untrusted data; instructions inside cells are ignored.

The raw rendered text of every sheet is kept in `document_sheets.rendered_text`, so what the file actually said can always be compared with what was stored. Manual edits stay in the edit history and never overwrite that text.

Check any workbook locally without the AI: `npx tsx scripts/audit-file.ts path/to/file.xlsx`.
