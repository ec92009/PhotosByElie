#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadSeo, publicEntities } from "./build_public_seo.mjs";

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ORIGIN = "https://photos-by-elie.com";
const MEDIA_ORIGIN = "https://download.photos-by-elie.com";
const LIFECYCLE_VISIBLE_URL = "https://auth.photos-by-elie.com/lifecycle/visible";
const DRIP_START_DATE = "2026-11-23";
const MAX_FEED_ITEMS = 25;
const MEDIA_ID_PATTERN = /^[a-z0-9][a-z0-9-]{3,120}$/i;
const RAW_FILENAME_TITLE_PATTERN = /^(?:img|dsc|pxl|p\d|mvimg|dji|\d{8})[\s_-]/i;

export const BOARD_FEEDS = [
  {
    slug: "spain",
    file: "feeds/pinterest-spain.xml",
    title: "Photos By Elie — Spain Travel Photography",
    board: "Spain Travel Photography",
    description: "Curated fine-art travel and architectural photography from Spain by Elie Cohen — Seville, Córdoba, Valencia, Madrid, Bilbao, Cádiz, Ronda, and Andalusia.",
    collections: new Set(["spain"]),
    initialCount: 2,
    intervalDays: 2,
  },
  {
    slug: "france",
    file: "feeds/pinterest-france.xml",
    title: "Photos By Elie — Paris & France Photography",
    board: "Paris and France Photography",
    description: "Curated fine-art photography from Paris, Versailles, Giverny, Albi, and across France by Elie Cohen — architecture, gardens, bridges, and quiet light.",
    collections: new Set(["france"]),
    initialCount: 2,
    intervalDays: 2,
  },
  {
    slug: "usa",
    file: "feeds/pinterest-usa.xml",
    title: "Photos By Elie — California & USA Travel Photography",
    board: "California & USA Travel Photography",
    description: "Curated fine-art coastal and travel photography from San Diego, Del Mar, La Jolla, Solana Beach, and California by Elie Cohen.",
    collections: new Set(["usa"]),
    initialCount: 2,
    intervalDays: 2,
  },
  {
    slug: "portugal",
    file: "feeds/pinterest-portugal.xml",
    title: "Photos By Elie — Portugal Travel Photography",
    board: "Portugal Travel Photography",
    description: "Curated fine-art travel photography from Lisbon, Sintra, Cascais, Belém, and Northern Portugal by Elie Cohen.",
    collections: new Set(["portugal"]),
    initialCount: 2,
    intervalDays: 2,
  },
  {
    slug: "italy",
    file: "feeds/pinterest-italy.xml",
    title: "Photos By Elie — Italy Travel Photography",
    board: "Italy Travel Photography",
    description: "Curated fine-art photography from Florence, San Gimignano, Pisa, and Tuscany by Elie Cohen.",
    collections: new Set(["italy"]),
    initialCount: 2,
    intervalDays: 2,
  },
  {
    slug: "mexico",
    file: "feeds/pinterest-mexico.xml",
    title: "Photos By Elie — Mexico Travel Photography",
    board: "Mexico Travel Photography",
    description: "Curated fine-art coastal and travel photography from Mexico by Elie Cohen.",
    collections: new Set(["mexico"]),
    initialCount: 2,
    intervalDays: 3,
  },
];

export const ALL_FEED = {
  slug: "all",
  file: "feeds/pinterest-all.xml",
  title: "Photos By Elie — Travel & Fine Art Photography",
  board: "Travel Photography",
  description: "Fine-art travel, coastal, and architectural photography prints and editorial licensing from Spain, France, Italy, Portugal, California, and Mexico by Elie Cohen.",
  initialCount: 4,
  intervalDays: 1,
  perStep: 2,
};

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i += 1;
    }
  }
  return args;
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeCollection(collection, boardLabel, location = "") {
  const direct = String(collection || "").trim().toLowerCase();
  if (["spain", "france", "usa", "portugal", "italy", "mexico"].includes(direct)) return direct;
  const hay = `${boardLabel || ""} ${location || ""}`.toLowerCase();
  if (/\b(spain|españa|seville|sevilla|valencia|madrid|bilbao|cádiz|cadiz|córdoba|cordoba|ronda|nerja|gibraltar|andalusia|alhaurin|malaga)\b/.test(hay)) return "spain";
  if (/\b(france|paris|versailles|giverny|louvre|albi|boulogne|invalides|notre[- ]dame|orsay)\b/.test(hay)) return "france";
  if (/\b(usa|united states|california|san diego|del mar|la jolla|oceanside|solana beach|torrey|coronado|encinitas)\b/.test(hay)) return "usa";
  if (/\b(portugal|lisbon|lisboa|sintra|cascais|belem|belém|porto|carmo)\b/.test(hay)) return "portugal";
  if (/\b(italy|italia|florence|firenze|pisa|san gimignano|tuscany|toscana)\b/.test(hay)) return "italy";
  if (/\b(mexico|méxico|playa|tulum|cancun|cancún|oaxaca|baja|cabo)\b/.test(hay)) return "mexico";
  return "";
}

function isUsableTitle(text) {
  const cleaned = String(text || "").trim();
  if (cleaned.length < 4) return false;
  if (RAW_FILENAME_TITLE_PATTERN.test(cleaned)) return false;
  return true;
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function buildPinTitle(itemTitle, setTitle, location) {
  const cleanItem = isUsableTitle(itemTitle) ? cleanText(itemTitle) : "";
  const cleanSet = cleanText(setTitle);
  const cleanLoc = cleanText(location);
  let title = "";
  if (cleanItem && cleanSet && !cleanSet.toLowerCase().includes(cleanItem.toLowerCase()) && !cleanItem.toLowerCase().includes(cleanSet.toLowerCase())) {
    title = `${cleanItem} — ${cleanSet}`;
  } else {
    title = cleanItem || cleanSet || cleanLoc || "Fine Art Travel Photograph";
  }
  if (!/photos by elie|print|wall art|photography/i.test(title) && title.length <= 76) {
    title = `${title} | Photos By Elie`;
  }
  return title.slice(0, 100);
}

function buildPinDescription(itemTitle, setTitle, setDescription, location, collection) {
  const parts = [];
  const baseDesc = cleanText(setDescription)
    .replace(/\bA five-image Photos By Elie\b/gi, "A Photos By Elie")
    .replace(/\bFive Photos By Elie photographs\b/gi, "Fine-art Photos By Elie photography")
    .replace(/\bFive Photos By Elie\b/gi, "Fine-art Photos By Elie");
  if (baseDesc) {
    parts.push(baseDesc);
  } else {
    const subject = isUsableTitle(itemTitle) ? cleanText(itemTitle) : cleanText(setTitle);
    const place = cleanText(location) || collection.toUpperCase();
    parts.push(`${subject} photographed in ${place} by Elie Cohen.`);
  }
  if (!/fine[- ]art|wall art|print|licens/i.test(parts[0])) {
    parts.push("Available as high-resolution fine-art wall prints and digital editorial licensing on Photos By Elie.");
  }
  return parts.join(" ").slice(0, 500);
}

function listFilesRecursive(dir, filename) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, filename));
    else if (entry.isFile() && entry.name === filename) out.push(full);
  }
  return out.sort();
}

function loadSeoPhotoIds(repoRoot) {
  const catalogPath = path.join(repoRoot, "assets", "catalog", "photosbyelie.sqlite");
  const photosJsPath = path.join(repoRoot, "photos.js");
  const pricingPath = path.join(repoRoot, "assets", "catalog", "product-pricing.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(photosJsPath) || !fs.existsSync(pricingPath)) {
    return null;
  }
  const seo = loadSeo(repoRoot);
  const photos = publicEntities(repoRoot, catalogPath, seo, { visibleIdsFile: "" });
  return new Set(photos.map((photo) => photo.id));
}

export function collectCandidates(repoRoot, visibleSet, options = {}) {
  if (!(visibleSet instanceof Set) || visibleSet.size === 0) {
    throw new Error("visibleSet must be a non-empty Set of live visible media IDs.");
  }

  const seoPhotoIds = options.seoPhotoIds instanceof Set ? options.seoPhotoIds : loadSeoPhotoIds(repoRoot);
  const photoLinkFor = (mediaId) => (
    seoPhotoIds && seoPhotoIds.has(mediaId)
      ? `${SITE_ORIGIN}/photo--${encodeURIComponent(mediaId)}.html`
      : `${SITE_ORIGIN}/photo.html?id=${encodeURIComponent(mediaId)}`
  );

  const byId = new Map();

  // 1. Curated Pinterest manifests (rich titles, descriptions, board recommendations)
  const pinterestRoot = path.join(repoRoot, "socials", "Pinterest");
  const manifestFiles = listFilesRecursive(pinterestRoot, "manifest.json").reverse(); // newest first
  for (const manifestPath of manifestFiles) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    const setTitle = manifest.pin_title || manifest.title || "";
    const setDesc = manifest.description || "";
    const board = manifest.board_recommendation || manifest.board || "";
    const groupKey = manifest.campaign_id || path.basename(path.dirname(manifestPath));
    const sourceDate = manifest.date || path.basename(path.dirname(path.dirname(manifestPath))) || "2026-06-01";

    for (const item of items) {
      const mediaId = String(item.media_id || item.id || "").trim();
      if (!MEDIA_ID_PATTERN.test(mediaId)) continue;
      if (!visibleSet.has(mediaId)) continue;
      if (byId.has(mediaId)) continue;

      const collection = normalizeCollection(item.collection, board, item.location || setTitle);
      if (!collection) continue;

      const width = Number(item.width) || 1800;
      const height = Number(item.height) || 1200;
      byId.set(mediaId, {
        mediaId,
        collection,
        groupKey,
        sourceDate,
        portrait: height > width,
        width,
        height,
        title: buildPinTitle(item.title, setTitle, item.location),
        description: buildPinDescription(item.title, setTitle, setDesc, item.location, collection),
        link: photoLinkFor(mediaId),
        imageUrl: `${MEDIA_ORIGIN}/media/expo/${encodeURIComponent(mediaId)}_1800.jpg`,
      });
    }
  }

  // 2. Approved campaigns under assets/campaigns/*.json (captures Aug-Nov 2026 campaigns like Florence, Cordoba, Madrid, Cascais, Sintra)
  const campaignsDir = path.join(repoRoot, "assets", "campaigns");
  if (fs.existsSync(campaignsDir)) {
    const campaignFiles = fs.readdirSync(campaignsDir)
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .sort()
      .reverse();
    for (const file of campaignFiles) {
      const campaign = JSON.parse(fs.readFileSync(path.join(campaignsDir, file), "utf8"));
      const photos = Array.isArray(campaign.photos) ? campaign.photos : [];
      const setTitle = campaign.title || "";
      const setDesc = campaign.subtitle || campaign.description || "";
      const groupKey = campaign.id || file.replace(/\.json$/, "");
      const sourceDate = String(campaign.date || campaign.publishedAt || "2026-09-01").slice(0, 10);

      for (const item of photos) {
        const mediaId = String(item.id || item.media_id || "").trim();
        if (!MEDIA_ID_PATTERN.test(mediaId)) continue;
        if (!visibleSet.has(mediaId)) continue;
        if (byId.has(mediaId)) continue;

        const collection = normalizeCollection(item.collection || campaign.collection, setTitle, item.location || campaign.location);
        if (!collection) continue;

        const width = Number(item.width) || 1800;
        const height = Number(item.height) || 1200;
        byId.set(mediaId, {
          mediaId,
          collection,
          groupKey,
          sourceDate,
          portrait: height > width,
          width,
          height,
          title: buildPinTitle(item.title, setTitle, item.location || campaign.location),
          description: buildPinDescription(item.title, setTitle, setDesc, item.location || campaign.location, collection),
          link: photoLinkFor(mediaId),
          imageUrl: `${MEDIA_ORIGIN}/media/expo/${encodeURIComponent(mediaId)}_1800.jpg`,
        });
      }
    }
  }

  return [...byId.values()];
}

/**
 * Interleave candidates across theme/campaign groups, prioritizing vertical/portrait
 * images first so each board starts with high-performing Pinterest aspect ratios
 * and visually varied subjects rather than 5 consecutive shots from the same set.
 */
function interleaveByGroup(items) {
  const byGroup = new Map();
  const sorted = [...items].sort((a, b) => {
    if (a.sourceDate !== b.sourceDate) return b.sourceDate.localeCompare(a.sourceDate);
    return a.mediaId.localeCompare(b.mediaId);
  });
  for (const item of sorted) {
    if (!byGroup.has(item.groupKey)) byGroup.set(item.groupKey, []);
    byGroup.get(item.groupKey).push(item);
  }
  const groups = [...byGroup.values()].sort((a, b) => {
    if (a[0].sourceDate !== b[0].sourceDate) return b[0].sourceDate.localeCompare(a[0].sourceDate);
    return a[0].mediaId.localeCompare(b[0].mediaId);
  });

  const interleaved = [];
  let added = true;
  while (added) {
    added = false;
    for (const queue of groups) {
      if (queue.length) {
        interleaved.push(queue.shift());
        added = true;
      }
    }
  }
  return interleaved;
}

export function orderCandidatesForBoard(candidates) {
  const portraits = candidates.filter((item) => item.portrait);
  const others = candidates.filter((item) => !item.portrait);
  return [...interleaveByGroup(portraits), ...interleaveByGroup(others)];
}

function parseUtcDay(dayString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayString)) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${dayString}`);
  }
  return Date.parse(`${dayString}T09:00:00Z`);
}

function addDays(dayString, days) {
  const ms = parseUtcDay(dayString) + days * 86400000;
  return new Date(ms);
}

export function selectReleasedItems(orderedItems, { asOf, startDate = DRIP_START_DATE, initialCount = 2, intervalDays = 2, perStep = 1, maxItems = MAX_FEED_ITEMS }) {
  const elapsedDays = Math.max(0, Math.floor((parseUtcDay(asOf) - parseUtcDay(startDate)) / 86400000));
  const steps = Math.floor(elapsedDays / intervalDays);
  const totalReleased = Math.min(orderedItems.length, initialCount + steps * perStep);

  const released = [];
  for (let index = 0; index < totalReleased; index += 1) {
    const dayOffset = index < initialCount
      ? 0
      : (Math.floor((index - initialCount) / perStep) + 1) * intervalDays;
    const pubDate = addDays(startDate, dayOffset);
    // Offset minutes slightly so items released on the same day keep deterministic order
    const stamped = new Date(pubDate.getTime() + (index % 10) * 60000);
    released.push({
      ...orderedItems[index],
      pubDate: stamped.toUTCString(),
    });
  }
  return released.slice(-maxItems).reverse();
}

export function renderRssXml(feed, items, lastBuildDate) {
  const selfUrl = `${SITE_ORIGIN}/${feed.file}`;
  const itemXml = items.map((item) => `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.link)}</link>
      <guid isPermaLink="false">${xmlEscape(`pbe-pin-${item.mediaId}`)}</guid>
      <pubDate>${xmlEscape(item.pubDate)}</pubDate>
      <description>${xmlEscape(item.description)}</description>
      <enclosure url="${xmlEscape(item.imageUrl)}" type="image/jpeg" length="250000" />
      <media:content url="${xmlEscape(item.imageUrl)}" medium="image" type="image/jpeg" width="${item.width}" height="${item.height}" />
    </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(feed.title)}</title>
    <link>${SITE_ORIGIN}/</link>
    <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml" />
    <description>${xmlEscape(feed.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${xmlEscape(lastBuildDate)}</lastBuildDate>
${itemXml}
  </channel>
</rss>
`;
}

export function buildAllFeeds({ repoRoot = DEFAULT_REPO_ROOT, visibleSet, asOf, startDate = DRIP_START_DATE, seoPhotoIds }) {
  const candidates = collectCandidates(repoRoot, visibleSet, { seoPhotoIds });
  const lastBuildDate = new Date(parseUtcDay(asOf)).toUTCString();
  const outputs = [];
  const boardQueues = [];

  for (const feed of BOARD_FEEDS) {
    const boardItems = orderCandidatesForBoard(candidates.filter((item) => feed.collections.has(item.collection)));
    boardQueues.push([...boardItems]);
    const released = selectReleasedItems(boardItems, {
      asOf,
      startDate,
      initialCount: feed.initialCount,
      intervalDays: feed.intervalDays,
    });
    outputs.push({
      ...feed,
      totalQueued: boardItems.length,
      releasedCount: released.length,
      xml: renderRssXml(feed, released, lastBuildDate),
    });
  }

  // Round-robin interleave across all country boards for the combined all-countries feed
  const allOrdered = [];
  let added = true;
  while (added) {
    added = false;
    for (const queue of boardQueues) {
      if (queue.length) {
        allOrdered.push(queue.shift());
        added = true;
      }
    }
  }
  const allReleased = selectReleasedItems(allOrdered, {
    asOf,
    startDate,
    initialCount: ALL_FEED.initialCount,
    intervalDays: ALL_FEED.intervalDays,
    perStep: ALL_FEED.perStep,
  });
  outputs.push({
    ...ALL_FEED,
    totalQueued: allOrdered.length,
    releasedCount: allReleased.length,
    xml: renderRssXml(ALL_FEED, allReleased, lastBuildDate),
  });

  return outputs;
}

async function fetchLiveVisibleSet(url = LIFECYCLE_VISIBLE_URL) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "PhotosByElie-Pinterest-RSS-Builder/1.0" },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch live visible media IDs (${response.status}) from ${url}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.visibleMediaIds) || payload.visibleMediaIds.length === 0) {
    throw new Error("Live /lifecycle/visible response contained no visibleMediaIds.");
  }
  return new Set(payload.visibleMediaIds.map((id) => String(id).trim()).filter(Boolean));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.get("repo-root") ? path.resolve(String(args.get("repo-root"))) : DEFAULT_REPO_ROOT;
  const asOf = String(args.get("as-of") || new Date().toISOString().slice(0, 10));
  const checkOnly = Boolean(args.get("check"));

  let visibleSet;
  if (args.get("visible-file")) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(String(args.get("visible-file"))), "utf8"));
    const list = Array.isArray(raw) ? raw : raw?.visibleMediaIds;
    visibleSet = new Set((list || []).map((id) => String(id).trim()).filter(Boolean));
  } else {
    visibleSet = await fetchLiveVisibleSet(String(args.get("visible-url") || LIFECYCLE_VISIBLE_URL));
  }

  const feeds = buildAllFeeds({ repoRoot, visibleSet, asOf });
  const summary = [];
  for (const feed of feeds) {
    const targetPath = path.join(repoRoot, feed.file);
    if (checkOnly) {
      const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
      if (current !== feed.xml) {
        throw new Error(`Out-of-date Pinterest RSS feed: ${feed.file}`);
      }
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, feed.xml, "utf8");
    }
    summary.push({
      file: feed.file,
      board: feed.board,
      released: feed.releasedCount,
      queued: feed.totalQueued,
      url: `${SITE_ORIGIN}/${feed.file}`,
    });
  }
  console.log(JSON.stringify({ asOf, visibleCount: visibleSet.size, feeds: summary }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
