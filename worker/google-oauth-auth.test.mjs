import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleOAuthAuth } from "./google-oauth-auth.mjs";

import { createMemoryGoogleOAuthTransactionStore } from "./google-oauth-transaction-store.mjs";

const loginRequest = (url = "https://auth.photos-by-elie.com/auth/google/login") => new Request(url);

const authOptions = (overrides = {}) => ({
  transactionStore: createMemoryGoogleOAuthTransactionStore(),
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  sessionSecret: "google-session-secret",
  fetcher: async () => new Response(JSON.stringify({ id_token: "id-token" }), {
    headers: { "content-type": "application/json" },
  }),
  verifyIdToken: async (_token, { nonce }) => ({ email: "Buyer@Example.com", nonce }),
  ...overrides,
});

test("Google OAuth always requests the account picker", async () => {
  const auth = createGoogleOAuthAuth(authOptions());
  const url = new URL((await auth.beginLogin(loginRequest(), {
    prompt: "none",
    returnTo: "https://photos-by-elie.com/account.html",
  })).url);

  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("redirect_uri"), "https://auth.photos-by-elie.com/auth/google/callback");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.ok(url.searchParams.get("state"));
});

test("Google OAuth callback exchanges a code and produces a signed session cookie", async () => {
  let tokenExchange;
  const auth = createGoogleOAuthAuth(authOptions({
    fetcher: async (url, options) => {
      tokenExchange = { url, options };
      return new Response(JSON.stringify({ id_token: "id-token" }), {
        headers: { "content-type": "application/json" },
      });
    },
  }));
  const login = await auth.beginLogin(loginRequest());
  const state = new URL(login.url).searchParams.get("state");
  const callback = new Request(`https://auth.photos-by-elie.com/auth/google/callback?code=one-time-code&state=${encodeURIComponent(state)}`, { headers: { cookie: login.cookie.split(";")[0] } });
  const result = await auth.handleCallback(callback);

  assert.equal(tokenExchange.url, "https://oauth2.googleapis.com/token");
  assert.equal(tokenExchange.options.method, "POST");
  assert.match(result.cookie, /^pbe_google_session=/);
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /SameSite=None/);
  assert.match(result.cookie, /Secure/);
  assert.equal(result.identity.email, "Buyer@Example.com");

  const session = await auth.optionalSession(new Request("https://auth.photos-by-elie.com/auth/session", {
    headers: { cookie: result.cookie.split(";")[0] },
  }));
  assert.equal(session.email, "buyer@example.com");
  assert.equal(session.provider, "google-oauth");
});

test("Google OAuth rejects callback state from another origin and expired state", async () => {
  let currentNow = new Date("2026-08-02T12:00:00.000Z");
  const auth = createGoogleOAuthAuth(authOptions({
    stateSeconds: 60,
    now: () => currentNow,
  }));
  const login = await auth.beginLogin(loginRequest());
  const state = new URL(login.url).searchParams.get("state");

  await assert.rejects(
    () => auth.handleCallback(new Request(`https://download.photos-by-elie.com/auth/google/callback?code=code&state=${encodeURIComponent(state)}`)),
    (error) => error.code === "google_oauth_state_mismatch" && error.status === 401,
  );

  currentNow = new Date("2026-08-02T12:01:01.000Z");
  await assert.rejects(
    () => auth.handleCallback(new Request(`https://auth.photos-by-elie.com/auth/google/callback?code=code&state=${encodeURIComponent(state)}`)),
    (error) => error.code === "google_oauth_state_expired" && error.status === 401,
  );
});

test("signed non-browser sessions preserve trusted purpose and fixture claims", async () => {
  const auth = createGoogleOAuthAuth(authOptions());
  const token = await auth.issueSessionToken({
    email: "ec92009@gmail.com",
    provider: "backstage-device",
    purpose: "pbe-owner-session",
    deviceId: "owner-device-max",
    sessionId: "pbe-session-one",
    fixtureId: "fixture-la-concha",
    fixtureBreadcrumb: "RE › La Concha",
    sourceIdentity: "owner-sqlite:abc",
    catalogIdentity: "catalog-sqlite:def",
    capabilities: ["gallery.read", "waste-basket.x"],
  }, 300);

  const session = await auth.optionalSession(new Request("https://auth.photos-by-elie.com/api/v1/pbe-owner/session", {
    headers: { authorization: `Bearer ${token}` },
  }));
  assert.equal(session.provider, "backstage-device");
  assert.equal(session.purpose, "pbe-owner-session");
  assert.equal(session.deviceId, "owner-device-max");
  assert.equal(session.sessionId, "pbe-session-one");
  assert.equal(session.fixtureId, "fixture-la-concha");
  assert.deepEqual(session.capabilities, ["gallery.read", "waste-basket.x"]);
});

const callbackFor = (login, cookie = login.cookie.split(";")[0], suffix = "code=one-time-code") => {
  const state = new URL(login.url).searchParams.get("state");
  return new Request(`https://auth.photos-by-elie.com/auth/google/callback?${suffix}&state=${encodeURIComponent(state)}`, { headers: { cookie } });
};

test("transferred, duplicate and malformed browser cookies fail before token exchange", async () => {
  let exchanges = 0;
  const auth = createGoogleOAuthAuth(authOptions({ fetcher: async () => {
    exchanges++;
    return Response.json({ id_token: "id-token" });
  } }));
  const a = await auth.beginLogin(loginRequest());
  const b = await auth.beginLogin(loginRequest());
  for (const cookie of ["", b.cookie.split(";")[0], a.cookie.split(";")[0] + "; " + a.cookie.split(";")[0], "__Host-pbe_google_transaction=%ZZ"]) {
    await assert.rejects(() => auth.handleCallback(callbackFor(a, cookie)), { code: "google_oauth_browser_mismatch" });
  }
  assert.equal(exchanges, 0);
  const outcomes = await Promise.allSettled([auth.handleCallback(callbackFor(a)), auth.handleCallback(callbackFor(a))]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(exchanges, 1);
  await assert.rejects(() => auth.handleCallback(callbackFor(a)), { code: "google_oauth_transaction_used" });
  assert.equal(exchanges, 1);
});

test("PKCE verifier stays out of URLs and logout or denied callbacks consume the transaction", async () => {
  let observedVerifier;
  const auth = createGoogleOAuthAuth(authOptions({ fetcher: async (_url, options) => {
    observedVerifier = new URLSearchParams(options.body).get("code_verifier");
    return Response.json({ id_token: "id-token" });
  } }));
  const login = await auth.beginLogin(loginRequest());
  const verifier = login.cookie.split(";")[0].split("=")[1];
  const url = new URL(login.url);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.href.includes(verifier), false);
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  const state = JSON.parse(Buffer.from(url.searchParams.get("state").split(".")[0], "base64url"));
  assert.equal(JSON.stringify(state).includes(verifier), false);
  assert.equal(state.nonce, url.searchParams.get("nonce"));
  await auth.handleCallback(callbackFor(login));
  assert.equal(observedVerifier, verifier);
  const cancelled = await auth.beginLogin(loginRequest());
  await auth.cancelLogin(callbackFor(cancelled));
  await assert.rejects(() => auth.handleCallback(callbackFor(cancelled)), { code: "google_oauth_transaction_used" });
  const denied = await auth.beginLogin(loginRequest());
  await assert.rejects(() => auth.handleCallback(callbackFor(denied, undefined, "error=access_denied")), { code: "google_oauth_denied" });
  await assert.rejects(() => auth.handleCallback(callbackFor(denied)), { code: "google_oauth_transaction_used" });
});

test("production RS256 verifier rejects missing or mismatched nonce and accepts the bound identity", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "fixture-key", alg: "RS256" };
  const jwt = async nonce => {
    const claims = { iss: "https://accounts.google.com", aud: "google-client-id", exp: Math.floor(Date.now()/1000)+3600, email: "buyer@example.com", email_verified: true, ...(nonce === undefined ? {} : { nonce }) };
    const prefix = [Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url")].join(".");
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(prefix));
    return prefix + "." + Buffer.from(signature).toString("base64url");
  };
  for (const variant of ["missing", "wrong", "matching"]) {
    let idToken;
    const auth = createGoogleOAuthAuth(authOptions({ verifyIdToken: null, fetcher: async url => Response.json(String(url).includes("certs") ? { keys: [jwk] } : { id_token: idToken }) }));
    const login = await auth.beginLogin(loginRequest());
    idToken = await jwt(variant === "matching" ? new URL(login.url).searchParams.get("nonce") : variant === "wrong" ? "foreign-nonce" : undefined);
    if (variant === "matching") assert.equal((await auth.handleCallback(callbackFor(login))).identity.email, "buyer@example.com");
    else await assert.rejects(() => auth.handleCallback(callbackFor(login)), { code: "google_oauth_nonce_mismatch" });
  }
});

test("D1 transaction consumption persists across auth instances and is atomic", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { createD1GoogleOAuthTransactionStore } = await import("./google-oauth-transaction-store.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0015_google_oauth_transactions.sql", import.meta.url), "utf8"));
  const database = { prepare(sql) { return { bind(...args) { return { async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; } }; } }; } };
  let exchanges = 0;
  const makeAuth = () => createGoogleOAuthAuth(authOptions({ transactionStore: createD1GoogleOAuthTransactionStore({ database }), fetcher: async () => { exchanges++; return Response.json({ id_token: "id-token" }); } }));
  try {
    const login = await makeAuth().beginLogin(loginRequest());
    const results = await Promise.allSettled([makeAuth().handleCallback(callbackFor(login)), makeAuth().handleCallback(callbackFor(login))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(exchanges, 1);
    await assert.rejects(() => makeAuth().handleCallback(callbackFor(login)), { code: "google_oauth_transaction_used" });
    const next = await makeAuth().beginLogin(loginRequest());
    await makeAuth().cancelLogin(callbackFor(next));
    await assert.rejects(() => makeAuth().handleCallback(callbackFor(next)), { code: "google_oauth_transaction_used" });
  } finally { db.close(); }
});
