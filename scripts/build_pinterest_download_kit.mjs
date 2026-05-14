#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_ROOT = path.join(REPO_ROOT, "socials", "Pinterest");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) {
    args.set(key, true);
    continue;
  }
  args.set(key, next);
  index += 1;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function newestManifestDir() {
  const dates = fs.existsSync(DEFAULT_ROOT)
    ? fs.readdirSync(DEFAULT_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .filter((name) => fs.existsSync(path.join(DEFAULT_ROOT, name, "manifest.json")))
      .sort()
    : [];
  if (!dates.length) {
    throw new Error(`No Pinterest manifest found under ${path.relative(REPO_ROOT, DEFAULT_ROOT)}`);
  }
  return path.join(DEFAULT_ROOT, dates[dates.length - 1]);
}

function resolveWorkDir() {
  if (args.get("dir")) return path.resolve(String(args.get("dir")));
  if (args.get("date")) return path.join(DEFAULT_ROOT, String(args.get("date")));
  return newestManifestDir();
}

function fileSizeLabel(filePath) {
  const bytes = fs.statSync(filePath).size;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function addFile(rows, workDir, item) {
  if (!item.relativePath) return;
  const absolutePath = path.join(workDir, item.relativePath);
  if (!fs.existsSync(absolutePath)) return;
  rows.push({
    ...item,
    size: fileSizeLabel(absolutePath),
  });
}

function rowsForManifest(workDir, manifest) {
  const rows = [];
  addFile(rows, workDir, {
    section: "Primary Pin",
    label: "Single-image 2:3 Pin JPG",
    relativePath: manifest.staged_single_pin?.image,
    note: "Upload this directly to Pinterest instead of downloading it back from Pinterest.",
  });
  addFile(rows, workDir, {
    section: "Review",
    label: "Pin landing page",
    relativePath: "landing-page.html",
    note: "Open locally or publish for Pinterest scraping and owner review.",
  });
  addFile(rows, workDir, {
    section: "Review",
    label: "Carousel contact sheet",
    relativePath: "contact-sheet.jpg",
    note: "Review the candidate crops together.",
  });
  addFile(rows, workDir, {
    section: "Review",
    label: "Source family contact sheet",
    relativePath: "source-family-contact-sheet.jpg",
    note: "Review the larger source family.",
  });
  for (const candidate of manifest.carousel_candidates || []) {
    addFile(rows, workDir, {
      section: "Carousel Candidates",
      label: candidate.label || candidate.photo_id || "Candidate",
      relativePath: candidate.image,
      note: candidate.photo_id ? `Photo id: ${candidate.photo_id}` : "",
    });
  }
  for (const candidate of manifest.carousel_candidates || []) {
    addFile(rows, workDir, {
      section: "Source Previews",
      label: `${candidate.label || candidate.photo_id || "Candidate"} source preview`,
      relativePath: candidate.source,
      note: candidate.photo_id ? `Source for ${candidate.photo_id}` : "",
    });
  }
  return rows;
}

function tsvCell(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function renderTsv(rows) {
  const header = ["section", "label", "path", "size", "note"];
  const body = rows.map((row) => [
    row.section,
    row.label,
    row.relativePath,
    row.size,
    row.note,
  ].map(tsvCell).join("\t"));
  return `${header.join("\t")}\n${body.join("\n")}\n`;
}

function renderFileList(rows) {
  let currentSection = "";
  const parts = [];
  for (const row of rows) {
    if (row.section !== currentSection) {
      currentSection = row.section;
      parts.push(`<h2>${escapeHtml(currentSection)}</h2>`);
    }
    const href = encodeURI(row.relativePath);
    parts.push(`
      <article class="download-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <span>${escapeHtml(row.relativePath)} · ${escapeHtml(row.size)}</span>
          ${row.note ? `<p>${escapeHtml(row.note)}</p>` : ""}
        </div>
        <div class="actions">
          <a class="button" href="${href}" download>Download</a>
          <a class="button secondary" href="${href}" target="_blank" rel="noreferrer">Open</a>
        </div>
      </article>
    `);
  }
  return parts.join("\n");
}

function renderCopyBlock(label, value) {
  if (!value) return "";
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <textarea readonly>${escapeHtml(value)}</textarea>
    </label>
  `;
}

function renderHtml(workDir, manifest, rows) {
  const title = manifest.title || manifest.topic || "Pinterest kit";
  const publishedAsset = manifest.staged_single_pin?.published_asset || "";
  const publishedLanding = manifest.staged_single_pin?.landing_page || "";
  const relativeWorkDir = path.relative(REPO_ROOT, workDir);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)} | Owner Pinterest Kit</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: Canvas;
      color: CanvasText;
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 5vw, 4rem);
      letter-spacing: 0;
    }
    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: .14em;
      font-size: .8rem;
      font-weight: 900;
      color: color-mix(in srgb, CanvasText 68%, Canvas 32%);
    }
    .lede {
      max-width: 760px;
      color: color-mix(in srgb, CanvasText 70%, Canvas 30%);
      font-size: 1.1rem;
      line-height: 1.45;
    }
    .meta, .copy-grid, .download-row {
      border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas 82%);
      background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
    }
    .meta {
      display: grid;
      gap: 10px;
      margin: 24px 0;
      padding: 16px;
    }
    .meta div {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .meta b {
      min-width: 110px;
    }
    h2 {
      margin: 32px 0 12px;
      text-transform: uppercase;
      letter-spacing: .12em;
      font-size: .9rem;
      color: color-mix(in srgb, CanvasText 68%, Canvas 32%);
    }
    .download-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      margin: 10px 0;
      padding: 14px;
    }
    .download-row span, .download-row p {
      display: block;
      margin: 4px 0 0;
      color: color-mix(in srgb, CanvasText 66%, Canvas 34%);
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 0 14px;
      border: 1px solid CanvasText;
      border-radius: 999px;
      color: Canvas;
      background: CanvasText;
      text-decoration: none;
      font-weight: 800;
    }
    .button.secondary {
      color: CanvasText;
      background: transparent;
    }
    .copy-grid {
      display: grid;
      gap: 14px;
      padding: 16px;
    }
    label span {
      display: block;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: .1em;
      font-size: .78rem;
      font-weight: 800;
    }
    textarea {
      width: 100%;
      min-height: 72px;
      box-sizing: border-box;
      padding: 10px;
      resize: vertical;
      font: inherit;
      border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas 82%);
      background: Canvas;
      color: CanvasText;
    }
    @media (max-width: 720px) {
      .download-row {
        grid-template-columns: 1fr;
      }
      .actions {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Owner Pinterest kit</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">Internal posting workspace for Photos By Elie. This is not buyer-facing copy. Use these first-party files and copy blocks when preparing a Pin; do not download assets back from Pinterest's browser UI.</p>

    <section class="meta" aria-label="Pin metadata">
      <div><b>Date</b><span>${escapeHtml(manifest.date)}</span></div>
      <div><b>Account</b><span>${escapeHtml(manifest.account)}</span></div>
      <div><b>Board</b><span>${escapeHtml(manifest.board)}</span></div>
      <div><b>Status</b><span>${escapeHtml(manifest.status)}</span></div>
      <div><b>Destination</b><a href="${escapeHtml(manifest.destination)}" target="_blank" rel="noreferrer">${escapeHtml(manifest.destination)}</a></div>
      ${publishedAsset ? `<div><b>Published JPG</b><a href="${escapeHtml(publishedAsset)}" target="_blank" rel="noreferrer">${escapeHtml(publishedAsset)}</a></div>` : ""}
      ${publishedLanding ? `<div><b>Published page</b><a href="${escapeHtml(publishedLanding)}" target="_blank" rel="noreferrer">${escapeHtml(publishedLanding)}</a></div>` : ""}
      <div><b>Local folder</b><span>${escapeHtml(relativeWorkDir)}</span></div>
    </section>

    <h2>Copy</h2>
    <section class="copy-grid">
      ${renderCopyBlock("Title", manifest.title)}
      ${renderCopyBlock("Description", manifest.description)}
      ${renderCopyBlock("Alt text", manifest.alt_text)}
    </section>

    ${renderFileList(rows)}
  </main>
</body>
</html>
`;
  return html.replace(/[ \t]+$/gm, "");
}

const workDir = resolveWorkDir();
const manifestPath = path.join(workDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing manifest: ${path.relative(REPO_ROOT, manifestPath)}`);
}

const manifest = readJson(manifestPath);
const rows = rowsForManifest(workDir, manifest);
const htmlPath = path.join(workDir, "downloads.html");
const tsvPath = path.join(workDir, "download-manifest.tsv");
fs.writeFileSync(htmlPath, renderHtml(workDir, manifest, rows));
fs.writeFileSync(tsvPath, renderTsv(rows));

console.log(`Wrote ${path.relative(REPO_ROOT, htmlPath)}`);
console.log(`Wrote ${path.relative(REPO_ROOT, tsvPath)}`);
