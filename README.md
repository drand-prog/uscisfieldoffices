# USCIS Field Office Dashboard

A static dashboard for exploring USCIS quarterly performance data by field
office: applications received, approved, denied, and pending. Covers two
forms, toggled in the same page/URL:

- **N-400** (Application for Naturalization) — FY2015 Q1 through FY2026 Q3 (47 quarters)
- **I-485** (Application to Register Permanent Residence or Adjust Status) — FY2025 Q4 through FY2026 Q3 (4 quarters)

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
scripts/parse_pdf.py         parser for N-400's PDF-era reports (FY2019-2021)
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
1. Save the report into `data/raw/` named `i485_performance_data_fyYYYY_qN_v1.xlsx`.
2. Run `python3 scripts/ingest_i485.py data/raw/i485_performance_data_fyYYYY_qN_v1.xlsx`
   (or `--all`).
3. Commit the new raw file and the regenerated `data/i485_quarterly.json`.

Both scripts are safe to re-run for a quarter already in the dataset — it's
overwritten in place, not duplicated. Ingesting N-400 requires `openpyxl` (for
`.xlsx`) and the `pdftotext` binary from poppler-utils (for `.pdf`); I-485 is
`.xlsx`-only so far and needs just `openpyxl`. CSVs need no extra dependency.

## Why the parser looks the way it does

USCIS has changed the N-400 report's column layout repeatedly since FY2015:
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

I-485 reuses the same grid parser — it has a different number of category
blocks per office (five: Family-based, Employment-based, Humanitarian-based,
Other, and Total, vs. N-400's three: Naturalization, Military Naturalization,
and Total), which is why `iter_grid_offices` takes a `num_values` parameter
and block-splitting is a generic `values_to_named_blocks(raw_values,
bucket_names)` rather than hard-coded to N-400's bucket names. I-485 has had
one report layout so far, so `scripts/ingest_i485.py` doesn't need N-400's
PDF/CSV support or code-less-era name lookup — those can be added the same
way if a future I-485 quarter needs them.

Both ingestion scripts validate cleanly against USCIS's own published totals:
every quarter's national TOTAL row matches exactly, and per-office sums
reconcile with it (exactly for I-485, which shows no suppression in the
quarters ingested so far; within the noise expected from small-count
suppression for N-400 — see below).

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
  zero — never averaged or summed as zero. I-485 has shown no suppression in
  any quarter ingested so far (case volumes are larger than N-400's).
- **N-400's PDF-derived quarters (FY2019-2021):** extracted from PDF text
  layout rather than a structured spreadsheet. These are flagged
  `needsVerification: true` in the dataset and shown with a warning banner and
  a "(PDF)" tag in the dashboard; spot-check against the source PDF before
  relying on them for anything precise. One known gap: FY2019 Q4's
  Christiansted, VI office (CHR) has a malformed source line (a genuinely
  blank cell where every other row has "-" or "D") that the tokenizer can't
  unambiguously place, so that one office/quarter is dropped rather than
  guessed at. I-485 has no PDF-era quarters.
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
  dataset. I-485's periods have shown no such issue so far.
- **Pending is a stock, not a flow.** It's a snapshot as of quarter-end, not
  summable across quarters. Received/Approved/Denied are flow counts for that
  quarter only.
- **Approval/denial rates:** N-400's rate chart uses the non-military
  Naturalization category rather than Total, because Military Naturalization
  has enough small-count suppression (~15% of its office-level cells) to make
  a rate computed from it unreliable at the office level. I-485's rate chart
  uses Total directly, since no I-485 category has shown meaningful
  suppression. This is configured per form via `rateBucket` in `FORMS`
  (`assets/app.js`).

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
