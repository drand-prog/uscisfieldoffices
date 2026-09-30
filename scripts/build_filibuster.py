#!/usr/bin/env python3
"""
Build the standalone "Filibuster Policy Failures by Topic" page
(filibuster/index.html) from its Markdown source (filibuster/content.md).

Usage:
    python3 scripts/build_filibuster.py

The source was exported from a Claude Docs document. Only the Markdown the
source actually uses is supported: #/##/### headings, "- " bullet lists,
paragraphs, **bold**, and [text](url) / [text](<url>) links. No third-party
dependencies. Re-run after editing content.md and commit both files.
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "filibuster"
SRC = SITE / "content.md"
OUT = SITE / "index.html"

LINK_RE = re.compile(r"\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
CODE_RE = re.compile(r"^([DR]\d+)\.\s")


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def fmt_text(raw):
    return BOLD_RE.sub(r"<strong>\1</strong>", html.escape(raw, quote=False))


def inline(raw):
    out, pos = [], 0
    for m in LINK_RE.finditer(raw):
        out.append(fmt_text(raw[pos:m.start()]))
        url = m.group(2) or m.group(3)
        out.append(
            f'<a href="{html.escape(url)}" rel="noopener" target="_blank">'
            f"{fmt_text(m.group(1))}</a>"
        )
        pos = m.end()
    out.append(fmt_text(raw[pos:]))
    return "".join(out)


def parse(md):
    """Group the Markdown into title, lead paragraphs and h2 sections of h3 entries."""
    lines = md.splitlines()
    title = lines[0].lstrip("# ").strip()
    doc = {"title": title, "lead": [], "sections": []}
    section = entry = None
    para = []

    def target():
        if entry is not None:
            return entry["blocks"]
        if section is not None:
            return section["blocks"]
        return doc["lead"]

    def flush_para():
        if para:
            target().append(("p", " ".join(para)))
            para.clear()

    for line in lines[1:]:
        if line.startswith("## "):
            flush_para()
            section = {"title": line[3:].strip(), "blocks": [], "entries": []}
            doc["sections"].append(section)
            entry = None
        elif line.startswith("### "):
            flush_para()
            entry = {"title": line[4:].strip(), "blocks": []}
            section["entries"].append(entry)
        elif line.startswith("- "):
            flush_para()
            blocks = target()
            if blocks and blocks[-1][0] == "ul":
                blocks[-1][1].append(line[2:])
            else:
                blocks.append(("ul", [line[2:]]))
        elif not line.strip():
            flush_para()
        else:
            para.append(line.strip())
    flush_para()
    return doc


def render_blocks(blocks):
    parts = []
    for kind, value in blocks:
        if kind == "p":
            parts.append(f"<p>{inline(value)}</p>")
        else:
            items = "".join(f"<li>{inline(i)}</li>" for i in value)
            parts.append(f"<ul>{items}</ul>")
    return "\n".join(parts)


def party_of(section_title):
    t = section_title.lower()
    if t.startswith("democratic") or t.startswith("appendix a"):
        return "d"
    if t.startswith("republican") or t.startswith("appendix b"):
        return "r"
    return ""


def build():
    doc = parse(SRC.read_text(encoding="utf-8"))

    # Assign unique ids, and pair each summary entry (D1, R2, ...) with its
    # appendix detail entry so the two can link to each other.
    used = set()

    def uid(text):
        base = slugify(text) or "section"
        slug, n = base, 2
        while slug in used:
            slug, n = f"{base}-{n}", n + 1
        used.add(slug)
        return slug

    summary_ids, detail_ids = {}, {}
    for sec in doc["sections"]:
        sec["id"] = uid(sec["title"])
        sec["party"] = party_of(sec["title"])
        sec["appendix"] = sec["title"].lower().startswith("appendix")
        for e in sec["entries"]:
            e["id"] = uid(e["title"])
            m = CODE_RE.match(e["title"])
            e["code"] = m.group(1) if m else None
            if e["code"]:
                (detail_ids if sec["appendix"] else summary_ids)[e["code"]] = e["id"]

    toc, body = [], []
    for sec in doc["sections"]:
        sub = ""
        if sec["entries"] and not sec["appendix"]:
            sub = "<ol>" + "".join(
                f'<li><a href="#{e["id"]}">{html.escape(e["title"])}</a></li>'
                for e in sec["entries"]
            ) + "</ol>"
        toc.append(
            f'<li class="p-{sec["party"] or "n"}"><a href="#{sec["id"]}">'
            f'{html.escape(sec["title"])}</a>{sub}</li>'
        )

        entries = []
        for e in sec["entries"]:
            if sec["appendix"]:
                back = summary_ids.get(e["code"])
                jump = f'<a class="jump" href="#{back}">&uarr; Summary</a>' if back else ""
            else:
                fwd = detail_ids.get(e["code"])
                jump = f'<a class="jump" href="#{fwd}">Details &darr;</a>' if fwd else ""
            code = e["code"]
            title = e["title"][len(code) + 2:] if code else e["title"]
            badge = f'<span class="code">{code}</span>' if code else ""
            entries.append(
                f'<article class="entry" id="{e["id"]}">'
                f'<h3>{badge}<a class="self" href="#{e["id"]}">{html.escape(title)}</a></h3>'
                f'{render_blocks(e["blocks"])}{jump}</article>'
            )
        cls = "section" + (f' p-{sec["party"]}' if sec["party"] else "")
        cls += " appendix" if sec["appendix"] else ""
        body.append(
            f'<section class="{cls}" id="{sec["id"]}">'
            f'<h2>{html.escape(sec["title"])}</h2>'
            f'{render_blocks(sec["blocks"])}{"".join(entries)}</section>'
        )

    lead = [b for b in doc["lead"]]
    updated = ""
    if lead and lead[0][0] == "p" and lead[0][1].startswith("Updated "):
        updated = lead.pop(0)[1]
    description = lead[0][1] if lead else doc["title"]

    page = TEMPLATE.format(
        title=html.escape(doc["title"]),
        description=html.escape(description),
        updated=html.escape(updated),
        lead=render_blocks(lead),
        toc="\n".join(toc),
        body="\n".join(body),
    )
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(page):,} bytes)")


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23233044'/%3E%3Ctext x='16' y='22' font-family='Georgia,serif' font-size='17' font-weight='700' text-anchor='middle' fill='%23f4efe6'%3E60%3C/text%3E%3C/svg%3E">
<!-- Generated by scripts/build_filibuster.py from content.md; edit that file, not this one. -->
<style>
:root {{
  --bg: #fbfaf7; --surface: #ffffff; --text: #1d2330; --muted: #5d6573;
  --line: #e4e1da; --accent: #233044; --link: #1f5fa8;
  --dem: #2f5fb3; --dem-soft: #eef3fb; --rep: #b23a3a; --rep-soft: #fbefef;
  --neutral: #7a6f5c;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --bg: #14171d; --surface: #1b1f27; --text: #e7e9ee; --muted: #9aa3b2;
    --line: #2c323d; --accent: #e7e9ee; --link: #8ab4f8;
    --dem: #7fa6ec; --dem-soft: #1c2536; --rep: #ec8a8a; --rep-soft: #33201f;
    --neutral: #bfae8f;
  }}
}}
:root[data-theme="dark"] {{
  --bg: #14171d; --surface: #1b1f27; --text: #e7e9ee; --muted: #9aa3b2;
  --line: #2c323d; --accent: #e7e9ee; --link: #8ab4f8;
  --dem: #7fa6ec; --dem-soft: #1c2536; --rep: #ec8a8a; --rep-soft: #33201f;
  --neutral: #bfae8f;
}}
* {{ box-sizing: border-box; }}
html {{ scroll-behavior: smooth; scroll-padding-top: 16px; }}
body {{
  margin: 0; background: var(--bg); color: var(--text);
  font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}}
a {{ color: var(--link); text-underline-offset: 2px; }}
.wrap {{ max-width: 1180px; margin: 0 auto; padding: 0 16px; }}
header.hero {{ padding: 56px 0 28px; border-bottom: 1px solid var(--line); }}
header.hero h1 {{
  font-family: Georgia, "Times New Roman", serif; font-weight: 700;
  font-size: clamp(30px, 5vw, 48px); line-height: 1.1; margin: 0 0 12px; color: var(--accent);
  max-width: 22ch;
}}
header.hero .updated {{ color: var(--muted); font-size: 14px; margin: 0 0 16px; }}
header.hero .lead p {{ font-size: 19px; max-width: 62ch; margin: 0; }}
.legend {{ display: flex; gap: 16px; flex-wrap: wrap; margin-top: 20px; font-size: 14px; color: var(--muted); }}
.legend span::before {{ content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }}
.legend .d::before {{ background: var(--dem); }}
.legend .r::before {{ background: var(--rep); }}
.layout {{ display: grid; grid-template-columns: 1fr; gap: 32px; padding-top: 32px; padding-bottom: 64px; }}
nav.toc {{ font-size: 14px; }}
nav.toc details {{ border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; }}
nav.toc summary {{ cursor: pointer; font-weight: 600; }}
nav.toc ul, nav.toc ol {{ list-style: none; margin: 0; padding: 0; }}
nav.toc > details > ul {{ margin-top: 10px; }}
nav.toc li {{ margin: 6px 0; }}
nav.toc ol {{ margin: 4px 0 10px 10px; border-left: 2px solid var(--line); padding-left: 10px; }}
nav.toc .p-d > ol {{ border-color: var(--dem); }}
nav.toc .p-r > ol {{ border-color: var(--rep); }}
nav.toc ol a {{ color: var(--muted); text-decoration: none; }}
nav.toc ol a:hover, nav.toc > details > ul > li > a:hover {{ color: var(--link); text-decoration: underline; }}
nav.toc > details > ul > li > a {{ color: var(--text); font-weight: 600; text-decoration: none; }}
main {{ min-width: 0; }}
section.section {{ margin-bottom: 48px; }}
section.section > h2 {{
  font-family: Georgia, "Times New Roman", serif; font-size: 28px; line-height: 1.2;
  margin: 0 0 18px; padding-bottom: 8px; border-bottom: 3px solid var(--neutral);
}}
section.p-d > h2 {{ border-color: var(--dem); }}
section.p-r > h2 {{ border-color: var(--rep); }}
article.entry {{
  background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--neutral);
  border-radius: 8px; padding: 18px 20px 14px; margin: 0 0 16px;
}}
section.p-d article.entry {{ border-left-color: var(--dem); }}
section.p-r article.entry {{ border-left-color: var(--rep); }}
section.appendix article.entry {{ background: transparent; }}
article.entry:target {{ box-shadow: 0 0 0 3px color-mix(in srgb, var(--link) 35%, transparent); }}
article.entry h3 {{ font-size: 19px; line-height: 1.35; margin: 0 0 10px; display: flex; gap: 10px; align-items: baseline; }}
article.entry h3 a.self {{ color: inherit; text-decoration: none; }}
article.entry h3 a.self:hover {{ text-decoration: underline; }}
.code {{
  flex: none; font-size: 12px; font-weight: 700; letter-spacing: .03em; padding: 2px 7px; border-radius: 4px;
  background: var(--line); color: var(--text); font-variant-numeric: tabular-nums;
}}
section.p-d .code {{ background: var(--dem-soft); color: var(--dem); }}
section.p-r .code {{ background: var(--rep-soft); color: var(--rep); }}
article.entry ul {{ margin: 0; padding-left: 20px; }}
article.entry li {{ margin: 6px 0; }}
section.section > ul {{ padding-left: 20px; }}
section.section > p, section.section > ul {{ max-width: 75ch; }}
a.jump {{ display: inline-block; font-size: 13px; margin-top: 8px; text-decoration: none; }}
a.jump:hover {{ text-decoration: underline; }}
footer {{ border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; padding: 20px 0 40px; }}
@media (min-width: 1000px) {{
  .layout {{ grid-template-columns: 280px minmax(0, 1fr); gap: 48px; }}
  nav.toc {{ position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 32px); overflow: auto; }}
  nav.toc details {{ border: 0; background: none; padding: 0; }}
  nav.toc summary {{ list-style: none; pointer-events: none; color: var(--muted); text-transform: uppercase; font-size: 12px; letter-spacing: .06em; }}
  nav.toc summary::-webkit-details-marker {{ display: none; }}
}}
@media print {{
  nav.toc, a.jump {{ display: none; }}
  .layout {{ display: block; }}
  article.entry {{ break-inside: avoid; }}
}}
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <h1>{title}</h1>
    <p class="updated">{updated}</p>
    <div class="lead">{lead}</div>
    <div class="legend"><span class="d">Democratic-backed</span><span class="r">Republican-backed</span></div>
  </div>
</header>
<div class="wrap layout">
  <nav class="toc" aria-label="Contents">
    <details id="toc" open>
      <summary>Contents</summary>
      <ul>
{toc}
      </ul>
    </details>
  </nav>
  <main>
{body}
  </main>
</div>
<footer><div class="wrap">{updated}. Figures and vote counts are as stated in the source document; see Appendix C for data notes and Appendix D for sources.</div></footer>
<script>
// Collapse the contents list by default on narrow screens.
if (window.matchMedia("(max-width: 999px)").matches) document.getElementById("toc").removeAttribute("open");
</script>
</body>
</html>
"""


if __name__ == "__main__":
    build()
