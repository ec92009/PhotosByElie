#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const API_BASE = process.env.ETSY_API_BASE || "https://api.etsy.com/v3";
const CONFIG_DIR = path.join(os.homedir(), ".config", "photosbyelie");
const DEFAULT_TOKEN_FILE = path.join(CONFIG_DIR, "etsy-token.json");

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
  node scripts/etsy_api_check.mjs --token-status
  node scripts/etsy_api_check.mjs --me
  node scripts/etsy_api_check.mjs --get /application/users/me

Environment:
  ETSY_KEYSTRING       Required for live API calls.
  ETSY_SHARED_SECRET   Required for live API calls.
  ETSY_TOKEN_FILE      Optional. Defaults to ~/.config/photosbyelie/etsy-token.json.

Security:
  The Etsy app keystring, shared secret, and OAuth tokens must stay outside git.
  This script never prints token or app secret values.
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

function tokenFile() {
  return path.resolve(env("ETSY_TOKEN_FILE") || DEFAULT_TOKEN_FILE);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function readToken() {
  const filePath = tokenFile();
  if (!fs.existsSync(filePath)) fail(`Token file not found: ${filePath}`);
  const token = readJson(filePath);
  if (!token.access_token) fail("Token file does not contain an access_token.");
  return { filePath, token };
}

function tokenStatus() {
  const filePath = tokenFile();
  if (!fs.existsSync(filePath)) fail(`Token file not found: ${filePath}`);
  const token = readJson(filePath);
  console.log(JSON.stringify({
    token_file: filePath,
    has_access_token: Boolean(token.access_token),
    has_refresh_token: Boolean(token.refresh_token),
    token_type: token.token_type || null,
    expires_in: token.expires_in ?? null,
    expires_at: token.expires_at || null,
    saved_at: token.saved_at || null,
    scopes: token.scopes || token.scope || null,
  }, null, 2));
}

function safeApiPath(input) {
  const pathname = String(input || "").trim();
  if (!pathname) fail("--get requires an Etsy API path such as /application/users/me.");
  if (!pathname.startsWith("/application/")) {
    fail("Only /application/ Etsy API paths are allowed.");
  }
  return pathname;
}

async function etsyGet(pathname) {
  const keystring = requiredEnv("ETSY_KEYSTRING");
  const sharedSecret = requiredEnv("ETSY_SHARED_SECRET");
  const { token } = readToken();
  const url = new URL(`${API_BASE}${pathname}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "x-api-key": `${keystring}:${sharedSecret}`,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Etsy API ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function printGet(pathname) {
  const payload = await etsyGet(pathname);
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  if (args.get("token-status")) {
    tokenStatus();
    return;
  }
  if (args.get("me")) {
    await printGet("/application/users/me");
    return;
  }
  if (args.get("get")) {
    await printGet(safeApiPath(args.get("get")));
    return;
  }
  fail("Choose --token-status, --me, or --get.");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
