// Shared by the public page build (scripts/build_filibuster.mjs) and the
// admin editor (admin/index.html): parse content.md into a document model,
// serialize the model back to Markdown, and render the model to the page.
//
// Only the Markdown the content uses is supported: #/##/### headings,
// "- " bullet lists, paragraphs, **bold**, and [text](url) / [text](<url>)
// links.
//
// Model: { title, lead: [block], sections: [{ title, blocks: [block],
// entries: [{ title, blocks: [block] }] }] }, where a block is
// { type: "p", text } or { type: "ul", items: [text] }.

const LINK_RE = /\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;
const CODE_RE = /^([DR]\d+)\.\s/;

export function parse(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const doc = { title: (lines[0] || "").replace(/^#+\s*/, "").trim(), lead: [], sections: [] };
  let section = null;
  let entry = null;
  let para = [];

  const target = () => (entry ? entry.blocks : section ? section.blocks : doc.lead);
  const flushPara = () => {
    if (para.length) {
      target().push({ type: "p", text: para.join(" ") });
      para = [];
    }
  };

  for (const line of lines.slice(1)) {
    if (line.startsWith("## ")) {
      flushPara();
      section = { title: line.slice(3).trim(), blocks: [], entries: [] };
      doc.sections.push(section);
      entry = null;
    } else if (line.startsWith("### ")) {
      flushPara();
      if (!section) {
        section = { title: "", blocks: [], entries: [] };
        doc.sections.push(section);
      }
      entry = { title: line.slice(4).trim(), blocks: [] };
      section.entries.push(entry);
    } else if (line.startsWith("- ")) {
      flushPara();
      const blocks = target();
      const last = blocks[blocks.length - 1];
      if (last && last.type === "ul") last.items.push(line.slice(2));
      else blocks.push({ type: "ul", items: [line.slice(2)] });
    } else if (!line.trim()) {
      flushPara();
    } else {
      para.push(line.trim());
    }
  }
  flushPara();
  return doc;
}

// Collapse line breaks so a field's text stays a single Markdown line.
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();

function serializeBlocks(blocks) {
  return blocks
    .map((b) =>
      b.type === "ul"
        ? b.items.map(oneLine).filter(Boolean).map((i) => `- ${i}`).join("\n")
        : oneLine(b.text)
    )
    .filter(Boolean);
}

export function serialize(doc) {
  const parts = [`# ${oneLine(doc.title)}`, ...serializeBlocks(doc.lead)];
  for (const sec of doc.sections) {
    parts.push(`## ${oneLine(sec.title)}`, ...serializeBlocks(sec.blocks));
    for (const e of sec.entries) parts.push(`### ${oneLine(e.title)}`, ...serializeBlocks(e.blocks));
  }
  return parts.join("\n\n") + "\n";
}

function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const fmtText = (raw) => escapeText(raw).replace(BOLD_RE, "<strong>$1</strong>");

export function inline(raw) {
  let out = "";
  let pos = 0;
  for (const m of raw.matchAll(LINK_RE)) {
    out += fmtText(raw.slice(pos, m.index));
    const url = m[2] || m[3];
    out += `<a href="${escapeAttr(url)}" rel="noopener" target="_blank">${fmtText(m[1])}</a>`;
    pos = m.index + m[0].length;
  }
  return out + fmtText(raw.slice(pos));
}

function renderBlocks(blocks) {
  return blocks
    .map((b) =>
      b.type === "p"
        ? `<p>${inline(b.text)}</p>`
        : `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`
    )
    .join("\n");
}

function partyOf(title) {
  const t = title.toLowerCase();
  if (t.startsWith("democratic") || t.startsWith("appendix a")) return "d";
  if (t.startsWith("republican") || t.startsWith("appendix b")) return "r";
  return "";
}

export function renderPage(md) {
  const doc = parse(md);

  // Assign unique ids, and pair each summary entry (D1, R2, ...) with its
  // appendix detail entry so the two can link to each other.
  const used = new Set();
  const uid = (text) => {
    const base = slugify(text) || "section";
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };

  const summaryIds = {};
  const detailIds = {};
  const secs = doc.sections.map((sec) => {
    const appendix = sec.title.toLowerCase().startsWith("appendix");
    const s = { ...sec, id: uid(sec.title), party: partyOf(sec.title), appendix };
    s.entries = sec.entries.map((e) => {
      const m = CODE_RE.exec(e.title);
      const ent = { ...e, id: uid(e.title), code: m ? m[1] : null };
      if (ent.code) (appendix ? detailIds : summaryIds)[ent.code] = ent.id;
      return ent;
    });
    return s;
  });

  const toc = [];
  const body = [];
  for (const sec of secs) {
    let sub = "";
    if (sec.entries.length && !sec.appendix) {
      sub =
        "<ol>" +
        sec.entries.map((e) => `<li><a href="#${e.id}">${escapeAttr(e.title)}</a></li>`).join("") +
        "</ol>";
    }
    toc.push(
      `<li class="p-${sec.party || "n"}"><a href="#${sec.id}">${escapeAttr(sec.title)}</a>${sub}</li>`
    );

    const entries = sec.entries.map((e) => {
      let jump = "";
      if (sec.appendix) {
        const back = summaryIds[e.code];
        if (back) jump = `<a class="jump" href="#${back}">&uarr; Summary</a>`;
      } else {
        const fwd = detailIds[e.code];
        if (fwd) jump = `<a class="jump" href="#${fwd}">Details &darr;</a>`;
      }
      const title = e.code ? e.title.slice(e.code.length + 2) : e.title;
      const badge = e.code ? `<span class="code">${e.code}</span>` : "";
      return (
        `<article class="entry" id="${e.id}">` +
        `<h3>${badge}<a class="self" href="#${e.id}">${escapeAttr(title)}</a></h3>` +
        `${renderBlocks(e.blocks)}${jump}</article>`
      );
    });
    let cls = "section" + (sec.party ? ` p-${sec.party}` : "");
    if (sec.appendix) cls += " appendix";
    body.push(
      `<section class="${cls}" id="${sec.id}">` +
        `<h2>${escapeAttr(sec.title)}</h2>` +
        `${renderBlocks(sec.blocks)}${entries.join("")}</section>`
    );
  }

  const lead = [...doc.lead];
  let updated = "";
  if (lead.length && lead[0].type === "p" && lead[0].text.startsWith("Updated ")) {
    updated = lead.shift().text;
  }
  const description = lead.length && lead[0].type === "p" ? lead[0].text : doc.title;

  return template({
    title: escapeAttr(doc.title),
    description: escapeAttr(description),
    updated: escapeAttr(updated),
    lead: renderBlocks(lead),
    toc: toc.join("\n"),
    body: body.join("\n"),
  });
}

const template = ({ title, description, updated, lead, toc, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23233044'/%3E%3Ctext x='16' y='22' font-family='Georgia,serif' font-size='17' font-weight='700' text-anchor='middle' fill='%23f4efe6'%3E60%3C/text%3E%3C/svg%3E">
<!-- Generated from content.md by lib/render.js (via scripts/build_filibuster.mjs or the admin page); edit content.md or use /admin/, not this file. -->
<style>
:root {
  --bg: #fbfaf7; --surface: #ffffff; --text: #1d2330; --muted: #5d6573;
  --line: #e4e1da; --accent: #233044; --link: #1f5fa8;
  --dem: #2f5fb3; --dem-soft: #eef3fb; --rep: #b23a3a; --rep-soft: #fbefef;
  --neutral: #7a6f5c;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14171d; --surface: #1b1f27; --text: #e7e9ee; --muted: #9aa3b2;
    --line: #2c323d; --accent: #e7e9ee; --link: #8ab4f8;
    --dem: #7fa6ec; --dem-soft: #1c2536; --rep: #ec8a8a; --rep-soft: #33201f;
    --neutral: #bfae8f;
  }
}
:root[data-theme="dark"] {
  --bg: #14171d; --surface: #1b1f27; --text: #e7e9ee; --muted: #9aa3b2;
  --line: #2c323d; --accent: #e7e9ee; --link: #8ab4f8;
  --dem: #7fa6ec; --dem-soft: #1c2536; --rep: #ec8a8a; --rep-soft: #33201f;
  --neutral: #bfae8f;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 16px; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}
a { color: var(--link); text-underline-offset: 2px; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 16px; }
header.hero { padding: 56px 0 28px; border-bottom: 1px solid var(--line); }
header.hero h1 {
  font-family: Georgia, "Times New Roman", serif; font-weight: 700;
  font-size: clamp(30px, 5vw, 48px); line-height: 1.1; margin: 0 0 12px; color: var(--accent);
  max-width: 22ch;
}
header.hero .updated { color: var(--muted); font-size: 14px; margin: 0 0 16px; }
header.hero .lead p { font-size: 19px; max-width: 62ch; margin: 0; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 20px; font-size: 14px; color: var(--muted); }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
.legend .d::before { background: var(--dem); }
.legend .r::before { background: var(--rep); }
.layout { display: grid; grid-template-columns: 1fr; gap: 32px; padding-top: 32px; padding-bottom: 64px; }
nav.toc { font-size: 14px; }
nav.toc details { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 10px 14px; }
nav.toc summary { cursor: pointer; font-weight: 600; }
nav.toc ul, nav.toc ol { list-style: none; margin: 0; padding: 0; }
nav.toc > details > ul { margin-top: 10px; }
nav.toc li { margin: 6px 0; }
nav.toc ol { margin: 4px 0 10px 10px; border-left: 2px solid var(--line); padding-left: 10px; }
nav.toc .p-d > ol { border-color: var(--dem); }
nav.toc .p-r > ol { border-color: var(--rep); }
nav.toc ol a { color: var(--muted); text-decoration: none; }
nav.toc ol a:hover, nav.toc > details > ul > li > a:hover { color: var(--link); text-decoration: underline; }
nav.toc > details > ul > li > a { color: var(--text); font-weight: 600; text-decoration: none; }
main { min-width: 0; }
section.section { margin-bottom: 48px; }
section.section > h2 {
  font-family: Georgia, "Times New Roman", serif; font-size: 28px; line-height: 1.2;
  margin: 0 0 18px; padding-bottom: 8px; border-bottom: 3px solid var(--neutral);
}
section.p-d > h2 { border-color: var(--dem); }
section.p-r > h2 { border-color: var(--rep); }
article.entry {
  background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--neutral);
  border-radius: 8px; padding: 18px 20px 14px; margin: 0 0 16px;
}
section.p-d article.entry { border-left-color: var(--dem); }
section.p-r article.entry { border-left-color: var(--rep); }
section.appendix article.entry { background: transparent; }
article.entry:target { box-shadow: 0 0 0 3px color-mix(in srgb, var(--link) 35%, transparent); }
article.entry h3 { font-size: 19px; line-height: 1.35; margin: 0 0 10px; display: flex; gap: 10px; align-items: baseline; }
article.entry h3 a.self { color: inherit; text-decoration: none; }
article.entry h3 a.self:hover { text-decoration: underline; }
.code {
  flex: none; font-size: 12px; font-weight: 700; letter-spacing: .03em; padding: 2px 7px; border-radius: 4px;
  background: var(--line); color: var(--text); font-variant-numeric: tabular-nums;
}
section.p-d .code { background: var(--dem-soft); color: var(--dem); }
section.p-r .code { background: var(--rep-soft); color: var(--rep); }
article.entry ul { margin: 0; padding-left: 20px; }
article.entry li { margin: 6px 0; }
section.section > ul { padding-left: 20px; }
section.section > p, section.section > ul { max-width: 75ch; }
a.jump { display: inline-block; font-size: 13px; margin-top: 8px; text-decoration: none; }
a.jump:hover { text-decoration: underline; }
footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; padding: 20px 0 40px; }
@media (min-width: 1000px) {
  .layout { grid-template-columns: 280px minmax(0, 1fr); gap: 48px; }
  nav.toc { position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 32px); overflow: auto; }
  nav.toc details { border: 0; background: none; padding: 0; }
  nav.toc summary { list-style: none; pointer-events: none; color: var(--muted); text-transform: uppercase; font-size: 12px; letter-spacing: .06em; }
  nav.toc summary::-webkit-details-marker { display: none; }
}
@media print {
  nav.toc, a.jump { display: none; }
  .layout { display: block; }
  article.entry { break-inside: avoid; }
}
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <h1>${title}</h1>
    <p class="updated">${updated}</p>
    <div class="lead">${lead}</div>
    <div class="legend"><span class="d">Democratic-backed</span><span class="r">Republican-backed</span></div>
  </div>
</header>
<div class="wrap layout">
  <nav class="toc" aria-label="Contents">
    <details id="toc" open>
      <summary>Contents</summary>
      <ul>
${toc}
      </ul>
    </details>
  </nav>
  <main>
${body}
  </main>
</div>
<footer><div class="wrap">${updated}. Figures and vote counts are as stated in the source document; see Appendix C for data notes and Appendix D for sources.</div></footer>
<script>
// Collapse the contents list by default on narrow screens.
if (window.matchMedia("(max-width: 999px)").matches) document.getElementById("toc").removeAttribute("open");
</script>
</body>
</html>
`;
