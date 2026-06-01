#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

const API_BASE = process.env.PINTEREST_API_BASE || "https://api.pinterest.com/v5";
const AUTH_URL = process.env.PINTEREST_AUTH_URL || "https://www.pinterest.com/oauth/";
const CONFIG_DIR = path.join(os.homedir(), ".config", "photosbyelie");
const DEFAULT_TOKEN_FILE = path.join(CONFIG_DIR, "pinterest-token.json");
const DEFAULT_STATE_FILE = path.join(CONFIG_DIR, "pinterest-oauth-state.json");
const DEFAULT_SCOPES = [
  "boards:read",
  "pins:read",
  "pins:write",
  "user_accounts:read",
];

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
  node scripts/pinterest_oauth.mjs --auth-url
  node scripts/pinterest_oauth.mjs --exchange-code <code>
  node scripts/pinterest_oauth.mjs --refresh
  node scripts/pinterest_oauth.mjs --token-status

Environment:
  PINTEREST_CLIENT_ID       Required for --auth-url, --exchange-code, and --refresh.
  PINTEREST_CLIENT_SECRET   Required for --exchange-code and --refresh.
  PINTEREST_REDIRECT_URI    Required for --auth-url and --exchange-code.
  PINTEREST_TOKEN_FILE      Optional. Defaults to ~/.config/photosbyelie/pinterest-token.json.
  PINTEREST_SCOPES          Optional comma/space separated scopes for --auth-url.

Security:
  Tokens are saved outside the repo with 0600 permissions and are never printed.
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
  return path.resolve(env("PINTEREST_TOKEN_FILE") || DEFAULT_TOKEN_FILE);
}

function ensureConfigDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function writePrivateJson(filePath, payload) {
  ensureConfigDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function scopes() {
  const raw = String(args.get("scopes") || env("PINTEREST_SCOPES") || "").trim();
  if (!raw) return DEFAULT_SCOPES;
  return raw.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function redactedStatus(payload, filePath) {
  return {
    token_file: filePath,
    has_access_token: Boolean(payload.access_token),
    has_refresh_token: Boolean(payload.refresh_token),
    expires_in: payload.expires_in ?? null,
    refresh_token_expires_in: payload.refresh_token_expires_in ?? null,
    scope: payload.scope ?? null,
    token_type: payload.token_type ?? null,
    saved_at: payload.saved_at ?? null,
  };
}

function saveState(payload) {
  writePrivateJson(DEFAULT_STATE_FILE, payload);
}

function savedState() {
  if (!fs.existsSync(DEFAULT_STATE_FILE)) return null;
  return readJson(DEFAULT_STATE_FILE);
}

function buildAuthUrl() {
  const clientId = requiredEnv("PINTEREST_CLIENT_ID");
  const redirectUri = requiredEnv("PINTEREST_REDIRECT_URI");
  const state = randomBytes(18).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes().join(","),
    state,
  });
  saveState({
    state,
    redirect_uri: redirectUri,
    scopes: scopes(),
    created_at: new Date().toISOString(),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function basicAuthHeader() {
  const clientId = requiredEnv("PINTEREST_CLIENT_ID");
  const clientSecret = requiredEnv("PINTEREST_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function tokenRequest(fields) {
  const body = new URLSearchParams(fields);
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Pinterest OAuth ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function exchangeCode() {
  const code = String(args.get("exchange-code") || "").trim();
  if (!code) fail("--exchange-code requires the code returned by Pinterest.");
  const redirectUri = requiredEnv("PINTEREST_REDIRECT_URI");
  const stateArg = String(args.get("state") || "").trim();
  const storedState = savedState();
  if (stateArg && storedState?.state && stateArg !== storedState.state) {
    fail("Provided --state does not match the saved OAuth state.");
  }
  const payload = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    continuous_refresh: "true",
  });
  const filePath = tokenFile();
  writePrivateJson(filePath, {
    ...payload,
    saved_at: new Date().toISOString(),
  });
  console.log(JSON.stringify(redactedStatus(payload, filePath), null, 2));
}

async function refreshToken() {
  const filePath = tokenFile();
  if (!fs.existsSync(filePath)) fail(`Token file not found: ${filePath}`);
  const current = readJson(filePath);
  if (!current.refresh_token) fail("Token file does not contain a refresh_token.");
  const payload = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    scope: scopes().join(","),
  });
  writePrivateJson(filePath, {
    ...current,
    ...payload,
    saved_at: new Date().toISOString(),
  });
  console.log(JSON.stringify(redactedStatus(payload, filePath), null, 2));
}

function tokenStatus() {
  const filePath = tokenFile();
  if (!fs.existsSync(filePath)) fail(`Token file not found: ${filePath}`);
  console.log(JSON.stringify(redactedStatus(readJson(filePath), filePath), null, 2));
}

async function main() {
  if (args.get("help")) {
    console.log(usage());
    return;
  }
  if (args.get("auth-url")) {
    console.log(JSON.stringify({
      authorization_url: buildAuthUrl(),
      state_file: DEFAULT_STATE_FILE,
      scopes: scopes(),
      note: "Open authorization_url, approve Pinterest access, then run --exchange-code with the returned code. Tokens will not be printed.",
    }, null, 2));
    return;
  }
  if (args.get("exchange-code")) {
    await exchangeCode();
    return;
  }
  if (args.get("refresh")) {
    await refreshToken();
    return;
  }
  if (args.get("token-status")) {
    tokenStatus();
    return;
  }
  fail("Choose --auth-url, --exchange-code, --refresh, or --token-status.");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
