#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";

const GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION || "v1.0";
const GRAPH_BASE = process.env.THREADS_GRAPH_BASE || `https://graph.threads.net/${GRAPH_VERSION}`;
const TOKEN_BASE = process.env.THREADS_TOKEN_BASE || "https://graph.threads.net";
const AUTH_BASE = process.env.THREADS_AUTH_BASE || "https://threads.net/oauth/authorize";
const CONFIG_DIR = path.join(os.homedir(), ".config", "photosbyelie");
const DEFAULT_TOKEN_FILE = path.join(CONFIG_DIR, "threads-token.json");
const DEFAULT_STATE_FILE = path.join(CONFIG_DIR, "threads-oauth-state.json");
const DEFAULT_SCOPES = [
  "threads_basic",
  "threads_content_publish",
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
  node scripts/threads_oauth.mjs --auth-url
  node scripts/threads_oauth.mjs --exchange-code <code>
  node scripts/threads_oauth.mjs --token-status

Environment:
  THREADS_APP_ID          Required for --auth-url and --exchange-code.
  THREADS_APP_SECRET      Required for --exchange-code.
  THREADS_REDIRECT_URI    Required for --auth-url and --exchange-code.
  THREADS_TOKEN_FILE      Optional. Defaults to ~/.config/photosbyelie/threads-token.json.
  THREADS_SCOPES          Optional comma/space separated scopes for --auth-url.
  THREADS_GRAPH_VERSION   Optional. Defaults to v1.0.

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
  return path.resolve(env("THREADS_TOKEN_FILE") || DEFAULT_TOKEN_FILE);
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
  const raw = String(args.get("scopes") || env("THREADS_SCOPES") || "").trim();
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
    graph_version: payload.graph_version || GRAPH_VERSION,
    has_access_token: Boolean(payload.access_token),
    token_type: payload.token_type || null,
    expires_in: payload.expires_in ?? null,
    saved_at: payload.saved_at || null,
    scopes: payload.scopes || null,
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
  const appId = requiredEnv("THREADS_APP_ID");
  const redirectUri = requiredEnv("THREADS_REDIRECT_URI");
  const state = randomBytes(18).toString("base64url");
  const requestedScopes = scopes();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: requestedScopes.join(","),
  });
  saveState({
    state,
    redirect_uri: redirectUri,
    scopes: requestedScopes,
    graph_version: GRAPH_VERSION,
    created_at: new Date().toISOString(),
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

async function tokenGet(pathname, params) {
  const url = new URL(`${TOKEN_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Threads OAuth ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function tokenPostForm(pathname, body) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) form.set(key, value);
  const response = await fetch(`${TOKEN_BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Threads OAuth ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function exchangeCode() {
  const code = String(args.get("exchange-code") || "").trim();
  if (!code) fail("--exchange-code requires the code returned by Threads.");
  const appId = requiredEnv("THREADS_APP_ID");
  const appSecret = requiredEnv("THREADS_APP_SECRET");
  const redirectUri = requiredEnv("THREADS_REDIRECT_URI");
  const stateArg = String(args.get("state") || "").trim();
  const storedState = savedState();
  if (stateArg && storedState?.state && stateArg !== storedState.state) {
    fail("Provided --state does not match the saved OAuth state.");
  }

  const shortLived = await tokenPostForm("/oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const longLived = await tokenGet("/access_token", {
    grant_type: "th_exchange_token",
    client_secret: appSecret,
    access_token: shortLived.access_token,
  }).catch(() => shortLived);

  const filePath = tokenFile();
  const payload = {
    ...longLived,
    graph_version: GRAPH_VERSION,
    scopes: storedState?.scopes || scopes(),
    saved_at: new Date().toISOString(),
  };
  writePrivateJson(filePath, payload);
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
      graph_version: GRAPH_VERSION,
      note: "Open authorization_url, approve Threads access, then run --exchange-code with the returned code. Tokens will not be printed.",
    }, null, 2));
    return;
  }
  if (args.get("exchange-code")) {
    await exchangeCode();
    return;
  }
  if (args.get("token-status")) {
    tokenStatus();
    return;
  }
  fail("Choose --auth-url, --exchange-code, or --token-status.");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
