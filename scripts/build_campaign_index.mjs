#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import catalogTsv from "./catalog_tsv.cjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CAMPAIGN_DIR = path.join(REPO_ROOT, "assets", "campaigns");
const OUTPUT_PATH = path.join(CAMPAIGN_DIR, "index.json");
const SITE_BASE_URL = "https://photos-by-elie.com/";
const { loadCatalogWindow } = catalogTsv;
import campaignRules from "../campaign-collection.js";

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
  const collections = loadCatalogWindow(REPO_ROOT).photosByElieData || {};
  const index = new Map();
  for (const [collectionKey, collection] of Object.entries(collections)) {
    for (const photo of collection.photos || []) {
      index.set(photo.id, { photo, collectionKey, collection });
    }
  }
  return index;
}

function publicPreviewUrl(photo, mediaConfig, size = "gallery") {
  const preview = photo?.media?.publicPreview || {};
  const key = size === "detail"
    ? preview.detailKey || preview.galleryKey
    : preview.galleryKey || preview.detailKey;
  if (!key || !mediaConfig.publicBaseUrl) return "";
  return `${String(mediaConfig.publicBaseUrl).replace(/\/$/, "")}/${String(key).replace(/^\//, "")}`;
}

function campaignDate(campaign) {
  return String(campaign.id || "").match(/(\d{4}-\d{2}-\d{2})$/)?.[1] || "0000-00-00";
}

function campaignItem(campaign, stat, photoIndex, mediaConfig) {
  const heroId = campaign.heroPhotoId || campaign.primaryPhotoIds?.[0] || "";
  const heroEntry = photoIndex.get(heroId);
  const photoIds = campaignRules.memberIds(campaign);
  const previewIds = [
    heroId,
    ...(campaign.primaryPhotoIds || []),
  ].filter(Boolean);
  const previewImageUrls = Array.from(new Set(
    previewIds
      .map((id) => photoIndex.get(id)?.photo)
      .map((photo) => publicPreviewUrl(photo, mediaConfig))
      .filter(Boolean)
  )).slice(0, 8);
  return {
    id: campaign.id,
    source: campaign.source || "Photos By Elie",
    title: campaign.title || campaign.id,
    description: campaign.description || "",
    date: campaignDate(campaign),
    href: `./campaign.html?c=${encodeURIComponent(campaign.id)}`,
    publicUrl: `${SITE_BASE_URL}campaign.html?c=${encodeURIComponent(campaign.id)}`,
    imageUrl: publicPreviewUrl(heroEntry?.photo, mediaConfig) || previewImageUrls[0] || "",
    imageAlt: heroEntry?.photo?.title || campaign.title || campaign.id,
    previewImageUrls,
    photoIds,
    compositePhotoIds: campaignRules.compositePhotoIds(campaign),
    primaryPhotoCount: Array.isArray(campaign.primaryPhotoIds) ? campaign.primaryPhotoIds.length : 0,
    relatedPhotoCount: Array.isArray(campaign.relatedPhotoIds) ? campaign.relatedPhotoIds.length : 0,
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

const mediaConfig = loadMediaConfig();
const photoIndex = loadPhotoIndex();
const campaigns = fs.readdirSync(CAMPAIGN_DIR)
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .map((file) => {
    const filePath = path.join(CAMPAIGN_DIR, file);
    const campaign = readJson(filePath);
    return campaignRules.publicCampaign(campaign) ? campaignItem(campaign, fs.statSync(filePath), photoIndex, mediaConfig) : null;
  })
  .filter((item) => item?.id)
  .sort((a, b) => b.date.localeCompare(a.date) || b.mtimeMs - a.mtimeMs || a.title.localeCompare(b.title));

const payload = {
  format: "photosbyelie-campaign-index",
  schema_version: 1,
  generated_at: new Date().toISOString(),
  campaign_count: campaigns.length,
  campaigns,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)} with ${campaigns.length} campaigns`);
