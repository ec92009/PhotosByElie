#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalogTsv = require("./catalog_tsv.cjs");

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CAMPAIGN_DIR = path.join(REPO_ROOT, "assets", "campaigns");
const PACKAGE_DIR = path.join(REPO_ROOT, "assets", "owner-actions", "social-post-packages");
const INDEX_PATH = path.join(CAMPAIGN_DIR, "index.json");
const SOCIAL_PLATFORMS = new Set(["facebook", "instagram", "pinterest", "threads"]);
const REQUIRED_ACCEPTANCE_DATE = "2026-05-27";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadMediaConfig() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, "media-config.js"), "utf8"), context, { filename: "media-config.js" });
  return context.window.photosByElieMediaConfig || {};
}

function loadPhotoIndex() {
  const collections = catalogTsv.loadCatalogWindow(REPO_ROOT).photosByElieData || {};
  const index = new Map();
  for (const [collectionKey, collection] of Object.entries(collections)) {
    for (const photo of collection.photos || []) {
      index.set(photo.id, { photo, collectionKey });
    }
  }
  return index;
}

function publicPreviewUrl(photo, mediaConfig) {
  const preview = photo?.media?.publicPreview || {};
  const key = preview.galleryKey || preview.detailKey;
  if (!key || !mediaConfig.publicBaseUrl) return "";
  return `${String(mediaConfig.publicBaseUrl).replace(/\/$/, "")}/${String(key).replace(/^\//, "")}`;
}

function socialRows(payload) {
  const rows = Array.isArray(payload.packages)
    ? payload.packages
    : Array.isArray(payload.platforms)
      ? payload.platforms
      : [];
  return rows.filter((row) => SOCIAL_PLATFORMS.has(String(row.platform || "").toLowerCase()));
}

function campaignIdFrom(row) {
  if (row.campaign_id) return String(row.campaign_id);
  try {
    const url = new URL(String(row.destination_url || ""));
    return url.searchParams.get("c") || "";
  } catch {
    return "";
  }
}

function itemIds(row) {
  const items = Array.isArray(row.media) ? row.media : Array.isArray(row.items) ? row.items : [];
  return items
    .map((item) => String(item.media_id || item.id || "").trim())
    .filter(Boolean);
}

function assertFirstPartyUrl(row, campaignId, errors) {
  let url;
  try {
    url = new URL(String(row.destination_url || ""));
  } catch {
    errors.push(`${row.date} ${row.platform}: destination_url is not a URL.`);
    return;
  }
  const allowedHost = url.hostname === "photos-by-elie.com"
    || (url.hostname === "ec92009.github.io" && url.pathname.startsWith("/PhotosByElie/"));
  if (!allowedHost || !url.pathname.endsWith("/campaign.html") || url.searchParams.get("c") !== campaignId) {
    errors.push(`${row.date} ${row.platform}: destination_url is not the expected first-party campaign URL.`);
  }
}

function assertNoPrivateReferences(campaign, context, errors) {
  const serialized = JSON.stringify(campaign);
  [
    "/Users/",
    "tmp/",
    "masters/",
    "renders/",
    "private",
    "buyer",
  ].forEach((needle) => {
    if (serialized.includes(needle)) errors.push(`${context}: campaign JSON contains private-looking reference ${needle}`);
  });
}

function validateCampaignRow({ row, campaignId, photoIndex, mediaConfig, indexCampaignIds, errors }) {
  const campaignPath = path.join(CAMPAIGN_DIR, `${campaignId}.json`);
  if (!campaignId) {
    errors.push(`${row.date} ${row.platform}: missing campaign id.`);
    return;
  }
  if (!fs.existsSync(campaignPath)) {
    errors.push(`${row.date} ${row.platform}: missing assets/campaigns/${campaignId}.json.`);
    return;
  }
  const campaign = readJson(campaignPath);
  if (campaign.id !== campaignId) {
    errors.push(`${row.date} ${row.platform}: campaign id mismatch in ${campaignId}.json.`);
  }
  if (!SOCIAL_PLATFORMS.has(String(campaign.source || "").toLowerCase())) {
    errors.push(`${row.date} ${row.platform}: campaign source is not a social platform.`);
  }
  if (!indexCampaignIds.has(campaignId)) {
    errors.push(`${row.date} ${row.platform}: campaign is absent from assets/campaigns/index.json.`);
  }
  assertFirstPartyUrl(row, campaignId, errors);
  assertNoPrivateReferences(campaign, campaignId, errors);

  const primaryIds = Array.isArray(campaign.primaryPhotoIds) ? campaign.primaryPhotoIds : [];
  if (!primaryIds.length) errors.push(`${campaignId}: primaryPhotoIds is empty.`);
  for (const id of primaryIds) {
    const entry = photoIndex.get(id);
    if (!entry) {
      errors.push(`${campaignId}: primary photo ${id} is not in the public catalog.`);
      continue;
    }
    if (!publicPreviewUrl(entry.photo, mediaConfig)) {
      errors.push(`${campaignId}: primary photo ${id} has no public preview key.`);
    }
  }

  const primarySet = new Set(primaryIds);
  for (const id of itemIds(row)) {
    if (!primarySet.has(id)) {
      errors.push(`${row.date} ${row.platform}: package photo ${id} is not in ${campaignId}.primaryPhotoIds.`);
    }
  }
}

function packageDates() {
  if (!fs.existsSync(PACKAGE_DIR)) return [];
  return fs.readdirSync(PACKAGE_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

const since = argValue("--since", "");
const mediaConfig = loadMediaConfig();
const photoIndex = loadPhotoIndex();
const campaignIndex = readJson(INDEX_PATH);
const indexCampaigns = Array.isArray(campaignIndex.campaigns) ? campaignIndex.campaigns : [];
const indexCampaignIds = new Set(indexCampaigns.map((item) => item.id).filter(Boolean));
const socialIndexCount = indexCampaigns.filter((item) => SOCIAL_PLATFORMS.has(String(item.source || "").toLowerCase())).length;
const errors = [];
const rows = [];
const dates = packageDates();
const latestPackageDate = dates.at(-1) || "";
const targetDates = since
  ? dates.filter((value) => value >= since)
  : Array.from(new Set([REQUIRED_ACCEPTANCE_DATE, latestPackageDate].filter(Boolean))).sort();

for (const date of targetDates) {
  const packagePath = path.join(PACKAGE_DIR, date, "daily-social-package.json");
  if (!fs.existsSync(packagePath)) continue;
  const payload = readJson(packagePath);
  for (const row of socialRows(payload)) {
    rows.push({ ...row, date: row.date || date });
  }
}

if (!rows.some((row) => row.date === REQUIRED_ACCEPTANCE_DATE)) {
  errors.push(`No ${REQUIRED_ACCEPTANCE_DATE} social package rows were found for acceptance-criteria coverage.`);
}
if (!rows.length) {
  errors.push(`No social package rows found for ${targetDates.join(", ")}.`);
}

const latestDate = rows.map((row) => row.date).sort().at(-1) || "";
const latestIds = new Set();

for (const row of rows) {
  const campaignId = campaignIdFrom(row);
  if (row.date === latestDate && campaignId) latestIds.add(campaignId);
  validateCampaignRow({ row, campaignId, photoIndex, mediaConfig, indexCampaignIds, errors });
}

if (latestIds.size < 3) {
  errors.push(`Latest package date ${latestDate || "(none)"} exposes only ${latestIds.size} distinct campaign springboard(s).`);
}
if (socialIndexCount < latestIds.size) {
  errors.push("Campaign index does not expose enough social campaigns for the latest-social shelf.");
}

if (errors.length) {
  console.error("Social springboard validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(since
  ? `Validated ${rows.length} social package rows since ${since}.`
  : `Validated ${rows.length} social package rows for ${targetDates.join(", ")}.`);
console.log(`Latest package date: ${latestDate} (${latestIds.size} distinct campaign springboards).`);
console.log(`Campaign index social entries available for latest-social shelf: ${socialIndexCount}.`);
