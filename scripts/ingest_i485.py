#!/usr/bin/env python3
"""
Ingest USCIS I-485 (Application to Register Permanent Residence or Adjust
Status) field-office/service-center performance reports into the dashboard's
JSON dataset (data/i485_quarterly.json).

Usage:
    python3 scripts/ingest_i485.py data/raw/i485_performance_data_fy2026_q4_v1.xlsx [more files...]
    python3 scripts/ingest_i485.py --all          # re-ingest everything in data/raw/

Same USCIS report family as the N-400 ingestion (scripts/ingest_quarterly.py)
and built on the same shared parsers (scripts/parse_common.py,
scripts/parse_pdf.py) -- accepts .xlsx, .csv, or .pdf source files. I-485's
layout has five category blocks per office instead of N-400's three: Family-
based, Employment-based, Humanitarian-based, Other, and Total (20 data
columns, not 12) -- see values_to_named_blocks in parse_common.py. Re-running
this script for a quarter already in the dataset overwrites it in place.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_common import (  # noqa: E402
    iter_grid_offices,
    load_grid,
    normalize_name,
    parse_fy_quarter_from_filename,
    quarter_dates,
    values_to_named_blocks,
)
from parse_pdf import iter_pdf_offices  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
OUTPUT_PATH = REPO_ROOT / "data" / "i485_quarterly.json"

NUM_VALUES = 20  # 5 category blocks x 4 fields (received/approved/denied/pending)
BUCKETS = ("family", "employment", "humanitarian", "other", "total")


def build_name_code_lookup(raw_dir: Path):
    """Scan every spreadsheet-era file for (name, state)->code pairs, so any
    quarter that lacks a code column can still be keyed by stable codes."""
    by_name_state = {}
    by_name = {}
    ambiguous_names = set()
    for path in sorted(raw_dir.glob("i485_performance_data_*")):
        if path.suffix.lower() not in (".xlsx", ".csv"):
            continue
        try:
            grid = load_grid(path)
            for rec in iter_grid_offices(grid, num_values=NUM_VALUES):
                if rec["code"] and rec["code"] != "TOTAL" and rec["name"]:
                    norm_name = normalize_name(rec["name"])
                    norm_state = normalize_name(rec["state"] or "")
                    by_name_state.setdefault((norm_name, norm_state), rec["code"])
                    prior = by_name.setdefault(norm_name, rec["code"])
                    if prior != rec["code"]:
                        ambiguous_names.add(norm_name)
        except Exception as exc:  # noqa: BLE001
            print(f"  (lookup pass skipped {path.name}: {exc})", file=sys.stderr)
    for name in ambiguous_names:
        del by_name[name]
    return by_name_state, by_name


def ingest_file(path: Path, by_name_state: dict, by_name: dict):
    fy, q = parse_fy_quarter_from_filename(path)
    quarter_key = f"FY{fy}Q{q}"
    start_date, end_date = quarter_dates(fy, q)
    ext = path.suffix.lower()

    offices = {}
    unresolved = []

    if ext == ".pdf":
        source_format = "pdf"
        row_iter = iter_pdf_offices(path, num_values=NUM_VALUES)
    else:
        source_format = ext.lstrip(".")
        row_iter = iter_grid_offices(load_grid(path), num_values=NUM_VALUES)

    for rec in row_iter:
        code = rec["code"]
        if code is None:
            key = (normalize_name(rec["name"]), normalize_name(rec["state"] or ""))
            code = by_name_state.get(key) or by_name.get(normalize_name(rec["name"]))
            if code is None:
                unresolved.append(rec["name"])
                continue
        blocks, suppressed = values_to_named_blocks(rec["raw_values"], BUCKETS)
        offices[code] = {
            "code": code,
            "name": "All Offices (National)" if code == "TOTAL" else rec["name"].strip(),
            "state": rec["state"],
            "family": blocks["family"],
            "employment": blocks["employment"],
            "humanitarian": blocks["humanitarian"],
            "other": blocks["other"],
            "total": blocks["total"],
            "suppressed": suppressed,
        }

    if unresolved:
        print(f"  WARNING {path.name}: could not resolve code for: {unresolved}", file=sys.stderr)

    return quarter_key, {
        "fy": fy,
        "quarter": q,
        "label": f"FY{fy} Q{q}",
        "periodStart": start_date,
        "periodEnd": end_date,
        "sourceFile": path.name,
        "sourceFormat": source_format,
        "needsVerification": source_format == "pdf",
        "offices": offices,
    }


def main(argv):
    if not argv:
        print(__doc__)
        return 1

    if argv == ["--all"]:
        paths = sorted(RAW_DIR.glob("i485_performance_data_*"))
    else:
        paths = [Path(a) for a in argv]

    print("Building office name->code lookup from spreadsheet-era I-485 files...")
    by_name_state, by_name = build_name_code_lookup(RAW_DIR)
    print(f"  {len(by_name_state)} (name, state) pairs, {len(by_name)} unambiguous names")

    if OUTPUT_PATH.exists():
        dataset = json.loads(OUTPUT_PATH.read_text())
    else:
        dataset = {"quarters": {}}

    for path in paths:
        if not path.exists():
            print(f"skip (not found): {path}", file=sys.stderr)
            continue
        quarter_key, quarter_data = ingest_file(path, by_name_state, by_name)
        dataset["quarters"][quarter_key] = quarter_data
        n_offices = len(quarter_data["offices"]) - 1
        flag = " [PDF-derived]" if quarter_data["needsVerification"] else ""
        print(f"ingested {path.name} -> {quarter_key} ({n_offices} offices/service centers){flag}")

    ordered = dict(
        sorted(dataset["quarters"].items(), key=lambda kv: kv[1]["fy"] * 10 + kv[1]["quarter"])
    )
    dataset["quarters"] = ordered
    dataset["generatedNote"] = (
        "Generated by scripts/ingest_i485.py. Do not hand-edit; re-run the "
        "script against the source workbook(s) instead."
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(dataset, indent=2, sort_keys=False) + "\n")
    print(f"wrote {OUTPUT_PATH} ({len(dataset['quarters'])} quarters)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
