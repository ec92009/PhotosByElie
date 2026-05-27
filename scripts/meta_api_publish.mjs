#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH_BASE = process.env.META_GRAPH_BASE || `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), ".config", "photosbyelie", "meta-token.json");

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
  node scripts/meta_api_publish.mjs --list-pages
  node scripts/meta_api_publish.mjs --platform facebook --manifest socials/Facebook/YYYY-MM-DD/theme/manifest.json --page-id <id>
  node scripts/meta_api_publish.mjs --platform instagram --manifest socials/Instagram/YYYY-MM-DD/theme/manifest.json --ig-user-id <id>
  node scripts/meta_api_publish.mjs --platform facebook --manifest ... --page-id <id> --publish
  node scripts/meta_api_publish.mjs --platform instagram --manifest ... --ig-user-id <id> --publish

Environment:
  META_ACCESS_TOKEN       Required for --list-pages and --publish unless a token file exists.
  META_TOKEN_FILE         Optional. Defaults to ~/.config/photosbyelie/meta-token.json.
  META_PAGE_ACCESS_TOKEN  Optional Page token for Facebook publish calls.
  META_PAGE_ID            Optional default Facebook Page id.
  META_IG_USER_ID         Optional default Instagram professional account id.
  META_GRAPH_VERSION      Optional. Defaults to v23.0.

Notes:
  Dry-run is the default. Live publishing requires --publish.
  Facebook dry-run models a multi-photo Page post.
  Instagram dry-run models a feed carousel.
`;
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

function token() {
  const envToken = String(process.env.META_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const filePath = path.resolve(String(process.env.META_TOKEN_FILE || DEFAULT_TOKEN_FILE));
  if (!fs.existsSync(filePath)) return "";
  const payload = readJson(filePath);
  return String(payload.access_token || "").trim();
}

function mediaItems(manifest) {
  const items = Array.isArray(manifest.items) ? manifest.items : Array.isArray(manifest.media) ? manifest.media : [];
  if (!items.length) fail("Manifest has no items/media array.");
  return items;
}

function publicImageUrl(item) {
  return item.public_asset_url || item.source_url || item.media_url || "";
}

function caption(manifest) {
  return String(manifest.caption || manifest.description || "").trim();
}

function resolvedManifestPath() {
  const raw = args.get("manifest");
  if (!raw) fail("--manifest is required for dry-run and publish.");
  const filePath = path.resolve(String(raw));
  if (!fs.existsSync(filePath)) fail(`Manifest not found: ${filePath}`);
  return filePath;
}

function pageId() {
  return String(args.get("page-id") || process.env.META_PAGE_ID || "").trim();
}

function igUserId() {
  return String(args.get("ig-user-id") || process.env.META_IG_USER_ID || "").trim();
}

function facebookDryRun(manifest, resolvedPageId) {
  const items = mediaItems(manifest);
  const photoUploads = items.map((item, index) => {
    const imageUrl = publicImageUrl(item);
    if (!imageUrl.startsWith("https://")) fail(`Item ${item.order || item.media_id || index + 1} has no public https image URL.`);
    return {
      source_item: {
        order: item.order || index + 1,
        media_id: item.media_id || item.id,
        public_asset_url: imageUrl,
      },
      endpoint: `/${resolvedPageId || "<META_PAGE_ID>"}/photos`,
      body: {
        url: imageUrl,
        published: false,
      },
      result_placeholder: `{media_fbid_${index + 1}}`,
    };
  });
  return {
    status: args.get("publish") ? "ready_to_publish" : "dry_run",
    platform: "facebook",
    account: manifest.account || "Photos By Elie Facebook Page",
    page_id: resolvedPageId || null,
    image_count: photoUploads.length,
    graph_version: GRAPH_VERSION,
    note: "Live publish uploads photos unpublished, then creates one Page feed post with attached_media.",
    photo_uploads: photoUploads,
    feed_post: {
      endpoint: `/${resolvedPageId || "<META_PAGE_ID>"}/feed`,
      body: {
        message: caption(manifest),
        attached_media: photoUploads.map((_, index) => ({ media_fbid: `{media_fbid_${index + 1}}` })),
      },
    },
  };
}

function instagramDryRun(manifest, resolvedIgUserId) {
  const items = mediaItems(manifest);
  if (items.length > 10) fail("Instagram carousel publishing supports at most 10 images.");
  const mediaContainers = items.map((item, index) => {
    const imageUrl = publicImageUrl(item);
    if (!imageUrl.startsWith("https://")) fail(`Item ${item.order || item.media_id || index + 1} has no public https image URL.`);
    return {
      source_item: {
        order: item.order || index + 1,
        media_id: item.media_id || item.id,
        public_asset_url: imageUrl,
      },
      endpoint: `/${resolvedIgUserId || "<META_IG_USER_ID>"}/media`,
      body: items.length === 1
        ? { image_url: imageUrl, caption: caption(manifest) }
        : { image_url: imageUrl, is_carousel_item: true },
      result_placeholder: `{creation_id_${index + 1}}`,
    };
  });
  const carouselOrSingle = items.length === 1
    ? {
      endpoint: `/${resolvedIgUserId || "<META_IG_USER_ID>"}/media_publish`,
      body: { creation_id: "{creation_id_1}" },
    }
    : {
      endpoint: `/${resolvedIgUserId || "<META_IG_USER_ID>"}/media`,
      body: {
        media_type: "CAROUSEL",
        children: mediaContainers.map((_, index) => `{creation_id_${index + 1}}`),
        caption: caption(manifest),
      },
      publish_endpoint: `/${resolvedIgUserId || "<META_IG_USER_ID>"}/media_publish`,
      publish_body: { creation_id: "{carousel_creation_id}" },
    };
  return {
    status: args.get("publish") ? "ready_to_publish" : "dry_run",
    platform: "instagram",
    account: manifest.account || "Photos By Elie Instagram",
    ig_user_id: resolvedIgUserId || null,
    image_count: mediaContainers.length,
    graph_version: GRAPH_VERSION,
    note: "Live publish creates media containers, then publishes a single image or carousel container.",
    media_containers: mediaContainers,
    publish: carouselOrSingle,
  };
}

async function graphFetch(pathname, options = {}, accessToken = token()) {
  if (!accessToken) fail("META_ACCESS_TOKEN is required for this command unless a token file exists.");
  const response = await fetch(`${GRAPH_BASE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Meta Graph ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function graphPostForm(pathname, body, accessToken) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return graphFetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }, accessToken);
}

async function listPages() {
  const body = await graphFetch("/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}");
  const redacted = {
    graph_version: GRAPH_VERSION,
    pages: (body.data || []).map((page) => ({
      id: page.id,
      name: page.name,
      has_page_access_token: Boolean(page.access_token),
      instagram_business_account: page.instagram_business_account || null,
    })),
  };
  console.log(JSON.stringify(redacted, null, 2));
}

async function pageAccessToken(targetPageId) {
  const envPageToken = String(process.env.META_PAGE_ACCESS_TOKEN || "").trim();
  if (envPageToken) return envPageToken;
  const body = await graphFetch("/me/accounts?fields=id,name,access_token");
  const page = (body.data || []).find((candidate) => candidate.id === targetPageId);
  if (!page?.access_token) fail(`No Page access token returned for page id ${targetPageId}.`);
  return page.access_token;
}

async function publishFacebook(payload) {
  if (!payload.page_id) fail("A Facebook Page id is required for --publish.");
  const pageToken = await pageAccessToken(payload.page_id);
  const uploaded = [];
  for (const entry of payload.photo_uploads) {
    const result = await graphPostForm(entry.endpoint, entry.body, pageToken);
    uploaded.push({ source_item: entry.source_item, response: result });
  }
  const attachedMedia = uploaded.map((item) => ({ media_fbid: item.response.id }));
  const feed = await graphPostForm(payload.feed_post.endpoint, {
    ...payload.feed_post.body,
    attached_media: attachedMedia,
  }, pageToken);
  console.log(JSON.stringify({ status: "published", platform: "facebook", uploaded, feed }, null, 2));
}

async function publishInstagram(payload) {
  if (!payload.ig_user_id) fail("An Instagram user id is required for --publish.");
  const created = [];
  for (const entry of payload.media_containers) {
    const result = await graphPostForm(entry.endpoint, entry.body, token());
    created.push({ source_item: entry.source_item, response: result });
  }
  if (created.length === 1) {
    const published = await graphPostForm(payload.publish.endpoint, { creation_id: created[0].response.id }, token());
    console.log(JSON.stringify({ status: "published", platform: "instagram", created, published }, null, 2));
    return;
  }
  const carousel = await graphPostForm(payload.publish.endpoint, {
    media_type: "CAROUSEL",
    children: created.map((item) => item.response.id).join(","),
    caption: caption(readJson(resolvedManifestPath())),
  }, token());
  const published = await graphPostForm(payload.publish.publish_endpoint, { creation_id: carousel.id }, token());
  console.log(JSON.stringify({ status: "published", platform: "instagram", created, carousel, published }, null, 2));
}

async function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  if (args.get("list-pages")) {
    await listPages();
    return;
  }
  const platform = String(args.get("platform") || "").toLowerCase();
  if (!["facebook", "instagram"].includes(platform)) fail("--platform must be facebook or instagram.");
  const filePath = resolvedManifestPath();
  const manifest = readJson(filePath);
  const payload = platform === "facebook"
    ? facebookDryRun(manifest, pageId())
    : instagramDryRun(manifest, igUserId());
  payload.manifest = path.relative(REPO_ROOT, filePath);
  if (!args.get("publish")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (platform === "facebook") await publishFacebook(payload);
  if (platform === "instagram") await publishInstagram(payload);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
