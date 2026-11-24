#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadSeo, publicEntities } from "./build_public_seo.mjs";
import { collectCandidates, xmlEscape } from "./build_pinterest_rss.mjs";

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ORIGIN = "https://photos-by-elie.com";
const MEDIA_ORIGIN = "https://download.photos-by-elie.com";
const LIFECYCLE_VISIBLE_URL = "https://auth.photos-by-elie.com/lifecycle/visible";
const DEFAULT_OUTPUT_FILE = "feeds/google-merchant.xml";
const DEFAULT_OPTION_ID = "jpg-6mp";
const DEFAULT_MAX_ITEMS = 250;
const RAW_FILENAME_TITLE_PATTERN = /^(?:img|dsc|pxl|p\d|mvimg|dji|\d{8})[\s_-]/i;
const DIGITAL_SHIPPING_COUNTRIES = ["US", "CA", "GB", "ES", "FR", "DE", "IT", "PT"];

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

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isUsableTitle(value) {
  const cleaned = cleanText(value);
  if (cleaned.length < 4) return false;
  if (RAW_FILENAME_TITLE_PATTERN.test(cleaned)) return false;
  return true;
}

function orientationLabel(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return "Landscape";
  const ratio = w / h;
  if (ratio > 1.08) return "Landscape";
  if (ratio < 0.92) return "Portrait";
  return "Square";
}

function resolveDigitalProduct(pricing, optionId = DEFAULT_OPTION_ID) {
  const products = Array.isArray(pricing?.products) ? pricing.products : [];
  const product = products.find((item) => item?.id === optionId && item?.type === "digital");
  if (!product) {
    throw new Error(`Digital product option "${optionId}" not found in product-pricing.json`);
  }
  const price = Number(product.prices?.original ?? product.price ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid price for product option "${optionId}"`);
  }
  const currency = String(pricing?.currency || "usd").trim().toUpperCase();
  return {
    id: product.id,
    label: cleanText(product.label || product.id),
    detail: cleanText(product.detail || ""),
    minMegapixels: Number(product.minMegapixels || 0),
    price,
    currency,
  };
}

function buildProductTitle(photo, curated, product) {
  const baseTitle = isUsableTitle(photo.title)
    ? cleanText(photo.title)
    : cleanText(curated?.title || "").replace(/\s*\|\s*Photos By Elie\s*$/i, "");
  const location = cleanText(photo.location);
  const collection = cleanText(photo.collectionTitle);
  let title = baseTitle || location || `${collection} Travel Photograph`;
  if (location && !title.toLowerCase().includes(location.split(",")[0].trim().toLowerCase()) && title.length <= 78) {
    title = `${title}, ${location}`;
  }
  const suffix = product.id === "full"
    ? " — Fine Art Photography Full-Resolution Download"
    : " — Fine Art Travel Photography Printable Download";
  if (title.length + suffix.length <= 150) {
    title += suffix;
  } else if (title.length + " — Fine Art Wall Art Download".length <= 150) {
    title += " — Fine Art Wall Art Download";
  }
  return title.slice(0, 150);
}

function buildProductDescription(photo, curated, product) {
  const parts = [];
  if (cleanText(photo.description)) {
    parts.push(cleanText(photo.description));
  } else if (cleanText(curated?.description)) {
    const cleanedCurated = cleanText(curated.description)
      .replace(/Available as high-resolution fine-art wall prints and digital editorial licensing on Photos By Elie\.?/gi, "")
      .trim();
    if (cleanedCurated) parts.push(cleanedCurated);
  } else {
    const subject = isUsableTitle(photo.title) ? cleanText(photo.title) : `${cleanText(photo.collectionTitle)} Fine Art Photograph`;
    const place = cleanText(photo.location) || cleanText(photo.collectionTitle);
    parts.push(`${subject} photographed in ${place} by Elie Cohen.`);
  }
  const keywords = Array.isArray(photo.keywords)
    ? photo.keywords.map((term) => cleanText(term)).filter(Boolean).slice(0, 8)
    : [];
  if (keywords.length) {
    parts.push(`Subjects & details: ${keywords.join(", ")}.`);
  }
  parts.push(
    `Instant high-resolution digital download (${product.label}${product.detail ? ` — ${product.detail}` : ""}) suitable for fine-art home decor, framing, and personal or editorial display. No physical shipping fee; secure download link delivered immediately after checkout on Photos By Elie.`,
  );
  return parts.join(" ").slice(0, 4900);
}

export function selectMerchantProducts({
  repoRoot = DEFAULT_REPO_ROOT,
  visibleSet,
  optionId = DEFAULT_OPTION_ID,
  maxItems = DEFAULT_MAX_ITEMS,
}) {
  if (!(visibleSet instanceof Set) || visibleSet.size === 0) {
    throw new Error("visibleSet must be a non-empty Set of live visible media IDs.");
  }
  const catalogPath = path.join(repoRoot, "assets", "catalog", "photosbyelie.sqlite");
  const pricingPath = path.join(repoRoot, "assets", "catalog", "product-pricing.json");
  const pricing = JSON.parse(fs.readFileSync(pricingPath, "utf8"));
  const product = resolveDigitalProduct(pricing, optionId);
  const seo = loadSeo(repoRoot);
  const catalogPhotos = publicEntities(repoRoot, catalogPath, seo, { visibleIdsFile: "" })
    .filter((photo) => visibleSet.has(photo.id))
    .filter((photo) => !product.minMegapixels || Number(photo.megapixels || 0) >= product.minMegapixels);

  const curatedById = new Map();
  for (const item of collectCandidates(repoRoot, visibleSet, { seoPhotoIds: new Set(catalogPhotos.map((p) => p.id)) })) {
    curatedById.set(item.mediaId, item);
  }

  // Group curated first, then high-resolution catalog items with clean titles & metadata
  const curatedItems = [];
  const catalogByCollection = new Map();
  for (const photo of catalogPhotos) {
    const curated = curatedById.get(photo.id) || null;
    if (curated) {
      curatedItems.push({ photo, curated, tier: "Curated" });
      continue;
    }
    if (!isUsableTitle(photo.title)) continue;
    const mp = Number(photo.megapixels || 0);
    if (mp > 0 && mp < Math.max(12, product.minMegapixels)) continue;
    const key = photo.collectionKey;
    if (!catalogByCollection.has(key)) catalogByCollection.set(key, []);
    catalogByCollection.get(key).push({
      photo,
      curated: null,
      tier: "Catalog",
      score: (photo.location ? 2 : 0) + Math.min(5, (photo.keywords || []).length) + (mp >= 20 ? 1 : 0),
    });
  }

  // Sort each collection bucket by metadata richness, then stable ID
  const collectionQueues = [...catalogByCollection.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, list]) => list.sort((a, b) => (b.score - a.score) || a.photo.id.localeCompare(b.photo.id)));

  // Deterministic order for curated items (newest sourceDate first, then ID)
  curatedItems.sort((a, b) => {
    const dateCmp = String(b.curated.sourceDate || "").localeCompare(String(a.curated.sourceDate || ""));
    return dateCmp || a.photo.id.localeCompare(b.photo.id);
  });

  const selected = [];
  const seen = new Set();
  for (const entry of curatedItems) {
    if (selected.length >= maxItems) break;
    seen.add(entry.photo.id);
    selected.push(entry);
  }

  let progressed = true;
  while (selected.length < maxItems && progressed) {
    progressed = false;
    for (const queue of collectionQueues) {
      while (queue.length && seen.has(queue[0].photo.id)) queue.shift();
      if (!queue.length) continue;
      const next = queue.shift();
      seen.add(next.photo.id);
      selected.push(next);
      progressed = true;
      if (selected.length >= maxItems) break;
    }
  }

  return selected.map(({ photo, curated, tier }) => {
    const canonicalPath = seo.entityPath("photo", photo.id);
    const link = `${SITE_ORIGIN}${canonicalPath}?option=${encodeURIComponent(product.id)}`;
    const imageLink = `${MEDIA_ORIGIN}/media/expo/${encodeURIComponent(photo.id)}_1800.jpg`;
    return {
      id: `pbe-${photo.id}-${product.id}`,
      itemGroupId: `pbe-${photo.id}`,
      mediaId: photo.id,
      collectionKey: photo.collectionKey,
      collectionTitle: cleanText(photo.collectionTitle),
      title: buildProductTitle(photo, curated, product),
      description: buildProductDescription(photo, curated, product),
      link,
      imageLink,
      availability: "in_stock",
      condition: "new",
      price: `${product.price.toFixed(2)} ${product.currency}`,
      currency: product.currency,
      brand: "Photos By Elie",
      googleProductCategory: "500044",
      productType: `Fine Art Photography > Travel Wall Art > ${cleanText(photo.collectionTitle)}`,
      orientation: orientationLabel(photo.fullWidth || curated?.width, photo.fullHeight || curated?.height),
      tier,
    };
  });
}

export function renderMerchantXml(items, { feedFile = DEFAULT_OUTPUT_FILE, asOf } = {}) {
  const selfUrl = `${SITE_ORIGIN}/${feedFile}`;
  const lastBuildDate = asOf
    ? new Date(Date.parse(`${asOf}T09:00:00Z`)).toUTCString()
    : new Date().toUTCString();
  const shippingXml = DIGITAL_SHIPPING_COUNTRIES.map((country) => (
    `      <g:shipping><g:country>${country}</g:country><g:service>Instant Digital Download</g:service><g:price>0.00 USD</g:price></g:shipping>`
  )).join("\n");

  const itemXml = items.map((item) => `    <item>
      <g:id>${xmlEscape(item.id)}</g:id>
      <g:item_group_id>${xmlEscape(item.itemGroupId)}</g:item_group_id>
      <g:title>${xmlEscape(item.title)}</g:title>
      <g:description>${xmlEscape(item.description)}</g:description>
      <g:link>${xmlEscape(item.link)}</g:link>
      <g:image_link>${xmlEscape(item.imageLink)}</g:image_link>
      <g:availability>${item.availability}</g:availability>
      <g:condition>${item.condition}</g:condition>
      <g:price>${xmlEscape(item.price)}</g:price>
      <g:brand>${xmlEscape(item.brand)}</g:brand>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${item.googleProductCategory}</g:google_product_category>
      <g:product_type>${xmlEscape(item.productType)}</g:product_type>
${shippingXml}
      <g:custom_label_0>${xmlEscape(item.collectionTitle)}</g:custom_label_0>
      <g:custom_label_1>${xmlEscape(item.orientation)}</g:custom_label_1>
      <g:custom_label_2>${xmlEscape(item.tier)}</g:custom_label_2>
    </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Photos By Elie — Fine Art Travel Photography Downloads</title>
    <link>${SITE_ORIGIN}/</link>
    <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml" />
    <description>Curated fine-art travel, coastal, and architectural photography printable digital downloads by Elie Cohen.</description>
    <language>en-us</language>
    <lastBuildDate>${xmlEscape(lastBuildDate)}</lastBuildDate>
${itemXml}
  </channel>
</rss>
`;
}

async function fetchLiveVisibleSet(url = LIFECYCLE_VISIBLE_URL) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "PhotosByElie-Merchant-Feed-Builder/1.0" },
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
  const outputRel = String(args.get("output") || DEFAULT_OUTPUT_FILE);
  const optionId = String(args.get("option-id") || DEFAULT_OPTION_ID);
  const maxItems = Math.max(1, Number(args.get("max-items") || DEFAULT_MAX_ITEMS));
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

  const items = selectMerchantProducts({ repoRoot, visibleSet, optionId, maxItems });
  if (!items.length) {
    throw new Error("Refusing to write an empty Google Merchant Center feed.");
  }
  const xml = renderMerchantXml(items, { feedFile: outputRel, asOf });
  const targetPath = path.join(repoRoot, outputRel);
  if (checkOnly) {
    const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "";
    if (current !== xml) {
      throw new Error(`Out-of-date Google Merchant Center feed: ${outputRel}`);
    }
  } else {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, xml, "utf8");
  }

  const byCollection = {};
  const byTier = {};
  for (const item of items) {
    byCollection[item.collectionKey] = (byCollection[item.collectionKey] || 0) + 1;
    byTier[item.tier] = (byTier[item.tier] || 0) + 1;
  }
  console.log(JSON.stringify({
    asOf,
    file: outputRel,
    url: `${SITE_ORIGIN}/${outputRel}`,
    optionId,
    count: items.length,
    byTier,
    byCollection,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
