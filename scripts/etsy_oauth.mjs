#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash, randomBytes } from "node:crypto";

const API_BASE = process.env.ETSY_API_BASE || "https://api.etsy.com/v3/public";
const AUTH_URL = process.env.ETSY_AUTH_URL || "https://www.etsy.com/oauth/connect";
const CONFIG_DIR = path.join(os.homedir(), ".config", "photosbyelie");
const DEFAULT_TOKEN_FILE = path.join(CONFIG_DIR, "etsy-token.json");
const DEFAULT_STATE_FILE = path.join(CONFIG_DIR, "etsy-oauth-state.json");
const DEFAULT_REDIRECT_URI = "https://photos-by-elie.com/etsy-callback.html";
const DEFAULT_SCOPES = [
  "shops_r",
  "listings_r",
  "listings_w",
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
  node scripts/etsy_oauth.mjs --auth-url
  node scripts/etsy_oauth.mjs --exchange-code <code>
  node scripts/etsy_oauth.mjs --refresh
  node scripts/etsy_oauth.mjs --token-status

Environment:
  ETSY_KEYSTRING       Required for --auth-url, --exchange-code, and --refresh.
  ETSY_REDIRECT_URI    Optional. Defaults to ${DEFAULT_REDIRECT_URI}.
  ETSY_TOKEN_FILE      Optional. Defaults to ~/.config/photosbyelie/etsy-token.json.
  ETSY_SCOPES          Optional comma/space separated scopes for --auth-url.

Security:
  Tokens and PKCE state are saved outside the repo with 0600 permissions and are never printed.
  Keep the Etsy keystring/shared secret outside git; this script only needs the keystring for OAuth.
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

function stateFile() {
  return path.resolve(env("ETSY_STATE_FILE") || DEFAULT_STATE_FILE);
}

function redirectUri() {
  return String(args.get("redirect-uri") || env("ETSY_REDIRECT_URI") || DEFAULT_REDIRECT_URI).trim();
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
  const raw = String(args.get("scopes") || env("ETSY_SCOPES") || "").trim();
  if (!raw) return DEFAULT_SCOPES;
  return raw.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) fail(`${name} is required.`);
  return value;
}

function savedState() {
  const filePath = stateFile();
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function saveState(payload) {
  writePrivateJson(stateFile(), payload);
}

function codeChallenge(codeVerifier) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function tokenExpiry(payload) {
  const expiresIn = Number(payload.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function redactedStatus(payload, filePath) {
  return {
    token_file: filePath,
    has_access_token: Boolean(payload.access_token),
    has_refresh_token: Boolean(payload.refresh_token),
    token_type: payload.token_type || null,
    expires_in: payload.expires_in ?? null,
    expires_at: payload.expires_at || null,
    saved_at: payload.saved_at || null,
    scopes: payload.scopes || payload.scope || null,
  };
}

function buildAuthUrl() {
  const keystring = requiredEnv("ETSY_KEYSTRING");
  const state = randomBytes(18).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const requestedScopes = scopes();
  const uri = redirectUri();
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: uri,
    scope: requestedScopes.join(" "),
    client_id: keystring,
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
  });
  saveState({
    state,
    code_verifier: verifier,
    redirect_uri: uri,
    scopes: requestedScopes,
    created_at: new Date().toISOString(),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(fields) {
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Etsy OAuth ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function exchangeCode() {
  const code = String(args.get("exchange-code") || "").trim();
  if (!code) fail("--exchange-code requires the code returned by Etsy.");
  const stateArg = String(args.get("state") || "").trim();
  const storedState = savedState();
  if (!storedState?.code_verifier) fail(`Saved OAuth state not found: ${stateFile()}`);
  if (stateArg && storedState?.state && stateArg !== storedState.state) {
    fail("Provided --state does not match the saved OAuth state.");
  }
  const payload = await tokenRequest({
    grant_type: "authorization_code",
    client_id: requiredEnv("ETSY_KEYSTRING"),
    redirect_uri: storedState.redirect_uri || redirectUri(),
    code,
    code_verifier: storedState.code_verifier,
  });
  const filePath = tokenFile();
  const saved = {
    ...payload,
    scopes: storedState.scopes || scopes(),
    saved_at: new Date().toISOString(),
    expires_at: tokenExpiry(payload),
  };
  writePrivateJson(filePath, saved);
  console.log(JSON.stringify(redactedStatus(saved, filePath), null, 2));
}

async function refreshToken() {
  const filePath = tokenFile();
  if (!fs.existsSync(filePath)) fail(`Token file not found: ${filePath}`);
  const current = readJson(filePath);
  if (!current.refresh_token) fail("Token file does not contain a refresh_token.");
  const payload = await tokenRequest({
    grant_type: "refresh_token",
    client_id: requiredEnv("ETSY_KEYSTRING"),
    refresh_token: current.refresh_token,
  });
  const saved = {
    ...current,
    ...payload,
    saved_at: new Date().toISOString(),
    expires_at: tokenExpiry(payload),
  };
  writePrivateJson(filePath, saved);
  console.log(JSON.stringify(redactedStatus(saved, filePath), null, 2));
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
      state_file: stateFile(),
      redirect_uri: redirectUri(),
      scopes: scopes(),
      note: "Open authorization_url, approve Etsy access, then run --exchange-code with the returned code. Tokens will not be printed.",
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
