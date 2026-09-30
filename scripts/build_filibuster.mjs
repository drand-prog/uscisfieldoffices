#!/usr/bin/env node
// Build the standalone "Filibuster Policy Failures by Topic" page
// (filibuster/index.html) from its Markdown source (filibuster/content.md).
//
// Usage:
//     node scripts/build_filibuster.mjs
//
// Rendering lives in filibuster/lib/render.js, which the admin page
// (filibuster/admin/) also uses, so a publish from the admin page and a
// local build produce the same HTML. Re-run after editing content.md by
// hand and commit both files. No dependencies beyond Node 18+.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderPage } from "../filibuster/lib/render.js";

const site = fileURLToPath(new URL("../filibuster/", import.meta.url));
const page = renderPage(readFileSync(site + "content.md", "utf8"));
writeFileSync(site + "index.html", page);
console.log(`wrote filibuster/index.html (${Buffer.byteLength(page).toLocaleString()} bytes)`);
