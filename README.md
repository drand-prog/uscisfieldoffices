# USCIS N-400 Field Office Dashboard

A static dashboard for exploring USCIS Form N-400 (Application for Naturalization)
quarterly performance data by field office: applications received, approved,
denied, and pending, FY2015 Q1 through FY2026 Q3 (47 quarters).

No backend, no build step — `index.html` + vanilla JS + Chart.js, reading a
pre-generated JSON dataset. Deployable as-is on Vercel (or any static host) by
pointing it at this repo.

## Project layout

```
index.html                   the page
assets/style.css             styling (light/dark, CSS custom properties)
assets/app.js                data loading, office picker, charts, tables
assets/vendor/chart.umd.js   Chart.js, vendored locally (no external CDN dependency)
data/raw/                    source USCIS files, one per quarter
data/n400_quarterly.json     generated dataset the page actually reads
scripts/parse_common.py      shared grid parser (xlsx/csv) + layout auto-detection
scripts/parse_pdf.py         parser for the PDF-era reports (FY2019-2021)
scripts/ingest_quarterly.py  builds data/n400_quarterly.json from data/raw/
```

## Adding a new quarter

1. Download the quarterly report from USCIS and save it into `data/raw/` named
   `n400_performance_data_fyYYYY_qN_v1.<ext>` (`.xlsx`, `.csv`, or `.pdf`).
2. Run:
   ```
   python3 scripts/ingest_quarterly.py data/raw/n400_performance_data_fyYYYY_qN_v1.xlsx
   ```
   or `python3 scripts/ingest_quarterly.py --all` to rebuild the whole dataset
   from every file in `data/raw/`. Re-running for a quarter already in the
   dataset overwrites it in place, so it's safe to re-run after fixing a source
   file.
3. Commit both the new raw file and the regenerated `data/n400_quarterly.json`.

Requires `openpyxl` (for `.xlsx`) and the `pdftotext` binary from poppler-utils
(for `.pdf`); CSVs need no extra dependency.

## Why the parser looks the way it does

USCIS has changed this report's column layout repeatedly since FY2015:
- Some eras label a "Field Office Code" column explicitly; others (FY2015 Q2-Q4,
  FY2016-2017) have the column but no header text for it; FY2015 Q1 has no code
  column at all.
- Column offsets shift by report era.
- FY2019-2021 are PDFs, not spreadsheets.

Rather than hard-coding row/column numbers per era, `parse_common.py` locates
the TOTAL row and the office-code column empirically from each file's own
content (see its module docstring), and `parse_pdf.py` recovers the same
structure from `pdftotext -layout` output by splitting on runs of whitespace.
Office codes for the one code-less era (FY2015 Q1) are recovered from a
name+state lookup built from every other file that does have codes — keyed by
(name, state) first because a few office names repeat across states (e.g.
"Portland" in both Maine and Oregon).

The ingestion script validates cleanly against USCIS's own published totals:
every quarter's national TOTAL row matches exactly, and per-office sums
reconcile with it to within the noise expected from USCIS's own small-count
suppression (see below).

## Data-quality notes

- **Suppression ("D"):** USCIS withholds small counts for privacy. Suppressed
  cells are stored as `null` (with a `suppressed` flag) and shown as gaps, not
  zero — never averaged or summed as zero.
- **PDF-derived quarters (FY2019-2021):** extracted from PDF text layout rather
  than a structured spreadsheet. These are flagged `needsVerification: true` in
  the dataset and shown with a warning banner and a "(PDF)" tag in the
  dashboard; spot-check against the source PDF before relying on them for
  anything precise. One known gap: FY2019 Q4's Christiansted, VI office (CHR)
  has a malformed source line (a genuinely blank cell where every other row
  has "-" or "D") that the tokenizer can't unambiguously place, so that one
  office/quarter is dropped rather than guessed at.
- **Offices open and close over time.** An office is selectable in the
  dashboard if it appears in *any* quarter; quarters before it opened or after
  it closed show as gaps, labeled "not in report" (distinct from "D
  (suppressed)", which means the office reported but USCIS withheld that
  specific value).
- **FY2026 Q3's source workbook** states its reporting period as "April 1, 2025
  – June 30, 2026" — inconsistent with every other quarter and with USCIS's own
  fiscal-quarter definition. Treated as a typo for April 1-June 30, 2026 (the
  correct FY2026 Q3 window); the raw text is preserved in the dataset.
- **Pending is a stock, not a flow.** It's a snapshot as of quarter-end, not
  summable across quarters. Received/Approved/Denied are flow counts for that
  quarter only.
- **Approval/denial rates** are computed from the non-military Naturalization
  category only, not Total — the Military Naturalization category has enough
  small-count suppression (~15% of its office-level cells) that a rate
  computed from it would be unreliable at the office level.

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
