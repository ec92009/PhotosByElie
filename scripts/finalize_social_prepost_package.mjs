#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalogTsv = require("./catalog_tsv.cjs");

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGE_ROOT = path.join(REPO_ROOT, "assets", "owner-actions", "social-post-packages");
const CAMPAIGN_DIR = path.join(REPO_ROOT, "assets", "campaigns");
const SOCIAL_ROOT = path.join(REPO_ROOT, "socials");
const SITE_BASE_URL = "https://photos-by-elie.com/";
const SOCIAL_PLATFORMS = new Set(["facebook", "instagram", "pinterest", "threads"]);
const LEGACY_R2_HOST = "pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev";

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(key, true);
      continue;
    }
    parsed.set(key, next);
    index += 1;
  }
  return parsed;
}

const args = parseArgs(process.argv);
const dryRun = Boolean(args.get("dry-run"));
const fetchImages = !Boolean(args.get("skip-image-fetch"));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function repoRelative(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "social-package";
}

function platformName(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "facebook") return "Facebook";
  if (lower === "instagram") return "Instagram";
  if (lower === "pinterest") return "Pinterest";
  if (lower === "threads") return "Threads";
  return String(value || "Social");
}

function platformKey(row) {
  return String(row.platform || "").toLowerCase();
}

function loadMediaConfig() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readText(path.join(REPO_ROOT, "media-config.js")), context, { filename: "media-config.js" });
  return context.window.photosByElieMediaConfig || {};
}

function loadCatalog() {
  const collections = catalogTsv.loadCatalogWindow(REPO_ROOT).photosByElieData || {};
  const byId = new Map();
  for (const [collectionKey, collection] of Object.entries(collections)) {
    for (const photo of collection.photos || []) {
      byId.set(photo.id, { collectionKey, collection, photo });
    }
  }
  return byId;
}

function metadataValue(photo, label) {
  return (photo?.metadata || []).find((item) => item.label === label)?.value || "";
}

function previewDimensions(photo) {
  const previewFile = metadataValue(photo, "Preview file");
  const match = previewFile.match(/\b(\d{3,5})\s+x\s+(\d{3,5})\b/);
  if (!match) return {};
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function publicPreviewUrl(photo, mediaConfig, size = "detail") {
  const preview = photo?.media?.publicPreview || {};
  const key = size === "gallery"
    ? preview.galleryKey || preview.detailKey
    : preview.detailKey || preview.galleryKey;
  if (!key || !mediaConfig.publicBaseUrl) return "";
  return `${String(mediaConfig.publicBaseUrl).replace(/\/$/, "")}/${String(key).replace(/^\//, "")}`;
}

function normalizeMediaUrl(value, mediaConfig) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (url.hostname === LEGACY_R2_HOST && mediaConfig.publicBaseUrl) {
      return `${String(mediaConfig.publicBaseUrl).replace(/\/$/, "")}${url.pathname}`;
    }
  } catch {
    return String(value);
  }
  return String(value);
}

function photoUrl(mediaId) {
  return `${SITE_BASE_URL}photo.html?id=${encodeURIComponent(mediaId)}`;
}

function campaignUrl(campaignId) {
  return `${SITE_BASE_URL}campaign.html?c=${encodeURIComponent(campaignId)}`;
}

function campaignIdFor(row, date, titleSlug) {
  const current = String(row.campaign_id || "").trim();
  if (current) return current;
  return `${platformKey(row) || "social"}-${titleSlug}-${date}`;
}

function itemImagePath(platform, date, titleSlug, item, order) {
  const extension = String(item.image || item.local_staged_path || "").match(/\.(jpe?g|png|webp)$/i)?.[0] || ".jpg";
  const fileName = `${String(order).padStart(2, "0")}-${slugify(item.media_id || item.id)}-${titleSlug}${extension.toLowerCase()}`;
  return `images/${fileName}`;
}

function normalizeItem(item, { order, row, date, titleSlug, mediaConfig, catalog }) {
  const mediaId = String(item.media_id || item.id || "").trim();
  const entry = catalog.get(mediaId);
  const dims = previewDimensions(entry?.photo);
  const sourceUrl = publicPreviewUrl(entry?.photo, mediaConfig, "detail")
    || normalizeMediaUrl(item.public_asset_url || item.source_url, mediaConfig);
  const image = item.image || itemImagePath(row.platform, date, titleSlug, item, order);
  const localStagedPath = path.join("socials", row.platform, date, titleSlug, image).replaceAll(path.sep, "/");

  return {
    ...item,
    order,
    id: mediaId,
    media_id: mediaId,
    title: entry?.photo?.title || item.title || mediaId,
    collection: entry?.collectionKey || item.collection || "",
    location: metadataValue(entry?.photo, "Location") || item.location || entry?.collection?.title || "",
    width: dims.width || item.width || 0,
    height: dims.height || item.height || 0,
    source_url: sourceUrl,
    public_asset_url: sourceUrl,
    photo_url: photoUrl(mediaId),
    public_photo_url: photoUrl(mediaId),
    image,
    local_staged_path: localStagedPath,
  };
}

function publishedUrl(row) {
  return row.published_url
    || row.published?.permalink
    || row.verification?.permalink
    || "";
}

function defaultBlockers(row, manifestPath) {
  if (publishedUrl(row)) return [];
  const blockers = new Set(Array.isArray(row.manual_blockers) ? row.manual_blockers : []);
  blockers.add(`Publish pending: review ${repoRelative(manifestPath)} and use the ${row.platform} browser/API workflow.`);
  if (row.platform === "Instagram") {
    blockers.add("Instagram feed captions are not clickable; update the profile website link or use a Story link sticker before posting.");
  }
  if (row.platform === "Pinterest") {
    blockers.add("Pinterest publish pending: choose the board and publish one Pin per staged image or use the prepared browser upload set.");
  }
  return Array.from(blockers);
}

function postType(row) {
  if (row.post_type) return row.post_type;
  if (row.platform === "Pinterest") return "multi_pin_sequence";
  if (row.platform === "Facebook") return "multi_photo";
  return "carousel";
}

function enforceCount(row) {
  const count = Array.isArray(row.items) ? row.items.length : 0;
  if (row.platform === "Pinterest" && count !== 5) {
    throw new Error(`${row.platform} ${row.title} must contain exactly 5 images; found ${count}.`);
  }
  if ((row.platform === "Facebook" || row.platform === "Instagram") && (count < 5 || count > 10)) {
    throw new Error(`${row.platform} ${row.title} must contain 5-10 images; found ${count}.`);
  }
  if (row.platform === "Threads" && (count < 3 || count > 4)) {
    throw new Error(`${row.platform} ${row.title} must contain 3-4 images; found ${count}.`);
  }
}

function normalizeRow(row, { date, mediaConfig, catalog }) {
  const platform = platformName(row.platform);
  const title = String(row.title || row.theme || "Social package").trim();
  const titleSlug = slugify(row.slug || title);
  const campaignId = campaignIdFor({ ...row, platform }, date, titleSlug);
  const packageDir = path.join(SOCIAL_ROOT, platform, date, titleSlug);
  const manifestPath = path.join(packageDir, "manifest.json");
  const items = (Array.isArray(row.items) ? row.items : [])
    .map((item, index) => normalizeItem(item, {
      order: index + 1,
      row: { ...row, platform },
      date,
      titleSlug,
      mediaConfig,
      catalog,
    }));
  const normalized = {
    ...row,
    date,
    platform,
    status: row.status || "prepared",
    account: row.account || accountFor(platform),
    post_type: postType({ ...row, platform }),
    title,
    destination_url: campaignUrl(campaignId),
    campaign_id: campaignId,
    caption: row.caption || defaultCaption(platform, title, campaignId),
    recommended_upload_set: "images",
    available_count: items.length,
    notes: Array.from(new Set([
      ...(Array.isArray(row.notes) ? row.notes : []),
      "Images are public watermarked R2 previews staged for upload/API publishing.",
    ])),
    items,
  };
  normalized.manual_blockers = defaultBlockers(normalized, manifestPath);
  const url = publishedUrl(normalized);
  if (url) normalized.published_url = url;
  enforceCount(normalized);
  return normalized;
}

function accountFor(platform) {
  if (platform === "Facebook") return "Photos By Elie";
  if (platform === "Pinterest") return "PhotosByElie Pinterest";
  return "ec92009";
}

function defaultCaption(platform, title, campaignId) {
  const destination = campaignUrl(campaignId);
  if (platform === "Instagram") {
    return `${title} from Photos By Elie. Browse the edit from the profile link.\n\n#PhotosByElie #TravelPhotography #WallArt`;
  }
  return `${title} from Photos By Elie. Browse: ${destination}`;
}

function deriveThreads(platforms, date) {
  if (platforms.some((row) => platformKey(row) === "threads")) return platforms;
  const instagram = platforms.find((row) => platformKey(row) === "instagram" && Array.isArray(row.items) && row.items.length >= 3);
  if (!instagram) return platforms;
  const items = instagram.items.slice(0, 4);
  const threads = {
    ...instagram,
    platform: "Threads",
    status: "prepared",
    account: "ec92009",
    post_type: "carousel",
    caption: `${instagram.title} in four Photos By Elie frames. Browse: ${instagram.destination_url || campaignUrl(instagram.campaign_id)}`,
    available_count: items.length,
    items,
    published: undefined,
    verification: undefined,
    published_url: undefined,
    notes: [
      "Derived from the Instagram package for a 3-4 image Threads carousel.",
      "Images are public watermarked R2 previews staged for upload/API publishing.",
    ],
  };
  return [...platforms, { ...threads, date }];
}

function statusFor(platforms) {
  const published = platforms.filter((row) => publishedUrl(row)).length;
  if (published === platforms.length && platforms.length) return "published";
  if (published > 0) return "published_partial";
  return "prepared";
}

function packagePathFromArgs() {
  if (args.get("package")) return path.resolve(String(args.get("package")));
  const date = args.get("date") ? String(args.get("date")) : "";
  if (date) return path.join(PACKAGE_ROOT, date, "daily-social-package.json");
  const latestPath = path.join(PACKAGE_ROOT, "latest-daily-social-package.json");
  if (fs.existsSync(latestPath)) return latestPath;
  const dates = fs.readdirSync(PACKAGE_ROOT)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
  if (!dates.length) throw new Error(`No daily social package directories found under ${repoRelative(PACKAGE_ROOT)}.`);
  return path.join(PACKAGE_ROOT, dates.at(-1), "daily-social-package.json");
}

function currentVersion() {
  return `v${readText(path.join(REPO_ROOT, "VERSION")).trim()}`;
}

function campaignDescription(row) {
  const count = row.items.length;
  const noun = count === 1 ? "photo" : "photo";
  return `A ${count}-${noun} ${row.title} edit prepared for ${row.platform} with public Photos By Elie previews and a first-party browsing destination.`;
}

function campaignPayload(row) {
  const campaignPath = path.join(CAMPAIGN_DIR, `${row.campaign_id}.json`);
  const existing = fs.existsSync(campaignPath) ? readJson(campaignPath) : {};
  const primaryIds = row.items.map((item) => item.media_id).filter(Boolean);
  return {
    ...existing,
    id: row.campaign_id,
    source: row.platform,
    title: row.title,
    eyebrow: existing.eyebrow || `${row.platform} edit`,
    description: existing.description || campaignDescription(row),
    relatedTitle: existing.relatedTitle || "More Photos By Elie edits",
    heroPhotoId: primaryIds.includes(existing.heroPhotoId) ? existing.heroPhotoId : primaryIds[0],
    primaryPhotoIds: primaryIds,
    relatedPhotoIds: Array.isArray(existing.relatedPhotoIds) ? existing.relatedPhotoIds : [],
    searchPlaceholder: existing.searchPlaceholder || row.title,
  };
}

function renderPlatformReadme(row) {
  const lines = [
    `# ${row.platform} - ${row.date} - ${row.title}`,
    "",
    `Status: ${row.status}`,
    `Destination: ${row.destination_url}`,
  ];
  const url = publishedUrl(row);
  if (url) lines.push(`Published URL: ${url}`);
  if (row.manual_blockers?.length) {
    lines.push("", "Manual blockers:");
    for (const blocker of row.manual_blockers) lines.push(`- ${blocker}`);
  }
  lines.push("", "Caption:", "", row.caption, "", "Images:");
  for (const item of row.items) {
    lines.push(`- ${item.order}. \`${item.media_id}\` - ${item.public_asset_url} - ${item.local_staged_path}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderPackageMarkdown(payload) {
  const lines = [
    `# Daily Social Package - ${payload.date}`,
    "",
    `Status: ${payload.status}`,
    `Visible version: ${payload.visible_version}`,
    "",
  ];
  for (const row of payload.platforms) {
    lines.push(`## ${row.platform}: ${row.title}`, "");
    lines.push(`- Status: ${row.status}`);
    lines.push(`- Destination: ${row.destination_url}`);
    const url = publishedUrl(row);
    if (url) lines.push(`- Published URL: ${url}`);
    if (row.manual_blockers?.length) {
      lines.push(`- Manual blockers: ${row.manual_blockers.join(" | ")}`);
    }
    lines.push("", "| # | Media id | Source URL | Local image |");
    lines.push("| ---: | --- | --- | --- |");
    for (const item of row.items) {
      lines.push(`| ${item.order} | \`${item.media_id}\` | ${item.public_asset_url} | ${item.local_staged_path} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function ensureStagedImage(item, dry) {
  const targetPath = path.join(REPO_ROOT, item.local_staged_path);
  if (fs.existsSync(targetPath)) return;
  if (dry || !fetchImages) {
    throw new Error(`Missing staged image ${item.local_staged_path}`);
  }
  if (!item.public_asset_url) throw new Error(`No source URL for ${item.media_id}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const response = await fetch(item.public_asset_url);
  if (!response.ok) throw new Error(`Failed to fetch ${item.public_asset_url}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, body);
}

async function writePlatform(row) {
  const packageDir = path.join(SOCIAL_ROOT, row.platform, row.date, slugify(row.title));
  if (dryRun) {
    for (const item of row.items) await ensureStagedImage(item, true);
    return;
  }
  fs.mkdirSync(path.join(packageDir, "images"), { recursive: true });
  for (const item of row.items) await ensureStagedImage(item, false);
  fs.writeFileSync(path.join(packageDir, "caption.txt"), `${row.caption.trim()}\n`);
  fs.writeFileSync(path.join(packageDir, "README.md"), renderPlatformReadme(row));
  writeJson(path.join(packageDir, "manifest.json"), row);
}

function writeCampaign(row) {
  const payload = campaignPayload(row);
  if (!dryRun) writeJson(path.join(CAMPAIGN_DIR, `${payload.id}.json`), payload);
}

function campaignPriority(row) {
  const platformWeight = row.platform === "Threads" ? 0 : 100;
  return platformWeight + (Array.isArray(row.items) ? row.items.length : 0);
}

function campaignRows(platforms) {
  const chosen = new Map();
  for (const row of platforms) {
    const previous = chosen.get(row.campaign_id);
    if (!previous || campaignPriority(row) > campaignPriority(previous)) {
      chosen.set(row.campaign_id, row);
    }
  }
  return Array.from(chosen.values());
}

function writePackage(payload, packagePath) {
  const packageDir = path.dirname(packagePath);
  if (dryRun) return;
  writeJson(path.join(packageDir, "daily-social-package.json"), payload);
  fs.writeFileSync(path.join(packageDir, "daily-social-package.md"), renderPackageMarkdown(payload));
  writeJson(path.join(PACKAGE_ROOT, "latest-daily-social-package.json"), payload);
  writeJson(path.join(PACKAGE_ROOT, "latest.json"), {
    format: payload.format,
    schema_version: payload.schema_version,
    generated_at: payload.generated_at,
    queue_date: payload.date,
    package_count: payload.platforms.length,
    json: repoRelative(path.join(packageDir, "daily-social-package.json")),
    markdown: repoRelative(path.join(packageDir, "daily-social-package.md")),
    status: payload.status,
  });
}

function rebuildCampaignIndex() {
  if (dryRun || Boolean(args.get("no-campaign-index"))) return;
  execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts", "build_campaign_index.mjs")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

async function main() {
  const packagePath = packagePathFromArgs();
  if (!fs.existsSync(packagePath)) throw new Error(`Daily package not found: ${repoRelative(packagePath)}`);
  const source = readJson(packagePath);
  const date = String(args.get("date") || source.date || source.queue_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Cannot determine YYYY-MM-DD date for ${repoRelative(packagePath)}`);

  const mediaConfig = loadMediaConfig();
  const catalog = loadCatalog();
  const rawPlatforms = deriveThreads(
    (Array.isArray(source.platforms) ? source.platforms : Array.isArray(source.packages) ? source.packages : [])
      .filter((row) => SOCIAL_PLATFORMS.has(platformKey(row))),
    date
  );
  if (!rawPlatforms.length) throw new Error(`No supported social platform rows found in ${repoRelative(packagePath)}`);

  const platforms = rawPlatforms.map((row) => normalizeRow(row, { date, mediaConfig, catalog }));
  const payload = {
    ...source,
    date,
    format: "photosbyelie-daily-social-package",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    visible_version: currentVersion(),
    status: statusFor(platforms),
    themes: Array.from(new Set(platforms.filter((row) => row.platform !== "Threads").map((row) => row.title))),
    platforms,
  };

  for (const row of campaignRows(platforms)) writeCampaign(row);
  for (const row of platforms) await writePlatform(row);
  writePackage(payload, path.join(PACKAGE_ROOT, date, "daily-social-package.json"));
  rebuildCampaignIndex();

  console.log(`${dryRun ? "Checked" : "Finalized"} ${platforms.length} social platform package(s) for ${date}.`);
  console.log(`Package: ${repoRelative(path.join(PACKAGE_ROOT, date, "daily-social-package.json"))}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
