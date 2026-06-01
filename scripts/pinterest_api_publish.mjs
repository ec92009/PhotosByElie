#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_ROOT = path.join(REPO_ROOT, "socials", "Pinterest");
const API_BASE = process.env.PINTEREST_API_BASE || "https://api.pinterest.com/v5";
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), ".config", "photosbyelie", "pinterest-token.json");

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
  node scripts/pinterest_api_publish.mjs --manifest socials/Pinterest/YYYY-MM-DD/theme/manifest.json
  node scripts/pinterest_api_publish.mjs --manifest ... --board-id <id> --publish
  node scripts/pinterest_api_publish.mjs --list-boards

Environment:
  PINTEREST_ACCESS_TOKEN   Required for --publish and --list-boards unless a token file exists.
  PINTEREST_TOKEN_FILE      Optional. Defaults to ~/.config/photosbyelie/pinterest-token.json.
  PINTEREST_BOARD_ID       Optional default board id for publishing.

Notes:
  Dry-run is the default. Live publishing requires --publish.
  The current API path creates one standard image Pin per staged image.
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

function newestManifestPath() {
  const dates = fs.existsSync(DEFAULT_ROOT)
    ? fs.readdirSync(DEFAULT_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort()
    : [];
  for (const date of dates.reverse()) {
    const dateDir = path.join(DEFAULT_ROOT, date);
    const direct = path.join(dateDir, "manifest.json");
    if (fs.existsSync(direct)) return direct;
    const themed = fs.readdirSync(dateDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dateDir, entry.name, "manifest.json"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort();
    if (themed.length) return themed[themed.length - 1];
  }
  fail(`No Pinterest manifest found under ${path.relative(REPO_ROOT, DEFAULT_ROOT)}`);
}

function manifestPath() {
  if (args.get("manifest")) return path.resolve(String(args.get("manifest")));
  return newestManifestPath();
}

function mediaItems(manifest) {
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  if (!items.length) fail("Manifest has no items array.");
  return items;
}

function boardId() {
  return String(args.get("board-id") || process.env.PINTEREST_BOARD_ID || "").trim();
}

function token() {
  const envToken = String(process.env.PINTEREST_ACCESS_TOKEN || "").trim();
  if (envToken) return envToken;
  const filePath = path.resolve(String(process.env.PINTEREST_TOKEN_FILE || DEFAULT_TOKEN_FILE));
  if (!fs.existsSync(filePath)) return "";
  const payload = readJson(filePath);
  return String(payload.access_token || "").trim();
}

function pinTitle(manifest, item, total) {
  const base = manifest.pin_title || manifest.title || "Photos By Elie";
  if (total <= 1) return base.slice(0, 100);
  return `${base} (${item.order || 1}/${total})`.slice(0, 100);
}

function pinDescription(manifest) {
  return String(manifest.description || manifest.caption || "").slice(0, 500);
}

function pinLink(manifest, item) {
  return manifest.destination_url || item.public_photo_url || item.photo_url || "";
}

function pinAltText(manifest, item, total) {
  const base = manifest.alt_text || item.title || manifest.title || "Photos By Elie photograph.";
  if (total <= 1) return String(base).slice(0, 500);
  return `${base} Image ${item.order || 1} of ${total}.`.slice(0, 500);
}

function publicImageUrl(item) {
  return item.public_asset_url || item.source_url || item.media_url || "";
}

function buildPinRequests(manifest, resolvedBoardId) {
  const items = mediaItems(manifest);
  return items.map((item) => {
    const imageUrl = publicImageUrl(item);
    if (!imageUrl.startsWith("https://")) {
      fail(`Item ${item.order || item.id || "unknown"} has no public https image URL.`);
    }
    return {
      source_item: {
        order: item.order,
        media_id: item.media_id || item.id,
        public_asset_url: imageUrl,
      },
      request: {
        board_id: resolvedBoardId || "<PINTEREST_BOARD_ID>",
        title: pinTitle(manifest, item, items.length),
        description: pinDescription(manifest),
        link: pinLink(manifest, item),
        alt_text: pinAltText(manifest, item, items.length),
        media_source: {
          source_type: "image_url",
          url: imageUrl,
          is_standard: true,
        },
      },
    };
  });
}

async function pinterestFetch(pathname, options = {}) {
  const accessToken = token();
  if (!accessToken) fail("PINTEREST_ACCESS_TOKEN is required for this command.");
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = body ? JSON.stringify(body) : text;
    throw new Error(`Pinterest API ${response.status}: ${detail}`);
  }
  return body;
}

async function listBoards() {
  const body = await pinterestFetch("/boards");
  console.log(JSON.stringify(body, null, 2));
}

async function publishPins(requests) {
  const results = [];
  for (const entry of requests) {
    const body = await pinterestFetch("/pins", {
      method: "POST",
      body: JSON.stringify(entry.request),
    });
    results.push({
      source_item: entry.source_item,
      response: body,
    });
  }
  console.log(JSON.stringify({ status: "published", results }, null, 2));
}

async function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  if (args.get("list-boards")) {
    await listBoards();
    return;
  }

  const filePath = manifestPath();
  if (!fs.existsSync(filePath)) fail(`Manifest not found: ${filePath}`);
  const manifest = readJson(filePath);
  const resolvedBoardId = boardId();
  const requests = buildPinRequests(manifest, resolvedBoardId);
  const dryRunPayload = {
    status: args.get("publish") ? "ready_to_publish" : "dry_run",
    manifest: path.relative(REPO_ROOT, filePath),
    account: manifest.account || "@photosbyelie",
    board_label: manifest.board || manifest.board_recommendation || null,
    board_id: resolvedBoardId || null,
    pin_count: requests.length,
    api_note: "Pinterest API publishing is modeled as one standard image Pin per staged image.",
    requests,
  };

  if (!args.get("publish")) {
    console.log(JSON.stringify(dryRunPayload, null, 2));
    return;
  }
  if (!resolvedBoardId) fail("A board id is required for --publish. Pass --board-id or PINTEREST_BOARD_ID.");
  await publishPins(requests);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
