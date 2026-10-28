# 04 — UX Flows (tender releaser's point of view)

Audience: a construction or real-estate person who lives in Excel and knows terms like "BOQ", "rate", "L1", "comparative statement". Goal: it should feel like **a smarter Excel**, not a software tool. No jargon like "extraction", "schema", "LLM", "JSON", "tokens" anywhere in the UI.

Related: data from `01`, comparison numbers from `03 §2`, analysis types from `03 §5`.

---

## 0. Global look and vocabulary

### Palette usage
| Token | Hex | Used for |
|---|---|---|
| `primary` | `#E96A32` | Primary buttons ("Upload bid", "Run analysis"), active tab underline, progress bars |
| `primary-dull` | `#F13B09` | Primary button hover/pressed, destructive confirm |
| `dark` | `#212529` | Body text, top bar background |
| `dark-dull` | `#181B1E` | Top bar border, table header text on light |
| `light` | `#EDEAE6` | Page background (warm paper feel) |
| `light-dull` | `#F8F9FA` | Cards, table body, zebra stripe alternate (white is the other stripe) |
| `accent` | `#7E4228` | **Section band rows** in every BOQ/comparison table (white bold text on accent), the same in Excel exports, which makes on-screen and Excel look identical |
| `accent-dull` | `#5C311E` | Table column header row, grand total row |
| `contrast` | `#17196D` | Links, contractor name headers, L1 badge, "selected" states, chart/score bars |
| `contrast-dull` | `#0A0C63` | Link hover, focus rings |

Two **semantic tints** are added for cell highlighting only (the palette has no green, and red would clash with the orange primary):
- Lowest in row / good: background `#E4F2E7`, text `#1E6B34`
- Highest in row / bad: background `#FBE3D7` (light tint of primary), text `#9A3412`
- Warning (flag / needs review): background `#FFF4CC`, text `#7A5B00`

Logo: `E:\COC1\Final_Logo.png` sits in the top-left of the top bar.

### Numbers
- Indian grouping everywhere: **₹2,03,47,940**. Headline figures also show a short form, **₹2.03 Cr** / **₹35.7 L**.
- Quantities: `2,127 sqm`. Rates: `₹1,250 /sqm`.
- Unpriced: **"—"** in grey, tooltip "Left blank by contractor". Missing: **"×"** in grey, tooltip "Item not in this contractor's bid".

### Words used in the UI
| Instead of | Say |
|---|---|
| Extraction / processing | "Reading your file…" |
| Structured data | "BOQ" / "Bill of Quantities" |
| Bid vs tender comparison | **"Comparative Statement"** (standard term in Indian construction procurement) |
| Lowest bidder | **L1**, then L2, L3… |
| Issues | "Things to check" |
| Analysis | "Ask a question" / "Reports" |

### Global layout
Top bar (dark): logo · "Tenders" · right side shows nothing else (no login in the demo). Content max-width 1440px. Tables can scroll horizontally inside their card, never the page.

---

## (a) Tender list / dashboard: `/`

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [logo]  Tenders                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│  Your tenders                                        [ + New tender ]     │
│                                                                           │
│  ┌ Tender ──────────────────┬ Client ─┬ Items ┬ Bids ┬ Lowest (L1) ──────┬ Updated ┐
│  │ ITC Fortune Guwahati     │ ITC     │  21   │  7   │ ₹1.88 Cr Rise Deck│ 2h ago  │
│  │ Sobha Tower B – Plumbing │ Sobha   │ 112   │  3 ⚠ │ ₹46.2 L  Aqua...  │ 3d ago  │
│  └──────────────────────────┴─────────┴───────┴──────┴───────────────────┴─────────┘
│  ⚠ = a bid has things to check                                           │
└───────────────────────────────────────────────────────────────────────────┘
```
- One plain table, clicking a row opens the tender.
- "Lowest (L1)" uses the like-for-like total (code, no LLM).
- Empty state: a large card that says "Start by creating a tender and uploading your BOQ", with a [+ New tender] button.
- Row menu (⋯): Rename, Archive.

---

## (b) Create a tender + upload requirements: `/tenders/new`

One page, two steps, no wizard chrome.

```
 New tender
 ─────────────────────────────────────────────
 Tender name *        [ ITC Fortune Guwahati            ]
 Client (optional)    [ ITC                             ]
 Site / location      [ Guwahati                        ]
 Currency             [ INR ▾ ]

 Your requirements (BOQ / scope document)
 ┌───────────────────────────────────────────┐
 │   Drop your BOQ here, or click to browse  │
 │   Excel, PDF, Word, CSV or text           │
 └───────────────────────────────────────────┘
                                   [ Create tender ]
```
After clicking:
1. Progress card with an orange bar: "Uploading…" → "Reading your file…" → "Checking quantities…" → "Done". The status text comes from the polled `status_detail`. The typical time (~10–30 s) is shown below the bar.
2. The page lands on the **Requirements tab** of the new tender with a green banner: "We read **21 items in 3 sections** from *vyaas ITC FORTUNE….xlsx*. Please glance through and fix anything that looks wrong."
3. If there are things to check, the banner is yellow and reads "2 rows need a look", with a [Review] button that opens the review panel (see §(e)).

A tender can also be created without a file (name only), and the BOQ uploaded later from the Requirements tab.

---

## (c) Single tender view: `/tenders/[id]`

Header: tender name · client · location · "21 items · 7 bids". Right side: [ Upload bid ] (primary) and [ Ask a question ] (secondary, jumps to the New Analysis tab).

Tabs, in this order:
**Requirements · Comparative Statement · Bids (7) · Reports (4) · Ask a question**

The default tab is **Comparative Statement** when at least 1 bid exists, otherwise Requirements.

### c1. Requirements tab (the BOQ as uploaded)

```
 Requirements — from vyaas ITC FORTUNE GUWAHATI FOR CONTRACTORS.xlsx   [Download original] [Export to Excel]
 ┌────┬──────────────────────┬───────────────────────────────┬──────┬────────┬─────────────┐
 │ No.│ Item                 │ Description                   │ Unit │   Qty  │ Budget rate │
 ├────┴──────────────────────┴───────────────────────────────┴──────┴────────┴─────────────┤
 │ ███ CIVIL WORKS ██████████████████████████████████████████████████ (accent band) ███████ │
 │ 1  │ Room Flooring        │ Providing and laying 8mm wa…▸ │ sqm  │  2,127 │     ₹750    │
 │ 2  │ SPC Flooring         │ Receiving and fixing in pos…▸ │ sqm  │  2,127 │       —     │
 │ …                                                                                       │
 │ ███ GYPSUM & POP PUNNING AND PAINT WORK ████████████████████████████████████████████████ │
 │ …                                                                                       │
 │ Terms & notes (2)  ▸                                                                    │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```
- Exactly the columns an estimator expects. "Budget rate" only appears if any tender line has a rate.
- Long descriptions are clamped to 1 line. Clicking ▸ expands the row in place.
- Hovering a row shows a small "From row 5 of your file" tooltip with the original row text (from `rendered_text`). This builds trust.
- Inline edit on double-click for Qty / Unit / Name, for fixing a misread. Edits are saved immediately with a small "edited" dot. Allowed only until the first bid arrives.
- **Export to Excel**: yes (same banding and formatting).

### c2. Comparative Statement tab (default view, no AI involved): see section (d)

### c3. Bids tab

List view:
```
 Bids received (7)                                                       [ Upload bid ]
 ┌──────────────────────┬──────────────┬───────────────┬────────┬─────────┬──────────────────┐
 │ Contractor           │ Quoted total │ Like-for-like │  Rank  │ Priced  │ Status           │
 ├──────────────────────┼──────────────┼───────────────┼────────┼─────────┼──────────────────┤
 │ Rise Deck            │ ₹1,88,15,100 │ ₹1,88,15,100  │  L1    │ 19 / 21 │ ✓ Ready          │
 │ Brijesh Ji  [3 opts] │ ₹1,95,75,630 │ ₹1,95,75,630  │  L2    │ 19 / 21 │ ⚠ 2 to check     │
 │ OM Infra Solutions   │ ₹3,02,80,500 │ ₹3,02,80,500  │  L7    │ 19 / 21 │ ✓ Ready  GST excl│
 └──────────────────────┴──────────────┴───────────────┴────────┴─────────┴──────────────────┘
```

**Upload bid** (modal):
- Drop **one or many** files. Each file becomes one bid.
- For each file: "Contractor name" is prefilled after reading (from the letterhead, else the file name, e.g. "Vinod Mistry"), and the user can edit it.
- If a contractor already has a bid: "Replace Vinod Mistry's earlier bid?" [Replace] [Keep both].
- Same progress UX as (b). Files are processed one after another, with a per-file status list.

**Single bid view** `/tenders/[id]/bids/[docId]`:
- Header card: contractor name (editable), letterhead details, date, quoted total, "GST: excluded / 18%", price options chip ("3 price options — comparing Option 3 (lowest) ▾", a dropdown to switch), [Download original] [Export to Excel].
- **"Things to check" panel** (yellow, collapsible, shown only if there are issues). Each issue is one plain sentence plus an action:
  - "Item 8 *Room Flooring* has an extra line: 237 rmt @ ₹1,850. We added it to item 8." [OK] [Make it a separate extra item]
  - "Row 11: 839 × ₹151 = ₹1,26,689, but the amount says ₹9,64,850." [Keep as is]
  - "We couldn't place 'Marble polish' in your BOQ." [Link to item ▾] [It's an extra item]
  - "Rows 37–41 were treated as notes, not items." [View]
  - [Mark all as reviewed]
- **Bid BOQ table**: same as Requirements, plus `Rate · Amount · Remarks` columns, and a "Matches your item" column, shown only when the link isn't exact (with a dropdown to fix it). Remarks render as a small tag ("Tile by client") using the warning tint.
- **Terms & notes** card: grouped by category (Tax, Payment, Validity, Site facilities, Exclusions…), with verbatim text.
- **Export to Excel**: yes.

### c4. Reports tab (past analyses)

```
 Reports (4)                                                         [ Ask a question ]
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ ▦ Civil Works – rate comparison                                   Today, 3:42 pm    │
 │   Rise Deck is cheapest on 6 of 11 civil items; OM Infra highest on 9.               │
 ├──────────────────────────────────────────────────────────────────────────────────────┤
 │ ≡ Contractor ranking – value for money                            Yesterday         │
 │   Rise Deck ranks first on like-for-like price; Rajat most complete.  ⚠ Based on 6 of 7 bids [Run again]
 ├──────────────────────────────────────────────────────────────────────────────────────┤
 │ ¶ Which bids exclude GST?                                         12 Oct            │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```
- Icon = type (▦ table, ≡ ranking, ¶ report). Then title, the one-line description, and a timestamp.
- Staleness badge as defined in doc 03 §8.
- Clicking opens `/tenders/[id]/reports/[analysisId]`:
  - Title, description, "Your question: '…'" (grey quote), date.
  - The result rendered by type:
    - **table** → the same grid component as the comparative statement (group bands in accent, highlight tints, sticky first column, click-to-sort headers). Dotted-underlined numbers have the tooltip "Calculated from the bid data — double-check".
    - **ranking** → leaderboard cards: big rank number, contractor name in contrast navy, a score bar (0–100, contrast fill), a one-line headline, two columns for strengths ✓ / concerns ⚠, and key figures. The criteria and weights are shown at the top as small chips ("Price 60% · Completeness 25% · Terms 15%").
    - **narrative** → verdict in a highlighted callout, key figure tiles in a row, then the formatted report text.
  - "Assumptions" and "Limits of this answer" as small grey lists at the bottom.
  - Actions: **[Export to Excel] [Download CSV]** (table/ranking) · **[Download text] [Copy]** (narrative) · [Run again] · [Rename] · [Delete].

### c5. Ask a question tab (new analysis)

```
 Ask a question about these bids
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ e.g. "Which contractor is cheapest for painting work, and by how much?"   │
 │                                                                           │
 └───────────────────────────────────────────────────────────────────────────┘
 Show the answer as:  (•) Let us choose  ( ) Table  ( ) Ranking  ( ) Written report

 Quick picks:
 [ Compare total cost ]  [ Rank by value for money ]  [ Flag quantity mismatches ]
 [ Items each contractor left out ]  [ Unusually high or low rates ]  [ Compare terms & exclusions ]

                                                          [ Run analysis ]   (≈ 20–40 s)
```
- Quick picks **fill the textbox and the format choice**, and the user can edit before running:

| Quick pick | Text filled | Format |
|---|---|---|
| Compare total cost | "Compare the total cost of all bids on a like-for-like basis, showing quoted total, like-for-like total, items not priced and GST basis." | Table |
| Rank by value for money | "Rank all contractors by value for money, weighing like-for-like price, completeness (items priced) and risky terms or exclusions." | Ranking |
| Flag quantity mismatches | "List every item where a contractor's quantity or unit differs from my BOQ, with the difference." | Table |
| Items each contractor left out | "For each contractor, list the BOQ items they left unpriced or missed, and the estimated value of those gaps." | Table |
| Unusually high or low rates | "Find rates that are more than 25% above or below the median for that item, and explain which look risky." | Table |
| Compare terms & exclusions | "Summarise each contractor's terms, exclusions, client-supplied materials and GST treatment, and point out what makes bids not comparable." | Written report |

- On run: the button turns into an orange progress bar with the copy "Reading 7 bids… → Comparing rates… → Writing your answer…". On success the page navigates to the report page. On failure: "We couldn't produce a reliable answer. Try rephrasing, or pick a quick pick." Your text is kept.
- If the identical question was already answered on the same data, the existing report opens instantly with a small note "You asked this before — showing the saved answer. [Run again]".
- Under the textbox, a small grey note: "Answers use only the BOQ and bids in this tender."

---

## (d) Comparative Statement: the default comparison view

The most important screen. It is pure code, instant, and needs no AI. It mirrors the "CS" sheet estimators build by hand.

```
 Comparative Statement            Show: (•) Rates ( ) Amounts ( ) Both     Sections: [All ▾]   [Export to Excel]
 ┌────┬─────────────────┬──────┬───────┬════════════╤════════════╤════════════╤═══ … ═══╤──────────────────┐
 │ No.│ Item            │ Unit │  Qty  │ Rise Deck  │ Brijesh Ji │ KSB Int.   │  …      │ Min · Median · Max│
 │    │                 │      │       │   L1       │  L2        │  L3        │         │                  │
 ├────┴─────────────────┴──────┴───────┴────────────┴────────────┴────────────┴─────────┴──────────────────┤
 │ ███ CIVIL WORKS ███████████████████████████████████████████████████████████████████████████████████████ │
 │ 1.1│ Room Flooring   │ sqm  │ 2,127 │ [₹850]good │   ₹1,050   │   ₹914.94  │ ₹1,750bad│ 850·1,184·1,750  │
 │ 1.2│ SPC Flooring    │ sqm  │ 2,127 │     —      │     —      │     —      │ …₹1,510 │ 1,510            │
 │ 1.4│ Toilet Flooring │ sqm  │ 1,154 │   ₹920     │  ₹1,100    │  ₹968.76   │ ₹950 🏷  │ …                │
 │ 1.8│ Room Flooring   │ sqm  │   237 │  ₹1,250    │  ₹3,228    │ ₹4,621 ⧉   │ …       │                  │
 │ …                                                                                                        │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Quoted total (as per bid)           │ ₹1,88,15,100 │ ₹1,95,75,630 │ ₹1,97,02,213 │ …                       │
 │ Like-for-like total ⓘ               │ ₹1,88,15,100 │ ₹1,95,75,630 │ ₹1,97,02,213 │ …   ← ranks L1/L2 use this│
 │ If gaps filled at median ⓘ          │ …            │ …            │ …            │                         │
 │ Items not priced / missing          │ 2 / 0        │ 2 / 0        │ 2 / 0        │                         │
 │ Material by client / labour-only    │ 0 / 0        │ 0 / 0        │ 0 / 0        │                         │
 │ GST                                 │ "18%" note   │ not stated   │ not stated   │                         │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Extra items offered (not in your BOQ):  none
```

Behaviour:
- **Frozen left columns** (No., Item, Unit, Qty) and a frozen header, so it scrolls like Excel. One column per contractor, ordered by rank (L1 first). The contractor name is in contrast navy and clicking it opens the bid.
- **Rates / Amounts / Both** toggle. Amounts use the normalized amount (rate × your qty).
- Per row: **lowest cell = green tint, highest = orange tint**, only when ≥ 2 contractors priced the item.
- Cell markers: 🏷 = remark (hover shows "Tile Provide by Client" and the cell gets the warning tint if it is a MATERIAL_BY_CLIENT / LABOUR_ONLY flag, because that rate is not comparable), ⧉ = split pricing (hover shows the breakdown), ⚠ = qty/unit differs from your BOQ (hover shows "Bid qty 250 vs your 237").
- Footer ⓘ tooltips in plain words:
  - Like-for-like: "Only counts items that every contractor priced, so totals are fair to compare."
  - Gaps filled: "Adds an estimate for items a contractor left out, using the middle rate of the others."
- **Sections filter** to show one section and its subtotal rows only.
- **Export to Excel**: yes. Gives an `.xlsx` with the same layout, frozen panes, section bands in `#7E4228`, green/orange fills, footer totals, and a second sheet "Notes" listing every remark/flag and the terms per contractor. Also **CSV** (flat: one row per item × contractor) under the export button's ▾.
- Shown for 1 bid too (then it's simply bid vs BOQ, with no green/orange).

---

## (e) Review panel (shared by tender upload and bid upload)

A right-side drawer titled "Things to check (n)". Every issue from `documents.issues` appears as one card in plain language with 1–2 buttons. Nothing is hidden: the "Rows we skipped" section at the bottom lists `ignored_rows` with their reasons and the original text, collapsed by default. "Mark all as reviewed" sets the document to Ready. Issues never block the Comparative Statement.

---

## Export summary (their comfort zone)

| View | Excel (.xlsx) | CSV | Other |
|---|---|---|---|
| Requirements (BOQ) | ✓ | ✓ | Download original file |
| Single bid | ✓ | ✓ | Download original file |
| Comparative Statement | ✓ (formatted, 2 sheets) | ✓ (flat) | |
| Report: table | ✓ | ✓ | |
| Report: ranking | ✓ (flattened) | ✓ | |
| Report: written | — | — | Download text (.md), Copy |
| Tender list | — | — | (not needed) |
