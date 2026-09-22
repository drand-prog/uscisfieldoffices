# USCIS Field Office Dashboard

A static dashboard for exploring USCIS quarterly performance data by field
office: applications received, approved, denied, and pending. Covers two
forms, toggled in the same page/URL:

- **N-400** (Application for Naturalization) — FY2015 Q1 through FY2026 Q3 (47 quarters)
- **I-485** (Application to Register Permanent Residence or Adjust Status) — FY2015 Q1 through FY2026 Q3 (47 quarters), further split by category: Family-based, Employment-based, Humanitarian-based, Other, or all combined

No backend, no build step — `index.html` + vanilla JS + Chart.js, reading
pre-generated JSON datasets. Deployable as-is on Vercel (or any static host)
by pointing it at this repo. The active form is in the URL (`?form=n400` or
`?form=i485`, alongside `&office=CODE`), so a link to a specific form/office
is shareable.

## Project layout

```
index.html                   the page (form-agnostic; text swapped by JS per form)
assets/style.css             styling (light/dark, CSS custom properties)
assets/app.js                FORMS config, data loading, office picker, charts, tables
assets/vendor/chart.umd.js   Chart.js, vendored locally (no external CDN dependency)
data/raw/                    source USCIS files, one per quarter, both forms
data/n400_quarterly.json     generated N-400 dataset
data/i485_quarterly.json     generated I-485 dataset
scripts/parse_common.py      shared grid parser (xlsx/csv) + layout auto-detection
scripts/parse_pdf.py         parser for both forms' PDF-era reports (N-400: FY2019-2021; I-485: FY2015 Q1, FY2019-2021)
scripts/ingest_quarterly.py  builds data/n400_quarterly.json from data/raw/
scripts/ingest_i485.py       builds data/i485_quarterly.json from data/raw/
```

## Adding a new quarter

**N-400:**
1. Save the report into `data/raw/` named `n400_performance_data_fyYYYY_qN_v1.<ext>`
   (`.xlsx`, `.csv`, or `.pdf`).
2. Run `python3 scripts/ingest_quarterly.py data/raw/n400_performance_data_fyYYYY_qN_v1.xlsx`
   (or `--all` to rebuild everything from `data/raw/`).
3. Commit the new raw file and the regenerated `data/n400_quarterly.json`.

**I-485:**
1. Save the report into `data/raw/` named `i485_performance_data_fyYYYY_qN_v1.<ext>`
   (`.xlsx`, `.csv`, or `.pdf`).
2. Run `python3 scripts/ingest_i485.py data/raw/i485_performance_data_fyYYYY_qN_v1.xlsx`
   (or `--all`).
3. Commit the new raw file and the regenerated `data/i485_quarterly.json`.

Both scripts are safe to re-run for a quarter already in the dataset — it's
overwritten in place, not duplicated. Both need `openpyxl` (for `.xlsx`) and
the `pdftotext` binary from poppler-utils (for `.pdf`); CSVs need no extra
dependency.

## Why the parser looks the way it does

USCIS has changed both reports' column layouts repeatedly since FY2015:
- Some eras label a "Field Office Code" column explicitly; others (N-400's
  FY2015 Q2-Q4/FY2016-2017, I-485's FY2016-2017) have the column but no header
  text for it; each form's FY2015 Q1 has no code column at all.
- Column offsets shift by report era.
- Some quarters are PDFs, not spreadsheets: N-400's FY2019-2021, I-485's
  FY2015 Q1 and FY2019-2021.

Rather than hard-coding row/column numbers per era, `parse_common.py` locates
the TOTAL row and the office-code column empirically from each file's own
content (see its module docstring), and `parse_pdf.py` recovers the same
structure from `pdftotext -layout` output by splitting on runs of whitespace.
Office codes for each form's one code-less era (FY2015 Q1) are recovered from
a name+state lookup built from every other file that does have codes — keyed
by (name, state) first because a few office names repeat across states (e.g.
"Portland" in both Maine and Oregon).

I-485 reuses the same grid and PDF parsers — it has a different number of
category blocks per office (five: Family-based, Employment-based,
Humanitarian-based, Other, and Total, vs. N-400's three: Naturalization,
Military Naturalization, and Total), which is why `iter_grid_offices` and
`iter_pdf_offices` take a `num_values` parameter and block-splitting is a
generic `values_to_named_blocks(raw_values, bucket_names)` rather than
hard-coded to N-400's bucket names.

Both ingestion scripts validate cleanly against USCIS's own published totals:
every quarter's national TOTAL row matches exactly, and per-office sums
reconcile with it within the noise expected from small-count suppression —
except FY2017 Q1's I-485 service centers, a genuine source-data gap for that
one quarter (see Data-quality notes).

## Adding a third form

1. Write `scripts/ingest_<form>.py` following `scripts/ingest_i485.py` as a
   template — reuse `parse_common.py`'s `iter_grid_offices` /
   `values_to_named_blocks` (or `parse_pdf.py` if the source is a PDF era) and
   write `data/<form>_quarterly.json` with the same `{quarters: {FYyyyyQn:
   {..., offices: {CODE: {code, name, state, <bucket>: {received, approved,
   denied, pending}, ..., suppressed}}}}}` shape the dashboard expects — every
   office needs a `total` bucket at minimum, since most charts read from it.
2. Add an entry to `FORMS` in `assets/app.js` (copy the `i485` entry): a
   `dataUrl`, page title/subtitle/chart-note copy, `rateBucket` (which bucket
   the approval/denial-rate chart and the outlier panel's denial-rate metric
   should read — use `"total"` unless a specific category needs excluding the
   way N-400 excludes Military Naturalization for suppression reasons), and
   `footerSource`/`showFy2026Q3Note`.
3. Add a `<button data-form="...">` to `#form-toggle` in `index.html`.

## Data-quality notes

- **Suppression ("D"):** USCIS withholds small counts for privacy. Suppressed
  cells are stored as `null` (with a `suppressed` flag) and shown as gaps, not
  zero — never averaged or summed as zero. I-485's Total bucket shows
  suppression in ~1% of office-quarter cells (rarer than N-400's Total, which
  shows essentially none, since I-485's Military-analog issue — see rate
  chart note below — is spread across four categories instead of concentrated
  in one small one).
- **PDF-derived quarters:** extracted from PDF text layout rather than a
  structured spreadsheet — N-400's FY2019-2021, I-485's FY2015 Q1 and
  FY2019-2021. These are flagged `needsVerification: true` in the dataset and
  shown with a warning banner and a "(PDF)" tag in the dashboard; spot-check
  against the source PDF before relying on them for anything precise. Known
  gaps: N-400 FY2019 Q4's Christiansted, VI office (CHR) has a malformed
  source line (a genuinely blank cell where every other row has "-" or "D")
  that the tokenizer can't unambiguously place, so that one office/quarter is
  dropped rather than guessed at. I-485's PDFs additionally have a category
  header cell that reads exactly "Total" on its own line, above and separate
  from the real total-row; `parse_pdf.py` requires the full row shape (name +
  all data columns) to match before treating a line as *the* total row, not
  just matching text, to avoid latching onto that header instead.
- **FY2017 Q1's four I-485 service centers** (WSC, NSC, SSC, ESC) show
  near-zero figures across every category in the source CSV itself, including
  Employment-based — the category service centers otherwise overwhelmingly
  dominate (compare FY2017 Q2's Texas Service Center: ~18,700 received, almost
  all Employment-based, vs. FY2017 Q1's ~30). This reproduces directly from
  the raw file, not a parsing bug, and is the one quarter where per-office
  totals don't reconcile with the national TOTAL row by more than a few
  hundred cases (off by roughly 5,000-24,000 depending on the field) — treated
  as a genuine USCIS reporting gap for that quarter, not corrected or guessed
  at.
- **Offices open and close over time**, and I-485's office list includes
  USCIS service centers (which N-400's doesn't) alongside field offices. An
  office is selectable in the dashboard if it appears in *any* quarter of the
  active form's dataset; quarters before it opened or after it closed show as
  gaps, labeled "not in report" (distinct from "D (suppressed)", which means
  the office reported but USCIS withheld that specific value). Switching forms
  resets the office selection to the national total if the previously
  selected code doesn't exist in the other form (e.g. a service center has no
  N-400 equivalent).
- **N-400's FY2026 Q3 source workbook** states its reporting period as "April
  1, 2025 – June 30, 2026" — inconsistent with every other quarter and with
  USCIS's own fiscal-quarter definition. Treated as a typo for April 1-June
  30, 2026 (the correct FY2026 Q3 window); the raw text is preserved in the
  dataset. I-485's periods have shown no such issue.
- **Pending is a stock, not a flow.** It's a snapshot as of quarter-end, not
  summable across quarters. Received/Approved/Denied are flow counts for that
  quarter only.
- **Denial rate:** N-400's rate chart uses the non-military Naturalization
  category rather than Total, because Military Naturalization has enough
  small-count suppression (~15% of its office-level cells) to make a rate
  computed from it unreliable at the office level. I-485's rate chart uses
  Total directly (or, when a single category is selected via the category
  toggle, that category), since no individual I-485 category shows
  suppression anywhere near that concentrated. This is configured per form via
  `rateBucket` in `FORMS` (`assets/app.js`). The chart itself only plots the
  denial rate; `rateSeries()` no longer computes an approval-rate series
  since nothing reads it (denial rate always equals 100% minus approval
  rate for decided cases, so nothing was lost by dropping it).
- **I-485 category toggle:** Family-based, Employment-based, Humanitarian-
  based, and Other are reported as separate category blocks (see "Why the
  parser looks the way it does" above); the dashboard defaults to Total (all
  four combined) but lets you pick a single category, which then drives every
  chart, the stat tiles, and the outlier panel — not just a filtered view of
  the Total charts. N-400 doesn't have sub-categories in this sense (Military
  Naturalization is a data-quality carve-out, not a category worth viewing on
  its own), so the toggle is I-485-only.
- **Administration shading on the x-axis:** every chart's Q1-Q4 tick labels
  are tinted blue (Democratic) or red (Republican) for whichever party held
  the presidency as of that quarter's `periodEnd`. This is computed from a
  small hard-coded table of inauguration dates in `assets/app.js`
  (`ADMINISTRATIONS`), not derived from the data. Using `periodEnd` rather
  than the fiscal quarter number handles the post-election transition for
  free: Q2 of the fiscal year following an election always ends March 31,
  after the January 20 inauguration, so it's automatically attributed to the
  incoming president, while Q1 (ending December 31) stays with the outgoing
  one. The table needs a manual entry after each future inauguration.
- **FY/CY x-axis toggle:** a global control (`#year-mode-toggle`, above the
  charts) switches every chart's x-axis, tooltips, and "View as table" rows
  between fiscal-year grouping (USCIS's own Oct-Sep quarters, the default)
  and calendar-year grouping. Calendar year/quarter is derived from each
  quarter's `periodEnd` date (`calendarYearOf`/`calendarQuarterOf` in
  `assets/app.js`) rather than stored separately, so a fiscal quarter's
  calendar-year label follows directly from when it actually ends — e.g.
  FY2015 Q1 (Oct-Dec 2014) reads as CY2014 Q4. The choice is synced to the
  URL (`?yearMode=cy`) like the other view state. The administration
  shading is unaffected by this toggle since it's keyed off `periodEnd`
  directly, not the fiscal/calendar quarter label.
- **Policy milestone markers:** every chart marks five dated USCIS policy
  changes (`POLICY_MILESTONES` in `assets/app.js`) with a small dot right on
  the x-axis, positioned by exact date rather than snapped to the middle of
  whichever quarter it falls in. `milestoneMarkers()` finds the quarter via
  `quarterIndexForDate()` (matching against `periodStart`/`periodEnd`) and
  computes a 0-1 day-fraction within it (`dayFractionInQuarter()`), then
  remaps that to `frac - 0.5` before adding it to the quarter's integer
  index -- so a date is placed within *half a quarter-width* of its own
  quarter's tick (dead center for a mid-quarter date, at the boundary with
  the neighboring quarter for a date right at periodStart/periodEnd), rather
  than interpolated across the *full* gap to the next quarter's tick. The
  full-gap version was tried first and put a late-quarter date's dot
  visually on top of the next quarter's tick -- indistinguishable from
  belonging to that next quarter, most noticeably where a quarter transition
  also happens to cross a year boundary in CY mode. Chart.js can't position
  a dataset point at a fractional category index, so the visible dot is
  drawn directly by a small canvas plugin
  (`milestoneMarkersPlugin`) that linearly interpolates between the two
  nearest integer pixel positions, the same technique `yearBandsPlugin`/
  `drawPartyStrip` already use above. A second, invisible (`pointRadius: 0`)
  Chart.js dataset per milestone still exists purely so that quarter's
  column participates in the normal index-mode tooltip; `tooltipBase()`'s
  label callback special-cases any dataset flagged `isMilestone` to show its
  explanation text instead of a formatted value. Because the visible dot now
  uses the exact date, two milestones landing in the same quarter (the 2020
  fee rule and the 2020 civics test, both FY2021 Q1) land at naturally
  different x positions rather than needing to be stacked. A new milestone
  only needs an entry added to `POLICY_MILESTONES`, nothing else.

## Local preview

Any static file server works, e.g.:
```
python3 -m http.server 8000
```
then open `http://localhost:8000/`.

## Deploying

Point Vercel at this repo (or `vercel --prod` from a checkout) — it's a plain
static site with no build step, so Vercel's default static-site detection
handles it with no configuration.
