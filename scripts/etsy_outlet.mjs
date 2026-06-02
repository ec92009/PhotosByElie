#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import catalogTsv from "./catalog_tsv.cjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CAMPAIGN_DIR = path.join(REPO_ROOT, "assets", "campaigns");
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, "assets", "owner-actions", "etsy-listing-packages");
const DEFAULT_CAMPAIGN_ID = "facebook-evening-in-sevilla-street-light-2026-06-02";
const SITE_BASE_URL = "https://photos-by-elie.com/";
const API_BASE = process.env.ETSY_API_BASE || "https://api.etsy.com/v3";
const CONFIG_DIR = path.join(os.homedir(), ".config", "photosbyelie");
const DEFAULT_TOKEN_FILE = path.join(CONFIG_DIR, "etsy-token.json");
const DEFAULT_SHOP_ID = "42422777";

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

function usage() {
  return `Usage:
  node scripts/etsy_outlet.mjs --campaign <campaign-id>
  node scripts/etsy_outlet.mjs --campaign <campaign-id> --limit 8 --price 65.00
  node scripts/etsy_outlet.mjs --list-campaigns

Draft creation is opt-in and requires complete Etsy shop setup ids:
  node scripts/etsy_outlet.mjs --campaign <campaign-id> \\
    --taxonomy-id <id> --shipping-profile-id <id> --readiness-state-id <id> \\
    --create-drafts --confirm-create-drafts

Defaults:
  campaign: ${DEFAULT_CAMPAIGN_ID}
  output:   ${path.relative(REPO_ROOT, DEFAULT_OUTPUT_ROOT)}

Guardrails:
  Uses public catalog rows, public R2 watermarked previews, and first-party URLs only.
  Does not read private masters, buyer downloads, Owner-only review JSON, or secrets.
  Does not publish active Etsy listings.
`;
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error("");
  console.error(usage());
  process.exit(1);
}

function env(name) {
  return String(process.env[name] || "").trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s]+/g, "-")
    .toLowerCase();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, limit) {
  const text = cleanText(value);
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 1)).replace(/\s+\S*$/, "");
}

function campaignDate(campaignId) {
  return String(campaignId || "").match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
    || new Date().toISOString().slice(0, 10);
}

function loadMediaConfig() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, "media-config.js"), "utf8"), context, {
    filename: "media-config.js",
  });
  return context.window.photosByElieMediaConfig || {};
}

function loadCatalog() {
  const collections = loadCatalogWindow(REPO_ROOT).photosByElieData || {};
  const byId = new Map();
  for (const [collectionKey, collection] of Object.entries(collections)) {
    for (const photo of collection.photos || []) {
      byId.set(photo.id, { collectionKey, collection, photo });
    }
  }
  return { byId, mediaConfig: loadMediaConfig() };
}

function publicMediaUrl(photo, mediaConfig, keyName = "detailKey") {
  const preview = photo?.media?.publicPreview || {};
  const key = preview[keyName] || preview.detailKey || preview.galleryKey || "";
  if (!key || !mediaConfig.publicBaseUrl) return "";
  return `${String(mediaConfig.publicBaseUrl).replace(/\/$/, "")}/${String(key).replace(/^\//, "")}`;
}

function metadataValue(photo, label) {
  return (photo?.metadata || []).find((item) => item.label === label)?.value || "";
}

function splitKeywords(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function normalizeKeywords(photo) {
  return Array.from(new Set([
    ...(Array.isArray(photo?.keywords) ? photo.keywords : []),
    ...splitKeywords(metadataValue(photo, "Keywords")),
  ].map((item) => cleanText(item)).filter(Boolean)));
}

function genericPhotoTitle(title) {
  return /^(img|dsc|d5h|photo|image)?[\s_-]*\d{3,}|^\d{8}[\s_-]/i.test(cleanText(title));
}

function sellerTitle(campaign, photo, index) {
  const base = cleanText(campaign.title || "Photos By Elie Wall Art");
  const existing = cleanText(photo.title || metadataValue(photo, "Metadata title"));
  const stem = existing && !genericPhotoTitle(existing) ? existing : base.replace(/^Evening in Sevilla/i, "Sevilla After Dusk");
  return truncate(`${stem} Fine Art Photo Print - Spain Travel Photography Wall Art No. ${index + 1}`, 140);
}

function etsyTag(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addTag(target, value) {
  const tag = etsyTag(value);
  if (!tag || tag.length > 20) return;
  if (!target.includes(tag)) target.push(tag);
}

function listingTags(campaign, photo, collectionTitle) {
  const keywords = normalizeKeywords(photo)
    .filter((keyword) => !/^(published adobe|photo|photograph|travel photography)$/i.test(keyword));
  const tags = [];
  addTag(tags, "Photos By Elie");
  addTag(tags, "fine art photo");
  addTag(tags, "photo print");
  addTag(tags, "wall decor");
  addTag(tags, "travel print");
  addTag(tags, `${collectionTitle} wall art`);
  addTag(tags, `${collectionTitle} print`);

  const combined = `${campaign.title || ""} ${campaign.eyebrow || ""} ${campaign.description || ""}`.toLowerCase();
  if (combined.includes("sevilla") || combined.includes("seville")) {
    addTag(tags, "Sevilla print");
    addTag(tags, "Sevilla wall art");
    addTag(tags, "Andalusia decor");
    addTag(tags, "evening street");
  }
  if (combined.includes("architecture") || combined.includes("facade") || combined.includes("street")) {
    addTag(tags, "architecture art");
  }
  if (combined.includes("evening") || combined.includes("dusk") || combined.includes("sunset")) {
    addTag(tags, "warm wall art");
  }
  for (const keyword of keywords) addTag(tags, keyword);
  return tags.slice(0, 13);
}

function destinationUrl(campaign) {
  return `${SITE_BASE_URL}campaign.html?c=${encodeURIComponent(campaign.id)}`;
}

function photoUrl(photoId) {
  return `${SITE_BASE_URL}photo.html?id=${encodeURIComponent(photoId)}`;
}

function listingDescription({ campaign, photo, collectionTitle, previewUrl, photoDestination }) {
  const captured = metadataValue(photo, "Captured").slice(0, 4);
  const capturedText = captured ? ` Captured ${captured}.` : "";
  return [
    `${campaign.description || `${campaign.title} by Photos By Elie.`}${capturedText}`,
    "",
    "This draft listing is shaped for a made-to-order fine art photographic print by Elie Cohen, selected for wall-art use rather than casual browsing.",
    "",
    "Browse the complete first-party edit:",
    destinationUrl(campaign),
    "",
    "Photo detail page:",
    photoDestination,
    "",
    `Collection: ${collectionTitle}`,
  ].join("\n");
}

function createRequestBody({ args, title, description, tags }) {
  const body = {
    quantity: Number(args.get("quantity") || 10),
    title,
    description,
    price: String(args.get("price") || "65.00"),
    who_made: String(args.get("who-made") || "i_did"),
    when_made: String(args.get("when-made") || "made_to_order"),
    is_supply: "false",
    taxonomy_id: args.get("taxonomy-id") ? Number(args.get("taxonomy-id")) : null,
    tags,
    materials: ["photographic print", "wall art"],
    should_auto_renew: true,
  };
  if (args.get("shipping-profile-id")) body.shipping_profile_id = Number(args.get("shipping-profile-id"));
  if (args.get("readiness-state-id")) body.readiness_state_id = Number(args.get("readiness-state-id"));
  if (args.get("return-policy-id")) body.return_policy_id = Number(args.get("return-policy-id"));
  return body;
}

function loadCampaigns() {
  return fs.readdirSync(CAMPAIGN_DIR)
    .filter((fileName) => fileName.endsWith(".json") && fileName !== "index.json")
    .map((fileName) => readJson(path.join(CAMPAIGN_DIR, fileName)))
    .sort((a, b) => String(b.id || "").localeCompare(String(a.id || "")));
}

function loadCampaign(campaignId) {
  const filePath = path.join(CAMPAIGN_DIR, `${campaignId}.json`);
  if (!fs.existsSync(filePath)) fail(`Campaign not found: ${campaignId}`);
  return readJson(filePath);
}

function listCampaigns() {
  for (const campaign of loadCampaigns()) {
    console.log(`${campaign.id}\t${campaign.title || ""}`);
  }
}

function buildListings(campaign, catalog) {
  const requestedIds = String(args.get("photo-ids") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const photoIds = requestedIds.length ? requestedIds : campaign.primaryPhotoIds || [];
  const limit = Number.parseInt(String(args.get("limit") || photoIds.length || 8), 10);
  return photoIds.slice(0, Number.isFinite(limit) && limit > 0 ? limit : photoIds.length)
    .map((photoId, index) => {
      const record = catalog.byId.get(photoId);
      if (!record) {
        return { media_id: photoId, status: "missing_from_public_catalog" };
      }
      const { collection, photo } = record;
      const preview = photo.media?.publicPreview || {};
      if (photo.media?.type !== "photo" || preview.allowed === false || !preview.detailKey) {
        return { media_id: photoId, status: "not_public_watermarked_photo" };
      }
      const previewUrl = publicMediaUrl(photo, catalog.mediaConfig);
      const galleryPreviewUrl = publicMediaUrl(photo, catalog.mediaConfig, "galleryKey");
      const title = sellerTitle(campaign, photo, index);
      const photoDestination = photoUrl(photo.id);
      const tags = listingTags(campaign, photo, collection.title || record.collectionKey);
      const description = listingDescription({
        campaign,
        photo,
        collectionTitle: collection.title || record.collectionKey,
        previewUrl,
        photoDestination,
      });
      return {
        media_id: photo.id,
        status: "ready_for_owner_review",
        title,
        collection: record.collectionKey,
        collection_title: collection.title || record.collectionKey,
        first_party_url: destinationUrl(campaign),
        photo_url: photoDestination,
        public_preview_url: previewUrl,
        gallery_preview_url: galleryPreviewUrl,
        captured: metadataValue(photo, "Captured"),
        original_size: metadataValue(photo, "Original size"),
        source_origin: photo.sourceOrigin || "",
        tags,
        etsy_request_body: createRequestBody({ args, title, description, tags }),
      };
    });
}

function tokenFile() {
  return path.resolve(env("ETSY_TOKEN_FILE") || DEFAULT_TOKEN_FILE);
}

function requiredCreateValue(name, fallback = "") {
  const value = String(args.get(name) || fallback || "").trim();
  if (!value) fail(`--${name} is required when creating Etsy drafts.`);
  return value;
}

function readToken() {
  const filePath = tokenFile();
  if (!fs.existsSync(filePath)) fail(`Token file not found: ${filePath}`);
  const token = readJson(filePath);
  if (!token.access_token) fail("Token file does not contain an access_token.");
  return token;
}

function createFormBody(requestBody) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(requestBody)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item);
    } else {
      form.append(key, String(value));
    }
  }
  return form;
}

async function createDrafts(payload) {
  if (!args.get("confirm-create-drafts")) {
    fail("--confirm-create-drafts is required with --create-drafts.");
  }
  requiredCreateValue("taxonomy-id");
  requiredCreateValue("shipping-profile-id");
  requiredCreateValue("readiness-state-id");
  const keystring = requiredCreateValue("etsy-keystring", env("ETSY_KEYSTRING"));
  const sharedSecret = requiredCreateValue("etsy-shared-secret", env("ETSY_SHARED_SECRET"));
  const shopId = requiredCreateValue("shop-id", env("ETSY_SHOP_ID") || DEFAULT_SHOP_ID);
  const token = readToken();
  const created = [];
  for (const listing of payload.listings.filter((item) => item.status === "ready_for_owner_review")) {
    const url = new URL(`${API_BASE}/application/shops/${encodeURIComponent(shopId)}/listings`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "x-api-key": `${keystring}:${sharedSecret}`,
      },
      body: createFormBody(listing.etsy_request_body),
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (!response.ok) {
      created.push({
        media_id: listing.media_id,
        status: "etsy_error",
        http_status: response.status,
        error: result,
      });
      continue;
    }
    created.push({
      media_id: listing.media_id,
      status: "draft_created",
      listing_id: result.listing_id || null,
      url: result.url || null,
      state: result.state || null,
    });
  }
  payload.etsy_create_results = created;
  payload.mode = "etsy_drafts_created";
}

function renderReadme(payload) {
  const lines = [
    `# Etsy Outlet Package - ${payload.campaign_title}`,
    "",
    `Generated: ${payload.generated_at}`,
    `Campaign: ${payload.campaign_id}`,
    `Destination: ${payload.first_party_url}`,
    `Mode: ${payload.mode}`,
    "",
    "This package is for owner review before any Etsy listing is published.",
    "It uses public catalog rows, public R2 watermarked previews, and first-party Photos By Elie URLs only.",
    "",
    "## Listings",
    "",
  ];
  for (const listing of payload.listings) {
    lines.push(`### ${listing.title || listing.media_id}`);
    lines.push("");
    lines.push(`- Media ID: \`${listing.media_id}\``);
    lines.push(`- Status: \`${listing.status}\``);
    if (listing.photo_url) lines.push(`- Photo URL: ${listing.photo_url}`);
    if (listing.public_preview_url) lines.push(`- Public preview: ${listing.public_preview_url}`);
    if (listing.etsy_request_body?.price) lines.push(`- Draft price: ${listing.etsy_request_body.price}`);
    if (listing.etsy_request_body?.taxonomy_id == null) lines.push("- Etsy taxonomy: `needs owner/shop setup`");
    if (listing.tags?.length) lines.push(`- Tags: ${listing.tags.map((tag) => `\`${tag}\``).join(", ")}`);
    lines.push("");
  }
  lines.push("## Next Manual Checks");
  lines.push("");
  lines.push("- Confirm Etsy taxonomy for fine art photo prints.");
  lines.push("- Confirm shipping profile and readiness/processing profile.");
  lines.push("- Confirm print size/material options and production path.");
  lines.push("- Upload approved Etsy listing images before publishing.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  if (args.get("list-campaigns")) {
    listCampaigns();
    return;
  }

  const campaignId = String(args.get("campaign") || DEFAULT_CAMPAIGN_ID);
  const campaign = loadCampaign(campaignId);
  const catalog = loadCatalog();
  const outputRoot = path.resolve(String(args.get("output-root") || DEFAULT_OUTPUT_ROOT));
  const packageDate = String(args.get("date") || campaignDate(campaign.id));
  const outputDir = path.join(outputRoot, packageDate, slugify(campaign.id));
  const payload = {
    format: "photosbyelie-etsy-outlet-package",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: "review_package_only",
    shop_id: String(args.get("shop-id") || env("ETSY_SHOP_ID") || DEFAULT_SHOP_ID),
    shop_url: "https://www.etsy.com/shop/PhotosByElieShop",
    campaign_id: campaign.id,
    campaign_title: campaign.title || campaign.id,
    first_party_url: destinationUrl(campaign),
    output_dir: path.relative(REPO_ROOT, outputDir),
    guardrails: [
      "public catalog rows only",
      "public R2 watermarked previews only",
      "first-party Photos By Elie URLs only",
      "no private masters, buyer downloads, Owner-only review JSON, or secrets",
      "draft/review first; no active publish",
    ],
    create_drafts_requested: Boolean(args.get("create-drafts")),
    listings: buildListings(campaign, catalog),
  };

  if (args.get("create-drafts")) {
    await createDrafts(payload);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "manifest.json"), payload);
  fs.writeFileSync(path.join(outputDir, "README.md"), renderReadme(payload));
  writeJson(path.join(outputRoot, "latest.json"), {
    format: payload.format,
    schema_version: payload.schema_version,
    generated_at: payload.generated_at,
    campaign_id: payload.campaign_id,
    listing_count: payload.listings.length,
    ready_count: payload.listings.filter((listing) => listing.status === "ready_for_owner_review").length,
    mode: payload.mode,
    manifest: path.relative(REPO_ROOT, path.join(outputDir, "manifest.json")),
    readme: path.relative(REPO_ROOT, path.join(outputDir, "README.md")),
  });

  const ready = payload.listings.filter((listing) => listing.status === "ready_for_owner_review").length;
  const blocked = payload.listings.length - ready;
  console.log(`Generated Etsy outlet package for ${payload.campaign_title}`);
  console.log(`Listings: ${payload.listings.length}; ready for owner review: ${ready}; blocked: ${blocked}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, outputDir)}`);
  if (!args.get("create-drafts")) {
    console.log("No Etsy API write was made. Add --create-drafts --confirm-create-drafts plus Etsy setup ids to create drafts.");
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
