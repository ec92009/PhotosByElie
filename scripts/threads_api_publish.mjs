#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION || "v1.0";
const GRAPH_BASE = process.env.THREADS_GRAPH_BASE || `https://graph.threads.net/${GRAPH_VERSION}`;
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), ".config", "photosbyelie", "threads-token.json");
const DEFAULT_CONTAINER_WAIT_MS = Number(process.env.THREADS_CONTAINER_WAIT_MS || 180000);

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
  node scripts/threads_api_publish.mjs --profile
  node scripts/threads_api_publish.mjs --manifest socials/Threads/YYYY-MM-DD/theme/manifest.json --threads-user-id <id>
  node scripts/threads_api_publish.mjs --manifest socials/Threads/YYYY-MM-DD/theme/manifest.json --threads-user-id <id> --publish

Environment:
  THREADS_ACCESS_TOKEN  Required for --profile and --publish unless a token file exists.
  THREADS_TOKEN_FILE    Optional. Defaults to ~/.config/photosbyelie/threads-token.json.
  THREADS_USER_ID       Optional default Threads user id. Use "me" if supported by the token.
  THREADS_GRAPH_VERSION Optional. Defaults to v1.0.

Notes:
  Dry-run is the default. Live publishing requires --publish.
  Threads image carousels are planned as child media containers plus a parent carousel container.
`;
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error("");
  console.error(usage());
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function token() {
  const envToken = String(process.env.THREADS_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const filePath = path.resolve(String(process.env.THREADS_TOKEN_FILE || DEFAULT_TOKEN_FILE));
  if (!fs.existsSync(filePath)) return "";
  const payload = readJson(filePath);
  return String(payload.access_token || "").trim();
}

function resolvedManifestPath() {
  const raw = args.get("manifest");
  if (!raw) fail("--manifest is required for dry-run and publish.");
  const filePath = path.resolve(String(raw));
  if (!fs.existsSync(filePath)) fail(`Manifest not found: ${filePath}`);
  return filePath;
}

function threadsUserId() {
  return String(args.get("threads-user-id") || process.env.THREADS_USER_ID || "").trim();
}

function mediaItems(manifest) {
  const items = Array.isArray(manifest.items) ? manifest.items : Array.isArray(manifest.media) ? manifest.media : [];
  if (!items.length) fail("Manifest has no items/media array.");
  if (items.length > 10) fail("Threads carousel publishing supports at most 10 images.");
  return items;
}

function publicImageUrl(item) {
  return item.public_asset_url || item.source_url || item.media_url || "";
}

function caption(manifest) {
  return String(manifest.caption || manifest.description || "").trim();
}

function threadsDryRun(manifest, resolvedUserId) {
  const items = mediaItems(manifest);
  const userId = resolvedUserId || "<THREADS_USER_ID>";
  const childContainers = items.map((item, index) => {
    const imageUrl = publicImageUrl(item);
    if (!imageUrl.startsWith("https://")) fail(`Item ${item.order || item.media_id || index + 1} has no public https image URL.`);
    return {
      source_item: {
        order: item.order || index + 1,
        media_id: item.media_id || item.id,
        public_asset_url: imageUrl,
      },
      endpoint: `/${userId}/threads`,
      body: items.length === 1
        ? {
          media_type: "IMAGE",
          image_url: imageUrl,
          text: caption(manifest),
        }
        : {
          media_type: "IMAGE",
          image_url: imageUrl,
          is_carousel_item: true,
        },
      result_placeholder: `{creation_id_${index + 1}}`,
    };
  });
  const publishPlan = items.length === 1
    ? {
      endpoint: `/${userId}/threads_publish`,
      body: { creation_id: "{creation_id_1}" },
    }
    : {
      endpoint: `/${userId}/threads`,
      body: {
        media_type: "CAROUSEL",
        children: childContainers.map((_, index) => `{creation_id_${index + 1}}`),
        text: caption(manifest),
      },
      publish_endpoint: `/${userId}/threads_publish`,
      publish_body: { creation_id: "{carousel_creation_id}" },
    };
  return {
    status: args.get("publish") ? "ready_to_publish" : "dry_run",
    platform: "threads",
    account: manifest.account || "Photos By Elie Threads",
    threads_user_id: resolvedUserId || null,
    image_count: childContainers.length,
    graph_version: GRAPH_VERSION,
    destination_url: manifest.destination_url || null,
    link_preview_note: manifest.link_preview_note || "Remove automatic link previews if they show generic or off-theme metadata.",
    note: "Live publish creates one image container or child image containers plus a carousel container, then publishes it.",
    media_containers: childContainers,
    publish: publishPlan,
  };
}

async function graphFetch(pathname, options = {}, accessToken = token()) {
  if (!accessToken) fail("THREADS_ACCESS_TOKEN is required for this command unless a token file exists.");
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
    throw new Error(`Threads Graph ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function graphPostForm(pathname, body, accessToken = token()) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    form.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return graphFetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }, accessToken);
}

async function profile() {
  const body = await graphFetch("/me?fields=id,username,name");
  console.log(JSON.stringify({
    graph_version: GRAPH_VERSION,
    id: body.id || null,
    username: body.username || null,
    name: body.name || null,
  }, null, 2));
}

async function publishThreads(payload) {
  if (!payload.threads_user_id) fail("A Threads user id is required for --publish.");
  const accessToken = token();
  const waitForContainer = async (id, label) => {
    const deadline = Date.now() + DEFAULT_CONTAINER_WAIT_MS;
    let last = null;
    while (Date.now() < deadline) {
      const status = await graphFetch(`/${id}?fields=status`, {}, accessToken).catch((error) => {
        const message = error?.message || String(error);
        if (message.includes('"code":24') || message.includes('"error_subcode":4279009')) {
          return null;
        }
        throw error;
      });
      if (!status) {
        await sleep(5000);
        continue;
      }
      last = status;
      if (status.status === "FINISHED" || status.status === "PUBLISHED") return status;
      if (status.status === "ERROR" || status.status === "EXPIRED") {
        throw new Error(`Threads container ${label} ${id} failed: ${JSON.stringify(status)}`);
      }
      await sleep(5000);
    }
    throw new Error(`Threads container ${label} ${id} was not ready before timeout. Last status: ${JSON.stringify(last)}`);
  };
  const created = [];
  for (const entry of payload.media_containers) {
    const result = await graphPostForm(entry.endpoint, entry.body, accessToken);
    await waitForContainer(result.id, entry.source_item?.media_id || entry.source_item?.order || "media");
    created.push({ source_item: entry.source_item, response: result });
  }
  if (created.length === 1) {
    const published = await graphPostForm(payload.publish.endpoint, { creation_id: created[0].response.id }, accessToken);
    console.log(JSON.stringify({ status: "published", platform: "threads", created, published }, null, 2));
    return;
  }
  const carousel = await graphPostForm(payload.publish.endpoint, {
    media_type: "CAROUSEL",
    children: created.map((item) => item.response.id).join(","),
    text: caption(readJson(resolvedManifestPath())),
  }, accessToken);
  await waitForContainer(carousel.id, "carousel");
  const published = await graphPostForm(payload.publish.publish_endpoint, { creation_id: carousel.id }, accessToken);
  console.log(JSON.stringify({ status: "published", platform: "threads", created, carousel, published }, null, 2));
}

async function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  if (args.get("profile")) {
    await profile();
    return;
  }
  const filePath = resolvedManifestPath();
  const manifest = readJson(filePath);
  const payload = threadsDryRun(manifest, threadsUserId());
  payload.manifest = path.relative(REPO_ROOT, filePath);
  if (!args.get("publish")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  await publishThreads(payload);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
