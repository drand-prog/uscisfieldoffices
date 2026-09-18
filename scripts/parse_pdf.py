"""
Parser for the PDF-era (FY2019-FY2021) USCIS N-400 quarterly reports.

pdftotext -layout preserves the report's fixed-width column alignment well
enough that splitting each line on runs of 2+ spaces recovers the same
(name, code, 12 values) tuples the grid parser extracts from spreadsheets.
"""
import re
import subprocess

from parse_common import CODE_RE, is_known_state_name, is_structural_label, looks_like_footer

SPLIT_RE = re.compile(r"\s{2,}")


def pdf_to_text(pdf_path):
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def iter_pdf_offices(pdf_path):
    text = pdf_to_text(pdf_path)
    lines = [ln.strip("\f") for ln in text.split("\n")]

    total_values = None
    for line in lines:
        tokens = [t for t in SPLIT_RE.split(line.strip()) if t]
        if not tokens:
            continue
        if tokens[0].strip().lower() in ("total", "grand total") and len(tokens) == 13:
            total_values = tokens[1:13]
            break
    if total_values is None:
        raise ValueError(f"Could not locate Grand Total row in {pdf_path}")

    yield {"name": "TOTAL", "code": "TOTAL", "state": None, "raw_values": total_values}

    current_state = None
    started = False
    for line in lines:
        tokens = [t for t in SPLIT_RE.split(line.strip()) if t]
        if not tokens:
            continue
        name0 = tokens[0]

        if not started:
            if name0.strip().lower() in ("total", "grand total"):
                started = True
            continue

        if looks_like_footer(name0):
            break
        if is_structural_label(name0):
            continue

        if len(tokens) == 14 and CODE_RE.match(tokens[1]):
            yield {
                "name": tokens[0],
                "code": tokens[1],
                "state": current_state,
                "raw_values": tokens[2:14],
            }
            continue

        # A real office always carries its own code on the same line (case
        # above), so this only matches genuine section headers.
        if len(tokens) == 1 or is_known_state_name(name0):
            current_state = name0
            continue
        # Anything else (wrapped text, repeated page headers, international
        # rows with no code column) doesn't match the expected shape and is
        # skipped rather than guessed at.
