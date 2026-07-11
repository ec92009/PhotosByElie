#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_ROOT = path.join(REPO_ROOT, "assets", "owner-actions", "social-post-packages");
const MARKDOWN_HEADING = "## Facebook Personal Share Assist";

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

function usage() {
  return `Usage:
  node scripts/facebook_personal_share_assist.mjs [--date YYYY-MM-DD]
  node scripts/facebook_personal_share_assist.mjs --package assets/owner-actions/social-post-packages/YYYY-MM-DD/daily-social-package.json
  node scripts/facebook_personal_share_assist.mjs --date YYYY-MM-DD --copy --open

Options:
  --date YYYY-MM-DD   Use that daily social package. Defaults to latest.
  --package PATH      Use an explicit daily package JSON.
  --copy              Copy the French and English personal-share text to the macOS clipboard.
  --open              Open the Facebook share URL in the default browser.
  --no-write          Print the assist kit without writing files.

Notes:
  This prepares a user-mediated personal profile share. It does not automate the
  final Facebook Post button and does not use private profile endpoints.`;
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error("");
  console.error(usage());
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function repoRelative(filePath) {
  return path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/");
}

function latestPackagePath() {
  const latestPath = path.join(PACKAGE_ROOT, "latest-daily-social-package.json");
  if (fs.existsSync(latestPath)) return latestPath;
  const dates = fs.readdirSync(PACKAGE_ROOT)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
  if (!dates.length) fail(`No daily social package directories found under ${repoRelative(PACKAGE_ROOT)}.`);
  return path.join(PACKAGE_ROOT, dates.at(-1), "daily-social-package.json");
}

function packagePathFromArgs() {
  if (args.get("package")) return path.resolve(String(args.get("package")));
  if (args.get("date")) {
    return path.join(PACKAGE_ROOT, String(args.get("date")), "daily-social-package.json");
  }
  return latestPackagePath();
}

function packageRows(payload) {
  return Array.isArray(payload.platforms) ? payload.platforms : Array.isArray(payload.packages) ? payload.packages : [];
}

function publishedUrl(row) {
  return row.published_url
    || row.published?.permalink
    || row.published?.permalink_url
    || row.verification?.permalink
    || row.verification?.permalink_url
    || "";
}

function slugFromRow(row) {
  const itemPath = packageItems(row).find((item) => item.local_staged_path)?.local_staged_path;
  if (itemPath) return path.basename(path.dirname(path.dirname(itemPath)));
  return String(row.title || "facebook-share")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function packageItems(row) {
  return Array.isArray(row.items) ? row.items : Array.isArray(row.media) ? row.media : [];
}

function facebookShareUrl(postUrl) {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`;
}

function frenchShareText(row, postUrl) {
  const title = String(row.title || "la nouvelle série").trim();
  return [
    "Je viens de publier quelques nouvelles photos sur Photos By Elie.",
    "",
    `La série du jour, « ${title} », rassemble quelques images que j'aime beaucoup.`,
    "",
    "À voir ici :",
    postUrl,
  ].join("\n");
}

function englishShareText(row, postUrl) {
  const title = String(row.title || "the new series").trim();
  return [
    "I just published a few new photos on Photos By Elie.",
    "",
    `Today's series, "${title}", brings together a few images I really like.`,
    "",
    "See it here:",
    postUrl,
  ].join("\n");
}

function clipboardText(assist) {
  return [
    "FR:",
    assist.text_fr,
    "",
    "EN:",
    assist.text_en,
  ].join("\n");
}

function renderReadme(assist) {
  return `# Facebook Personal Share Assist - ${assist.date}

Status: ${assist.status}
Expected identity: ${assist.expected_identity}
Source Page post: ${assist.facebook_post_url}
Share URL: ${assist.share_url}

French text:

${assist.text_fr}

English text:

${assist.text_en}

Manual final step:
- Confirm the visible Facebook posting identity is ${assist.expected_identity}, not Photos By Elie.
- Paste either the French or English text, or both, if it is not already in the composer.
- Click Facebook's final Post button yourself.
`;
}

function markdownSection(assist) {
  return `${MARKDOWN_HEADING}

- Status: ${assist.status}
- Expected identity: ${assist.expected_identity}
- Source Page post: ${assist.facebook_post_url}
- Share URL: ${assist.share_url}
- Local kit: ${assist.local_dir}

French text:

${assist.text_fr}

English text:

${assist.text_en}
`;
}

function upsertMarkdownSection(markdown, assist) {
  const section = markdownSection(assist).trimEnd();
  const pattern = new RegExp(`\\n${MARKDOWN_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n## |$)`);
  if (pattern.test(markdown)) {
    return `${markdown.replace(pattern, `\n${section}` ).trimEnd()}\n`;
  }
  return `${markdown.trimEnd()}\n\n${section}\n`;
}

function copyToClipboard(text) {
  const result = spawnSync("pbcopy", { input: text, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`pbcopy failed: ${result.stderr?.toString() || "unknown error"}`);
  }
}

function openUrl(url) {
  const result = spawnSync("open", [url], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`open failed: ${result.stderr?.toString() || "unknown error"}`);
  }
}

function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  const packagePath = packagePathFromArgs();
  if (!fs.existsSync(packagePath)) fail(`Daily package not found: ${repoRelative(packagePath)}`);

  const payload = readJson(packagePath);
  const date = String(payload.date || args.get("date") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`Cannot determine package date for ${repoRelative(packagePath)}`);

  const facebook = packageRows(payload).find((row) => String(row.platform || "").toLowerCase() === "facebook");
  if (!facebook) fail(`${repoRelative(packagePath)} has no Facebook platform row.`);

  const postUrl = publishedUrl(facebook);
  if (!postUrl) fail(`${date} Facebook row is not published yet; publish the Page post before creating a personal share assist.`);

  const slug = slugFromRow(facebook);
  const assistDir = path.join(REPO_ROOT, "socials", "Facebook", date, slug, "personal-share");
  const assist = {
    format: "photosbyelie-facebook-personal-share-assist",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    date,
    status: "prepared_manual_final_click",
    expected_identity: "Elie Cohen",
    source_platform: "Facebook",
    source_page: facebook.account || "Photos By Elie",
    source_title: facebook.title || "",
    facebook_post_url: postUrl,
    campaign_url: facebook.destination_url || "",
    share_url: facebookShareUrl(postUrl),
    text_fr: frenchShareText(facebook, postUrl),
    text_en: englishShareText(facebook, postUrl),
    local_dir: repoRelative(assistDir),
    local_files: {
      text_fr: repoRelative(path.join(assistDir, "text-fr.txt")),
      text_en: repoRelative(path.join(assistDir, "text-en.txt")),
      share_url: repoRelative(path.join(assistDir, "share-url.txt")),
      manifest: repoRelative(path.join(assistDir, "manifest.json")),
      readme: repoRelative(path.join(assistDir, "README.md")),
    },
    guardrails: [
      "This is a user-mediated personal profile share assist.",
      "Do not automate the final Facebook Post button.",
      "Confirm the visible posting identity is Elie Cohen before posting.",
      "Do not use private Facebook endpoints, cookies, passwords, or 2FA codes.",
    ],
  };

  if (!args.get("no-write")) {
    fs.mkdirSync(assistDir, { recursive: true });
    fs.writeFileSync(path.join(assistDir, "text-fr.txt"), `${assist.text_fr}\n`);
    fs.writeFileSync(path.join(assistDir, "text-en.txt"), `${assist.text_en}\n`);
    fs.writeFileSync(path.join(assistDir, "share-url.txt"), `${assist.share_url}\n`);
    fs.writeFileSync(path.join(assistDir, "README.md"), renderReadme(assist));
    writeJson(path.join(assistDir, "manifest.json"), assist);

    facebook.personal_share_assist = assist;
    payload.personal_share_assist = assist;
    writeJson(packagePath, payload);

    const datePackagePath = path.join(PACKAGE_ROOT, date, "daily-social-package.json");
    if (path.resolve(packagePath) !== path.resolve(datePackagePath) && fs.existsSync(datePackagePath)) {
      const datedPayload = readJson(datePackagePath);
      const datedFacebook = packageRows(datedPayload).find((row) => String(row.platform || "").toLowerCase() === "facebook");
      if (datedFacebook) datedFacebook.personal_share_assist = assist;
      datedPayload.personal_share_assist = assist;
      writeJson(datePackagePath, datedPayload);
    }

    const latestPath = path.join(PACKAGE_ROOT, "latest-daily-social-package.json");
    if (fs.existsSync(latestPath)) {
      const latestPayload = readJson(latestPath);
      if (String(latestPayload.date || "") === date) {
        const latestFacebook = packageRows(latestPayload).find((row) => String(row.platform || "").toLowerCase() === "facebook");
        if (latestFacebook) latestFacebook.personal_share_assist = assist;
        latestPayload.personal_share_assist = assist;
        writeJson(latestPath, latestPayload);
      }
    }

    const markdownPath = path.join(PACKAGE_ROOT, date, "daily-social-package.md");
    if (fs.existsSync(markdownPath)) {
      fs.writeFileSync(markdownPath, upsertMarkdownSection(fs.readFileSync(markdownPath, "utf8"), assist));
    }
  }

  if (args.get("copy")) copyToClipboard(clipboardText(assist));
  if (args.get("open")) openUrl(assist.share_url);

  console.log(JSON.stringify({
    status: assist.status,
    date: assist.date,
    expected_identity: assist.expected_identity,
    facebook_post_url: assist.facebook_post_url,
    share_url: assist.share_url,
    copied: Boolean(args.get("copy")),
    opened: Boolean(args.get("open")),
    local_dir: assist.local_dir,
    text_fr: assist.text_fr,
    text_en: assist.text_en,
  }, null, 2));
}

try {
  main();
} catch (error) {
  fail(error.message || String(error));
}
