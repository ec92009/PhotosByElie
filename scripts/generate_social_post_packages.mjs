#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import catalogTsv from "./catalog_tsv.cjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_HANDOFF = path.join(REPO_ROOT, "DAVID2MAX.md");
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, "assets", "owner-actions", "social-post-packages");
const SITE_BASE_URL = "https://ec92009.github.io/PhotosByElie/";
const { loadCatalogWindow } = catalogTsv;

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

const handoffPath = path.resolve(String(args.get("handoff") || DEFAULT_HANDOFF));
const outputRoot = path.resolve(String(args.get("output-root") || DEFAULT_OUTPUT_ROOT));
const requestedDate = args.get("date") ? String(args.get("date")) : "";
const limit = Number.parseInt(String(args.get("limit") || "10"), 10);
const dryRun = Boolean(args.get("dry-run"));

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function loadCatalog() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readText(path.join(REPO_ROOT, "media-config.js")), context, { filename: "media-config.js" });
  const collections = loadCatalogWindow(REPO_ROOT).photosByElieData || {};
  const mediaConfig = context.window.photosByElieMediaConfig || {};
  const byId = new Map();
  for (const [collectionKey, collection] of Object.entries(collections)) {
    for (const photo of collection.photos || []) {
      byId.set(photo.id, { collectionKey, collection, photo });
    }
  }
  return { byId, mediaConfig };
}

function parseSocialAssetQueues(markdown) {
  const headingPattern = /^##\s+(\d{4}-\d{2}-\d{2})\s+(?:PBE Weekly\s+)?Social Asset Queue\b.*$/gim;
  const sections = [];
  let match;
  while ((match = headingPattern.exec(markdown)) !== null) {
    const start = match.index;
    const nextHeading = markdown.slice(start + 1).search(/^##\s+/m);
    const end = nextHeading === -1 ? markdown.length : start + 1 + nextHeading;
    sections.push({
      date: match[1],
      start,
      body: markdown.slice(start, end),
    });
  }
  return sections;
}

function parseQueueItems(sectionBody) {
  const items = [];
  const linePattern = /^\s*-\s+Photo id:\s+`([^`]+)`\s+\|\s+Collection:\s+`([^`]+)`\s+\|\s+Title:\s+`([^`]+)`\s+\|\s+Suggested format:\s+`([^`]+)`\s+\|\s+Why:\s+(.+)$/gim;
  let match;
  while ((match = linePattern.exec(sectionBody)) !== null) {
    items.push({
      photoId: match[1].trim(),
      collection: match[2].trim(),
      title: match[3].trim(),
      suggestedFormat: match[4].trim(),
      why: match[5].trim(),
    });
  }
  return items;
}

function latestQueue(markdown) {
  const sections = parseSocialAssetQueues(markdown)
    .filter((section) => !requestedDate || section.date === requestedDate)
    .sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      return dateCompare || a.start - b.start;
    });
  if (!sections.length) {
    const detail = requestedDate ? ` for ${requestedDate}` : "";
    throw new Error(`No Social Asset Queue section found${detail} in ${handoffPath}`);
  }
  const section = sections[0];
  const items = parseQueueItems(section.body);
  if (!items.length) {
    throw new Error(`Social Asset Queue ${section.date} has no parseable photo rows`);
  }
  return { ...section, items: items.slice(0, Number.isFinite(limit) && limit > 0 ? limit : items.length) };
}

function metadataValue(photo, label) {
  return (photo.metadata || []).find((item) => item.label === label)?.value || "";
}

function splitKeywords(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashtagFromKeyword(keyword) {
  const cleaned = keyword
    .normalize("NFKD")
    .replace(/-/g, " ")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
  return cleaned ? `#${cleaned}` : "";
}

function hashtagsFor(photo, collectionKey) {
  const keywords = splitKeywords(metadataValue(photo, "Keywords"));
  const chosen = [
    collectionKey,
    ...keywords.filter((keyword) => !/^(photograph|photo|travel photography|architecture)$/i.test(keyword)),
  ].slice(0, 8);
  const tags = Array.from(new Set([
    "#PhotosByElie",
    "#TravelPhotography",
    ...chosen.map(hashtagFromKeyword),
  ].filter(Boolean)));
  return tags.slice(0, 10);
}

function publicMediaUrl(photo, mediaConfig, keyName = "detailKey") {
  const preview = photo.media?.publicPreview || {};
  let key = preview[keyName] || preview.detailKey || preview.galleryKey || "";
  if (keyName === "galleryKey" && key && !key.endsWith("_900.jpg") && preview.detailKey?.endsWith("_1800.jpg")) {
    key = preview.detailKey.replace(/_1800\.jpg$/, "_900.jpg");
  }
  if (!key || !mediaConfig.publicBaseUrl) return "";
  return `${String(mediaConfig.publicBaseUrl).replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

function photoUrl(photoId) {
  return `${SITE_BASE_URL}photo.html?id=${encodeURIComponent(photoId)}`;
}

function cleanTitle(title) {
  return String(title || "Untitled photo").replace(/\s+/g, " ").trim();
}

function captionStem(photo, item, collectionTitle) {
  const title = cleanTitle(photo.title || item.title);
  const captured = metadataValue(photo, "Captured").slice(0, 4);
  const place = collectionTitle || item.collection;
  const dateText = captured ? `, ${captured}` : "";
  return `${title} - ${place}${dateText}.`;
}

function instagramCaption(stem, tags) {
  return `${stem}\n\nBrowse the edit from the profile link.\n\n${tags.join(" ")}`;
}

function platformPackages(photo, item, collectionKey, collectionTitle, mediaConfig) {
  const title = cleanTitle(photo.title || item.title);
  const url = photoUrl(photo.id);
  const previewUrl = publicMediaUrl(photo, mediaConfig);
  const tags = hashtagsFor(photo, collectionKey);
  const stem = captionStem(photo, item, collectionTitle);
  const isCarousel = /carousel|panorama/i.test(item.suggestedFormat);
  const isStory = /story|reel|9:16/i.test(item.suggestedFormat);
  const cropNote = `${item.suggestedFormat}: ${item.why}`;
  return {
    instagram: {
      asset_format: item.suggestedFormat,
      post_type: isCarousel ? "carousel" : isStory ? "story_or_reel" : "feed",
      caption: instagramCaption(stem, tags),
      link_note: "Instagram feed captions do not support clickable links; put the campaign URL in the profile website link before posting, or use a Story link sticker.",
      media_url: previewUrl,
      photo_url: url,
      crop_note: cropNote,
      automation: "Potentially automatable through Instagram Graph API content publishing after Meta app, Instagram professional account, permissions, and token setup.",
    },
    facebook: {
      asset_format: item.suggestedFormat,
      post_type: isCarousel ? "multi_photo_or_album" : "photo_post",
      caption: `${stem}\n\nView/download: ${url}`,
      media_url: previewUrl,
      photo_url: url,
      crop_note: cropNote,
      automation: "Potentially automatable for a Facebook Page after Meta app, Page access token, and publish permissions are configured.",
    },
    pinterest: {
      asset_format: item.suggestedFormat,
      post_type: isCarousel ? "standard_pin_or_multi_pin_sequence" : "standard_pin",
      title: title.length > 280 ? `${title.slice(0, 277)}...` : title,
      description: `${stem} ${item.why}`,
      media_url: previewUrl,
      photo_url: url,
      board_suggestion: boardSuggestion(collectionKey, title),
      alt_text: `${title}, ${collectionTitle || item.collection}.`,
      crop_note: cropNote,
      automation: "Potentially automatable through the Pinterest API after a Pinterest Business account, approved app, board mapping, and token storage are configured.",
    },
  };
}

function boardSuggestion(collectionKey, title) {
  const lowerTitle = String(title || "").toLowerCase();
  if (collectionKey === "france" || lowerTitle.includes("paris") || lowerTitle.includes("versailles")) {
    return "Paris and France photography";
  }
  if (collectionKey === "spain" || lowerTitle.includes("dali")) return "Spain travel photography";
  if (collectionKey === "portugal") return "Portugal travel photography";
  if (collectionKey === "italy") return "Italy travel photography";
  if (collectionKey === "usa" || lowerTitle.includes("california")) return "California and USA photography";
  if (collectionKey === "ai") return "AI archive studies";
  return "Travel photography";
}

function packageForItem(item, catalog, mediaConfig) {
  const record = catalog.byId.get(item.photoId);
  if (!record) {
    return {
      photo_id: item.photoId,
      status: "missing_from_public_catalog",
      source_queue_item: item,
    };
  }
  const { collectionKey, collection, photo } = record;
  return {
    photo_id: photo.id,
    status: "ready_for_review",
    collection: collectionKey,
    collection_title: collection.title || item.collection,
    title: cleanTitle(photo.title || item.title),
    public_photo_url: photoUrl(photo.id),
    public_preview_url: publicMediaUrl(photo, mediaConfig),
    gallery_preview_url: publicMediaUrl(photo, mediaConfig, "galleryKey"),
    suggested_format: item.suggestedFormat,
    source_queue_reason: item.why,
    metadata: {
      captured: metadataValue(photo, "Captured"),
      camera: metadataValue(photo, "Camera"),
      keywords: splitKeywords(metadataValue(photo, "Keywords")),
      original_size: metadataValue(photo, "Original size"),
    },
    platforms: platformPackages(photo, item, collectionKey, collection.title || item.collection, mediaConfig),
  };
}

function renderMarkdown(payload) {
  const lines = [
    `# Social Post Packages - ${payload.queue_date}`,
    "",
    `Generated from the ${payload.queue_date} Social Asset Queue in ${path.basename(handoffPath)}.`,
    "",
    "These are ready-to-review packages, not proof that posting credentials are configured. The active targets are Instagram, Facebook, and Pinterest.",
    "",
  ];
  for (const item of payload.packages) {
    lines.push(`## ${item.title || item.photo_id}`);
    lines.push("");
    lines.push(`- Photo id: \`${item.photo_id}\``);
    lines.push(`- Status: \`${item.status}\``);
    if (item.public_photo_url) lines.push(`- Site URL: ${item.public_photo_url}`);
    if (item.public_preview_url) lines.push(`- Preview URL: ${item.public_preview_url}`);
    if (item.suggested_format) lines.push(`- Format: ${item.suggested_format}`);
    if (item.source_queue_reason) lines.push(`- Why: ${item.source_queue_reason}`);
    if (item.platforms) {
      lines.push("");
      lines.push("### Instagram");
      lines.push("");
      lines.push(item.platforms.instagram.caption);
      lines.push("");
      lines.push(`Crop note: ${item.platforms.instagram.crop_note}`);
      lines.push("");
      lines.push("### Facebook");
      lines.push("");
      lines.push(item.platforms.facebook.caption);
      lines.push("");
      lines.push(`Crop note: ${item.platforms.facebook.crop_note}`);
      lines.push("");
      lines.push("### Pinterest");
      lines.push("");
      lines.push(`Title: ${item.platforms.pinterest.title}`);
      lines.push("");
      lines.push(item.platforms.pinterest.description);
      lines.push("");
      lines.push(`Board: ${item.platforms.pinterest.board_suggestion}`);
      lines.push("");
      lines.push(`Alt text: ${item.platforms.pinterest.alt_text}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const handoff = readText(handoffPath);
const queue = latestQueue(handoff);
const catalog = loadCatalog();
const payload = {
  format: "photosbyelie-social-post-packages",
  schema_version: 1,
  generated_at: new Date().toISOString(),
  queue_date: queue.date,
  source_handoff: path.relative(REPO_ROOT, handoffPath),
  site_base_url: SITE_BASE_URL,
  mode: "draft_packages_only",
  automation_readiness: {
    instagram: "requires Meta app, professional Instagram account, content publishing permission, and token storage",
    facebook: "requires Meta app, Facebook Page access token, publish permissions, and token storage",
    pinterest: "requires Pinterest Business account, approved app, board mapping, and token storage",
  },
  packages: queue.items.map((item) => packageForItem(item, catalog, catalog.mediaConfig)),
};

const outputDir = path.join(outputRoot, payload.queue_date);
const jsonPath = path.join(outputDir, "post-packages.json");
const mdPath = path.join(outputDir, "post-packages.md");
const latestPath = path.join(outputRoot, "latest.json");

if (!dryRun) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderMarkdown(payload));
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(latestPath, `${JSON.stringify({
    format: payload.format,
    schema_version: payload.schema_version,
    generated_at: payload.generated_at,
    queue_date: payload.queue_date,
    package_count: payload.packages.length,
    json: path.relative(REPO_ROOT, jsonPath),
    markdown: path.relative(REPO_ROOT, mdPath),
  }, null, 2)}\n`);
}

const ready = payload.packages.filter((item) => item.status === "ready_for_review").length;
const missing = payload.packages.length - ready;
console.log(`Generated ${payload.packages.length} social post packages from ${payload.queue_date}`);
console.log(`Ready: ${ready}; missing from catalog: ${missing}`);
console.log(dryRun ? `Dry run only; would write ${path.relative(REPO_ROOT, outputDir)}` : `Wrote ${path.relative(REPO_ROOT, outputDir)}`);
