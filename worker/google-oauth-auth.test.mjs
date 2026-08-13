import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleOAuthAuth } from "./google-oauth-auth.mjs";

const loginRequest = (url = "https://auth.photos-by-elie.com/auth/google/login") => new Request(url);

const authOptions = (overrides = {}) => ({
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  sessionSecret: "google-session-secret",
  fetcher: async () => new Response(JSON.stringify({ id_token: "id-token" }), {
    headers: { "content-type": "application/json" },
  }),
  verifyIdToken: async () => ({ email: "Buyer@Example.com" }),
  ...overrides,
});

test("Google OAuth always requests the account picker", async () => {
  const auth = createGoogleOAuthAuth(authOptions());
  const url = new URL(await auth.loginUrlFor(loginRequest(), {
    prompt: "none",
    returnTo: "https://photos-by-elie.com/account.html",
  }));

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
  const state = new URL(await auth.loginUrlFor(loginRequest())).searchParams.get("state");
  const callback = new Request(`https://auth.photos-by-elie.com/auth/google/callback?code=one-time-code&state=${encodeURIComponent(state)}`);
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
  const state = new URL(await auth.loginUrlFor(loginRequest())).searchParams.get("state");

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
