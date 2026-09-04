import assert from "node:assert/strict";
import fs from "node:fs";
import jpeg from "jpeg-js";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import catalogTsv from "../scripts/catalog_tsv.cjs";
import { createMemoryAccessUserRegistry } from "./access-user-registry.mjs";
import { createAnalyticsStore } from "./analytics-store.mjs";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createCloudflareMediaVideoTranscoder } from "./cloudflare-media-video-transcoder.mjs";
import deployedWorker, { realEstateGalleriesFor } from "./deployed-worker.mjs";
import { createGoogleOAuthAuth } from "./google-oauth-auth.mjs";
import { createLocalZipDelivery } from "./local-zip-delivery.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createOwnerAccessAuth } from "./owner-access-auth.mjs";
import { createKvOwnerActionStore, createMemoryOwnerActionStore } from "./owner-action-store.mjs";
import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";
import { NON_REVOCABLE_PUBLIC_ASSET_KEYS } from "./non-revocable-public-assets.mjs";
import {
  createKvOwnerDeviceAuthStore,
  createMemoryOwnerDeviceAuthStore,
} from "./owner-device-auth-store.mjs";
import {
  createD1OwnerEnrollmentHandoffStore,
  createMemoryOwnerEnrollmentHandoffStore,
} from "./owner-enrollment-handoff-store.mjs";
import {
  REAL_ESTATE_PASSWORD_ITERATIONS,
  createRealEstateAuth,
  realEstatePasswordHash,
} from "./real-estate-auth.mjs";
import { createRealEstateDeliverables } from "./real-estate-deliverables.mjs";
import { createRealEstateOriginals } from "./real-estate-originals.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
import { createD1SidecarStateStore } from "./sidecar-state-store.mjs";
import { createStripeClient, createStripeWebhookSignature } from "./stripe-client.mjs";

const loadCatalog = () => {
  const catalogWindow = catalogTsv.loadCatalogWindow(new URL("..", import.meta.url).pathname);
  return createCatalogIndex({
    collections: catalogWindow.photosByElieData,
    resolutions: catalogWindow.photosByElieResolutions,
    frameOptions: catalogWindow.photosByElieFrameOptions,
    videoPriceTiers: catalogWindow.photosByElieVideoPriceTiers,
    storefrontPolicy: catalogWindow.photosByElieStorefrontPolicy,
  });
};

const deterministicIds = () => {
  let count = 0;
  return () => {
    count += 1;
    return `${String(count).padStart(12, "0")}-aaaa-bbbb-cccc-${String(count).padStart(12, "0")}`;
  };
};

const jsonRequest = (url, body, headers = {}) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const allowLifecycleFor = (deniedIds = []) => {
  const denied = new Set(deniedIds);
  return {
    ensureSchema: async () => ({ state: "ready" }),
    visibilityFor: async (ids) => ids.map((id) => ({ canonicalMediaId: id, visible: !denied.has(id), revision: 0 })),
    assertAllowed: async (ids) => {
      const blocked = ids.filter((id) => denied.has(id));
      if (blocked.length) throw Object.assign(new Error("One or more assets are unavailable."), {
        status: 410, code: "asset_lifecycle_denied", details: { mediaIds: blocked },
      });
      return true;
    },
  };
};

class TestD1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new TestD1Statement(this.database, this.sql, values); }
  first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values) }; }
  run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
}

class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(fs.readFileSync(new URL("../migrations/0012_lifecycle_deny_plane.sql", import.meta.url), "utf8"));
    this.sqlite.exec(fs.readFileSync(new URL("../migrations/0014_owner_enrollment_handoffs.sql", import.meta.url), "utf8"));
  }
  prepare(sql) { return new TestD1Statement(this.sqlite, sql); }
  batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const readyLifecycleD1 = async (mediaIds, bindings = new Map()) => {
  const database = new TestD1();
  const store = createD1LifecycleDenyStore({ database });
  const members = [...new Set(mediaIds)].map((id) => ({
    canonicalAssetId: `asset:${id}`,
    canonicalMediaId: id,
    bindings: bindings.get(id) || [{ bucket: "public", objectKey: `test/${id}.jpg` }],
  }));
  for (let index = 0; index < members.length; index += 100) {
    await store.seedVisibleBatch({ seedId: `test-seed-${index / 100}`, items: members.slice(index, index + 100) });
  }
  await store.activate({ activationId: "test-activation", ...await summarizeLifecycleManifest(members) });
  return database;
};

const denyLifecycleMedia = async (database, mediaId, bindings) => {
  const store = createD1LifecycleDenyStore({ database });
  const arm = await store.armBatch({
    operationId: `deny:${mediaId}`,
    operation: "x",
    denied: true,
    items: [{ canonicalAssetId: `asset:${mediaId}`, canonicalMediaId: mediaId, bindings }],
  });
  await store.markLocallyCommitted(arm);
  await store.applyBatch({
    ...arm,
    receipts: [{
      receiptId: `receipt:${mediaId}`,
      canonicalAssetId: `asset:${mediaId}`,
      canonicalMediaId: mediaId,
      revision: arm.revision,
      denied: true,
      lifecycleState: "recoverable",
    }],
  });
};

const realEstateSessionCookie = async (worker, galleryKey = "corine-real-estate") => {
  const response = await worker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    galleryKey,
    username: "Corine",
    accessCode: "LaConcha",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") || "", /^pbe_re_session=/);
  return (response.headers.get("set-cookie") || "").split(";")[0];
};

const testWorker = () => {
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe,
    now,
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });
  return { worker, stripe, store };
};

const fakeAccessAuthFor = (email) => ({
  optionalSession: async () => email ? {
    email,
    provider: "cloudflare-access",
    expiresAt: "2026-05-17T14:00:00.000Z",
    sessionSeconds: 7200,
  } : null,
  requireSession: async () => {
    if (!email) throw Object.assign(new Error("Access login is required."), { status: 401, code: "access_login_required" });
    return {
      email,
      provider: "cloudflare-access",
      expiresAt: "2026-05-17T14:00:00.000Z",
      sessionSeconds: 7200,
    };
  },
  logoutUrlFor: (baseUrl) => `${baseUrl}/cdn-cgi/access/logout`,
});

const backstageOwnerFixture = (email = "owner@example.com") => {
  const sessionToken = "synthetic-short-lived-backstage-session";
  const deviceId = "owner-device-synthetic-mac";
  const identity = {
    email,
    provider: "backstage-device",
    purpose: "backstage-api",
    deviceId,
    expiresAt: "2026-08-12T13:00:00.000Z",
    sessionSeconds: 900,
  };
  const requireSession = async (request) => {
    if (request.headers.get("authorization") === `Bearer ${sessionToken}`) return identity;
    throw Object.assign(new Error("Backstage session required."), {
      status: 401,
      code: "google_auth_required",
    });
  };
  return {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      origin: "https://photos-by-elie.com",
    },
    googleOAuthAuth: {
      optionalSession: async (request) => (
        request.headers.get("authorization") === `Bearer ${sessionToken}` ? identity : null
      ),
      requireSession,
    },
    ownerDeviceAuthStore: {
      getDevice: async (requestedDeviceId) => requestedDeviceId === deviceId ? {
        id: deviceId,
        email,
        name: "Synthetic Mac Backstage",
        platform: "macOS",
        revokedAt: "",
      } : null,
    },
  };
};

test("deployed Worker derives an Agnes Common-only gallery without a static password", () => {
  const galleries = realEstateGalleriesFor({
    REAL_ESTATE_GALLERIES_JSON: JSON.stringify({
      galleries: [{
        key: "Corine-gallery",
        username: "Corine",
        accessCode: "legacy-corine-password",
        privateMasterPrefix: "RE/Corine/masters",
      }],
    }),
  });
  const agnes = galleries.find((gallery) => gallery.key === "agnes-la-concha-common");
  assert.equal(galleries.length, 2);
  assert.equal(agnes.username, "Agnes");
  assert.equal(agnes.customer, "Agnes");
  assert.equal(agnes.propertyTitle, "La Concha / Common");
  assert.equal(agnes.maxItems, 14);
  assert.equal(agnes.privateMasterPrefix, "RE/Corine/masters");
  assert.equal(agnes.accessCode, "");
  assert.equal(agnes.accessCodeHash, "");
  const corine = galleries.find((gallery) => gallery.key === "Corine-gallery");
  assert.equal(corine.privateMasterPrefix, "masters");
  assert.equal(corine.privateMasterLayout, "flat");
  assert.equal(corine.allowedPhotoIds.length, 121);
});

test("Access logout targets the team-domain session cookie when configured", () => {
  const auth = createOwnerAccessAuth({ teamName: "byelie", audience: "aud" });
  const logoutUrl = new URL(auth.logoutUrlFor("https://auth.photos-by-elie.com", {
    returnTo: "https://photos-by-elie.com/?account=1",
  }));
  assert.equal(logoutUrl.origin, "https://byelie.cloudflareaccess.com");
  assert.equal(logoutUrl.pathname, "/cdn-cgi/access/logout");
  assert.equal(logoutUrl.searchParams.get("redirect_url"), "https://photos-by-elie.com/?account=1");
});

test("Google OAuth auth requests account choice and stores a signed session cookie", async () => {
  const now = () => new Date("2026-06-21T12:00:00.000Z");
  let tokenExchangeSeen = false;
  const auth = createGoogleOAuthAuth({
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    sessionSecret: "google-session-secret",
    now,
    fetcher: async (url, init = {}) => {
      tokenExchangeSeen = true;
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("code"), "oauth-code");
      assert.equal(body.get("redirect_uri"), "https://worker.test/auth/google/callback");
      return new Response(JSON.stringify({ id_token: "verified-id-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    verifyIdToken: async (idToken, context) => {
      assert.equal(idToken, "verified-id-token");
      assert.equal(context.clientId, "google-client-id");
      return {
        email: "ec92009@gmail.com",
        provider: "google-oauth",
        expiresAt: "2026-06-21T13:00:00.000Z",
        sessionSeconds: 3600,
      };
    },
  });

  const loginUrl = new URL(await auth.loginUrlFor(new Request("https://worker.test/auth/google/login"), {
    returnTo: "https://photos-by-elie.com/?account=1",
    intent: "signin",
  }));
  assert.equal(loginUrl.origin, "https://accounts.google.com");
  assert.equal(loginUrl.pathname, "/o/oauth2/v2/auth");
  assert.equal(loginUrl.searchParams.get("client_id"), "google-client-id");
  assert.equal(loginUrl.searchParams.get("redirect_uri"), "https://worker.test/auth/google/callback");
  assert.equal(loginUrl.searchParams.get("response_type"), "code");
  assert.equal(loginUrl.searchParams.get("scope"), "openid email profile");
  assert.equal(loginUrl.searchParams.get("prompt"), "select_account");

  const callback = await auth.handleCallback(new Request(
    `https://worker.test/auth/google/callback?code=oauth-code&state=${encodeURIComponent(loginUrl.searchParams.get("state"))}`
  ));
  assert.equal(tokenExchangeSeen, true);
  assert.equal(callback.returnTo, "https://photos-by-elie.com/?account=1");
  assert.match(callback.cookie, /^pbe_google_session=/);
  assert.match(callback.sessionToken, /^[^.]+\.[^.]+$/);
  assert.match(callback.cookie, /HttpOnly/);
  assert.match(callback.cookie, /SameSite=None/);
  assert.match(callback.cookie, /Secure/);

  const cookie = callback.cookie.split(";")[0];
  const session = await auth.optionalSession(new Request("https://worker.test/auth/session", {
    headers: { cookie },
  }));
  assert.equal(session.email, "ec92009@gmail.com");
  assert.equal(session.provider, "google-oauth");

  const bearerSession = await auth.optionalSession(new Request("https://worker.test/auth/session", {
    headers: { authorization: `Bearer ${callback.sessionToken}` },
  }));
  assert.equal(bearerSession.email, "ec92009@gmail.com");
  assert.equal(bearerSession.provider, "google-oauth");

  const shortAccessToken = await auth.issueSessionToken(
    { email: "ec92009@gmail.com" },
    15 * 60
  );
  const shortAccessSession = await auth.optionalSession(new Request("https://worker.test/auth/session", {
    headers: { authorization: `Bearer ${shortAccessToken}` },
  }));
  assert.equal(shortAccessSession.email, "ec92009@gmail.com");
  assert.equal(shortAccessSession.sessionSeconds, 15 * 60);
});

const firstDeliverablePhotoId = (catalog, collectionKey = null) => {
  for (const [photoId, entry] of catalog.photos.entries()) {
    if (collectionKey && entry.collectionKey !== collectionKey) continue;
    const options = catalog.availableOptionsFor(entry.photo).map((option) => option.id);
    if (entry.photo.sourceFiles?.length && options.includes("full") && options.includes("jpg-3mp")) {
      return photoId;
    }
  }
  throw new Error("Could not find a deliverable test photo.");
};

const sourcePathForPhoto = (catalog, photoId) => catalog.photos.get(photoId).photo.sourceFiles[0].path;

const orderProductTotal = (orderItem) => (orderItem.products || [])
  .reduce((sum, product) => sum + Number(product.amount || 0), 0);

const catalogOptionCents = (catalog, photoId, optionId) => {
  const entry = catalog.photos.get(photoId);
  const option = catalog.options.get(optionId);
  const origin = String(entry?.photo?.sourceOrigin || entry?.photo?.origin || "").toLowerCase();
  const tier = origin === "ai" || entry?.collectionKey === "ai" ? "ai" : "original";
  return Math.round((Number(option?.prices?.[tier] ?? option?.price ?? 0)) * 100);
};

const createFakeKv = () => {
  const values = new Map();
  return {
    get: async (key, options = {}) => {
      const value = values.get(key) ?? null;
      if (value == null) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    put: async (key, value) => {
      values.set(key, String(value));
    },
    delete: async (key) => {
      values.delete(key);
    },
    list: async ({ prefix = "", limit = 1000, cursor = "" } = {}) => {
      const keys = [...values.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort((left, right) => left.localeCompare(right));
      const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
      const page = keys.slice(start, start + limit);
      const next = start + page.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: next >= keys.length,
        cursor: next < keys.length ? String(next) : undefined,
      };
    },
    _debug: values,
  };
};

test("KV owner device store revokes its durable device credential", async () => {
  const now = () => new Date("2026-07-25T12:00:00.000Z");
  const store = createKvOwnerDeviceAuthStore({
    namespace: createFakeKv(),
    prefix: "test",
    now,
  });
  const device = await store.putDevice({
    id: "device-max",
    email: "Owner@Example.com",
    name: "Max Backstage",
    createdAt: now().toISOString(),
  }, "device-secret");
  assert.equal(device.email, "owner@example.com");
  assert.match(device.credentialSalt, /^[a-f0-9]{32}$/);
  assert.match(device.credentialHash, /^[a-f0-9]{64}$/);
  assert.notEqual(device.credentialHash, "device-secret");
  assert.ok(await store.authenticateDevice({
    deviceId: device.id,
    credential: "device-secret",
  }));

  await store.revokeDevice({
    email: "OWNER@example.com",
    deviceId: device.id,
    revokedAt: "2026-07-25T12:01:00.000Z",
  });
  assert.equal(await store.authenticateDevice({
    deviceId: device.id,
    credential: "device-secret",
  }), null);
});

test("analytics endpoint stores sanitized public funnel events with credentialed origin CORS", async () => {
  const kv = createFakeKv();
  const analytics = createAnalyticsStore({
    namespace: kv,
    prefix: "test",
    now: () => new Date("2026-05-07T12:00:00.000Z"),
  });
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    analytics,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/analytics/events", {
    events: [{
      event: "page_view",
      sessionId: "tab-session-1",
      path: "/photo.html?id=secret#section",
      pageType: "photo",
      photoId: "photo-1",
      email: "buyer@example.com",
      orderId: "PBE-SECRET",
      userAgent: "browser",
    }],
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://photos-by-elie.com");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });

  const eventKey = [...kv._debug.keys()].find((key) => key.startsWith("test:analytics:events:2026-05-07:"));
  assert.ok(eventKey);
  const event = JSON.parse(kv._debug.get(eventKey));
  assert.equal(event.event, "page_view");
  assert.equal(event.path, "/photo.html");
  assert.equal(event.photoId, "photo-1");
  assert.equal(event.email, undefined);
  assert.equal(event.orderId, undefined);
  assert.equal(event.userAgent, undefined);

  const count = JSON.parse(kv._debug.get("test:analytics:counts:2026-05-07:page_view"));
  assert.equal(count.count, 1);
});

test("analytics credentialed CORS allows trusted preflight and rejects untrusted origins", async () => {
  const worker = createPhotosByElieWorker({ catalog: loadCatalog() });
  const preflight = await worker.fetch(new Request("https://worker.test/analytics/events", {
    method: "OPTIONS",
    headers: {
      origin: "https://photos-by-elie.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://photos-by-elie.com");
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.equal(preflight.headers.get("vary"), "Origin");

  const denied = await worker.fetch(jsonRequest("https://worker.test/analytics/events", {
    events: [{ event: "page_view", path: "/" }],
  }, { origin: "https://example.invalid" }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), "null");
  assert.equal((await denied.json()).error.code, "cors_origin_forbidden");
});

test("KV owner action store lists newest actions through its time index", async () => {
  const kv = createFakeKv();
  const store = createKvOwnerActionStore({ namespace: kv, prefix: "test" });

  for (let index = 0; index < 12; index += 1) {
    await store.putAction({
      id: `000-old-${String(index).padStart(2, "0")}`,
      type: "import-operation",
      state: "queued",
      createdAt: `2026-05-17T12:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
  await store.putAction({
    id: "zzz-newest",
    type: "track-b-cloud-shell-check",
    state: "queued",
    createdAt: "2026-05-17T12:30:00.000Z",
  });

  const actions = await store.listActions({ limit: 1 });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, "zzz-newest");
  assert.deepEqual(JSON.parse(kv._debug.get("test:owner-action-head")).ids.slice(0, 2), [
    "zzz-newest",
    "000-old-11",
  ]);
});

test("KV owner action store keeps a cheap pending-action index", async () => {
  const kv = createFakeKv();
  const store = createKvOwnerActionStore({ namespace: kv, prefix: "test" });

  await store.putAction({
    id: "queued-action",
    type: "sidecar-culling-review",
    state: "queued",
    createdAt: "2026-05-17T12:00:00.000Z",
  });
  await store.putAction({
    id: "completed-action",
    type: "sidecar-culling-review",
    state: "completed",
    createdAt: "2026-05-17T12:01:00.000Z",
  });

  assert.deepEqual(JSON.parse(kv._debug.get("test:owner-action-pending:queued-action")), { id: "queued-action" });
  assert.deepEqual((await store.listPendingActions()).map((action) => action.id), ["queued-action"]);

  await store.putAction({
    id: "queued-action",
    type: "sidecar-culling-review",
    state: "completed",
    createdAt: "2026-05-17T12:00:00.000Z",
    updatedAt: "2026-05-17T12:02:00.000Z",
  });
  assert.equal(kv._debug.has("test:owner-action-pending:queued-action"), false);
  assert.deepEqual(await store.listPendingActions(), []);
});

test("Owner action stores replay idempotent actions", async () => {
  for (const store of [
    createMemoryOwnerActionStore(),
    createKvOwnerActionStore({ namespace: createFakeKv(), prefix: "test" }),
  ]) {
    const action = await store.putAction({
      id: "action-idempotent",
      type: "fixture-operation",
      state: "queued",
      createdAt: "2026-05-17T12:00:00.000Z",
    });
    assert.equal(await store.getIdempotentAction("fixture-create-20260725"), null);
    assert.equal(
      (await store.putIdempotentAction("fixture-create-20260725", action.id)).id,
      action.id
    );
    assert.equal(
      (await store.getIdempotentAction("fixture-create-20260725")).id,
      action.id
    );
  }
});

test("auth session treats configured Google admin as admin and owner", async () => {
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("ec92009@gmail.com"),
    accessAdminEmail: "ec92009@gmail.com",
  });

  const response = await worker.fetch(new Request("https://worker.test/auth/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.email, "ec92009@gmail.com");
  assert.equal(body.tier, "admin");
  assert.equal(body.admin, true);
  assert.deepEqual(body.roles, ["user", "owner", "admin"]);

  const ownerResponse = await worker.fetch(new Request("https://worker.test/owner/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(ownerResponse.status, 200);
  const ownerBody = await ownerResponse.json();
  assert.equal(ownerBody.admin, true);
  assert.equal(ownerBody.roles.includes("owner"), true);

  const logoutResponse = await worker.fetch(new Request("https://worker.test/auth/logout", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.get("location"), "https://worker.test/cdn-cgi/access/logout");
});

test("auth session reads Owner and Real Estate client tiers from the user registry", async () => {
  const registry = createMemoryAccessUserRegistry([
    { email: "owner@example.com", tier: "owner" },
    { email: "client@example.com", tier: "re_client", realEstateClients: ["corine-real-estate"] },
  ]);
  const ownerWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("owner@example.com"),
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const ownerResponse = await ownerWorker.fetch(new Request("https://worker.test/owner/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(ownerResponse.status, 200);
  const ownerBody = await ownerResponse.json();
  assert.equal(ownerBody.tier, "owner");
  assert.deepEqual(ownerBody.roles, ["user", "owner"]);

  const clientWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("client@example.com"),
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const clientSessionResponse = await clientWorker.fetch(new Request("https://worker.test/auth/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(clientSessionResponse.status, 200);
  const clientSession = await clientSessionResponse.json();
  assert.equal(clientSession.tier, "re_client");
  assert.deepEqual(clientSession.roles, ["user", "re_client"]);
  assert.deepEqual(clientSession.realEstateClients, ["corine-real-estate"]);

  const clientOwnerResponse = await clientWorker.fetch(new Request("https://worker.test/owner/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(clientOwnerResponse.status, 403);
});

test("shared galleries expose only assigned watermarked catalog previews", async () => {
  const catalog = loadCatalog();
  const photoIds = [...catalog.photos.keys()].slice(0, 20);
  const fixtureRows = [
    ...photoIds.map((photoId, index) => ({ id: "root", label: "Friends and Family", parentId: "", groupId: "root-group", photoId, ordinal: index + 1 })),
    ...photoIds.slice(0, 10).map((photoId, index) => ({ id: "family", label: "Family", parentId: "root", groupId: "family-group", photoId, ordinal: index + 1 })),
    ...photoIds.slice(0, 5).map((photoId, index) => ({ id: "blood", label: "Blood", parentId: "family", groupId: "blood-group", photoId, ordinal: index + 1 })),
  ];
  const registry = {
    getUser: async (email) => ({
      email,
      displayName: "Avery Morgan",
      tier: "user",
      roles: ["user"],
      groups: [
        { id: "root-group", label: "Friends and Family" },
        { id: "family-group", label: "Family" },
        { id: "blood-group", label: "Blood" },
      ],
      effectiveAccess: { scopes: [] },
    }),
    listSharedFixturesForUser: async () => fixtureRows,
  };
  const worker = createPhotosByElieWorker({
    catalog,
    accessAuth: fakeAccessAuthFor("ec92009pt@gmail.com"),
    accessUserRegistry: registry,
    lifecycleDenyStore: allowLifecycleFor(),
  });
  const response = await worker.fetch(new Request("https://worker.test/shared-galleries", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  const body = await response.json();
  assert.equal(body.user.displayName, "Avery Morgan");
  assert.deepEqual(body.fixtures.map((fixture) => fixture.photos.length), [20]);
  assert.equal(body.fixtureCount, 1);
  assert.equal(body.uniquePhotoCount, 20);
  assert.equal(JSON.stringify(body).includes("sourceFiles"), false);
  assert.equal(JSON.stringify(body).includes("privateMaster"), false);
  assert.match(body.fixtures[0].photos[0].previewUrl, /^https:\/\/download\.photos-by-elie\.com\/media\//);

  const anonymous = createPhotosByElieWorker({
    catalog,
    accessAuth: fakeAccessAuthFor(""),
    accessUserRegistry: registry,
    lifecycleDenyStore: allowLifecycleFor(),
  });
  const denied = await anonymous.fetch(new Request("https://worker.test/shared-galleries", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(denied.status, 401);
});

test("shared galleries omit lifecycle-denied photos", async () => {
  const catalog = loadCatalog();
  const photoIds = [...catalog.photos.keys()].slice(0, 3);
  const worker = createPhotosByElieWorker({
    catalog,
    accessAuth: fakeAccessAuthFor("viewer@example.com"),
    accessUserRegistry: {
      getUser: async (email) => ({ email, displayName: "Viewer", groups: [], effectiveAccess: { scopes: [] } }),
      listSharedFixturesForUser: async () => photoIds.map((photoId, index) => ({
        id: "shared", label: "Shared", parentId: "", groupId: "shared-group", photoId, ordinal: index + 1,
      })),
    },
    lifecycleDenyStore: allowLifecycleFor([photoIds[1]]),
  });
  const response = await worker.fetch(new Request("https://worker.test/shared-galleries", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.fixtures[0].photos.map((photo) => photo.id), [photoIds[0], photoIds[2]]);
});

test("shared galleries retain a nested fixture when it adds photos not present in its ancestor", async () => {
  const catalog = loadCatalog();
  const photoIds = [...catalog.photos.keys()].slice(0, 21);
  const fixtureRows = [
    ...photoIds.slice(0, 20).map((photoId, index) => ({
      id: "root",
      label: "Friends and Family",
      parentId: "",
      groupId: "root-group",
      photoId,
      ordinal: index + 1,
    })),
    ...[...photoIds.slice(0, 10), photoIds[20]].map((photoId, index) => ({
      id: "family",
      label: "Family",
      parentId: "root",
      groupId: "family-group",
      photoId,
      ordinal: index + 1,
    })),
    ...photoIds.slice(0, 5).map((photoId, index) => ({
      id: "blood",
      label: "Blood",
      parentId: "family",
      groupId: "blood-group",
      photoId,
      ordinal: index + 1,
    })),
  ];
  const registry = {
    getUser: async (email) => ({
      email,
      displayName: "Avery Morgan",
      tier: "user",
      roles: ["user"],
      groups: [],
      effectiveAccess: { scopes: [] },
    }),
    listSharedFixturesForUser: async () => fixtureRows,
  };
  const worker = createPhotosByElieWorker({
    catalog,
    accessAuth: fakeAccessAuthFor("ec92009pt@gmail.com"),
    accessUserRegistry: registry,
    lifecycleDenyStore: allowLifecycleFor(),
  });

  const response = await worker.fetch(new Request("https://worker.test/shared-galleries", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  const body = await response.json();
  assert.deepEqual(body.fixtures.map((fixture) => fixture.photos.length), [20, 11]);
  assert.equal(body.uniquePhotoCount, 21);
});

test("owner actions require an enrolled Backstage Mac session", async () => {
  const registry = createMemoryAccessUserRegistry([
    { email: "owner@example.com", tier: "owner" },
  ]);
  const backstage = backstageOwnerFixture();
  let nowTick = 0;
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: backstage.googleOAuthAuth,
    ownerDeviceAuthStore: backstage.ownerDeviceAuthStore,
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
    now: () => new Date(`2026-05-17T12:${String(nowTick++).padStart(2, "0")}:00.000Z`),
    randomUUID: deterministicIds(),
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "import-operation",
    payload: {
      sourceKind: "apple_photos",
      destinationKind: "expo",
    },
  }, backstage.headers));
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.action.type, "import-operation");
  assert.equal(body.action.state, "queued");
  assert.equal(body.action.createdBy, "owner@example.com");
  assert.deepEqual(body.action.payload, {
    sourceKind: "apple_photos",
    destinationKind: "expo",
  });

  const readback = await worker.fetch(new Request(`https://worker.test/owner/actions/${body.action.id}`, {
    headers: backstage.headers,
  }));
  assert.equal(readback.status, 200);
  const readbackBody = await readback.json();
  assert.equal(readbackBody.action.id, body.action.id);

  const claimResponse = await worker.fetch(jsonRequest(`https://worker.test/owner/actions/${body.action.id}/claim`, {
    connectorId: "Max Sidecar",
  }, backstage.headers));
  assert.equal(claimResponse.status, 200);
  const claimBody = await claimResponse.json();
  assert.equal(claimBody.action.state, "claimed");
  assert.equal(claimBody.action.claim.connectorId, "max-sidecar");
  assert.equal(claimBody.action.claim.claimedBy, "owner@example.com");
  assert.equal(claimBody.action.history.at(-1).event, "claimed");

  const completeResponse = await worker.fetch(jsonRequest(`https://worker.test/owner/actions/${body.action.id}/complete`, {
    result: { connector: "max-sidecar", recordsReviewed: 0 },
  }, backstage.headers));
  assert.equal(completeResponse.status, 200);
  const completeBody = await completeResponse.json();
  assert.equal(completeBody.action.state, "completed");
  assert.deepEqual(completeBody.action.result, { connector: "max-sidecar", recordsReviewed: 0 });
  assert.equal(completeBody.action.completedBy, "owner@example.com");
  assert.equal(completeBody.action.history.at(-1).event, "completed");

  const reclaimResponse = await worker.fetch(jsonRequest(`https://worker.test/owner/actions/${body.action.id}/claim`, {
    connectorId: "max-sidecar",
  }, backstage.headers));
  assert.equal(reclaimResponse.status, 409);

  const secondResponse = await worker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "track-b-cloud-shell-check",
    payload: { surface: "new-owner" },
  }, backstage.headers));
  assert.equal(secondResponse.status, 202);
  const secondBody = await secondResponse.json();

  const listResponse = await worker.fetch(new Request("https://worker.test/owner/actions?limit=1", {
    headers: backstage.headers,
  }));
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.limit, 1);
  assert.equal(listBody.actions.length, 1);
  assert.equal(listBody.actions[0].id, secondBody.action.id);

  const cancelResponse = await worker.fetch(jsonRequest(`https://worker.test/owner/actions/${secondBody.action.id}/cancel`, {
    reason: "Owner changed plans.",
  }, backstage.headers));
  assert.equal(cancelResponse.status, 200);
  const cancelled = (await cancelResponse.json()).action;
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.cancelledBy, "owner@example.com");
  assert.equal(cancelled.cancellation.reason, "Owner changed plans.");
  assert.ok(cancelled.timing.cancelledAt);
  assert.equal(cancelled.history.at(-1).event, "cancelled");

  const cancelAgainResponse = await worker.fetch(jsonRequest(`https://worker.test/owner/actions/${secondBody.action.id}/cancel`, {
    reason: "Duplicate cancellation.",
  }, backstage.headers));
  assert.equal(cancelAgainResponse.status, 409);

  const browserGoogleAuth = {
    optionalSession: async () => ({
      email: "client@example.com",
      provider: "google-oauth",
      purpose: "browser",
      expiresAt: "2026-08-12T13:00:00.000Z",
      sessionSeconds: 3600,
    }),
    requireSession: async () => ({
      email: "client@example.com",
      provider: "google-oauth",
      purpose: "browser",
      expiresAt: "2026-08-12T13:00:00.000Z",
      sessionSeconds: 3600,
    }),
  };
  const clientWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: browserGoogleAuth,
    accessUserRegistry: createMemoryAccessUserRegistry([{ email: "client@example.com", tier: "re_client" }]),
    accessAdminEmail: "ec92009@gmail.com",
  });
  const forbidden = await clientWorker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "import-operation",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "backstage_device_session_required");
  const listForbidden = await clientWorker.fetch(new Request("https://worker.test/owner/actions", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(listForbidden.status, 403);
  const claimForbidden = await clientWorker.fetch(jsonRequest(`https://worker.test/owner/actions/${body.action.id}/claim`, {
    connectorId: "client-sidecar",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(claimForbidden.status, 403);
});

test("Owner API v1 preserves action behavior behind Backstage authorization", async () => {
  const backstage = backstageOwnerFixture();
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: backstage.googleOAuthAuth,
    ownerDeviceAuthStore: backstage.ownerDeviceAuthStore,
    accessUserRegistry: createMemoryAccessUserRegistry([
      { email: "owner@example.com", tier: "owner" },
    ]),
    randomUUID: deterministicIds(),
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "fixture-operation",
    target: "max",
    payload: { operation: "list" },
  }, {
    ...backstage.headers,
    "idempotency-key": "fixture-list-20260725",
  }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-pbe-api-version"), "1");
  assert.match(response.headers.get("x-pbe-request-id") || "", /\S+/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("access-control-allow-headers") || "", /idempotency-key/);
  const body = await response.json();
  assert.equal(body.action.type, "fixture-operation");
  assert.equal(body.action.actionKind, "fixture-operation");
  assert.equal(body.action.target, "max");
  assert.equal(body.idempotencyReplayed, undefined);

  const replayResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "fixture-operation",
    target: "max",
    payload: { operation: "create", name: "This must not be queued" },
  }, {
    ...backstage.headers,
    "idempotency-key": "fixture-list-20260725",
  }));
  assert.equal(replayResponse.status, 200);
  const replayBody = await replayResponse.json();
  assert.equal(replayBody.idempotencyReplayed, true);
  assert.equal(replayBody.action.id, body.action.id);
  assert.deepEqual(replayBody.action.payload, { operation: "list" });

  const missingKeyResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "fixture-operation",
    target: "max",
    payload: { operation: "list" },
  }, backstage.headers));
  assert.equal(missingKeyResponse.status, 400);
  assert.equal((await missingKeyResponse.json()).error.code, "idempotency_key_required");

  const missingTargetResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "fixture-operation",
    payload: { operation: "list" },
  }, {
    ...backstage.headers,
    "idempotency-key": "fixture-missing-target-20260725",
  }));
  assert.equal(missingTargetResponse.status, 400);
  assert.equal((await missingTargetResponse.json()).error.code, "owner_action_target_required");

  const secondActionResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "sidecar-culling-review",
    target: "david",
    payload: { operation: "open" },
  }, {
    ...backstage.headers,
    "idempotency-key": "sidecar-open-20260725",
  }));
  assert.equal(secondActionResponse.status, 202);
  const thirdActionResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "sidecar-culling-review",
    target: "david",
    payload: { operation: "resume" },
  }, {
    ...backstage.headers,
    "idempotency-key": "sidecar-resume-20260725",
  }));
  assert.equal(thirdActionResponse.status, 202);

  const firstPageResponse = await worker.fetch(new Request(
    "https://worker.test/api/v1/actions?limit=1&target=david&actionKind=sidecar-culling-review",
    { headers: backstage.headers }
  ));
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.items[0].target, "david");
  assert.equal(firstPage.page.hasMore, true);
  assert.match(firstPage.page.nextCursor, /^[A-Za-z0-9_-]+$/);
  const secondPageResponse = await worker.fetch(new Request(
    `https://worker.test/api/v1/actions?limit=1&target=david&actionKind=sidecar-culling-review&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`,
    { headers: backstage.headers }
  ));
  const secondPage = await secondPageResponse.json();
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(secondPage.items[0].id, firstPage.items[0].id);
  assert.equal(secondPage.page.hasMore, false);
  assert.equal(secondPage.page.nextCursor, null);

  const readback = await worker.fetch(new Request(
    `https://worker.test/api/v1/actions/${encodeURIComponent(body.action.id)}`,
    { headers: backstage.headers }
  ));
  assert.equal(readback.status, 200);
  assert.equal((await readback.json()).action.id, body.action.id);

  const unknown = await worker.fetch(new Request("https://worker.test/api/v1/private-sqlite"));
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, "not_found");
});

test("Owner API v1 re-authenticates Keychain device credentials and independently revokes devices", async () => {
  const now = () => new Date("2026-07-25T09:00:00.000Z");
  const ownerDeviceAuthStore = createMemoryOwnerDeviceAuthStore({ now });
  let accessTokenCount = 0;
  const googleOAuthAuth = {
    optionalSession: async () => ({
      email: "ec92009@gmail.com",
      provider: "google-oauth",
      purpose: "browser",
      expiresAt: "2026-07-25T10:00:00.000Z",
      sessionSeconds: 3600,
    }),
    requireSession: async () => ({
      email: "ec92009@gmail.com",
      provider: "google-oauth",
      purpose: "browser",
      expiresAt: "2026-07-25T10:00:00.000Z",
      sessionSeconds: 3600,
    }),
    issueSessionToken: async (identity, seconds) => {
      accessTokenCount += 1;
      return `access-${identity.email}-${seconds}-${accessTokenCount}`;
    },
    clearCookieFor: () => "pbe_google_session=; Max-Age=0; Path=/; HttpOnly",
  };
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth,
    accessUserRegistry: createMemoryAccessUserRegistry([
      { email: "ec92009@gmail.com", tier: "owner" },
    ]),
    accessAdminEmail: "ec92009@gmail.com",
    ownerDeviceAuthStore,
    randomUUID: deterministicIds(),
    now,
  });

  const enrollResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/devices", {
    name: "Max Backstage",
    platform: "macOS",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(enrollResponse.status, 201);
  const enrollment = await enrollResponse.json();
  assert.match(enrollment.device.id, /^owner-device-/);
  assert.equal(enrollment.device.name, "Max Backstage");
  assert.match(enrollment.deviceCredential, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(enrollment.device.credentialHash, undefined);

  const listResponse = await worker.fetch(new Request("https://worker.test/api/v1/devices", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(listResponse.status, 200);
  const listedDevices = (await listResponse.json()).devices;
  assert.deepEqual(listedDevices.map((device) => device.id), [enrollment.device.id]);
  assert.equal(listedDevices[0].lastUsedAt, null);
  assert.equal(listedDevices[0].revokedAt, null);

  const tokenResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/auth/tokens", {
    deviceId: enrollment.device.id,
    deviceCredential: enrollment.deviceCredential,
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(tokenResponse.status, 201);
  const tokens = await tokenResponse.json();
  assert.equal(tokens.tokenType, "Bearer");
  assert.equal(tokens.expiresIn, 15 * 60);
  assert.match(tokens.accessToken, /^access-ec92009@gmail\.com-900-1$/);
  assert.equal(tokens.refreshToken, undefined);

  const secondTokenResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/auth/tokens", {
    deviceId: enrollment.device.id,
    deviceCredential: enrollment.deviceCredential,
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(secondTokenResponse.status, 201);
  assert.match((await secondTokenResponse.json()).accessToken, /^access-ec92009@gmail\.com-900-2$/);

  const removedRefreshRoute = await worker.fetch(jsonRequest("https://worker.test/api/v1/auth/refresh", {}, {
    origin: "https://photos-by-elie.com",
  }));
  assert.equal(removedRefreshRoute.status, 404);

  const logoutResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/auth/logout", {}, {
    origin: "https://photos-by-elie.com",
  }));
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /Max-Age=0/);

  const revokeResponse = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/devices/${encodeURIComponent(enrollment.device.id)}/revoke`,
    {},
    { origin: "https://photos-by-elie.com" }
  ));
  assert.equal(revokeResponse.status, 200);
  assert.match((await revokeResponse.json()).device.revokedAt, /^2026-07-25T09:00:00/);
  const revokedDeviceTokens = await worker.fetch(jsonRequest("https://worker.test/api/v1/auth/tokens", {
    deviceId: enrollment.device.id,
    deviceCredential: enrollment.deviceCredential,
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(revokedDeviceTokens.status, 401);
});

test("native Mac enrollment handoff is short-lived, browser-authorized, bound and single-use", async () => {
  let currentNow = new Date("2026-08-28T08:00:00.000Z");
  const now = () => currentNow;
  const ownerDeviceAuthStore = createMemoryOwnerDeviceAuthStore({ now });
  const ownerEnrollmentHandoffStore = createMemoryOwnerEnrollmentHandoffStore({ now });
  const ownerIdentity = {
    email: "ec92009@gmail.com",
    provider: "google-oauth",
    purpose: "browser",
    expiresAt: "2026-08-28T09:00:00.000Z",
    sessionSeconds: 3600,
  };
  let activeIdentity = ownerIdentity;
  const googleOAuthAuth = {
    optionalSession: async () => activeIdentity,
    requireSession: async () => activeIdentity,
    loginUrlFor: async (_request, { returnTo }) => `https://accounts.example.test/select?returnTo=${encodeURIComponent(returnTo)}`,
    issueSessionToken: async (identity) => `access-${identity.deviceId}`,
  };
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth,
    accessUserRegistry: createMemoryAccessUserRegistry([
      { email: "ec92009@gmail.com", tier: "owner" },
      { email: "another-owner@example.test", tier: "owner" },
    ]),
    accessAdminEmail: "ec92009@gmail.com",
    ownerDeviceAuthStore,
    ownerEnrollmentHandoffStore,
    randomUUID: deterministicIds(),
    now,
  });

  const startResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/enrollment-handoffs", {
    name: "Max Backstage",
    platform: "macOS",
    binding: "native-binding-one",
  }));
  assert.equal(startResponse.status, 201);
  const started = await startResponse.json();
  assert.equal(started.handoff.state, "pending");
  assert.equal(started.handoff.binding, "native-binding-one");
  assert.equal(new URL(started.handoff.authorizationURL).search, "");
  assert.equal(started.handoff.authorizationURL.includes(started.handoff.claimSecret), false);

  const wrongClaim = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${started.handoff.id}/claim`,
    { binding: "native-binding-one", claimSecret: "wrong-secret" }
  ));
  assert.equal(wrongClaim.status, 401);

  const pendingClaim = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${started.handoff.id}/claim`,
    { binding: started.handoff.binding, claimSecret: started.handoff.claimSecret }
  ));
  assert.equal(pendingClaim.status, 202);
  assert.deepEqual(await pendingClaim.json(), { ok: true, state: "pending" });

  const confirmation = await worker.fetch(new Request(started.handoff.authorizationURL));
  assert.equal(confirmation.status, 200);
  const confirmationHTML = await confirmation.text();
  assert.match(confirmationHTML, /Set up this Mac/);
  assert.equal(confirmationHTML.includes(started.handoff.claimSecret), false);

  const authorize = await worker.fetch(new Request(started.handoff.authorizationURL, {
    method: "POST",
    headers: { origin: "https://worker.test" },
  }));
  assert.equal(authorize.status, 200);
  assert.match(await authorize.text(), /This Mac is approved/);

  const claimResponse = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${started.handoff.id}/claim`,
    { binding: started.handoff.binding, claimSecret: started.handoff.claimSecret }
  ));
  assert.equal(claimResponse.status, 201);
  const claimed = await claimResponse.json();
  assert.equal(claimed.state, "completed");
  assert.match(claimed.device.id, /^owner-device-/);
  assert.match(claimed.deviceCredential, /^[A-Za-z0-9_-]{40,}$/);

  const replay = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${started.handoff.id}/claim`,
    { binding: started.handoff.binding, claimSecret: started.handoff.claimSecret }
  ));
  assert.equal(replay.status, 409);

  const cancellable = await worker.fetch(jsonRequest("https://worker.test/api/v1/enrollment-handoffs", {
    name: "Cancelled Mac",
    platform: "macOS",
    binding: "native-binding-cancelled",
  }));
  const cancellableBody = await cancellable.json();
  activeIdentity = { ...ownerIdentity, email: "another-owner@example.test" };
  const wrongIdentity = await worker.fetch(new Request(cancellableBody.handoff.authorizationURL));
  assert.equal(wrongIdentity.status, 403);
  activeIdentity = ownerIdentity;
  const cancelResponse = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${cancellableBody.handoff.id}/cancel`,
    { binding: cancellableBody.handoff.binding, claimSecret: cancellableBody.handoff.claimSecret }
  ));
  assert.equal(cancelResponse.status, 200);
  const cancelledClaim = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${cancellableBody.handoff.id}/claim`,
    { binding: cancellableBody.handoff.binding, claimSecret: cancellableBody.handoff.claimSecret }
  ));
  assert.equal(cancelledClaim.status, 409);

  const expiring = await worker.fetch(jsonRequest("https://worker.test/api/v1/enrollment-handoffs", {
    name: "Recovery Mac",
    platform: "macOS",
    binding: "native-binding-two",
  }));
  const expiringBody = await expiring.json();
  currentNow = new Date("2026-08-28T08:06:00.000Z");
  const expired = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/enrollment-handoffs/${expiringBody.handoff.id}/claim`,
    { binding: expiringBody.handoff.binding, claimSecret: expiringBody.handoff.claimSecret }
  ));
  assert.equal(expired.status, 410);
});

test("D1 native enrollment claim atomically consumes one authorized handoff", async () => {
  const source = fs.readFileSync(new URL("./owner-enrollment-handoff-store.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CREATE\s+TABLE/i);
  const database = new TestD1();
  const now = () => new Date("2026-08-28T08:00:00.000Z");
  const store = createD1OwnerEnrollmentHandoffStore({ database, now });
  await store.create({
    id: "owner-enrollment-d1",
    binding: "binding-d1",
    name: "Max",
    platform: "macOS",
    createdAt: "2026-08-28T08:00:00.000Z",
    expiresAt: "2026-08-28T08:05:00.000Z",
  }, "claim-d1");
  assert.equal((await store.claim({
    id: "owner-enrollment-d1",
    binding: "binding-d1",
    claimSecret: "claim-d1",
    claimedAt: "2026-08-28T08:01:00.000Z",
  })).outcome, "pending");
  assert.equal((await store.authorize({
    id: "owner-enrollment-d1",
    email: "ec92009@gmail.com",
    authorizedAt: "2026-08-28T08:01:00.000Z",
  })).state, "authorized");
  assert.equal((await store.claim({
    id: "owner-enrollment-d1",
    binding: "binding-d1",
    claimSecret: "claim-d1",
    claimedAt: "2026-08-28T08:02:00.000Z",
  })).outcome, "accepted");
  assert.equal((await store.claim({
    id: "owner-enrollment-d1",
    binding: "binding-d1",
    claimSecret: "claim-d1",
    claimedAt: "2026-08-28T08:02:01.000Z",
  })).outcome, "claimed");
});

test("PBE Owner sessions require Backstage, freeze fixture identities, close and honor device revocation", async () => {
  let currentNow = new Date("2026-08-12T12:00:00.000Z");
  const now = () => currentNow;
  const ownerDeviceAuthStore = createMemoryOwnerDeviceAuthStore({ now });
  const googleOAuthAuth = createGoogleOAuthAuth({
    clientId: "google-client",
    clientSecret: "google-secret",
    sessionSecret: "test-session-secret",
    now,
  });
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth,
    accessUserRegistry: createMemoryAccessUserRegistry([
      { email: "ec92009@gmail.com", tier: "owner" },
      { email: "another-owner@example.com", tier: "owner" },
    ]),
    accessAdminEmail: "ec92009@gmail.com",
    ownerDeviceAuthStore,
    randomUUID: deterministicIds(),
    now,
  });
  const browserToken = await googleOAuthAuth.issueSessionToken({
    email: "ec92009@gmail.com",
    provider: "google-oauth",
    purpose: "browser",
  });
  const otherOwnerToken = await googleOAuthAuth.issueSessionToken({
    email: "another-owner@example.com",
    provider: "google-oauth",
    purpose: "browser",
  });
  const bearer = (token) => ({ authorization: `Bearer ${token}`, origin: "https://photos-by-elie.com" });

  const wrongProvisioner = await worker.fetch(jsonRequest("https://worker.test/api/v1/devices", {
    name: "Not Elie's Backstage",
    platform: "macOS",
  }, bearer(otherOwnerToken)));
  assert.equal(wrongProvisioner.status, 403);
  assert.equal((await wrongProvisioner.json()).error.code, "backstage_provisioner_required");

  const wrongOrigin = await worker.fetch(jsonRequest("https://worker.test/api/v1/devices", {
    name: "Untrusted browser",
    platform: "macOS",
  }, {
    authorization: `Bearer ${browserToken}`,
    origin: "https://untrusted.example",
  }));
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await wrongOrigin.json()).error.code, "cors_origin_forbidden");
  assert.equal(wrongOrigin.headers.get("access-control-allow-origin"), "null");

  const enrollmentResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/devices", {
    name: "Max Backstage",
    platform: "macOS",
  }, bearer(browserToken)));
  assert.equal(enrollmentResponse.status, 201);
  const enrollment = await enrollmentResponse.json();

  const tokenResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/auth/tokens", {
    deviceId: enrollment.device.id,
    deviceCredential: enrollment.deviceCredential,
  }));
  assert.equal(tokenResponse.status, 201);
  const backstageTokens = await tokenResponse.json();

  const secondEnrollmentResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/devices", {
    name: "Recovery Mac",
    platform: "macOS",
  }, bearer(browserToken)));
  assert.equal(secondEnrollmentResponse.status, 201);
  const secondEnrollment = await secondEnrollmentResponse.json();
  const nativeDeviceList = await worker.fetch(new Request("https://worker.test/api/v1/devices", {
    headers: bearer(backstageTokens.accessToken),
  }));
  assert.equal(nativeDeviceList.status, 200);
  assert.deepEqual((await nativeDeviceList.json()).devices.map((device) => device.name), [
    "Max Backstage",
    "Recovery Mac",
  ]);
  const nativeRevoke = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/devices/${encodeURIComponent(secondEnrollment.device.id)}/revoke`,
    {},
    bearer(backstageTokens.accessToken)
  ));
  assert.equal(nativeRevoke.status, 200);
  assert.equal((await nativeRevoke.json()).device.name, "Recovery Mac");

  const browserMint = await worker.fetch(jsonRequest("https://worker.test/api/v1/pbe-owner/sessions", {
    fixtureId: "fixture-la-concha",
    fixtureBreadcrumb: "RE › La Concha",
    sourceIdentity: "owner-sqlite:abc",
    catalogIdentity: "catalog-sqlite:def",
    readinessIdentity: "ready:one",
    fixtureRevision: "fixture-revision:one",
  }, bearer(browserToken)));
  assert.equal(browserMint.status, 403);
  assert.equal((await browserMint.json()).error.code, "backstage_device_session_required");

  const browserAction = await worker.fetch(jsonRequest("https://worker.test/api/v1/actions", {
    actionKind: "photo-moderation",
    target: "max",
    payload: { operation: "waste-basket-x", photoId: "photo-one" },
  }, { ...bearer(browserToken), "idempotency-key": "browser-action-denied" }));
  assert.equal(browserAction.status, 403);

  const missingBinding = await worker.fetch(jsonRequest("https://worker.test/api/v1/pbe-owner/sessions", {
    fixtureId: "fixture-la-concha",
  }, bearer(backstageTokens.accessToken)));
  assert.equal(missingBinding.status, 400);
  assert.equal((await missingBinding.json()).error.code, "pbe_owner_session_binding_invalid");

  const mintResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/pbe-owner/sessions", {
    fixtureId: "fixture-la-concha",
    fixtureBreadcrumb: "RE › La Concha",
    sourceIdentity: "owner-sqlite:abc",
    catalogIdentity: "catalog-sqlite:def",
    readinessIdentity: "ready:one",
    fixtureRevision: "fixture-revision:one",
  }, bearer(backstageTokens.accessToken)));
  assert.equal(mintResponse.status, 201);
  const minted = await mintResponse.json();
  assert.match(minted.session.id, /^pbe-owner-session-/);
  assert.equal(minted.session.fixtureId, "fixture-la-concha");
  assert.equal(minted.session.lifecycleWriter, "pbb-79-waste-basket");
  assert.equal(minted.session.fixtureRevision, "fixture-revision:one");
  assert.deepEqual(minted.session.capabilities, [
    "gallery.read",
    "waste-basket.x",
    "waste-basket.restore",
    "fixture.hide",
    "fixture.review",
    "fixture.clear",
    "asset.rating",
    "asset.color",
  ]);

  const statusResponse = await worker.fetch(new Request("https://worker.test/api/v1/pbe-owner/session", {
    headers: bearer(minted.sessionToken),
  }));
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).session.fixtureBreadcrumb, "RE › La Concha");

  const wrongClose = await worker.fetch(jsonRequest("https://worker.test/api/v1/pbe-owner/sessions/not-this-session/close", {}, bearer(minted.sessionToken)));
  assert.equal(wrongClose.status, 409);
  const closeResponse = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/pbe-owner/sessions/${encodeURIComponent(minted.session.id)}/close`,
    {},
    bearer(minted.sessionToken)
  ));
  assert.equal(closeResponse.status, 200);
  assert.equal((await closeResponse.json()).session.state, "closed");
  const closedStatus = await worker.fetch(new Request("https://worker.test/api/v1/pbe-owner/session", {
    headers: bearer(minted.sessionToken),
  }));
  assert.equal(closedStatus.status, 401);

  const secondMintResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/pbe-owner/sessions", {
    fixtureId: "fixture-la-concha",
    fixtureBreadcrumb: "RE › La Concha",
    sourceIdentity: "owner-sqlite:abc",
    catalogIdentity: "catalog-sqlite:def",
    readinessIdentity: "ready:two",
    fixtureRevision: "fixture-revision:two",
  }, bearer(backstageTokens.accessToken)));
  const secondMint = await secondMintResponse.json();
  const revokeResponse = await worker.fetch(jsonRequest(
    `https://worker.test/api/v1/devices/${encodeURIComponent(enrollment.device.id)}/revoke`,
    {},
    bearer(browserToken)
  ));
  assert.equal(revokeResponse.status, 200);
  const revokedStatus = await worker.fetch(new Request("https://worker.test/api/v1/pbe-owner/session", {
    headers: bearer(secondMint.sessionToken),
  }));
  assert.equal(revokedStatus.status, 401);

  currentNow = new Date("2026-08-12T12:06:00.000Z");
  const expiredStatus = await worker.fetch(new Request("https://worker.test/api/v1/pbe-owner/session", {
    headers: bearer(secondMint.sessionToken),
  }));
  assert.equal(expiredStatus.status, 401);
});

test("background Owner connectors use scoped credentials and report health", async () => {
  const ownerActionStore = createMemoryOwnerActionStore();
  const registry = createMemoryAccessUserRegistry([{ email: "owner@example.com", tier: "owner" }]);
  const backstage = backstageOwnerFixture();
  const ownerConnectorAuth = {
    requireConnector: async (request) => {
      if (request.headers.get("authorization") !== "Bearer connector-secret") {
        throw Object.assign(new Error("Connector credential required."), {
          status: 401,
          code: "owner_connector_auth_required",
        });
      }
      return { connectorId: "david" };
    },
  };
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: backstage.googleOAuthAuth,
    ownerDeviceAuthStore: backstage.ownerDeviceAuthStore,
    accessUserRegistry: registry,
    ownerActionStore,
    ownerConnectorAuth,
    randomUUID: deterministicIds(),
  });

  const queuedResponse = await worker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "sidecar-culling-review",
    payload: { requestedConnector: "david", manifest: { limit: 24 } },
  }, backstage.headers));
  const queued = (await queuedResponse.json()).action;
  await worker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "track-b-cloud-shell-check",
  }, backstage.headers));

  const unauthorized = await worker.fetch(new Request("https://worker.test/owner/connector/actions"));
  assert.equal(unauthorized.status, 401);

  const connectorHeaders = { authorization: "Bearer connector-secret" };
  const heartbeatResponse = await worker.fetch(jsonRequest("https://worker.test/owner/connector/heartbeat", {
    hostname: "David-5.local",
    platform: "macos",
    version: "1.0",
    capabilities: ["apple-photos", "sidecar"],
  }, connectorHeaders));
  assert.equal(heartbeatResponse.status, 200);
  assert.equal((await heartbeatResponse.json()).connector.id, "david");

  const interactiveResponse = await worker.fetch(jsonRequest("https://worker.test/owner/interactive", {
    connectorId: "david",
    surface: "waste-basket",
  }, backstage.headers));
  assert.equal(interactiveResponse.status, 200);
  assert.equal((await interactiveResponse.json()).interactivePolling, true);

  const connectorInteractiveResponse = await worker.fetch(new Request("https://worker.test/owner/connector/interactive", {
    headers: connectorHeaders,
  }));
  assert.equal(connectorInteractiveResponse.status, 200);
  assert.equal((await connectorInteractiveResponse.json()).interactivePolling, true);

  const connectorList = await worker.fetch(new Request("https://worker.test/owner/connector/actions", {
    headers: connectorHeaders,
  }));
  const connectorListBody = await connectorList.json();
  assert.equal(connectorListBody.actions.length, 1);
  assert.equal(connectorListBody.actions[0].id, queued.id);

  const exactResponse = await worker.fetch(new Request(
    `https://worker.test/owner/connector/actions/${queued.id}`,
    { headers: connectorHeaders }
  ));
  assert.equal(exactResponse.status, 200);
  assert.equal((await exactResponse.json()).action.id, queued.id);

  const claimResponse = await worker.fetch(jsonRequest(
    `https://worker.test/owner/connector/actions/${queued.id}/claim`,
    { locallyAwakenedAt: "2026-07-22T10:00:00.000Z" },
    connectorHeaders
  ));
  const claimed = (await claimResponse.json()).action;
  assert.equal(claimed.claim.connectorId, "david");
  assert.equal(claimed.claim.claimedBy, "connector:david");
  assert.equal(claimed.timing.locallyAwakenedAt, "2026-07-22T10:00:00.000Z");
  assert.ok(claimed.timing.claimedAt);
  assert.equal(claimed.history.at(-2).event, "locally-awakened");

  const completeResponse = await worker.fetch(jsonRequest(
    `https://worker.test/owner/connector/actions/${queued.id}/complete`,
    {
      result: { recordsPrepared: 24 },
      timing: {
        executedAt: "2026-07-22T10:00:01.000Z",
        connector: {
          schema: "photosbyelie.ownerActionTiming.v1",
          actionId: queued.id,
          phases: {
            "action.execute": {
              startedAt: "2026-07-22T10:00:00.100Z",
              endedAt: "2026-07-22T10:00:00.900Z",
              elapsedMs: 800,
              outcome: "ok",
            },
          },
        },
      },
    },
    connectorHeaders
  ));
  const completed = (await completeResponse.json()).action;
  assert.equal(completed.state, "completed");
  assert.equal(completed.completedBy, "connector:david");
  assert.equal(completed.result.recordsPrepared, 24);
  assert.equal(completed.timing.executedAt, "2026-07-22T10:00:01.000Z");
  assert.equal(completed.timing.connector.schema, "photosbyelie.ownerActionTiming.v1");
  assert.equal(completed.timing.connector.phases["action.execute"].elapsedMs, 800);
  assert.ok(completed.timing.completedAt);

  const ownerConnectorResponse = await worker.fetch(new Request("https://worker.test/owner/connectors", {
    headers: backstage.headers,
  }));
  assert.equal(ownerConnectorResponse.status, 200);
  const ownerConnectors = await ownerConnectorResponse.json();
  assert.equal(ownerConnectors.connectors[0].hostname, "David-5.local");

});

test("public photo moderation is routed only to the requested Owner connector", async () => {
  const ownerActionStore = createMemoryOwnerActionStore();
  const backstage = backstageOwnerFixture();
  const ownerConnectorAuth = {
    requireConnector: async (request) => {
      const token = request.headers.get("authorization");
      if (token === "Bearer max-secret") return { connectorId: "max" };
      if (token === "Bearer david-secret") return { connectorId: "david" };
      throw Object.assign(new Error("Connector credential required."), { status: 401, code: "owner_connector_auth_required" });
    },
  };
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: backstage.googleOAuthAuth,
    ownerDeviceAuthStore: backstage.ownerDeviceAuthStore,
    accessUserRegistry: createMemoryAccessUserRegistry([{ email: "owner@example.com", tier: "owner" }]),
    ownerActionStore,
    ownerConnectorAuth,
    randomUUID: deterministicIds(),
  });

  const queuedResponse = await worker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "photo-moderation",
    payload: {
      operation: "hide-many",
      photoIds: ["photo-a", "photo-b"],
      requestedConnector: "max",
    },
  }, backstage.headers));
  assert.equal(queuedResponse.status, 202);

  const maxResponse = await worker.fetch(new Request("https://worker.test/owner/connector/actions", {
    headers: { authorization: "Bearer max-secret" },
  }));
  const maxBody = await maxResponse.json();
  assert.equal(maxBody.actions.length, 1);
  assert.equal(maxBody.actions[0].type, "photo-moderation");
  assert.deepEqual(maxBody.actions[0].payload.photoIds, ["photo-a", "photo-b"]);

  const davidResponse = await worker.fetch(new Request("https://worker.test/owner/connector/actions", {
    headers: { authorization: "Bearer david-secret" },
  }));
  assert.equal((await davidResponse.json()).actions.length, 0);
  const davidExactResponse = await worker.fetch(new Request(
    `https://worker.test/owner/connector/actions/${maxBody.actions[0].id}`,
    { headers: { authorization: "Bearer david-secret" } }
  ));
  assert.equal(davidExactResponse.status, 404);
  const davidClaimResponse = await worker.fetch(jsonRequest(
    `https://worker.test/owner/connector/actions/${maxBody.actions[0].id}/claim`,
    {},
    { authorization: "Bearer david-secret" }
  ));
  assert.equal(davidClaimResponse.status, 409);

  const metadataResponse = await worker.fetch(jsonRequest("https://worker.test/owner/actions", {
    action: "owner-hidden-metadata",
    payload: {
      photoIds: ["001-private"],
      requestedConnector: "max",
    },
  }, backstage.headers));
  assert.equal(metadataResponse.status, 202);
  const maxMetadataResponse = await worker.fetch(new Request("https://worker.test/owner/connector/actions", {
    headers: { authorization: "Bearer max-secret" },
  }));
  const maxMetadataBody = await maxMetadataResponse.json();
  assert.equal(maxMetadataBody.actions.some((action) => action.type === "owner-hidden-metadata"), true);
});

test("sidecar cloud decisions are stored behind Backstage or connector auth", async () => {
  const registry = createMemoryAccessUserRegistry([{ email: "owner@example.com", tier: "owner" }]);
  const backstage = backstageOwnerFixture();
  const ownerConnectorAuth = {
    requireConnector: async (request) => {
      if (request.headers.get("authorization") !== "Bearer connector-secret") {
        throw Object.assign(new Error("Connector credential required."), {
          status: 401,
          code: "owner_connector_auth_required",
        });
      }
      return { connectorId: "david" };
    },
  };
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: backstage.googleOAuthAuth,
    ownerDeviceAuthStore: backstage.ownerDeviceAuthStore,
    accessUserRegistry: registry,
    ownerConnectorAuth,
    now: () => new Date("2026-07-11T10:00:00.000Z"),
    randomUUID: deterministicIds(),
  });

  const ownerApplyResponse = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/apply", {
    assetId: "apple-cloud-id-1",
    action: "rating",
    rating: 4,
  }, backstage.headers));
  assert.equal(ownerApplyResponse.status, 200);
  const ownerApply = await ownerApplyResponse.json();
  assert.equal(ownerApply.actor.kind, "owner");
  assert.equal(ownerApply.state.rating, 4);
  assert.equal(ownerApply.state.pickState, "undecided");

  const connectorHeaders = { authorization: "Bearer connector-secret" };
  const connectorApplyResponse = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/apply", {
    assetId: "apple-cloud-id-1",
    action: "pick",
  }, connectorHeaders));
  assert.equal(connectorApplyResponse.status, 200);
  const connectorApply = await connectorApplyResponse.json();
  assert.equal(connectorApply.actor.kind, "connector");
  assert.equal(connectorApply.actor.id, "david");
  assert.equal(connectorApply.state.rating, 4);
  assert.equal(connectorApply.state.pickState, "picked");

  const reworkResponse = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/apply", {
    assetId: "apple-cloud-id-1",
    action: "metadata-rework",
    reworkCategory: "generic",
    reworkComment: "Use a more specific public-place title.",
  }, connectorHeaders));
  assert.equal(reworkResponse.status, 200);
  const rework = await reworkResponse.json();
  assert.equal(rework.state.pickState, "picked");
  assert.equal(rework.state.metadataState, "rework");
  assert.equal(rework.state.reworkCategory, "generic");
  assert.equal(rework.state.metadataAiAttemptCount, 0);

  const restoreBypass = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/apply", {
    assetId: "apple-cloud-id-1",
    action: "restore",
  }, connectorHeaders));
  assert.equal(restoreBypass.status, 409);
  assert.equal((await restoreBypass.json()).error.code, "waste_basket_gateway_required");

  const mirrorBypass = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/upsert", {
    decisions: [{
      assetId: "apple-cloud-id-1",
      state: { tombstoneState: "restored" },
    }],
  }, connectorHeaders));
  assert.equal(mirrorBypass.status, 409);
  assert.equal((await mirrorBypass.json()).error.code, "waste_basket_gateway_required");

  const auditedRetryResponse = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/upsert", {
    decisions: [{
      assetId: "apple-cloud-id-1",
      state: {
        rating: rework.state.rating,
        color: rework.state.color,
        pickState: rework.state.pickState,
        metadataState: rework.state.metadataState,
        title: rework.state.title,
        keywords: rework.state.keywords,
        reworkCategory: rework.state.reworkCategory,
        reworkComment: rework.state.reworkComment,
        metadataAiAttemptCount: 2,
        metadataAiLastError: "missing preview manifest",
        metadataAiLastAttemptAt: "2026-07-11T10:01:00.000Z",
      },
    }],
  }, connectorHeaders));
  assert.equal(auditedRetryResponse.status, 200);
  const auditedRetry = await auditedRetryResponse.json();
  assert.equal(auditedRetry.items[0].metadataAiAttemptCount, 2);
  assert.equal(auditedRetry.items[0].metadataAiLastError, "missing preview manifest");
  assert.equal(auditedRetry.items[0].metadataState, "rework");

  const queryResponse = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/query", {
    assetIds: ["apple-cloud-id-1", "missing-asset"],
  }, connectorHeaders));
  assert.equal(queryResponse.status, 200);
  const query = await queryResponse.json();
  assert.equal(query.count, 1);
  assert.equal(query.decisions["apple-cloud-id-1"].rating, 4);
  assert.equal(query.decisions["apple-cloud-id-1"].pickState, "picked");

  const batchResponse = await worker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/apply-batch", {
    decisions: [
      { assetId: "apple-cloud-id-batch", action: "rating", rating: 5 },
      { assetId: "apple-cloud-id-batch", action: "pick" },
    ],
  }, connectorHeaders));
  assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json();
  assert.equal(batch.count, 2);
  assert.equal(batch.items[0].state.rating, 5);
  assert.equal(batch.items[0].state.pickState, "undecided");
  assert.equal(batch.items[1].state.rating, 5);
  assert.equal(batch.items[1].state.pickState, "picked");

  const clientWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("client@example.com"),
    accessUserRegistry: createMemoryAccessUserRegistry([{ email: "client@example.com", tier: "re_client" }]),
  });
  const forbidden = await clientWorker.fetch(jsonRequest("https://worker.test/owner/sidecar/decisions/apply", {
    assetId: "apple-cloud-id-1",
    action: "pick",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(forbidden.status, 503);
  assert.equal((await forbidden.json()).error.code, "google_auth_unavailable");
});

test("D1 sidecar decision queries stay below the bound-variable ceiling", async () => {
  const boundCounts = [];
  const database = {
    prepare() {
      return {
        bind(...values) {
          boundCounts.push(values.length);
          return {
            async all() {
              if (values.length > 100) throw new Error("too many SQL variables");
              return { results: [] };
            },
          };
        },
      };
    },
  };
  const store = createD1SidecarStateStore({ database });

  await store.queryDecisions({
    assetIds: Array.from({ length: 205 }, (_, index) => `asset-${index}`),
  });

  assert.deepEqual(boundCounts, [80, 80, 45]);
});

test("access console requires an enrolled Backstage-device admin and writes reversible role grants", async () => {
  const registry = createMemoryAccessUserRegistry([
    { email: "owner@example.com", tier: "owner" },
  ]);
  const directGoogleAdmin = {
    email: "ec92009@gmail.com",
    provider: "google-oauth",
    purpose: "browser",
    expiresAt: "2026-08-12T13:00:00.000Z",
    sessionSeconds: 3600,
  };
  const directGoogleAdminWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: {
      optionalSession: async () => directGoogleAdmin,
      requireSession: async () => directGoogleAdmin,
    },
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const directGoogleForbidden = await directGoogleAdminWorker.fetch(new Request("https://worker.test/access-console/state", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(directGoogleForbidden.status, 403);
  assert.equal((await directGoogleForbidden.json()).error.code, "backstage_device_session_required");

  const nonAdminBackstage = backstageOwnerFixture("owner@example.com");
  const nonAdminWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: nonAdminBackstage.googleOAuthAuth,
    ownerDeviceAuthStore: nonAdminBackstage.ownerDeviceAuthStore,
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const forbidden = await nonAdminWorker.fetch(new Request("https://worker.test/access-console/state", {
    headers: nonAdminBackstage.headers,
  }));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "admin_role_required");
  const policyForbidden = await nonAdminWorker.fetch(new Request("https://worker.test/access-console/gallery-access?galleryKind=event&galleryKey=johnson-palmer-wedding", {
    headers: nonAdminBackstage.headers,
  }));
  assert.equal(policyForbidden.status, 403);

  const adminBackstage = backstageOwnerFixture("ec92009@gmail.com");
  const adminHeaders = adminBackstage.headers;
  const adminWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: adminBackstage.googleOAuthAuth,
    ownerDeviceAuthStore: adminBackstage.ownerDeviceAuthStore,
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const stateResponse = await adminWorker.fetch(new Request("https://worker.test/access-console/state", {
    headers: adminHeaders,
  }));
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.bootstrapAdminEmail, "ec92009@gmail.com");
  assert.equal(state.roles.find((role) => role.id === "admin")?.grantable, false);

  const adminGrantResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people", {
    email: "helper@example.test",
    roles: ["admin"],
  }, adminHeaders));
  assert.equal(adminGrantResponse.status, 400);

  const writeResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people", {
    email: "helper@example.test",
    displayName: "Helper Example",
    roles: ["user", "owner"],
    notes: "Temporary ACS rehearsal owner.",
  }, adminHeaders));
  assert.equal(writeResponse.status, 200);
  const writeBody = await writeResponse.json();
  assert.equal(writeBody.user.email, "helper@example.test");
  assert.equal(writeBody.user.tier, "owner");
  assert.deepEqual(writeBody.user.roles, ["user", "owner"]);

  const helperWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("helper@example.test"),
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const helperSessionResponse = await helperWorker.fetch(new Request("https://worker.test/owner/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(helperSessionResponse.status, 200);
  const helperSession = await helperSessionResponse.json();
  assert.equal(helperSession.tier, "owner");
  assert.equal(helperSession.roles.includes("owner"), true);

  const seedResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/fixtures/seed", {}, adminHeaders));
  assert.equal(seedResponse.status, 200);
  const seedBody = await seedResponse.json();
  assert.equal(seedBody.fixtures.users.some((user) => user.fixture && !user.disabledAt), false);
  assert.equal(seedBody.fixtures.events.find((event) => event.id === "fixture-expo")?.visibility, "public");
  assert.equal(seedBody.fixtures.events.find((event) => event.id === "fixture-travel")?.visibility, "public");
  assert.equal(seedBody.fixtures.events.find((event) => event.id === "fixture-re")?.visibility, "private");
  assert.equal(seedBody.fixtures.events.find((event) => event.id === "fixture-re")?.groupId, "");
  assert.equal(seedBody.fixtures.events.find((event) => event.id === "fixture-la-concha")?.parentId, "fixture-re");
  assert.equal(seedBody.fixtures.events.find((event) => event.id === "fixture-la-concha-apartment-1")?.visibility, "inherit");
  assert.deepEqual(seedBody.fixtures.groups.filter((group) => group.state !== "archived").map((group) => group.id), ["re-la-concha"]);
  assert.deepEqual((await registry.getUser("corine.bn2007@yahoo.fr")).groupIds, ["re-la-concha"]);

  const groupResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/groups", {
    id: "cohen-cousins",
    label: "Cohen cousins",
    kind: "family",
    galleryKind: "event",
    galleryKey: "cohen-cousins",
    accessPolicy: "family rehearsal previews with watermarks and normal download rules",
    capabilities: ["view_gallery", "view_watermarked", "download_items"],
    galleryDefaults: {
      watermarked: true,
      saleEnabled: true,
      downloads: true,
      pdf: false,
      video: false,
      memberOriginals: false,
      ownerOriginals: true,
    },
  }, adminHeaders));
  assert.equal(groupResponse.status, 200);
  const groupBody = await groupResponse.json();
  assert.equal(groupBody.group.id, "cohen-cousins");
  assert.equal(groupBody.group.state, "active");
  assert.equal(groupBody.group.galleryDefaults.downloads, true);
  assert.equal(groupBody.group.galleryDefaults.ownerOriginals, true);

  const cousinResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people", {
    email: "cousin@example.test",
    displayName: "Cohen Cousin",
    roles: ["user"],
    groupIds: ["cohen-cousins"],
  }, adminHeaders));
  assert.equal(cousinResponse.status, 200);
  const cousinBody = await cousinResponse.json();
  assert.deepEqual(cousinBody.user.groupIds, ["cohen-cousins"]);
  assert.equal(cousinBody.user.effectiveAccess.scopes.some((scope) => scope.galleryKey === "cohen-cousins"), true);
  assert.equal(cousinBody.user.effectiveAccess.scopes.find((scope) => scope.galleryKey === "cohen-cousins").galleryDefaults.ownerOriginals, true);

  const attendeeResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people", {
    email: "attendee@example.test",
    displayName: "Cohen Cousin Two",
    roles: ["user"],
    groupIds: ["cohen-cousins"],
  }, adminHeaders));
  assert.equal(attendeeResponse.status, 200);
  const attendeeBody = await attendeeResponse.json();
  assert.deepEqual(attendeeBody.user.groupIds, ["cohen-cousins"]);
  assert.equal(attendeeBody.user.groups[0].label, "Cohen cousins");
  assert.equal(attendeeBody.user.effectiveAccess.scopes.some((scope) => scope.galleryKey === "cohen-cousins"), true);

  const policyResponse = await adminWorker.fetch(new Request("https://worker.test/access-console/gallery-access?galleryKind=event&galleryKey=cohen-cousins&email=attendee%40example.test&ownerOriginals=1", {
    headers: adminHeaders,
  }));
  assert.equal(policyResponse.status, 200);
  const policyBody = await policyResponse.json();
  assert.equal(policyBody.gallery.label, "Cohen cousins");
  assert.equal(policyBody.decisions.visitor.allowed, false);
  assert.equal(policyBody.decisions.visitor.access.previewMode, "blocked");
  assert.equal(policyBody.decisions.selected.allowed, true);
  assert.equal(policyBody.decisions.selected.access.previewMode, "watermarked");
  assert.equal(policyBody.decisions.selected.access.assignedDownloads, true);
  assert.equal(policyBody.decisions.selected.access.checkout, true);
  assert.equal(policyBody.decisions.owner.allowed, true);
  assert.equal(policyBody.decisions.owner.access.previewMode, "originals");

  const reGroupResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people", {
    email: "la-concha-member@example.test",
    displayName: "La Concha Member",
    roles: ["user"],
    groupIds: ["re-la-concha"],
  }, adminHeaders));
  assert.equal(reGroupResponse.status, 200);

  const reGroupWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("la-concha-member@example.test"),
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
  });
  const reGroupSessionResponse = await reGroupWorker.fetch(new Request("https://worker.test/auth/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(reGroupSessionResponse.status, 200);
  const reGroupSession = await reGroupSessionResponse.json();
  assert.equal(reGroupSession.roles.includes("re_client"), true);
  assert.deepEqual(reGroupSession.realEstateClients, ["corine-real-estate"]);

  const corinePasswordResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people", {
    email: "corine@example.test",
    displayName: "Corine",
    roles: ["user", "re_client"],
    realEstateClients: ["re-la-concha"],
    groupIds: ["re-la-concha"],
    passwordLogin: {
      loginName: "Corine",
      password: "fresh-private-password",
      galleryKeys: ["re-la-concha"],
    },
  }, adminHeaders));
  assert.equal(corinePasswordResponse.status, 200);
  const corinePasswordBody = await corinePasswordResponse.json();
  assert.deepEqual(corinePasswordBody.user.realEstateClients, ["corine-real-estate"]);
  assert.equal(corinePasswordBody.credentials[0].galleryKey, "corine-real-estate");
  assert.equal(corinePasswordBody.credentials[0].passwordSet, true);
  assert.equal("passwordHash" in corinePasswordBody.credentials[0], false);

  const passwordAuth = createRealEstateAuth({
    galleries: [{ key: "Corine-gallery", username: "Corine", privateMasterPrefix: "real-estate/corine-real-estate/masters" }],
    credentialStore: registry,
    sessionSecret: "access-console-password-test-secret",
  });
  const passwordWorker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    realEstateAuth: passwordAuth,
  });
  const passwordLoginResponse = await passwordWorker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "fresh-private-password",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(passwordLoginResponse.status, 200);
  const passwordSessionCookie = (passwordLoginResponse.headers.get("set-cookie") || "").split(";")[0];
  assert.match(passwordSessionCookie, /^pbe_re_session=/);

  const caseFoldedPasswordLoginResponse = await passwordWorker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    galleryKey: "corine-real-estate",
    username: "corine",
    accessCode: "fresh-private-password",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(caseFoldedPasswordLoginResponse.status, 200);

  const genericPasswordLoginResponse = await passwordWorker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    username: "CORINE",
    accessCode: "fresh-private-password",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(genericPasswordLoginResponse.status, 200);
  assert.equal((await genericPasswordLoginResponse.json()).session.galleryKey, "corine-real-estate");

  const wrongCasePasswordLoginResponse = await passwordWorker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    username: "Corine",
    accessCode: "Fresh-private-password",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(wrongCasePasswordLoginResponse.status, 403);

  assert.equal(REAL_ESTATE_PASSWORD_ITERATIONS, 100_000);
  assert.equal(
    await realEstatePasswordHash("fresh-private-password", "test-salt", 210_000),
    await realEstatePasswordHash("fresh-private-password", "test-salt", 100_000)
  );

  const archiveGroupResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/groups/cohen-cousins/archive", {}, adminHeaders));
  assert.equal(archiveGroupResponse.status, 200);
  const archiveGroupBody = await archiveGroupResponse.json();
  assert.equal(archiveGroupBody.group.state, "archived");

  const archivedPolicyResponse = await adminWorker.fetch(new Request("https://worker.test/access-console/gallery-access?galleryKind=event&galleryKey=cohen-cousins&email=cousin%40example.test", {
    headers: adminHeaders,
  }));
  assert.equal(archivedPolicyResponse.status, 200);
  const archivedPolicy = await archivedPolicyResponse.json();
  assert.equal(archivedPolicy.gallery.groupId, "");
  assert.equal(archivedPolicy.decisions.selected.allowed, false);
  assert.equal(archivedPolicy.decisions.selected.access.previewMode, "blocked");

  const disableResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people/helper%40example.test/disable", {}, adminHeaders));
  assert.equal(disableResponse.status, 200);
  const disabledBody = await disableResponse.json();
  assert.equal(disabledBody.user.tier, "user");
  assert.deepEqual(disabledBody.user.roles, ["user"]);
  assert.ok(disabledBody.user.disabledAt);

  const disabledOwnerSession = await helperWorker.fetch(new Request("https://worker.test/owner/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(disabledOwnerSession.status, 403);

  const finalStateResponse = await adminWorker.fetch(new Request("https://worker.test/access-console/state", {
    headers: adminHeaders,
  }));
  const finalState = await finalStateResponse.json();
  assert.equal(finalState.audienceGroups.some((group) => group.label === "RE La Concha"), true);
  assert.equal(finalState.audienceGroups.find((group) => group.id === "cohen-cousins")?.state, "archived");
  assert.equal(finalState.galleryOptions.some((option) => option.galleryKey === "cohen-cousins"), false);
  assert.deepEqual(finalState.people.find((user) => user.email === "cousin@example.test")?.groupIds, []);
  assert.equal(finalState.galleryOptions.some((option) => option.galleryKey === "corine-real-estate"), true);
  assert.equal(finalState.realEstateCredentials.find((credential) => credential.email === "corine@example.test")?.passwordSet, true);
  assert.equal("passwordHash" in finalState.realEstateCredentials[0], false);

  const disableCorineResponse = await adminWorker.fetch(jsonRequest("https://worker.test/access-console/people/corine%40example.test/disable", {}, adminHeaders));
  assert.equal(disableCorineResponse.status, 200);
  const revokedPasswordLogin = await passwordWorker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "fresh-private-password",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(revokedPasswordLogin.status, 403);
  const revokedPasswordSession = await passwordWorker.fetch(new Request("https://worker.test/real-estate/session?galleryKey=corine-real-estate", {
    headers: { origin: "https://photos-by-elie.com", cookie: passwordSessionCookie },
  }));
  assert.equal(revokedPasswordSession.status, 401);
  assert.equal(finalState.capabilities.some((capability) => capability.id === "manage_access"), true);
  const archivedEvent = finalState.auditEvents.find((event) => event.eventType === "group_archived");
  const disabledEvent = finalState.auditEvents.find((event) => event.eventType === "user_disabled");
  assert.equal(Boolean(archivedEvent?.id), true);
  assert.equal(Boolean(disabledEvent?.id), true);
  assert.equal(archivedEvent.targetType, "group");
  assert.equal(archivedEvent.targetId, "cohen-cousins");
  assert.equal(archivedEvent.reversible, true);
  assert.equal(disabledEvent.targetType, "person");
  assert.equal(disabledEvent.targetEmail, "helper@example.test");
  assert.equal(disabledEvent.reversible, true);

  const undoDisableResponse = await adminWorker.fetch(jsonRequest(`https://worker.test/access-console/audit/${disabledEvent.id}/undo`, {}, adminHeaders));
  assert.equal(undoDisableResponse.status, 200);
  const undoDisableBody = await undoDisableResponse.json();
  assert.equal(undoDisableBody.event.revertedAt.length > 0, true);
  assert.equal(undoDisableBody.undoEvent.eventType, "access_undo");
  assert.equal(undoDisableBody.restored.email, "helper@example.test");

  const restoredOwnerSessionResponse = await helperWorker.fetch(new Request("https://worker.test/owner/session", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(restoredOwnerSessionResponse.status, 200);

  const undoArchiveResponse = await adminWorker.fetch(jsonRequest(`https://worker.test/access-console/audit/${archivedEvent.id}/undo`, {}, adminHeaders));
  assert.equal(undoArchiveResponse.status, 200);
  const undoArchiveBody = await undoArchiveResponse.json();
  assert.equal(undoArchiveBody.event.revertedAt.length > 0, true);
  assert.equal(undoArchiveBody.undoEvent.eventType, "access_undo");
  assert.equal(undoArchiveBody.restored.id, "cohen-cousins");

  const undoStateResponse = await adminWorker.fetch(new Request("https://worker.test/access-console/state", {
    headers: adminHeaders,
  }));
  const undoState = await undoStateResponse.json();
  assert.equal(undoState.audienceGroups.find((group) => group.id === "cohen-cousins")?.state, "active");
  assert.equal(undoState.galleryOptions.some((option) => option.galleryKey === "cohen-cousins"), true);
  assert.deepEqual(undoState.people.find((user) => user.email === "cousin@example.test")?.groupIds, ["cohen-cousins"]);
  assert.equal(undoState.auditEvents.some((event) => event.eventType === "access_undo"), true);
});

test("real-estate access login issues a scoped session for a Google-authenticated client", async () => {
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    email: "corine@example.com",
    accessCode: "legacy-code",
    privateMasterPrefix: "real-estate/corine-real-estate/masters",
  }, {
    key: "elie-real-estate",
    username: "Elie",
    email: "elie@example.com",
    accessCode: "legacy-code",
    privateMasterPrefix: "real-estate/elie-real-estate/masters",
  }];
  const registry = createMemoryAccessUserRegistry([{
    email: "corine@example.com",
    tier: "re_client",
    realEstateClients: ["corine-real-estate"],
  }]);
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    accessAuth: fakeAccessAuthFor("corine@example.com"),
    accessUserRegistry: registry,
    accessAdminEmail: "ec92009@gmail.com",
    authAllowedReturnOrigins: ["https://photos-by-elie.com"],
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now: () => new Date("2026-05-17T12:00:00.000Z"),
    }),
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/real-estate/access-login", {
    galleryKey: "corine-real-estate",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") || "", /^pbe_re_session=/);
  const body = await response.json();
  assert.equal(body.session.galleryKey, "corine-real-estate");
  assert.equal(body.access.realEstateClients[0], "corine-real-estate");

  const cookie = (response.headers.get("set-cookie") || "").split(";")[0];
  const sessionResponse = await worker.fetch(new Request("https://worker.test/real-estate/session?galleryKey=corine-real-estate", {
    headers: { cookie, origin: "https://photos-by-elie.com" },
  }));
  assert.equal(sessionResponse.status, 200);

  const forbiddenResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/access-login", {
    galleryKey: "elie-real-estate",
  }, { origin: "https://photos-by-elie.com" }));
  assert.equal(forbiddenResponse.status, 403);

  const redirectResponse = await worker.fetch(new Request(
    "https://worker.test/real-estate/access-login?galleryKey=corine-real-estate&returnTo=https%3A%2F%2Fphotos-by-elie.com%2Freal-estate.html%3Fclient%3Dcorine",
    { headers: { origin: "https://photos-by-elie.com" } }
  ));
  assert.equal(redirectResponse.status, 302);
  assert.equal(redirectResponse.headers.get("location"), "https://photos-by-elie.com/real-estate.html?client=corine");
  assert.match(redirectResponse.headers.get("set-cookie") || "", /^pbe_re_session=/);
});

test("real-estate Owner bypass requires Backstage while explicit Google client grants remain valid", async () => {
  const galleryKey = "corine-real-estate";
  const identities = new Map([
    ["direct-admin", {
      email: "ec92009@gmail.com",
      provider: "google-oauth",
      purpose: "browser",
      expiresAt: "2026-08-12T13:00:00.000Z",
      sessionSeconds: 3600,
    }],
    ["direct-client", {
      email: "corine@example.com",
      provider: "google-oauth",
      purpose: "browser",
      expiresAt: "2026-08-12T13:00:00.000Z",
      sessionSeconds: 3600,
    }],
    ["backstage-admin", {
      email: "ec92009@gmail.com",
      provider: "backstage-device",
      purpose: "backstage-api",
      deviceId: "owner-device-enrolled-mac",
      expiresAt: "2026-08-12T12:15:00.000Z",
      sessionSeconds: 900,
    }],
  ]);
  const identityFor = (request) => identities.get(
    String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  ) || null;
  const googleOAuthAuth = {
    optionalSession: async (request) => identityFor(request),
    requireSession: async (request) => {
      const identity = identityFor(request);
      if (identity) return identity;
      throw Object.assign(new Error("Google login is required."), {
        status: 401,
        code: "google_auth_required",
      });
    },
  };
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth,
    ownerDeviceAuthStore: {
      getDevice: async (deviceId) => deviceId === "owner-device-enrolled-mac" ? {
        id: deviceId,
        email: "ec92009@gmail.com",
        name: "Enrolled Backstage Mac",
        platform: "macOS",
        revokedAt: "",
      } : null,
    },
    accessUserRegistry: createMemoryAccessUserRegistry([{
      email: "corine@example.com",
      tier: "re_client",
      realEstateClients: [galleryKey],
    }]),
    accessAdminEmail: "ec92009@gmail.com",
    realEstateAuth: createRealEstateAuth({
      galleries: [{
        key: galleryKey,
        username: "Corine",
        privateMasterPrefix: "real-estate/corine-real-estate/masters",
      }],
      sessionSecret: "owner-real-estate-bypass-test-secret",
    }),
  });
  const headersFor = (token) => ({
    authorization: `Bearer ${token}`,
    origin: "https://photos-by-elie.com",
  });

  const directAdmin = await worker.fetch(jsonRequest("https://worker.test/real-estate/access-login", {
    galleryKey,
  }, headersFor("direct-admin")));
  assert.equal(directAdmin.status, 403);
  assert.equal((await directAdmin.json()).error.code, "real_estate_gallery_forbidden");

  const grantedClient = await worker.fetch(jsonRequest("https://worker.test/real-estate/access-login", {
    galleryKey,
  }, headersFor("direct-client")));
  assert.equal(grantedClient.status, 200);
  assert.equal((await grantedClient.json()).session.galleryKey, galleryKey);

  const backstageOwner = await worker.fetch(jsonRequest("https://worker.test/real-estate/access-login", {
    galleryKey,
  }, headersFor("backstage-admin")));
  assert.equal(backstageOwner.status, 200);
  assert.equal((await backstageOwner.json()).session.galleryKey, galleryKey);
});

test("direct Google OAuth session feeds account roles, RE login, and logout", async () => {
  const now = () => new Date("2026-06-21T12:00:00.000Z");
  const googleAuth = createGoogleOAuthAuth({
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    sessionSecret: "google-session-secret",
    now,
    fetcher: async () => new Response(JSON.stringify({ id_token: "client-id-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    verifyIdToken: async () => ({
      email: "corine@example.com",
      provider: "google-oauth",
      expiresAt: "2026-06-21T13:00:00.000Z",
      sessionSeconds: 3600,
    }),
  });
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    email: "corine@example.com",
    accessCode: "legacy-code",
    privateMasterPrefix: "real-estate/corine-real-estate/masters",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: googleAuth,
    accessUserRegistry: createMemoryAccessUserRegistry([{
      email: "corine@example.com",
      tier: "re_client",
      realEstateClients: ["corine-real-estate"],
    }]),
    accessAdminEmail: "ec92009@gmail.com",
    authAllowedReturnOrigins: ["https://photos-by-elie.com"],
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now,
    }),
  });

  const loginResponse = await worker.fetch(new Request(
    "https://worker.test/auth/google/login?returnTo=https%3A%2F%2Fphotos-by-elie.com%2F%3Faccount%3D1",
    { headers: { origin: "https://photos-by-elie.com" } }
  ));
  assert.equal(loginResponse.status, 302);
  const googleLoginUrl = new URL(loginResponse.headers.get("location"));
  assert.equal(googleLoginUrl.origin, "https://accounts.google.com");
  assert.equal(googleLoginUrl.searchParams.get("prompt"), "select_account");

  const callbackResponse = await worker.fetch(new Request(
    `https://worker.test/auth/google/callback?code=oauth-code&state=${encodeURIComponent(googleLoginUrl.searchParams.get("state"))}`,
    { headers: { origin: "https://photos-by-elie.com" } }
  ));
  assert.equal(callbackResponse.status, 302);
  assert.equal(callbackResponse.headers.get("location"), "https://photos-by-elie.com/?account=1");
  assert.match(callbackResponse.headers.get("set-cookie") || "", /^pbe_google_session=/);
  assert.match(callbackResponse.headers.get("set-cookie") || "", /SameSite=None/);
  assert.match(callbackResponse.headers.get("set-cookie") || "", /Secure/);
  const googleCookie = (callbackResponse.headers.get("set-cookie") || "").split(";")[0];

  const sessionResponse = await worker.fetch(new Request("https://worker.test/auth/session", {
    headers: { cookie: googleCookie, origin: "https://photos-by-elie.com" },
  }));
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.email, "corine@example.com");
  assert.equal(session.user.provider, "google-oauth");
  assert.equal(session.tier, "re_client");
  assert.deepEqual(session.realEstateClients, ["corine-real-estate"]);

  const accessResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/access-login", {
    galleryKey: "corine-real-estate",
  }, { cookie: googleCookie, origin: "https://photos-by-elie.com" }));
  assert.equal(accessResponse.status, 200);
  assert.match(accessResponse.headers.get("set-cookie") || "", /^pbe_re_session=/);

  const logoutResponse = await worker.fetch(new Request(
    "https://worker.test/auth/logout?returnTo=https%3A%2F%2Fphotos-by-elie.com%2F%3Faccount%3D1",
    { headers: { cookie: googleCookie, origin: "https://photos-by-elie.com" } }
  ));
  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.get("location"), "https://photos-by-elie.com/?account=1");
  const logoutCookies = logoutResponse.headers.getSetCookie();
  assert.equal(logoutCookies.length, 2);
  assert.match(logoutCookies[0], /^pbe_google_session=; Max-Age=0/);
  assert.match(logoutCookies[0], /SameSite=None/);
  assert.match(logoutCookies[0], /Secure/);
  assert.match(logoutCookies[1], /^pbe_re_session=; Max-Age=0/);
  assert.match(logoutCookies[1], /Path=\/real-estate/);
});

test("direct Google OAuth rejects local and Tailscale provisioning origins", async () => {
  const now = () => new Date("2026-06-21T12:00:00.000Z");
  const googleAuth = createGoogleOAuthAuth({
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    sessionSecret: "google-session-secret",
    now,
    fetcher: async () => new Response(JSON.stringify({ id_token: "owner-id-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    verifyIdToken: async () => ({
      email: "ec92009@gmail.com",
      provider: "google-oauth",
      expiresAt: "2026-06-21T13:00:00.000Z",
      sessionSeconds: 3600,
    }),
  });
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    googleOAuthAuth: googleAuth,
    accessUserRegistry: createMemoryAccessUserRegistry([]),
    accessAdminEmail: "ec92009@gmail.com",
  });
  const localOrigin = "http://100.111.30.109:8000";
  const returnTo = `${localOrigin}/owner.html`;

  const loginResponse = await worker.fetch(new Request(
    `https://worker.test/auth/google/login?returnTo=${encodeURIComponent(returnTo)}`,
    { headers: { origin: localOrigin } }
  ));
  assert.equal(loginResponse.status, 403);
  assert.equal(loginResponse.headers.get("access-control-allow-origin"), "null");
  assert.equal((await loginResponse.json()).error.code, "cors_origin_forbidden");
});

test("checkout and download milestones record analytics without buyer identifiers", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const analyticsKv = createFakeKv();
  const { worker } = (() => {
    const randomUUID = deterministicIds();
    return {
      worker: createPhotosByElieWorker({
        catalog,
        store: createMemoryStore(),
        stripe: createMockStripeClient({ randomUUID }),
        analytics: createAnalyticsStore({
          namespace: analyticsKv,
          prefix: "test",
          now: () => new Date("2026-05-07T12:00:00.000Z"),
        }),
        now: () => new Date("2026-05-07T12:00:00.000Z"),
        randomUUID,
      }),
    };
  })();

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  const downloadPath = paid.order.delivery.files?.[0]?.downloadUrl || paid.order.delivery.downloadUrl;
  assert.ok(downloadPath);
  const downloadResponse = await worker.fetch(new Request(`https://worker.test${downloadPath}`));
  assert.equal(downloadResponse.status, 200);

  const events = [...analyticsKv._debug.entries()]
    .filter(([key]) => key.startsWith("test:analytics:events:2026-05-07:"))
    .map(([, value]) => JSON.parse(value));
  assert.deepEqual(events.map((event) => event.event).sort(), [
    "checkout_session_created",
    "download_success",
    "payment_completed",
  ]);
  assert.ok(events.every((event) => event.email === undefined && event.orderId === undefined));
  assert.equal(events.find((event) => event.event === "download_success")?.downloadType, "archive");
});

const createFakeEmailClient = ({ fail = false } = {}) => {
  const sent = [];
  return {
    provider: "fake-email",
    sent,
    send: async (email) => {
      sent.push(email);
      if (fail) {
        throw Object.assign(new Error("Email provider unavailable."), {
          code: "fake_email_failed",
        });
      }
      return {
        provider: "fake-email",
        messageId: `msg_${String(sent.length).padStart(3, "0")}`,
        idempotencyKey: email.idempotencyKey,
      };
    },
  };
};

const createPerFileTestDelivery = (now = () => new Date("2026-05-07T12:00:00.000Z")) => ({
  validateOrder: async () => ({ ok: true }),
  createDelivery: async (order) => ({
    readyAt: now().toISOString(),
    files: order.items.flatMap((item) => item.products.map((product) => {
      const safeProduct = String(product.id).replace(/[^A-Za-z0-9_-]+/g, "-");
      const token = `dl_test_${safeProduct}`;
      return {
        token,
        photoId: item.photoId,
        title: item.title,
        productId: product.id,
        productLabel: product.label,
        bucket: "private",
        objectKey: item.source.privateMasterKey,
        name: `${item.photoId}-${safeProduct}.jpg`,
        downloadUrl: `/download/${token}`,
        bytes: 123,
        contentType: "image/jpeg",
      };
    })),
    items: [],
  }),
});

const createFakeR2 = (initial = {}) => {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, {
    body: value.body instanceof Uint8Array ? value.body : new Uint8Array(value.body),
    httpMetadata: value.httpMetadata || {},
    customMetadata: value.customMetadata || {},
  }]));
  return {
    head: async (key) => {
      const value = values.get(key);
      if (!value) return null;
      return {
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        size: value.body.byteLength,
      };
    },
    get: async (key, options = {}) => {
      const value = values.get(key);
      if (!value) return null;
      const range = options.range || null;
      const start = Number.isInteger(range?.offset) ? Math.max(0, range.offset) : 0;
      const end = Number.isInteger(range?.length) ? Math.min(value.body.byteLength, start + range.length) : value.body.byteLength;
      const body = value.body.slice(start, end);
      return {
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        size: value.body.byteLength,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        body,
      };
    },
    put: async (key, body, options = {}) => {
      let bytes = null;
      if (body instanceof Uint8Array) bytes = body;
      else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
      else if (typeof body?.arrayBuffer === "function") bytes = new Uint8Array(await body.arrayBuffer());
      else if (body && typeof body.getReader === "function") bytes = new Uint8Array(await new Response(body).arrayBuffer());
      else bytes = new Uint8Array(body);
      values.set(key, {
        body: bytes,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      });
      return {
        key,
        size: bytes.byteLength,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      };
    },
    delete: async (key) => {
      values.delete(key);
    },
    list: async ({ prefix = "", limit = 1000 } = {}) => {
      const objects = [...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit)
        .map(([key, value]) => ({
          key,
          size: value.body.byteLength,
          httpMetadata: value.httpMetadata,
          customMetadata: value.customMetadata,
        }));
      return { objects, truncated: false };
    },
    _debug: values,
  };
};

const createTestJpeg = (width = 64, height = 48) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = Math.round((x / width) * 255);
      data[index + 1] = Math.round((y / height) * 255);
      data[index + 2] = 120;
      data[index + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 90).data;
};

const createFakeImagesBinding = ({ output = createTestJpeg(32, 24), info = { width: 64, height: 48 } } = {}) => {
  const calls = [];
  return {
    calls,
    info: async () => info,
    input: () => {
      const call = { transforms: [], output: null };
      calls.push(call);
      return {
        transform(options = {}) {
          call.transforms.push(options);
          return this;
        },
        async output(options = {}) {
          call.output = options;
          return {
            response: () => new Response(output, {
              headers: { "content-type": "image/jpeg" },
            }),
          };
        },
      };
    },
  };
};

test("guest checkout creates a pending order and mock Stripe session", async () => {
  const catalog = loadCatalog();
  const { worker } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-3mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.match(body.order.id, /^PBE-20260507-/);
  assert.equal(body.order.status, "pending_payment");
  assert.equal(body.order.currency, "usd");
  assert.equal(body.order.items[0].products.length, 2);
  assert.equal(body.order.amountExpected, orderProductTotal(body.order.items[0]));
  assert.match(body.checkout.url, /^https:\/\/mock\.stripe\.local\/checkout\/cs_mock_/);
});

test("signed-in account remembers likes, basket, orders, and redownload access", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe: createMockStripeClient({ randomUUID }),
    delivery: createPerFileTestDelivery(now),
    accessAuth: fakeAccessAuthFor("buyer@example.com"),
    now,
    randomUUID,
  });
  const origin = "https://photos-by-elie.com";

  const preflightResponse = await worker.fetch(new Request("https://worker.test/account/profile", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "content-type",
    },
  }));
  assert.equal(preflightResponse.status, 200);
  assert.match(preflightResponse.headers.get("access-control-allow-methods"), /\bPATCH\b/);
  assert.match(preflightResponse.headers.get("access-control-allow-methods"), /\bPUT\b/);

  const emptyProfileResponse = await worker.fetch(new Request("https://worker.test/account/profile", {
    headers: { origin },
  }));
  assert.equal(emptyProfileResponse.status, 200);
  assert.equal(emptyProfileResponse.headers.get("access-control-allow-credentials"), "true");
  const emptyProfile = await emptyProfileResponse.json();
  assert.deepEqual(emptyProfile.profile.liked, []);
  assert.deepEqual(emptyProfile.profile.basket, []);
  assert.deepEqual(emptyProfile.orders, []);

  const saveProfileResponse = await worker.fetch(jsonRequest("https://worker.test/account/profile", {
    liked: [{ photoId }],
    basket: [{ photoId, options: [{ id: "full" }] }],
    language: "fr",
    theme: "dark",
    galleryCheckpoints: [
      {
        collectionKey: "spain",
        photoId,
        filterState: { query: "Spain", orientation: "landscape", sort: "oldest" },
        windowStart: 96,
        windowEnd: 999,
        anchorOffset: 42.5,
        updatedAt: "2026-05-07T11:59:00.000Z",
      },
      {
        collectionKey: "invalid key",
        photoId: "missing-photo",
        updatedAt: "2026-05-07T11:59:30.000Z",
      },
    ],
  }, { origin }));
  assert.equal(saveProfileResponse.status, 200);
  const savedProfile = await saveProfileResponse.json();
  assert.equal(savedProfile.profile.email, "buyer@example.com");
  assert.equal(savedProfile.profile.liked[0].photoId, photoId);
  assert.equal(savedProfile.profile.basket[0].photoId, photoId);
  assert.equal(savedProfile.profile.basket[0].options[0].id, "full");
  assert.equal(savedProfile.profile.language, "fr");
  assert.equal(savedProfile.profile.theme, "dark");
  assert.equal(savedProfile.profile.galleryCheckpoints.length, 1);
  assert.equal(savedProfile.profile.galleryCheckpoints[0].collectionKey, "spain");
  assert.equal(savedProfile.profile.galleryCheckpoints[0].windowStart, 96);
  assert.equal(savedProfile.profile.galleryCheckpoints[0].windowEnd, 288);
  assert.equal(savedProfile.profile.galleryCheckpoints[0].anchorOffset, 42.5);

  const mismatchResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/account", {
    email: "other@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }, { origin }));
  assert.equal(mismatchResponse.status, 403);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/account", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }, { origin }));
  assert.equal(checkoutResponse.status, 201);
  assert.equal(checkoutResponse.headers.get("access-control-allow-credentials"), "true");
  const checkout = await checkoutResponse.json();
  assert.equal(checkout.order.checkoutMode, "account");
  assert.equal(checkout.order.buyerEmail, "buyer@example.com");

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.files.length, 1);

  const accountProfileResponse = await worker.fetch(new Request("https://worker.test/account/profile", {
    headers: { origin },
  }));
  assert.equal(accountProfileResponse.status, 200);
  assert.equal(accountProfileResponse.headers.get("cache-control"), "private, no-store");
  const accountProfile = await accountProfileResponse.json();
  assert.equal(accountProfile.orders.length, 1);
  assert.equal(accountProfile.profile.galleryCheckpoints[0].photoId, photoId);
  assert.equal(accountProfile.orders[0].id, paid.order.id);
  assert.equal(accountProfile.orders[0].delivery.files[0].downloadUrl, paid.order.delivery.files[0].downloadUrl);

  const accountOrderResponse = await worker.fetch(new Request(`https://worker.test/account/orders/${paid.order.id}`, {
    headers: { origin },
  }));
  assert.equal(accountOrderResponse.status, 200);
  assert.equal(accountOrderResponse.headers.get("cache-control"), "private, no-store");
  const accountOrder = await accountOrderResponse.json();
  assert.equal(accountOrder.order.id, paid.order.id);
  assert.equal(accountOrder.order.delivery.files[0].productId, "full");

  const otherAccountWorker = createPhotosByElieWorker({
    catalog,
    store,
    accessAuth: fakeAccessAuthFor("other@example.com"),
  });
  const forbiddenOrderResponse = await otherAccountWorker.fetch(new Request(`https://worker.test/account/orders/${paid.order.id}`, {
    headers: { origin },
  }));
  assert.equal(forbiddenOrderResponse.status, 403);
  assert.equal(forbiddenOrderResponse.headers.get("cache-control"), "private, no-store");
});

test("account profile lifecycle visibility is queried in at most 100-ID chunks", async () => {
  const catalog = loadCatalog();
  const photoIds = [...catalog.photos.keys()].slice(0, 150);
  const store = createMemoryStore();
  await store.putAccountProfile({
    email: "buyer@example.com",
    liked: photoIds.map((photoId) => ({ photoId })),
    basket: [],
    language: "en",
    theme: "auto",
    updatedAt: "2026-08-13T10:00:00.000Z",
  });
  const calls = [];
  const lifecycleDenyStore = allowLifecycleFor([photoIds[149]]);
  const visibilityFor = lifecycleDenyStore.visibilityFor;
  lifecycleDenyStore.visibilityFor = async (ids) => {
    calls.push([...ids]);
    return visibilityFor(ids);
  };
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    accessAuth: fakeAccessAuthFor("buyer@example.com"),
    lifecycleDenyStore,
  });
  const response = await worker.fetch(new Request("https://worker.test/account/profile", {
    headers: { origin: "https://photos-by-elie.com" },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls.map((ids) => ids.length), [100, 50]);
  assert.equal(body.profile.liked.length, 149);
  assert.equal(body.profile.liked.some((item) => item.photoId === photoIds[149]), false);
});

test("signed-in account claims previous guest purchases by checkout email", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const store = createMemoryStore();
  const origin = "https://photos-by-elie.com";
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe: createMockStripeClient({ randomUUID }),
    delivery: createPerFileTestDelivery(now),
    now,
    randomUUID,
  });

  const guestCheckoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "Buyer@Example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(guestCheckoutResponse.status, 201);
  const guestCheckout = await guestCheckoutResponse.json();
  assert.equal(guestCheckout.order.checkoutMode, "guest");
  assert.equal(guestCheckout.order.buyerEmail, "buyer@example.com");

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: guestCheckout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.checkoutMode, "guest");
  assert.equal(paid.order.delivery.files.length, 1);

  const accountWorker = createPhotosByElieWorker({
    catalog,
    store,
    accessAuth: fakeAccessAuthFor("buyer@example.com"),
  });
  const profileResponse = await accountWorker.fetch(new Request("https://worker.test/account/profile", {
    headers: { origin },
  }));
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.deepEqual(profile.profile.liked, []);
  assert.deepEqual(profile.profile.basket, []);
  assert.equal(profile.orders.length, 1);
  assert.equal(profile.orders[0].id, paid.order.id);
  assert.equal(profile.orders[0].checkoutMode, "guest");
  assert.equal(profile.orders[0].delivery.files[0].downloadUrl, paid.order.delivery.files[0].downloadUrl);

  const accountOrderResponse = await accountWorker.fetch(new Request(`https://worker.test/account/orders/${paid.order.id}`, {
    headers: { origin },
  }));
  assert.equal(accountOrderResponse.status, 200);
  const accountOrder = await accountOrderResponse.json();
  assert.equal(accountOrder.order.id, paid.order.id);
  assert.equal(accountOrder.order.checkoutMode, "guest");
  assert.equal(accountOrder.order.delivery.files[0].downloadUrl, paid.order.delivery.files[0].downloadUrl);

  const otherAccountWorker = createPhotosByElieWorker({
    catalog,
    store,
    accessAuth: fakeAccessAuthFor("other@example.com"),
  });
  const forbiddenOrderResponse = await otherAccountWorker.fetch(new Request(`https://worker.test/account/orders/${paid.order.id}`, {
    headers: { origin },
  }));
  assert.equal(forbiddenOrderResponse.status, 403);
});

test("recent purchase lookup reports paid product coverage from Worker order records", async () => {
  const catalog = loadCatalog();
  let currentNow = new Date("2026-05-07T12:00:00.000Z");
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    delivery: createPerFileTestDelivery(() => currentNow),
    now: () => currentNow,
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-3mp" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);

  currentNow = new Date("2026-05-08T12:00:00.000Z");
  const lookupResponse = await worker.fetch(jsonRequest("https://worker.test/purchases/recent", {
    email: "BUYER@example.com",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-1mp" }] }],
  }));
  assert.equal(lookupResponse.status, 200);
  const lookup = await lookupResponse.json();
  assert.equal(lookup.source, "photosbyelie-worker-order-ledger");
  assert.equal(lookup.allowanceDays, 30);
  assert.equal(lookup.coveredCount, 1);

  const full = lookup.items.find((item) => item.photoId === photoId && item.productId === "full");
  assert.equal(full.covered, true);
  assert.equal(full.boundary, "within");
  assert.equal(full.purchasedAt, "2026-05-07T12:00:00.000Z");
  assert.equal(full.allowanceEndsAt, "2026-06-06T12:00:00.000Z");
  assert.equal(full.orderId, undefined);

  const oneMp = lookup.items.find((item) => item.photoId === photoId && item.productId === "jpg-1mp");
  assert.equal(oneMp.covered, false);
  assert.equal(oneMp.boundary, "not_purchased");
});

test("recent purchase lookup treats the exact 30-day boundary as covered", async () => {
  const catalog = loadCatalog();
  let currentNow = new Date("2026-05-07T12:00:00.000Z");
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    delivery: createPerFileTestDelivery(() => currentNow),
    now: () => currentNow,
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  const checkout = await checkoutResponse.json();
  await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));

  currentNow = new Date("2026-06-06T12:00:00.000Z");
  const exactResponse = await worker.fetch(jsonRequest("https://worker.test/purchases/recent", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(exactResponse.status, 200);
  const exact = await exactResponse.json();
  assert.equal(exact.items[0].covered, true);
  assert.equal(exact.items[0].boundary, "exact");
  assert.equal(exact.items[0].allowanceEndsAt, "2026-06-06T12:00:00.000Z");

  currentNow = new Date("2026-06-06T12:00:00.001Z");
  const expiredResponse = await worker.fetch(jsonRequest("https://worker.test/purchases/recent", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(expiredResponse.status, 200);
  const expired = await expiredResponse.json();
  assert.equal(expired.items[0].covered, false);
  assert.equal(expired.items[0].boundary, "expired");
});

test("guest checkout uses current 1 MP price and applies the Stripe minimum when needed", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  const oneMpAmount = catalogOptionCents(catalog, photoId, "jpg-1mp");
  const expectedMinimumAdjustment = Math.max(0, 50 - oneMpAmount);
  assert.equal(body.order.items[0].products[0].amount, oneMpAmount);
  assert.equal(body.order.subtotalAmount, oneMpAmount);
  assert.equal(body.order.minimumChargeAdjustment, expectedMinimumAdjustment);
  assert.equal(body.order.amountExpected, oneMpAmount + expectedMinimumAdjustment);
  const session = stripe._debug.sessions.get(body.checkout.sessionId);
  assert.equal(session.amount_total, oneMpAmount + expectedMinimumAdjustment);
  assert.equal(session.line_items.length, expectedMinimumAdjustment > 0 ? 2 : 1);
});

test("guest checkout applies an allowlisted rehearsal discount server-side", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const stripe = createMockStripeClient({ randomUUID });
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
    discountCodes: [{
      code: "owner-live-rehearsal",
      type: "target_total",
      targetTotalAmount: 50,
      label: "Owner live rehearsal",
    }],
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    discountCode: " owner-live-rehearsal ",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-3mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  const originalSubtotal = orderProductTotal(body.order.items[0]);
  assert.equal(body.order.originalSubtotalAmount, originalSubtotal);
  assert.equal(body.order.subtotalAmount, originalSubtotal);
  assert.equal(body.order.discountCode, "OWNER-LIVE-REHEARSAL");
  assert.equal(body.order.discountLabel, "Owner live rehearsal");
  assert.equal(body.order.discountAmount, originalSubtotal - 50);
  assert.equal(body.order.discountedSubtotalAmount, 50);
  assert.equal(body.order.minimumChargeAdjustment, 0);
  assert.equal(body.order.amountExpected, 50);
  assert.equal(body.order.items[0].products.reduce((sum, product) => sum + Number(product.checkoutAmount || 0), 0), 50);

  const storedOrder = await store.getOrder(body.order.id);
  assert.equal(storedOrder.originalSubtotalAmount, originalSubtotal);
  assert.equal(storedOrder.discountCode, "OWNER-LIVE-REHEARSAL");
  assert.equal(storedOrder.discountAmount, originalSubtotal - 50);
  assert.equal(storedOrder.amountExpected, 50);

  const session = stripe._debug.sessions.get(body.checkout.sessionId);
  assert.equal(session.amount_total, 50);
  assert.equal(session.metadata.original_subtotal_amount, originalSubtotal);
  assert.equal(session.metadata.discount_code, "OWNER-LIVE-REHEARSAL");
  assert.equal(session.metadata.discount_amount, originalSubtotal - 50);
  assert.equal(session.line_items.reduce((sum, item) => sum + Number(item.amount || 0), 0), 50);

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: body.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.amountPaid, 50);
  assert.equal(paid.order.discountCode, "OWNER-LIVE-REHEARSAL");
});

test("checkout discounts cannot reduce a live payment below the Stripe minimum", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const stripe = createMockStripeClient({ randomUUID });
  const worker = createPhotosByElieWorker({
    catalog,
    stripe,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
    discountCodes: [{ code: "FREE-PROOF", type: "percent", percentOff: 100 }],
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    discountCode: "FREE-PROOF",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.order.amountExpected, 50);
  assert.equal(body.order.discountAmount, body.order.originalSubtotalAmount - 50);
  const session = stripe._debug.sessions.get(body.checkout.sessionId);
  assert.equal(session.amount_total, 50);
  assert.equal(session.line_items.reduce((sum, item) => sum + Number(item.amount || 0), 0), 50);
});

test("guest checkout rejects unknown discount codes before creating a Stripe session", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    discountCode: "NOT-A-CODE",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  assert.equal(response.status, 403);

  const body = await response.json();
  assert.equal(body.error.code, "invalid_discount_code");
  assert.equal(stripe._debug.sessions.size, 0);
});

test("guest checkout rejects stale browser subtotal before Stripe session creation", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
    expectedSubtotalAmount: 100,
  }));
  assert.equal(response.status, 409);

  const body = await response.json();
  assert.equal(body.error.code, "checkout_total_mismatch");
  assert.equal(body.error.details.browserSubtotalAmount, 100);
  assert.equal(body.error.details.workerSubtotalAmount, catalogOptionCents(catalog, photoId, "jpg-1mp"));
  assert.equal(stripe._debug.sessions.size, 0);
});

test("AI collection items are retired from the checkout catalog", async () => {
  const catalog = createCatalogIndex({
    collections: {
      ai: {
        title: "AI",
        photos: [{
          id: "ai-gallery-test-image",
          title: "AI gallery test image",
          sourceOrigin: "camera",
          megapixels: 12,
          sourceFiles: [{ path: "ai-gallery-test.jpg", type: "JPG" }],
          metadata: [{ label: "Original size", value: "JPEG / 4000 x 3000 / 12 MP" }],
        }],
      },
    },
    resolutions: [
      { id: "full", type: "digital", label: "Full resolution", price: 65, prices: { original: 65 } },
      { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", price: 8, prices: { original: 8 }, minMegapixels: 1 },
    ],
  });
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId: "ai-gallery-test-image", options: [{ id: "full" }, { id: "jpg-1mp" }] }],
  }));
  assert.equal(catalog.photos.has("ai-gallery-test-image"), false);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unknown_photo");
});

test("AI sourceOrigin is retired even outside the former AI collection", async () => {
  const catalog = createCatalogIndex({
    collections: {
      france: {
        title: "France",
        photos: [{
          id: "ai-origin-in-camera-gallery",
          title: "AI-origin test image",
          sourceOrigin: "ai",
          megapixels: 12,
          sourceFiles: [{ path: "ai-origin-test.jpg", type: "JPG" }],
          metadata: [{ label: "Original size", value: "JPEG / 4000 x 3000 / 12 MP" }],
        }],
      },
    },
    resolutions: [
      { id: "full", type: "digital", label: "Full resolution", price: 65, prices: { original: 65 } },
      { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", price: 8, prices: { original: 8 }, minMegapixels: 1 },
    ],
  });
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId: "ai-origin-in-camera-gallery", options: [{ id: "full" }, { id: "jpg-1mp" }] }],
  }));
  assert.equal(catalog.photos.has("ai-origin-in-camera-gallery"), false);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unknown_photo");
});

test("retired media types are excluded from the checkout catalog", () => {
  const catalog = createCatalogIndex({
    collections: {
      spain: {
        title: "Spain",
        photos: [
          { id: "retired-video", media: { type: "video" } },
          { id: "sale-photo", media: { type: "photo" }, megapixels: 12 },
        ],
      },
    },
    storefrontPolicy: { retiredMediaTypes: ["video"] },
  });

  assert.equal(catalog.photos.has("retired-video"), false);
  assert.equal(catalog.photos.has("sale-photo"), true);
  assert.deepEqual(catalog.storefrontPolicy.retiredMediaTypes, ["video"]);
});

test("published camera products use the approved whole-dollar ladder", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.options.get("jpg-1mp").price, 8);
  assert.equal(catalog.options.get("jpg-3mp").price, 16);
  assert.equal(catalog.options.get("jpg-6mp").price, 28);
  assert.equal(catalog.options.get("full").price, 65);
});

test("published video products use the approved duration ladder", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.videoPriceTiers.video_short.price, 12);
  assert.equal(catalog.videoPriceTiers.video_medium.price, 20);
  assert.equal(catalog.videoPriceTiers.video_long.price, 28);
  assert.equal(catalog.videoPriceTiers.video_extended.price, 35);
  assert.equal(catalog.videoPriceTiers.video_premium.price, 50);
});

test("video checkout uses the shared flat video price tier", async () => {
  const catalog = createCatalogIndex({
    collections: {
      spain: {
        title: "Spain",
        photos: [{
          id: "video-cordoba-test",
          title: "Cordoba video test",
          media: { type: "video", video: { duration: 12 } },
          duration: 12,
          sourceOrigin: "camera",
          megapixels: 8.3,
          sourceFiles: [{ path: "cordoba.mov", type: "MOV" }],
          metadata: [{ label: "Original size", value: "MOV / 3840 x 2160 / 8.3 MP" }],
        }],
      },
    },
    resolutions: [
      { id: "full", type: "digital", label: "Full resolution", price: 65, prices: { original: 65, ai: 25 } },
    ],
    videoPriceTiers: {
      video_medium: { label: "Video 10-30s", price: 20 },
    },
  });
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId: "video-cordoba-test", options: [{ id: "video-original" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.order.amountExpected, 2000);
  assert.equal(body.order.items[0].products[0].id, "video-original");
  assert.equal(body.order.items[0].products[0].amount, 2000);
});

test("real Stripe client creates hosted Checkout Sessions with order metadata", async () => {
  let stripeRequest;
  const stripe = createStripeClient({
    secretKey: "sk_test_photosbyelie",
    webhookSecret: "whsec_photosbyelie",
    apiVersion: "2025-12-17",
    fetchImpl: async (url, init) => {
      stripeRequest = { url, init, params: new URLSearchParams(init.body) };
      return new Response(JSON.stringify({
        id: "cs_test_123",
        object: "checkout.session",
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
        payment_intent: "pi_test_123",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const session = await stripe.createCheckoutSession({
    orderId: "PBE-20260508-TEST",
    buyerEmail: "buyer@example.com",
    amountTotal: 5500,
    currency: "usd",
    lineItems: [{
      photoId: "photo-1",
      name: "Photo One - Full resolution",
      quantity: 1,
      unit_amount: 5500,
    }],
    successUrl: "https://photosbyelie.test/order.html?id=PBE-20260508-TEST",
    cancelUrl: "https://photosbyelie.test/basket.html",
    receiptDescription: "PhotosByElie order PBE-20260508-TEST.",
    metadata: {
      original_subtotal_amount: 6500,
      discount_code: "OWNER-LIVE",
      discount_amount: 1000,
      discounted_subtotal_amount: 5500,
      amount_expected: 5500,
    },
  });

  assert.equal(session.id, "cs_test_123");
  assert.equal(stripeRequest.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(stripeRequest.init.method, "POST");
  assert.match(stripeRequest.init.headers.authorization, /^Basic /);
  assert.equal(stripeRequest.init.headers["stripe-version"], "2025-12-17");
  assert.equal(stripeRequest.init.headers["idempotency-key"], "photosbyelie-checkout-PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("mode"), "payment");
  assert.equal(stripeRequest.params.get("client_reference_id"), "PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("metadata[order_id]"), "PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("metadata[discount_code]"), "OWNER-LIVE");
  assert.equal(stripeRequest.params.get("metadata[discount_amount]"), "1000");
  assert.equal(stripeRequest.params.get("payment_intent_data[receipt_email]"), "buyer@example.com");
  assert.equal(stripeRequest.params.get("payment_intent_data[statement_descriptor_suffix]"), "DOWNLOAD");
  assert.equal(stripeRequest.params.get("payment_intent_data[metadata][order_id]"), "PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("payment_intent_data[metadata][original_subtotal_amount]"), "6500");
  assert.equal(stripeRequest.params.get("payment_intent_data[metadata][discount_code]"), "OWNER-LIVE");
  assert.equal(stripeRequest.params.get("payment_intent_data[metadata][discount_amount]"), "1000");
  assert.equal(stripeRequest.params.get("payment_intent_data[metadata][amount_expected]"), "5500");
  assert.equal(stripeRequest.params.get("line_items[0][price_data][unit_amount]"), "5500");
  assert.equal(stripeRequest.params.get("line_items[0][price_data][product_data][metadata][photo_id]"), "photo-1");
});

test("real Stripe client verifies raw webhook signatures", async () => {
  const timestamp = 1778241600;
  const payload = JSON.stringify({
    id: "evt_test_123",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_123", metadata: { order_id: "PBE-TEST" } } },
  });
  const signature = await createStripeWebhookSignature({
    payload,
    secret: "whsec_photosbyelie",
    timestamp,
  });
  const stripe = createStripeClient({
    secretKey: "sk_test_photosbyelie",
    webhookSecret: "whsec_photosbyelie",
    fetchImpl: async () => new Response("{}"),
    now: () => new Date(timestamp * 1000),
  });

  const event = await stripe.constructEvent(new Request("https://worker.test/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  }));

  assert.equal(event.id, "evt_test_123");
  assert.equal(event.type, "checkout.session.completed");
  assert.equal(event.data.object.metadata.order_id, "PBE-TEST");
});

test("public paid order exposes capability links but not internal delivery or Stripe state", async () => {
  const catalog = loadCatalog();
  const { worker, store } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.amountPaid, checkout.order.amountExpected);
  assert.equal(paid.order.delivery.zipKey, undefined);
  assert.equal(paid.order.stripe, undefined);
  assert.match(paid.order.delivery.downloadUrl, /^\/download\/dl_/);

  const internalOrder = await store.getOrder(paid.order.id);
  assert.match(internalOrder.delivery.zipKey, /^deliveries\/photosbyelie-order-PBE-20260507-/);
  assert.ok(internalOrder.checkoutSessionId);
  assert.ok(internalOrder.paymentIntentId);
  await store.putOrder({
    ...internalOrder,
    deliveryError: {
      code: "legacy_delivery_failed",
      message: "A recovered legacy order retained its obsolete failure detail.",
      failedAt: "2026-05-07T11:59:00.000Z",
    },
  });

  const wrongEmailResponse = await worker.fetch(new Request(`https://worker.test/orders/${paid.order.id}?email=attacker@example.com`));
  assert.equal(wrongEmailResponse.status, 403);
  assert.equal(wrongEmailResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(wrongEmailResponse.headers.get("cdn-cache-control"), "no-store");

  const lookupResponse = await worker.fetch(new Request(`https://worker.test/orders/${paid.order.id}?email=buyer@example.com`));
  assert.equal(lookupResponse.status, 200);
  assert.equal(lookupResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(lookupResponse.headers.get("cdn-cache-control"), "no-store");
  const lookup = await lookupResponse.json();
  assert.equal(lookup.order.status, "ready");
  assert.equal(lookup.order.deliveryError, null);

  const missingEmailResponse = await worker.fetch(new Request(`https://worker.test/orders/by-session/${checkout.checkout.sessionId}`));
  assert.equal(missingEmailResponse.status, 403);
  assert.equal(missingEmailResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  const sessionLookupResponse = await worker.fetch(new Request(
    `https://worker.test/orders/by-session/${checkout.checkout.sessionId}?email=buyer%40example.com`
  ));
  assert.equal(sessionLookupResponse.status, 200);
  assert.equal(sessionLookupResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(sessionLookupResponse.headers.get("cdn-cache-control"), "no-store");
  const sessionLookup = await sessionLookupResponse.json();
  assert.equal(sessionLookup.order.id, paid.order.id);
  assert.equal(sessionLookup.order.status, "ready");
});

test("payment received after lifecycle revocation is retained for manual refund review without fulfillment", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const stripe = createMockStripeClient({ randomUUID });
  const photoId = firstDeliverablePhotoId(catalog);
  let denied = false;
  let deliveryCalls = 0;
  const lifecycleDenyStore = {
    ensureSchema: async () => ({ state: "ready" }),
    visibilityFor: async (ids) => ids.map((id) => ({ canonicalMediaId: id, visible: !denied, revision: 1 })),
    assertAllowed: async (ids) => {
      if (denied && ids.includes(photoId)) throw Object.assign(new Error("One or more assets are unavailable."), {
        status: 410,
        code: "asset_lifecycle_denied",
      });
      return true;
    },
  };
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe,
    randomUUID,
    lifecycleDenyStore,
    delivery: {
      validateOrder: async () => ({ ok: true }),
      createDelivery: async () => {
        deliveryCalls += 1;
        throw new Error("delivery must not start after revocation");
      },
    },
  });
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  denied = true;
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 409);
  assert.equal((await payResponse.json()).error.code, "paid_asset_revoked");
  assert.equal(deliveryCalls, 0);
  const retained = await store.getOrder(checkout.order.id);
  assert.equal(retained.status, "manual_refund_review");
  assert.equal(retained.delivery, null);
  assert.equal(retained.deliveryError.lifecycleCode, "asset_lifecycle_denied");
});

test("revocation racing the final ready commit enters manual refund review", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const stripe = createMockStripeClient({ randomUUID });
  const photoId = firstDeliverablePhotoId(catalog);
  let denied = false;
  const lifecycleDenyStore = {
    ensureSchema: async () => ({ state: "ready" }),
    visibilityFor: async (ids) => ids.map((id) => ({ canonicalMediaId: id, visible: !denied, revision: 1 })),
    assertAllowed: async (ids, context) => {
      if (denied && ids.includes(photoId)) throw Object.assign(new Error("One or more assets are unavailable."), {
        status: 410,
        code: "asset_lifecycle_denied",
      });
      if (context === "fulfillment:after-render") denied = true;
      return { digest: "fence-one" };
    },
  };
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe,
    randomUUID,
    lifecycleDenyStore,
    delivery: createPerFileTestDelivery(() => new Date("2026-05-07T12:00:00.000Z")),
  });
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 409);
  assert.equal((await payResponse.json()).error.code, "paid_asset_revoked");
  const retained = await store.getOrder(checkout.order.id);
  assert.equal(retained.status, "manual_refund_review");
  assert.equal(retained.delivery, null);
});

test("authoritative fulfillment settlement repairs a ready KV projection after a deny arm race", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const baseStore = createMemoryStore();
  const stripe = createMockStripeClient({ randomUUID });
  const photoId = firstDeliverablePhotoId(catalog);
  let settlementState = null;
  let armAfterReadyProjection = false;
  const store = {
    ...baseStore,
    putOrder: async (order) => {
      const saved = await baseStore.putOrder(order);
      if (order.lifecycleSettlementBound && order.status === "preparing") armAfterReadyProjection = true;
      return saved;
    },
  };
  const lifecycleDenyStore = {
    ensureSchema: async () => ({ state: "ready" }),
    visibilityFor: async (ids) => ids.map((id) => ({ canonicalMediaId: id, visible: true, revision: 0 })),
    assertAllowed: async (ids) => ({
      media: ids.map((id) => ({ canonicalMediaId: id, revision: 0, receiptId: "seed:test" })),
      digest: "a".repeat(64),
    }),
    commitFulfillmentReady: async ({ orderId }) => {
      settlementState = { orderId, state: "ready", lifecycleOperationId: "" };
      return settlementState;
    },
    fulfillmentFor: async (orderId) => armAfterReadyProjection
      ? { orderId, state: "manual_refund_review", lifecycleOperationId: "op-raced" }
      : settlementState,
  };
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe,
    randomUUID,
    lifecycleDenyStore,
    delivery: createPerFileTestDelivery(() => new Date("2026-05-07T12:00:00.000Z")),
  });
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 409);
  assert.equal((await payResponse.json()).error.code, "paid_asset_revoked");
  const retained = await baseStore.getOrder(checkout.order.id);
  assert.equal(retained.status, "manual_refund_review");
  assert.equal(retained.delivery, null);
  assert.equal(retained.deliveryError.lifecycleCode, "paid_asset_revoked");
});

test("paid checkout sends per-purchased-item delivery email links", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const emailClient = createFakeEmailClient();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe,
    now,
    randomUUID,
    delivery: createPerFileTestDelivery(now),
    ordersUrl: "https://photos-by-elie.com/order.html",
    downloadBaseUrl: "https://worker.test",
    emailClient,
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-3mp" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.deliveryEmail.status, "sent");
  assert.equal(paid.order.deliveryEmail.directLinkCount, 2);
  assert.equal(emailClient.sent.length, 1);
  const message = emailClient.sent[0];
  assert.equal(message.to, "buyer@example.com");
  assert.match(message.subject, /downloads are ready/);
  assert.match(message.text, /Purchased downloads:\n- .+ - Full resolution: https:\/\/worker\.test\/download\/dl_test_full/);
  assert.match(message.text, /- .+ - JPG 3 MP: https:\/\/worker\.test\/download\/dl_test_jpg-3mp/);
  assert.match(message.text, /Available for 30 days \(ends June 6, 2026\)/);
  assert.doesNotMatch(message.text, /Available until 2026-/);
  assert.match(message.text, /You can also use the order download page: https:\/\/photos-by-elie\.com\/order\.html\?id=PBE-20260507-/);
  assert.match(message.text, /email=buyer%40example\.com/);
  assert.match(message.text, /This page keeps your order record/i);
  const orderUrl = new URL(message.orderUrl);
  assert.equal(orderUrl.searchParams.get("id"), paid.order.id);
  assert.equal(orderUrl.searchParams.get("email"), "buyer@example.com");
  assert.equal(orderUrl.searchParams.get("lookup"), "order");
  assert.match(orderUrl.searchParams.get("cb") || "", new RegExp(`^${paid.order.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(orderUrl.searchParams.has("session_id"), false);
  assert.ok(message.text.indexOf("Purchased downloads:") < message.text.indexOf("You can also use the order download page:"));
  assert.match(message.html, /<a href="https:\/\/worker\.test\/download\/dl_test_full">[^<]+ - Full resolution<\/a>/);
  assert.match(message.html, /<a href="https:\/\/worker\.test\/download\/dl_test_jpg-3mp">[^<]+ - JPG 3 MP<\/a>/);
  assert.match(message.html, /Available for 30 days \(ends June 6, 2026\)/);

  const retryResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(retryResponse.status, 200);
  assert.equal(emailClient.sent.length, 1);

  const resendResponse = await worker.fetch(jsonRequest(`https://worker.test/orders/${paid.order.id}/resend-email`, {
    email: "buyer@example.com",
  }));
  assert.equal(resendResponse.status, 200);
  assert.equal(resendResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(resendResponse.headers.get("cdn-cache-control"), "no-store");
  const resent = await resendResponse.json();
  assert.equal(resent.deliveryEmail.status, "sent");
  assert.equal(resent.deliveryEmail.resendCount, 1);
  assert.equal(resent.deliveryEmail.directLinkCount, 2);
  assert.equal(emailClient.sent.length, 2);
  assert.match(emailClient.sent[1].idempotencyKey, /-resend-/);
  assert.match(emailClient.sent[1].text, /- .+ - Full resolution: https:\/\/worker\.test\/download\/dl_test_full/);

  const wrongEmailResponse = await worker.fetch(jsonRequest(`https://worker.test/orders/${paid.order.id}/resend-email`, {
    email: "not-buyer@example.com",
  }));
  assert.equal(wrongEmailResponse.status, 403);
  assert.equal(emailClient.sent.length, 2);
});

test("delivery email failure does not block paid delivery", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const emailClient = createFakeEmailClient({ fail: true });
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe,
    now,
    randomUUID,
    delivery: createPerFileTestDelivery(now),
    ordersUrl: "https://photos-by-elie.com/order.html",
    downloadBaseUrl: "https://worker.test",
    emailClient,
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.files.length, 1);
  assert.equal(paid.order.deliveryEmail.status, "failed");
  assert.equal(paid.order.deliveryEmail.error.code, "fake_email_failed");
  assert.equal(emailClient.sent.length, 1);
});

test("webhook rejects paid sessions whose amount does not match the order", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const event = stripe.paidEventForSession(checkout.checkout.sessionId, { amount_total: 9999 });

  const webhookResponse = await worker.fetch(jsonRequest("https://worker.test/stripe-webhook", event, {
    "x-mock-stripe-signature": stripe.signatureForPayload(),
  }));
  assert.equal(webhookResponse.status, 409);
  const body = await webhookResponse.json();
  assert.equal(body.error.code, "amount_mismatch");
});

test("replayed paid webhook clears the prior delivery error after successful recovery", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const stripe = createMockStripeClient({ randomUUID });
  const successfulDelivery = createPerFileTestDelivery();
  const photoId = firstDeliverablePhotoId(catalog);
  let deliveryCalls = 0;
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe,
    randomUUID,
    delivery: {
      validateOrder: successfulDelivery.validateOrder,
      createDelivery: async (order) => {
        deliveryCalls += 1;
        if (deliveryCalls === 1) {
          throw Object.assign(new Error("Synthetic delivery failure."), {
            code: "synthetic_delivery_failed",
          });
        }
        return successfulDelivery.createDelivery(order);
      },
    },
  });
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const event = stripe.paidEventForSession(checkout.checkout.sessionId);
  const webhookHeaders = { "x-mock-stripe-signature": stripe.signatureForPayload() };

  const failedResponse = await worker.fetch(jsonRequest("https://worker.test/stripe-webhook", event, webhookHeaders));
  assert.equal(failedResponse.status, 500);
  const failedOrder = await store.getOrder(checkout.order.id);
  assert.equal(failedOrder.status, "delivery_failed");
  assert.equal(failedOrder.deliveryError.code, "synthetic_delivery_failed");

  const recoveredResponse = await worker.fetch(jsonRequest("https://worker.test/stripe-webhook", event, webhookHeaders));
  assert.equal(recoveredResponse.status, 200);
  const recovered = await recoveredResponse.json();
  assert.equal(recovered.order.status, "ready");
  assert.equal(recovered.order.delivery.files.length, 1);
  assert.equal(recovered.order.deliveryError, null);
  const storedOrder = await store.getOrder(checkout.order.id);
  assert.equal(storedOrder.status, "ready");
  assert.equal(storedOrder.deliveryError, undefined);
});

test("download endpoint returns a mock signed R2 URL and allows repeat downloads", async () => {
  const catalog = loadCatalog();
  const { worker } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  const paid = await payResponse.json();
  const token = paid.order.delivery.downloadUrl.split("/").pop();

  const downloadResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(downloadResponse.status, 200);
  const download = await downloadResponse.json();
  assert.match(download.download.mockSignedUrl, /^mock-r2:\/\/download\/dl_/);
  assert.equal(download.download.zipKey, undefined);
  assert.equal(download.download.localZipPath, undefined);

  const repeatedResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(repeatedResponse.status, 200);
});

test("download endpoint enforces token expiry and download limits", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  let currentNow = new Date("2026-05-07T12:00:00.000Z");
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => currentNow,
    randomUUID,
    downloadTokenTtlSeconds: 60,
    downloadTokenMaxDownloads: 2,
  });
  const photoId = firstDeliverablePhotoId(catalog);
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  const paid = await payResponse.json();
  const token = paid.order.delivery.downloadUrl.split("/").pop();

  const firstDownloadResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(firstDownloadResponse.status, 200);
  const firstDownload = await firstDownloadResponse.json();
  assert.equal(firstDownload.download.expiresAt, "2026-05-07T12:01:00.000Z");
  assert.equal((await worker.fetch(new Request(`https://worker.test/download/${token}`))).status, 200);
  const limitedResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(limitedResponse.status, 429);

  const expiringWorker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => currentNow,
    randomUUID,
    downloadTokenTtlSeconds: 60,
  });
  const expiringCheckoutResponse = await expiringWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const expiringCheckout = await expiringCheckoutResponse.json();
  const expiringPayResponse = await expiringWorker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: expiringCheckout.checkout.sessionId,
  }));
  const expiringPaid = await expiringPayResponse.json();
  const expiringToken = expiringPaid.order.delivery.downloadUrl.split("/").pop();
  currentNow = new Date("2026-05-07T12:01:01.000Z");
  const expiredResponse = await expiringWorker.fetch(new Request(`https://worker.test/download/${expiringToken}`));
  assert.equal(expiredResponse.status, 410);
});

test("local ZIP delivery creates a real ZIP from a developed source", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const outputDir = fs.mkdtempSync("/tmp/photosbyelie-deliveries-");
  const sourceRoot = fs.mkdtempSync("/tmp/photosbyelie-sources-");
  const photoId = firstDeliverablePhotoId(catalog);
  const sourcePath = sourcePathForPhoto(catalog, photoId);
  const sourceFile = `${sourceRoot}/${sourcePath}`;
  fs.mkdirSync(sourceFile.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(sourceFile, jpeg.encode({
    data: Buffer.alloc(24 * 24 * 4, 255),
    width: 24,
    height: 24,
  }, 90).data);
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog,
    store,
    stripe,
    now,
    randomUUID,
    delivery: createLocalZipDelivery({
      repoRoot: new URL("..", import.meta.url).pathname,
      sourceRoots: [sourceRoot],
      outputDir,
      now,
    }),
  });

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.zipKey, undefined);
  const internalOrder = await store.getOrder(paid.order.id);
  assert.match(internalOrder.delivery.zipKey, /photosbyelie-order-PBE-20260507-.*\.zip$/);
  const zip = fs.readFileSync(internalOrder.delivery.zipKey);
  assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304");
  assert.ok(zip.includes(Buffer.from("ORDER.txt")));
  assert.ok(zip.includes(Buffer.from(`${photoId}-jpg-1mp.jpg`)));
  assert.ok(!zip.includes(Buffer.from(`${photoId}/${photoId}-jpg-1mp.jpg`)));

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(sourceRoot, { recursive: true, force: true });
});

test("deployed Worker mock checkout writes and downloads private R2 files", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const sourcePath = sourcePathForPhoto(catalog, photoId);
  const privateKey = `masters/${photoId}.jpg`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: new TextEncoder().encode("private developed master bytes"),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: privateR2,
    DELIVERY_MEDIA: privateR2,
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };
  env.ACCESS_DB = await readyLifecycleD1([photoId]);

  const checkoutResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }), env);
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }), env);
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.files.length, 1);
  assert.equal(paid.order.delivery.files[0].productId, "full");

  const token = paid.order.delivery.files[0].downloadUrl.split("/").pop();
  const downloadResponse = await deployedWorker.fetch(new Request(`https://worker.test/download/${token}`), env);
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "image/jpeg");
  const fileBytes = Buffer.from(await downloadResponse.arrayBuffer());
  assert.ok(fileBytes.includes(Buffer.from("private developed master bytes")));
});

test("deployed Worker renders missing JPG products with Cloudflare Images and caches them", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const privateKey = `masters/${photoId}.jpg`;
  const renderedBytes = createTestJpeg(40, 30);
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: createTestJpeg(120, 80),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const images = createFakeImagesBinding({ output: renderedBytes });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: privateR2,
    DELIVERY_MEDIA: privateR2,
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
    IMAGES: images,
  };
  env.ACCESS_DB = await readyLifecycleD1([photoId]);

  const checkoutResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }), env);
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }), env);
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  const renderKey = `renders/${photoId}_1mp.jpg`;
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.files[0].productId, "jpg-1mp");
  assert.equal(paid.order.delivery.files[0].cacheHit, false);
  assert.equal(privateR2._debug.has(renderKey), true);
  assert.equal(privateR2._debug.get(renderKey).customMetadata.watermark, "none");
  assert.equal(images.calls.length, 1);
  assert.equal(images.calls[0].transforms[0].fit, "scale-down");
  assert.equal(images.calls[0].output.format, "image/jpeg");
  assert.equal(images.calls[0].output.quality, 90);
});

test("real-estate originals preflight is authenticated, read-only, and storage-safe", async () => {
  const backstage = backstageOwnerFixture();
  const availablePhotoId = "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043";
  const missingPhotoId = "corine-re-2026-la-concha-1-apt-8ab1-missing";
  const albumSlug = "re-2026-la-concha-1-apt-8ab1";
  const privateKey = `real-estate/corine-real-estate/masters/${albumSlug}/${availablePhotoId}.jpg`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: new TextEncoder().encode("real estate original bytes"),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const emailClient = createFakeEmailClient();
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
    privateMasterPrefix: "real-estate/corine-real-estate/masters",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    randomUUID,
    googleOAuthAuth: backstage.googleOAuthAuth,
    ownerDeviceAuthStore: backstage.ownerDeviceAuthStore,
    accessUserRegistry: createMemoryAccessUserRegistry([
      { email: "owner@example.com", tier: "owner" },
    ]),
    realEstateOriginals: createRealEstateOriginals({
      privateBucket: privateR2,
      store,
      randomUUID,
      now: () => new Date("2026-08-07T00:00:00.000Z"),
      galleries,
      emailClient,
      assertAssetsAllowed: allowLifecycleFor().assertAllowed,
    }),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
    }),
  });

  const anonymousResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/originals/preflight", {
    galleryKey: "corine-real-estate",
    items: [{ photoId: availablePhotoId, albumSlug, sourceFile: "D5H_3043.JPG" }],
  }));
  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).error.code, "real_estate_login_required");

  const cookie = await realEstateSessionCookie(worker);
  const preflightResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/real-estate/originals/preflight", {
    galleryKey: "corine-real-estate",
    items: [
      {
        photoId: availablePhotoId,
        albumSlug,
        sourceFile: "D5H_3043.JPG",
        title: "La Concha 1 Apt 8AB1 - 01",
        sortIndex: 1,
      },
      {
        photoId: missingPhotoId,
        albumSlug,
        sourceFile: "MISSING.JPG",
        title: "La Concha 1 Apt 8AB1 - missing",
        sortIndex: 2,
      },
    ],
  }, { cookie }));
  assert.equal(preflightResponse.status, 200);
  assert.equal(preflightResponse.headers.get("x-pbe-api-version"), "1");
  const body = await preflightResponse.json();
  assert.equal(body.preflight.schemaVersion, 1);
  assert.equal(body.preflight.mode, "read-only");
  assert.equal(body.preflight.checkedAt, "2026-08-07T00:00:00.000Z");
  assert.equal(body.preflight.ok, false);
  assert.equal(body.preflight.requestedCount, 2);
  assert.equal(body.preflight.availableCount, 1);
  assert.equal(body.preflight.missingCount, 1);
  assert.equal(body.preflight.items[0].available, true);
  assert.equal(body.preflight.items[1].available, false);
  assert.equal(body.preflight.items[1].bytes, null);
  assert.doesNotMatch(JSON.stringify(body), /objectKey|privateMasterPrefix|real-estate\/corine-real-estate\/masters/);
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
  assert.equal(emailClient.sent.length, 0);

  const ownerPreflightResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/real-estate/originals/preflight", {
    galleryKey: "corine-real-estate",
    items: [{ photoId: availablePhotoId, albumSlug, sourceFile: "D5H_3043.JPG" }],
  }, backstage.headers));
  assert.equal(ownerPreflightResponse.status, 200);
  assert.equal((await ownerPreflightResponse.json()).preflight.ok, true);
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
  assert.equal(emailClient.sent.length, 0);

  const ownerMutationResponse = await worker.fetch(jsonRequest("https://worker.test/api/v1/real-estate/originals/session", {
    galleryKey: "corine-real-estate",
    items: [{ photoId: availablePhotoId, albumSlug, sourceFile: "D5H_3043.JPG" }],
  }, { authorization: "Bearer native-owner-access-token" }));
  assert.equal(ownerMutationResponse.status, 401);
  assert.equal((await ownerMutationResponse.json()).error.code, "real_estate_login_required");
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
  assert.equal(emailClient.sent.length, 0);
});

test("receipt-backed real-estate release allows only its flat canonical master IDs", async () => {
  const allowedPhotoId = "001-release-allowed";
  const forbiddenPhotoId = "001-release-forbidden";
  const privateR2 = createFakeR2({
    [`masters/${allowedPhotoId}.jpg`]: {
      body: new TextEncoder().encode("allowed receipt-backed original"),
      httpMetadata: { contentType: "image/jpeg" },
    },
    [`masters/${forbiddenPhotoId}.jpg`]: {
      body: new TextEncoder().encode("other private original"),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const store = createMemoryStore();
  const originals = createRealEstateOriginals({
    privateBucket: privateR2,
    store,
    galleries: [{
      key: "corine-real-estate",
      username: "Corine",
      privateMasterPrefix: "masters",
      privateMasterLayout: "flat",
      allowedPhotoIds: [allowedPhotoId],
    }],
    now: () => new Date("2026-08-07T08:00:00.000Z"),
    assertAssetsAllowed: allowLifecycleFor().assertAllowed,
  });
  const realEstateSession = { galleryKey: "corine-real-estate", username: "Corine" };

  const available = await originals.preflight({
    galleryKey: "corine-real-estate",
    realEstateSession,
    items: [{ photoId: allowedPhotoId, albumSlug: "la-concha", sourceFile: "D5H_3001.jpg" }],
  });
  assert.equal(available.ok, true);
  assert.equal(available.availableCount, 1);
  assert.doesNotMatch(JSON.stringify(available), /masters\//);

  await assert.rejects(
    originals.preflight({
      galleryKey: "corine-real-estate",
      realEstateSession,
      items: [{ photoId: forbiddenPhotoId, albumSlug: "la-concha", sourceFile: "D5H_3002.jpg" }],
    }),
    (error) => error?.status === 403 && error?.code === "real_estate_original_forbidden",
  );
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
});

test("real-estate preflight falls back to a one-byte read without creating delivery state", async () => {
  const photoId = "001-release-range-read";
  const source = new TextEncoder().encode("receipt-backed original bytes");
  const privateR2 = {
    head: async () => null,
    get: async (key, options = {}) => {
      assert.equal(key, `masters/${photoId}.jpg`);
      assert.deepEqual(options, { range: { offset: 0, length: 1 } });
      return {
        size: source.byteLength,
        body: { cancel: async () => {} },
        httpMetadata: { contentType: "image/jpeg" },
      };
    },
  };
  const store = createMemoryStore();
  const originals = createRealEstateOriginals({
    privateBucket: privateR2,
    store,
    galleries: [{
      key: "corine-real-estate",
      username: "Corine",
      privateMasterPrefix: "masters",
      privateMasterLayout: "flat",
      allowedPhotoIds: [photoId],
    }],
    assertAssetsAllowed: allowLifecycleFor().assertAllowed,
  });

  const preflight = await originals.preflight({
    galleryKey: "corine-real-estate",
    realEstateSession: { galleryKey: "corine-real-estate", username: "Corine" },
    items: [{ photoId, albumSlug: "la-concha", sourceFile: "D5H_3003.jpg" }],
  });
  assert.equal(preflight.ok, true);
  assert.equal(preflight.availableCount, 1);
  assert.equal(preflight.totalBytes, source.byteLength);
  assert.equal(preflight.items[0].verificationMethod, "range-read");
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
});

test("real-estate originals deny before metadata reads, tokens, orders, or email", async () => {
  const photoId = "001-revoked-original";
  let metadataReads = 0;
  const privateR2 = {
    head: async () => { metadataReads += 1; return { size: 42 }; },
    get: async () => { metadataReads += 1; return null; },
  };
  const store = createMemoryStore();
  const emailClient = createFakeEmailClient();
  const originals = createRealEstateOriginals({
    privateBucket: privateR2,
    store,
    emailClient,
    galleries: [{
      key: "corine-real-estate",
      username: "Corine",
      privateMasterPrefix: "masters",
      privateMasterLayout: "flat",
      allowedPhotoIds: [photoId],
    }],
    assertAssetsAllowed: allowLifecycleFor([photoId]).assertAllowed,
  });
  const payload = {
    galleryKey: "corine-real-estate",
    realEstateSession: { galleryKey: "corine-real-estate", username: "Corine" },
    items: [{ photoId, sourceFile: "revoked.jpg" }],
  };

  await assert.rejects(originals.preflight(payload), { code: "asset_lifecycle_denied" });
  await assert.rejects(originals.createSession(payload), { code: "asset_lifecycle_denied" });
  assert.equal(metadataReads, 0);
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
  assert.equal(emailClient.sent.length, 0);
});

test("real-estate originals recheck their lifecycle fence before token persistence", async () => {
  const photoId = "001-raced-original";
  let metadataReads = 0;
  let lifecycleChecks = 0;
  const store = createMemoryStore();
  const emailClient = createFakeEmailClient();
  const originals = createRealEstateOriginals({
    privateBucket: {
      head: async () => { metadataReads += 1; return { size: 42 }; },
      get: async () => null,
    },
    store,
    emailClient,
    galleries: [{
      key: "corine-real-estate",
      username: "Corine",
      privateMasterPrefix: "masters",
      privateMasterLayout: "flat",
      allowedPhotoIds: [photoId],
    }],
    assertAssetsAllowed: async (_ids, _context, expectedFence) => {
      lifecycleChecks += 1;
      if (expectedFence) throw Object.assign(new Error("Lifecycle changed."), {
        status: 409,
        code: "lifecycle_fence_changed",
      });
      return { digest: "originals-fence" };
    },
  });

  await assert.rejects(originals.createSession({
    galleryKey: "corine-real-estate",
    realEstateSession: { galleryKey: "corine-real-estate", username: "Corine" },
    items: [{ photoId, sourceFile: "raced.jpg" }],
  }), { code: "lifecycle_fence_changed" });
  assert.equal(lifecycleChecks, 2);
  assert.equal(metadataReads, 1);
  assert.equal(store._debug.downloads.size, 0);
  assert.equal(store._debug.orders.size, 0);
  assert.equal(emailClient.sent.length, 0);
});

test("real-estate originals endpoint creates private download tokens", async () => {
  const photoId = "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043";
  const videoId = "corine-re-2026-la-concha-1-apt-8ab1-video-001";
  const albumSlug = "re-2026-la-concha-1-apt-8ab1";
  const privateKey = `real-estate/corine-real-estate/masters/${albumSlug}/${photoId}.jpg`;
  const privateVideoKey = `real-estate/corine-real-estate/masters/${albumSlug}/${videoId}.mp4`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: new TextEncoder().encode("real estate original bytes"),
      httpMetadata: { contentType: "image/jpeg" },
    },
    [privateVideoKey]: {
      body: new TextEncoder().encode("real estate video bytes"),
      httpMetadata: { contentType: "video/mp4" },
    },
  });
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const emailClient = createFakeEmailClient({ fail: true });
  const galleries = [{
    key: "Corine-gallery",
    username: "Corine",
    email: "corine@example.com",
    propertyTitle: "La Concha 1 Apt 8AB1",
    accessCode: "LaConcha",
    privateMasterPrefix: "real-estate/corine-real-estate/masters",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-17T12:00:00.000Z"),
    randomUUID,
    delivery: createR2ZipDelivery({
      privateBucket: privateR2,
      deliveryBucket: createFakeR2(),
      randomUUID,
    }),
    realEstateOriginals: createRealEstateOriginals({
      privateBucket: privateR2,
      store,
      randomUUID,
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      galleries,
      emailClient,
      downloadBaseUrl: "https://worker.test",
      assertAssetsAllowed: allowLifecycleFor().assertAllowed,
    }),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now: () => new Date("2026-05-17T12:00:00.000Z"),
    }),
  });

  const cookie = await realEstateSessionCookie(worker);
  const sessionResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/originals/session", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    items: [
      {
        photoId,
        albumSlug,
        sourceFile: "D5H_3043.JPG",
        title: "La Concha 1 Apt 8AB1 - 01",
        sortIndex: 1,
      },
      {
        photoId: videoId,
        albumSlug,
        sourceFile: "VIDEO_001.mp4",
        title: "La Concha 1 Apt 8AB1 - Video",
        sortIndex: 2,
      },
    ],
  }, { cookie }));
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  assert.equal(session.originals.fileCount, 2);
  assert.equal(session.originals.files[0].photoId, photoId);
  assert.equal(session.originals.files[1].photoId, videoId);
  assert.match(session.originals.files[0].downloadUrl, /^\/download\/re_/);
  assert.equal(session.originals.deliveryEmail.status, "failed");
  assert.equal(session.originals.deliveryEmail.error.code, "fake_email_failed");
  assert.equal(emailClient.sent.length, 1);
  assert.match(emailClient.sent[0].text, /Hello Corine/);
  assert.match(emailClient.sent[0].text, /La Concha 1 Apt 8AB1/);
  assert.match(emailClient.sent[0].text, /https:\/\/worker\.test\/download\/re_/);
  assert.doesNotMatch(emailClient.sent[0].text, /backup/i);

  const token = session.originals.files[0].downloadUrl.split("/").pop();
  const downloadResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "image/jpeg");
  const fileBytes = Buffer.from(await downloadResponse.arrayBuffer());
  assert.ok(fileBytes.includes(Buffer.from("real estate original bytes")));

  const videoToken = session.originals.files[1].downloadUrl.split("/").pop();
  const videoResponse = await worker.fetch(new Request(`https://worker.test/download/${videoToken}`));
  assert.equal(videoResponse.status, 200);
  assert.equal(videoResponse.headers.get("content-type"), "video/mp4");
  const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
  assert.ok(videoBytes.includes(Buffer.from("real estate video bytes")));

  const supportRecord = await store.getOrder(session.originals.sessionId);
  assert.equal(supportRecord.deliveryEmail.status, "failed");
  assert.equal(supportRecord.delivery.files.length, 2);
});

test("real-estate originals endpoint rejects the wrong client password", async () => {
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateOriginals: createRealEstateOriginals({
      privateBucket: createFakeR2(),
      store,
      randomUUID,
      galleries,
    }),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
    }),
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/real-estate/login", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "Wrong",
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "real_estate_auth_required");
});

test("real-estate deliverables endpoint saves and lists client products", async () => {
  const randomUUID = deterministicIds();
  const privateR2 = createFakeR2();
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateDeliverables: createRealEstateDeliverables({
      privateBucket: privateR2,
      randomUUID,
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      galleries,
    }),
    lifecycleDenyStore: allowLifecycleFor(),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now: () => new Date("2026-05-17T12:00:00.000Z"),
    }),
  });
  const deliverable = {
    id: "local-pdf-20260517T120000Z",
    type: "pdf",
    title: "PDF: La Concha 1 Apt 8AB1",
    createdAt: "2026-05-17T12:00:00.000Z",
    filename: "corine-real-estate-la-concha-a4-20260517T120000Z.pdf",
    bytes: 54321,
    batch: {
      batchId: "20260517T120000Z",
      createdAt: "2026-05-17T12:00:00.000Z",
      galleryKey: "corine-real-estate",
      projects: [{
        projectId: "re-2026-la-concha-1-apt-8ab1",
        projectTitle: "La Concha 1 Apt 8AB1",
        items: [{
          photoId: "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043",
          title: "La Concha 1 Apt 8AB1 - 01",
          sortIndex: 1,
        }],
      }],
    },
  };

  const cookie = await realEstateSessionCookie(worker);
  const saveResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    deliverable,
  }, { cookie }));
  assert.equal(saveResponse.status, 201);
  const saved = await saveResponse.json();
  assert.equal(saved.deliverable.id, deliverable.id);
  assert.equal(saved.deliverable.batch.batchId, deliverable.batch.batchId);

  const listResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
  }, { cookie }));
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.count, 1);
  assert.equal(listed.deliverables[0].id, deliverable.id);
  assert.equal(listed.deliverables[0].filename, deliverable.filename);

  const deleteResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/delete", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    id: deliverable.id,
  }, { cookie }));
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(deleted.id, deliverable.id);
  assert.equal(deleted.deleted, true);

  const afterDeleteResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
  }, { cookie }));
  assert.equal(afterDeleteResponse.status, 200);
  const afterDelete = await afterDeleteResponse.json();
  assert.equal(afterDelete.count, 0);

  const wrongPassword = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "Wrong",
  }));
  assert.equal(wrongPassword.status, 401);
});

test("real-estate saved PDF and video email failures do not block saved products", async () => {
  const randomUUID = deterministicIds();
  const privateR2 = createFakeR2();
  const emailClient = createFakeEmailClient({ fail: true });
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    customer: "Corine",
    email: "corine@example.com",
    accessCode: "LaConcha",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateDeliverables: createRealEstateDeliverables({
      privateBucket: privateR2,
      randomUUID,
      now: () => new Date("2026-06-10T12:00:00.000Z"),
      galleries,
      emailClient,
      publicSiteUrl: "https://photos-by-elie.com",
    }),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now: () => new Date("2026-06-10T12:00:00.000Z"),
    }),
  });
  const cookie = await realEstateSessionCookie(worker);
  const batch = {
    batchId: "20260610T120000Z",
    galleryKey: "corine-real-estate",
    projects: [{ projectTitle: "La Concha 1 Apt 8AB1", items: [] }],
  };

  for (const type of ["pdf", "video"]) {
    const saveResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables", {
      galleryKey: "corine-real-estate",
      username: "Corine",
      deliverable: {
        id: `ready-${type}-20260610`,
        type,
        title: type === "pdf" ? "PDF: La Concha 1 Apt 8AB1" : "Video: La Concha 1 Apt 8AB1",
        status: "ready",
        filename: type === "pdf" ? "la-concha.pdf" : "la-concha.mp4",
        batch,
      },
    }, { cookie }));
    assert.equal(saveResponse.status, 201);
    const saved = await saveResponse.json();
    assert.equal(saved.deliverable.status, "ready");
    assert.equal(saved.deliverable.deliveryEmail.status, "failed");
    assert.equal(saved.deliverable.deliveryEmail.error.code, "fake_email_failed");
  }

  assert.equal(emailClient.sent.length, 2);
  assert.match(emailClient.sent[0].text, /Hello Corine/);
  assert.match(emailClient.sent[0].text, /La Concha 1 Apt 8AB1/);
  assert.match(emailClient.sent[0].text, /Real Estate shelf/);
  assert.doesNotMatch(emailClient.sent[0].text, /backup/i);

  const listResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
  }, { cookie }));
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.count, 2);
  assert.equal(listed.deliverables.filter((record) => record.deliveryEmail?.status === "failed").length, 2);
});

test("real-estate cloud assembly jobs persist status and serve completed assets", async () => {
  const randomUUID = deterministicIds();
  const privateR2 = createFakeR2();
  const galleries = [{
    key: "Corine-gallery",
    username: "Corine",
    accessCode: "LaConcha",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateDeliverables: createRealEstateDeliverables({
      privateBucket: privateR2,
      randomUUID,
      now: () => new Date("2026-06-10T12:00:00.000Z"),
      galleries,
    }),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now: () => new Date("2026-06-10T12:00:00.000Z"),
    }),
  });
  const cookie = await realEstateSessionCookie(worker);
  const batch = {
    schema: "photosbyelie.realEstatePdfBatch.v1",
    batchId: "20260610T120000Z",
    createdAt: "2026-06-10T12:00:00.000Z",
    galleryKey: "corine-real-estate",
    pdfSettings: { paperFormat: "a4", videoTreatment: "still-from-video" },
    slideshowSettings: {
      audioPolicy: {
        sourceVideoAudioGainDb: -20,
        musicGainDb: 0,
      },
    },
    projects: [{
      projectId: "re-la-concha",
      projectTitle: "La Concha",
      items: [{
        photoId: "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043",
        title: "Living room",
        mediaType: "video",
        sourceVideoPrivateKey: "real-estate/corine-real-estate/masters/la-concha/source.mp4",
        slideshowDurationPolicy: "preserve-source-duration",
      }],
    }],
  };

  const jobResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/jobs", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    title: "La Concha product",
    formats: ["pdf", "video"],
    batch,
  }, { cookie }));
  assert.equal(jobResponse.status, 202);
  const queued = await jobResponse.json();
  assert.equal(queued.deliverables.length, 2);
  assert.equal(queued.deliverables[0].status, "pending");
  assert.equal(queued.deliverables[0].deliveryEmail.decision, "email_when_ready_asset_available");
  assert.equal(queued.deliverables[0].deliveryEmail.status, "not_sent");
  assert.equal(queued.deliverables[1].assemblyJob.sourceVideoAudioPolicy, "duck-under-generated-guitar-bed");
  assert.equal(queued.deliverables[1].assemblyJob.sourceVideoAudioGainDb, -20);
  assert.equal(queued.job.status, "pending");
  assert.equal(queued.job.inputManifestBatchId, batch.batchId);
  assert.equal(queued.job.inputManifest.projects[0].items[0].sourceVideoPrivateKey, "real-estate/corine-real-estate/masters/la-concha/source.mp4");

  const jobStatusResponse = await worker.fetch(new Request(`https://worker.test/real-estate/deliverables/jobs/${queued.job.id}`, {
    headers: { cookie },
  }));
  assert.equal(jobStatusResponse.status, 200);
  const jobStatus = await jobStatusResponse.json();
  assert.equal(jobStatus.job.id, queued.job.id);
  assert.equal(jobStatus.job.status, "pending");
  assert.equal(jobStatus.job.deliverables.length, 2);

  const pendingAsset = await worker.fetch(new Request(`https://worker.test/real-estate/deliverables/${queued.deliverables[0].id}/view`, {
    headers: { cookie },
  }));
  assert.equal(pendingAsset.status, 409);
  assert.equal((await pendingAsset.json()).error.code, "real_estate_deliverable_pending");

  const pdfRecord = queued.deliverables.find((record) => record.type === "pdf");
  const videoRecord = queued.deliverables.find((record) => record.type === "video");
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 test");
  const completePdfResponse = await worker.fetch(new Request(
    `https://worker.test/real-estate/deliverables/${pdfRecord.id}/complete?galleryKey=corine-real-estate&filename=la-concha.pdf`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/pdf" },
      body: pdfBytes,
    }
  ));
  assert.equal(completePdfResponse.status, 200);
  const completedPdf = (await completePdfResponse.json()).deliverable;
  assert.equal(completedPdf.status, "ready");
  assert.equal(completedPdf.bytes, pdfBytes.byteLength);
  assert.equal(completedPdf.filename, "la-concha.pdf");
  assert.equal(completedPdf.assemblyJob.assembler, "browser-upload");
  assert.equal(completedPdf.deliveryEmail.decision, "owner_review_before_client_notification");

  const originalsRecordResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    deliverable: {
      id: "originals-20260610T120000Z",
      type: "originals",
      title: "La Concha product",
      status: "pending",
      filename: "la-concha-originals.zip",
      batch,
      outputs: { originals: { filename: "la-concha-originals.zip", contentType: "application/zip" } },
    },
  }, { cookie }));
  assert.equal(originalsRecordResponse.status, 201);
  const originalsRecord = (await originalsRecordResponse.json()).deliverable;
  const originalsBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const completeOriginalsResponse = await worker.fetch(new Request(
    `https://worker.test/real-estate/deliverables/${originalsRecord.id}/complete?galleryKey=corine-real-estate&filename=la-concha-originals.zip`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/zip" },
      body: originalsBytes,
    }
  ));
  assert.equal(completeOriginalsResponse.status, 200);
  const completedOriginals = (await completeOriginalsResponse.json()).deliverable;
  assert.equal(completedOriginals.status, "ready");
  assert.match(completedOriginals.downloadUrl, /^\/real-estate\/deliverables\//);
  const originalsDownloadResponse = await worker.fetch(new Request(`https://worker.test${completedOriginals.downloadUrl}`, {
    headers: { cookie },
  }));
  assert.equal(originalsDownloadResponse.status, 200);
  assert.equal(originalsDownloadResponse.headers.get("content-type"), "application/zip");
  assert.equal(Buffer.from(await originalsDownloadResponse.arrayBuffer()).toString("hex"), Buffer.from(originalsBytes).toString("hex"));

  const failVideoResponse = await worker.fetch(jsonRequest(
    `https://worker.test/real-estate/deliverables/${videoRecord.id}/fail`,
    {
      galleryKey: "corine-real-estate",
      failureReason: "Browser renderer could not read the source video.",
    },
    { cookie }
  ));
  assert.equal(failVideoResponse.status, 200);
  assert.equal((await failVideoResponse.json()).deliverable.status, "needs-attention");

  const failedJobResponse = await worker.fetch(new Request(`https://worker.test/real-estate/deliverables/jobs/${queued.job.id}`, {
    headers: { cookie },
  }));
  assert.equal(failedJobResponse.status, 200);
  const failedJob = await failedJobResponse.json();
  assert.equal(failedJob.job.status, "needs-attention");
  assert.equal(failedJob.job.failureReason, "Browser renderer could not read the source video.");
  assert.equal(failedJob.job.deliverables.find((record) => record.type === "pdf").status, "ready");

  const listResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
  }, { cookie }));
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  const listedPdf = listed.deliverables.find((record) => record.id === pdfRecord.id);
  assert.equal(listedPdf.status, "ready");
  assert.match(listedPdf.downloadUrl, /^\/real-estate\/deliverables\//);

  const downloadResponse = await worker.fetch(new Request(`https://worker.test${listedPdf.downloadUrl}`, {
    headers: { cookie },
  }));
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "application/pdf");
  assert.match(downloadResponse.headers.get("content-disposition"), /^attachment;/);
  assert.equal(Buffer.from(await downloadResponse.arrayBuffer()).toString(), "%PDF-1.4 test");
});

test("real-estate delivery links provide expiring no-login access to private finished products", async () => {
  const randomUUID = deterministicIds();
  const privateR2 = createFakeR2();
  const store = createMemoryStore();
  const now = () => new Date("2026-07-23T09:00:00.000Z");
  const galleries = [{
    key: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
  }];
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe: createMockStripeClient({ randomUUID }),
    delivery: createR2ZipDelivery({ privateBucket: privateR2 }),
    randomUUID,
    now,
    realEstateDeliverables: createRealEstateDeliverables({
      privateBucket: privateR2,
      store,
      randomUUID,
      now,
      galleries,
      downloadBaseUrl: "https://worker.test",
      deliveryLinkTtlSeconds: 7 * 24 * 60 * 60,
      deliveryLinkMaxDownloads: 12,
      assertAssetsAllowed: allowLifecycleFor().assertAllowed,
    }),
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now,
    }),
    lifecycleDenyStore: allowLifecycleFor(),
  });
  const cookie = await realEstateSessionCookie(worker);
  const batch = {
    batchId: "corine-links-20260723",
    galleryKey: "corine-real-estate",
    projects: [{ projectTitle: "La Concha", items: [{ photoId: "photo-1", title: "Terrace" }] }],
  };
  const ready = [];
  for (const [type, filename, contentType, bytes] of [
    ["pdf", "la-concha.pdf", "application/pdf", new TextEncoder().encode("%PDF-link-test")],
    ["video", "la-concha.mp4", "video/mp4", new TextEncoder().encode("mp4-link-test")],
    ["originals", "la-concha-originals.zip", "application/zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
  ]) {
    const savedResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables", {
      galleryKey: "corine-real-estate",
      username: "Corine",
      deliverable: {
        id: `corine-${type}-ready`,
        type,
        title: "La Concha delivery",
        status: "pending",
        filename,
        batch,
        outputs: { [type]: { filename, contentType } },
      },
    }, { cookie }));
    assert.equal(savedResponse.status, 201);
    const saved = (await savedResponse.json()).deliverable;
    const completedResponse = await worker.fetch(new Request(
      `https://worker.test/real-estate/deliverables/${saved.id}/complete?galleryKey=corine-real-estate&filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        headers: { cookie, "content-type": contentType },
        body: bytes,
      }
    ));
    assert.equal(completedResponse.status, 200);
    ready.push((await completedResponse.json()).deliverable);
  }

  const unauthenticated = await worker.fetch(jsonRequest(
    "https://worker.test/real-estate/deliverables/delivery-links",
    { galleryKey: "corine-real-estate", deliverableIds: ready.map((record) => record.id) }
  ));
  assert.equal(unauthenticated.status, 401);

  const createLinksResponse = await worker.fetch(jsonRequest(
    "https://worker.test/real-estate/deliverables/delivery-links",
    {
      galleryKey: "corine-real-estate",
      title: "La Concha delivery",
      deliverableIds: ready.map((record) => record.id),
    },
    { cookie }
  ));
  assert.equal(createLinksResponse.status, 201);
  const delivery = (await createLinksResponse.json()).delivery;
  assert.equal(delivery.links.length, 3);
  assert.equal(delivery.expiresAt, "2026-07-30T09:00:00.000Z");
  assert.equal(delivery.downloadLimit, 12);
  assert.deepEqual(delivery.links.map((link) => link.label), ["PDF", "Video", "Originals"]);
  assert.ok(delivery.links.every((link) => /^https:\/\/worker\.test\/download\/relink_/.test(link.url)));

  const pdfLink = delivery.links.find((link) => link.type === "pdf");
  const publicDownload = await worker.fetch(new Request(pdfLink.url));
  assert.equal(publicDownload.status, 200);
  assert.equal(publicDownload.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(publicDownload.headers.get("cdn-cache-control"), "no-store");
  assert.equal(publicDownload.headers.get("content-type"), "application/pdf");
  assert.match(publicDownload.headers.get("content-disposition"), /la-concha\.pdf/);
  assert.equal(Buffer.from(await publicDownload.arrayBuffer()).toString(), "%PDF-link-test");

  const token = new URL(pdfLink.url).pathname.split("/").pop();
  const stored = await store.getDownload(token);
  assert.equal(stored.realEstateGalleryKey, "corine-real-estate");
  assert.equal(stored.realEstateDeliverableId, "corine-pdf-ready");
  assert.deepEqual(stored.canonicalMediaIds, ["photo-1"]);
  assert.equal(stored.downloadCount, 1);
});

test("real-estate delivery links deny the full batch before object reads or token persistence", async () => {
  const privateR2 = createFakeR2();
  const store = createMemoryStore();
  const galleries = [{ key: "corine-real-estate", username: "Corine" }];
  const deliverables = createRealEstateDeliverables({
    privateBucket: privateR2,
    store,
    galleries,
    assertAssetsAllowed: allowLifecycleFor(["photo-denied"]).assertAllowed,
  });
  const session = { galleryKey: "corine-real-estate", username: "Corine" };
  const record = await deliverables.putDeliverable({
    galleryKey: "corine-real-estate",
    realEstateSession: session,
    deliverable: {
      id: "denied-pdf",
      type: "pdf",
      status: "ready",
      filename: "denied.pdf",
      outputs: { pdf: { key: "outputs/denied.pdf", contentType: "application/pdf" } },
      batch: { batchId: "denied-batch", projects: [{ items: [{ photoId: "photo-denied" }] }] },
    },
  });
  await privateR2.put(record.outputs.pdf.key, new TextEncoder().encode("%PDF"));
  let outputReads = 0;
  const originalGet = privateR2.get;
  privateR2.get = async (key, options) => {
    if (key === record.outputs.pdf.key) outputReads += 1;
    return originalGet(key, options);
  };

  await assert.rejects(deliverables.createDeliveryLinks({
    galleryKey: "corine-real-estate",
    realEstateSession: session,
    deliverableIds: [record.id],
  }), { code: "asset_lifecycle_denied" });
  assert.equal(outputReads, 0);
  assert.equal(store._debug.downloads.size, 0);
});

test("real-estate delivery links recheck their lifecycle fence before token persistence", async () => {
  const privateR2 = createFakeR2();
  const store = createMemoryStore();
  const galleries = [{ key: "corine-real-estate", username: "Corine" }];
  let lifecycleChecks = 0;
  const deliverables = createRealEstateDeliverables({
    privateBucket: privateR2,
    store,
    galleries,
    assertAssetsAllowed: async (_ids, _context, expectedFence) => {
      lifecycleChecks += 1;
      if (expectedFence) throw Object.assign(new Error("Lifecycle changed."), {
        status: 409,
        code: "lifecycle_fence_changed",
      });
      return { digest: "delivery-link-fence" };
    },
  });
  const session = { galleryKey: "corine-real-estate", username: "Corine" };
  const record = await deliverables.putDeliverable({
    galleryKey: "corine-real-estate",
    realEstateSession: session,
    deliverable: {
      id: "raced-pdf",
      type: "pdf",
      status: "ready",
      filename: "raced.pdf",
      outputs: { pdf: { key: "outputs/raced.pdf", contentType: "application/pdf" } },
      batch: { batchId: "raced-batch", projects: [{ items: [{ photoId: "photo-raced" }] }] },
    },
  });
  await privateR2.put(record.outputs.pdf.key, new TextEncoder().encode("%PDF"));

  await assert.rejects(deliverables.createDeliveryLinks({
    galleryKey: "corine-real-estate",
    realEstateSession: session,
    deliverableIds: [record.id],
  }), { code: "lifecycle_fence_changed" });
  assert.equal(lifecycleChecks, 2);
  assert.equal(store._debug.downloads.size, 0);
});

test("Cloudflare video transcoder forces a real iPhone-compatible transform", async () => {
  const calls = [];
  const outputBytes = new TextEncoder().encode("h264-aac-mp4");
  const media = {
    input(body) {
      calls.push({ method: "input", body });
      return {
        transform(options) {
          calls.push({ method: "transform", options });
          return {
            output(outputOptions) {
              calls.push({ method: "output", options: outputOptions });
              return {
                media: async () => outputBytes,
                contentType: async () => "video/mp4; codecs=avc1,mp4a",
              };
            },
          };
        },
      };
    },
  };
  const source = new TextEncoder().encode("vp9-opus-webm");
  const transcoder = createCloudflareMediaVideoTranscoder({ media });
  const result = await transcoder.toMp4({
    body: source,
    filename: "portrait.webm",
    width: 576,
    height: 1024,
  });

  assert.equal(calls[0].method, "input");
  assert.deepEqual(calls[1], {
    method: "transform",
    options: { width: 576, height: 1024, fit: "contain" },
  });
  assert.deepEqual(calls[2], {
    method: "output",
    options: { mode: "video", audio: true },
  });
  assert.equal(result.contentType, "video/mp4");
  assert.equal(result.filename, "portrait.mp4");
  assert.equal(Buffer.from(result.body).toString(), "h264-aac-mp4");
});

test("cloud render jobs use token-only internal routes and transcode WebM output", async () => {
  const randomUUID = deterministicIds();
  const privateR2 = createFakeR2();
  const dispatched = [];
  const transcoded = [];
  const galleries = [{ key: "Corine-gallery", username: "Corine", accessCode: "LaConcha" }];
  const deliverables = createRealEstateDeliverables({
    privateBucket: privateR2,
    randomUUID,
    now: () => new Date("2026-06-10T12:00:00.000Z"),
    galleries,
    assemblyDispatcher: { dispatch: async (payload) => dispatched.push(payload) },
    videoTranscoder: {
      toMp4: async ({ body, contentType, filename, width, height }) => {
        const input = new Uint8Array(await new Response(body).arrayBuffer());
        transcoded.push({ contentType, filename, width, height, bytes: input.byteLength });
        return {
          body: new TextEncoder().encode("mp4-transcoded"),
          contentType: "video/mp4",
          filename: filename.replace(/\.webm$/i, ".mp4"),
        };
      },
    },
  });
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateDeliverables: deliverables,
    realEstateAuth: createRealEstateAuth({
      galleries,
      sessionSecret: "test-real-estate-session-secret",
      now: () => new Date("2026-06-10T12:00:00.000Z"),
    }),
  });
  const cookie = await realEstateSessionCookie(worker);
  const batch = {
    schema: "photosbyelie.realEstatePdfBatch.v1",
    batchId: "cloud-render-test",
    projects: [{ projectId: "apt-1", projectTitle: "Apartment 1", items: [{ photoId: "photo-1", title: "Terrace" }] }],
  };
  const queuedResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/jobs", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    title: "Cloud product",
    formats: ["pdf", "video"],
    batch,
  }, { cookie }));
  assert.equal(queuedResponse.status, 202);
  const queued = await queuedResponse.json();
  assert.deepEqual(dispatched, [{ galleryKey: "Corine-gallery", jobId: queued.job.id }]);

  const access = await deliverables.beginCloudAssemblyRender({ galleryKey: "corine-real-estate", jobId: queued.job.id });
  const badTokenResponse = await worker.fetch(new Request(
    `https://worker.test/real-estate/internal/render-jobs/${queued.job.id}?galleryKey=corine-real-estate&token=wrong`
  ));
  assert.equal(badTokenResponse.status, 403);

  const renderJobResponse = await worker.fetch(new Request(
    `https://worker.test/real-estate/internal/render-jobs/${queued.job.id}?galleryKey=corine-real-estate&token=${access.renderToken}`
  ));
  assert.equal(renderJobResponse.status, 200);
  const renderJob = await renderJobResponse.json();
  assert.equal(renderJob.job.status, "processing");
  assert.equal(renderJob.job.inputManifest.batchId, batch.batchId);
  assert.equal("renderAccess" in renderJob.job, false);
  assert.equal(renderJob.job.progress.phase, "starting");

  const progressResponse = await worker.fetch(jsonRequest(
    `https://worker.test/real-estate/internal/render-jobs/${queued.job.id}/progress?galleryKey=corine-real-estate&token=${access.renderToken}`,
    { phase: "video-rendering", percent: 63, current: 5, total: 8 }
  ));
  assert.equal(progressResponse.status, 200);
  assert.deepEqual((await progressResponse.json()).progress, {
    phase: "video-rendering",
    percent: 63,
    current: 5,
    total: 8,
    detail: "",
    updatedAt: "2026-06-10T12:00:00.000Z",
  });

  const clientProgressResponse = await worker.fetch(new Request(`https://worker.test/real-estate/deliverables/jobs/${queued.job.id}`, {
    headers: { cookie },
  }));
  assert.equal(clientProgressResponse.status, 200);
  assert.equal((await clientProgressResponse.json()).job.progress.percent, 63);

  const pdfRecord = renderJob.job.deliverables.find((record) => record.type === "pdf");
  const videoRecord = renderJob.job.deliverables.find((record) => record.type === "video");
  const completePdf = await worker.fetch(new Request(
    `https://worker.test/real-estate/internal/render-jobs/${queued.job.id}/deliverables/${pdfRecord.id}/complete?galleryKey=corine-real-estate&token=${access.renderToken}&filename=cloud.pdf`,
    { method: "POST", headers: { "content-type": "application/pdf" }, body: "%PDF cloud" }
  ));
  assert.equal(completePdf.status, 200);
  assert.equal((await completePdf.json()).deliverable.assemblyJob.assembler, "cloud-browser-workflow");

  const completeVideo = await worker.fetch(new Request(
    `https://worker.test/real-estate/internal/render-jobs/${queued.job.id}/deliverables/${videoRecord.id}/complete?galleryKey=corine-real-estate&token=${access.renderToken}&filename=cloud.webm`,
    { method: "POST", headers: { "content-type": "video/webm" }, body: "webm-source" }
  ));
  assert.equal(completeVideo.status, 200);
  const video = (await completeVideo.json()).deliverable;
  assert.equal(video.status, "ready");
  assert.equal(video.filename, "cloud.mp4");
  assert.equal(video.outputs.video.contentType, "video/mp4");
  assert.deepEqual(transcoded, [{
    contentType: "video/webm",
    filename: "cloud.webm",
    width: 1280,
    height: 720,
    bytes: 11,
  }]);

  const readyResponse = await worker.fetch(new Request(`https://worker.test/real-estate/deliverables/jobs/${queued.job.id}`, {
    headers: { cookie },
  }));
  assert.equal(readyResponse.status, 200);
  assert.equal((await readyResponse.json()).job.status, "ready");
});

test("deployed Worker blocks checkout when private delivery files are missing", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };
  env.ACCESS_DB = await readyLifecycleD1([photoId]);

  const checkoutResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }), env);
  assert.equal(checkoutResponse.status, 409);
  const body = await checkoutResponse.json();
  assert.equal(body.error.code, "delivery_assets_unavailable");
  assert.equal(body.error.details.missing[0].code, "missing_private_master");
});

test("R2 ZIP delivery renders and privately caches JPG products", async () => {
  const photoId = "photo-1";
  const privateKey = `masters/${photoId}.jpg`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: createTestJpeg(),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  let renderCount = 0;
  const delivery = createR2ZipDelivery({
    privateBucket: privateR2,
    deliveryBucket: privateR2,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID: deterministicIds(),
    renderer: {
      canRender: (productId) => productId === "jpg-3mp",
      render: async () => {
        renderCount += 1;
        return createTestJpeg(32, 24);
      },
    },
  });
  const order = {
    id: "PBE-TEST",
    buyerEmail: "buyer@example.com",
    currency: "usd",
    amountPaid: 5500,
    amountExpected: 5500,
    items: [{
      photoId,
      title: "Private source",
      source: {
        path: "source.jpg",
        privateMasterKey: privateKey,
        dimensions: { width: 64, height: 48 },
      },
      products: [
        { id: "full", label: "Full resolution" },
        { id: "jpg-3mp", label: "JPG 3 MP" },
      ],
    }],
  };

  const firstDelivery = await delivery.createDelivery(order);
  const secondDelivery = await delivery.createDelivery({ ...order, id: "PBE-TEST-2" });
  assert.equal(renderCount, 1);
  assert.equal(firstDelivery.items.find((item) => item.products.includes("jpg-3mp")).cacheHit, false);
  assert.equal(secondDelivery.items.find((item) => item.products.includes("jpg-3mp")).cacheHit, true);
  const renderKeys = Array.from(privateR2._debug.keys()).filter((key) => key.startsWith(`renders/${photoId}_`));
  assert.equal(renderKeys.length, 1);
  assert.equal(renderKeys[0], `renders/${photoId}_3mp.jpg`);
  assert.equal(privateR2._debug.get(renderKeys[0]).httpMetadata.contentType, "image/jpeg");
  assert.equal(privateR2._debug.get(renderKeys[0]).customMetadata.watermark, "none");
  assert.deepEqual(firstDelivery.files.map((file) => file.name), [`${photoId}-full.jpg`, `${photoId}-jpg-3mp.jpg`]);
  assert.equal(firstDelivery.files[1].objectKey, renderKeys[0]);
  assert.equal(firstDelivery.files[1].downloadUrl.startsWith("/download/"), true);
});

test("R2 ZIP delivery does not fall back to legacy private masters", async () => {
  const photoId = "photo-legacy";
  const flatKey = `masters/${photoId}.jpg`;
  const legacyKey = `masters/${photoId}/source.jpg`;
  const privateR2 = createFakeR2({
    [legacyKey]: {
      body: createTestJpeg(),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const delivery = createR2ZipDelivery({
    privateBucket: privateR2,
    deliveryBucket: privateR2,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID: deterministicIds(),
  });

  await assert.rejects(() => delivery.createDelivery({
    id: "PBE-LEGACY",
    buyerEmail: "buyer@example.com",
    currency: "usd",
    amountPaid: 6500,
    amountExpected: 6500,
    items: [{
      photoId,
      title: "Legacy source",
      source: {
        path: "source.jpg",
        privateMasterKey: flatKey,
      },
      products: [{ id: "full", label: "Full resolution" }],
    }],
  }), (error) => error?.code === "missing_private_master" && error?.status === 409);
});

test("R2 ZIP delivery reuses cached JPG products without reading the private master", async () => {
  const photoId = "20220506-160631-03403-51426edaac";
  const privateKey = `masters/${photoId}.jpg`;
  const renderKey = `renders/${photoId}_3mp.jpg`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: createTestJpeg(120, 80),
      httpMetadata: { contentType: "image/jpeg" },
    },
    [renderKey]: {
      body: createTestJpeg(60, 40),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const originalGet = privateR2.get;
  let masterReads = 0;
  privateR2.get = async (key) => {
    const object = await originalGet(key);
    if (!object || key !== privateKey) return object;
    return {
      ...object,
      arrayBuffer: async () => {
        masterReads += 1;
        return object.arrayBuffer();
      },
    };
  };

  const delivery = createR2ZipDelivery({
    privateBucket: privateR2,
    deliveryBucket: privateR2,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID: deterministicIds(),
    renderer: {
      canRender: () => true,
      render: async () => {
        throw new Error("Renderer should not be called for a cached private JPG.");
      },
    },
  });
  const order = {
    id: "PBE-CACHED",
    buyerEmail: "buyer@example.com",
    currency: "usd",
    amountPaid: 1600,
    amountExpected: 1600,
    items: [{
      photoId,
      title: "Les Invalides, Paris",
      source: {
        path: "2022/JPG/05/06/20220506 160631 03403.jpg",
        privateMasterKey: privateKey,
        dimensions: { width: 6000, height: 4000 },
      },
      products: [
        { id: "jpg-3mp", label: "JPG 3 MP" },
      ],
    }],
  };

  const result = await delivery.createDelivery(order);
  assert.equal(masterReads, 0);
  assert.equal(result.items[0].cacheHit, true);
  assert.equal(result.items[0].renderKey, renderKey);
  assert.equal(result.files[0].name, `${photoId}-jpg-3mp.jpg`);
  assert.equal(result.files[0].objectKey, renderKey);
});

test("deployed Worker serves public R2 previews through the media route", async () => {
  const publicR2 = createFakeR2({
    "expo/france/sample_900.jpg": {
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    PUBLIC_MEDIA: publicR2,
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };
  env.ACCESS_DB = await readyLifecycleD1(["media-preview"], new Map([
    ["media-preview", [{ bucket: "public", objectKey: "expo/france/sample_900.jpg" }]],
  ]));

  const response = await deployedWorker.fetch(new Request("https://worker.test/media/expo/france/sample_900.jpg"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("hex"), "ffd8ffd9");

  const unbound = await deployedWorker.fetch(new Request("https://worker.test/media/expo/france/unbound.jpg"), env);
  assert.equal(unbound.status, 503);
  assert.equal(unbound.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(unbound.headers.get("cdn-cache-control"), "no-store");

  await denyLifecycleMedia(env.ACCESS_DB, "media-preview", [
    { bucket: "public", objectKey: "expo/france/sample_900.jpg" },
  ]);
  const denied = await deployedWorker.fetch(new Request("https://worker.test/media/expo/france/sample_900.jpg"), env);
  assert.equal(denied.status, 410);
  assert.equal(denied.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(denied.headers.get("cdn-cache-control"), "no-store");

  const missingEnv = {
    ...env,
    ACCESS_DB: await readyLifecycleD1(["media-preview"], new Map([
      ["media-preview", [{ bucket: "public", objectKey: "expo/france/sample_900.jpg" }]],
    ])),
    PUBLIC_MEDIA: createFakeR2(),
  };
  const missing = await deployedWorker.fetch(new Request("https://worker.test/media/expo/france/sample_900.jpg"), missingEnv);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(missing.headers.get("cdn-cache-control"), "no-store");
});

test("deployed Worker serves only the approved Backstage release manifest and immutable archives", async () => {
  const manifest = new TextEncoder().encode('{"schemaVersion":1}\n');
  const archive = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const bucket = createFakeR2({
    "backstage/releases/latest.json": {
      body: manifest,
      httpMetadata: { contentType: "text/plain" },
    },
    "backstage/releases/PhotosByElie-Backstage-v237.1-build-188.zip": {
      body: archive,
      httpMetadata: { contentType: "application/octet-stream" },
    },
    "backstage/releases/private.txt": {
      body: new TextEncoder().encode("not public"),
    },
  });

  const manifestResponse = await deployedWorker.fetch(
    new Request("https://download.photos-by-elie.com/backstage/releases/latest.json"),
    { PUBLIC_MEDIA: bucket },
  );
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(manifestResponse.headers.get("cache-control"), "public, max-age=60, must-revalidate");
  assert.equal(manifestResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await manifestResponse.text(), '{"schemaVersion":1}\n');

  const archiveUrl = "https://download.photos-by-elie.com/backstage/releases/PhotosByElie-Backstage-v237.1-build-188.zip";
  const archiveResponse = await deployedWorker.fetch(new Request(archiveUrl), { PUBLIC_MEDIA: bucket });
  assert.equal(archiveResponse.status, 200);
  assert.equal(archiveResponse.headers.get("content-type"), "application/zip");
  assert.equal(archiveResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(
    archiveResponse.headers.get("content-disposition"),
    'attachment; filename="PhotosByElie-Backstage-v237.1-build-188.zip"',
  );
  assert.equal(Buffer.from(await archiveResponse.arrayBuffer()).toString("hex"), "504b0304");

  const headResponse = await deployedWorker.fetch(new Request(archiveUrl, { method: "HEAD" }), { PUBLIC_MEDIA: bucket });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get("content-length"), "4");
  assert.equal((await headResponse.arrayBuffer()).byteLength, 0);

  for (const path of [
    "/backstage/releases/private.txt",
    "/backstage/releases/../private.txt",
    "/backstage/releases/PhotosByElie-Backstage-latest.zip",
  ]) {
    const denied = await deployedWorker.fetch(
      new Request(`https://download.photos-by-elie.com${path}`),
      { PUBLIC_MEDIA: bucket },
    );
    assert.equal(denied.status, 404, path);
  }

  const post = await deployedWorker.fetch(
    new Request("https://download.photos-by-elie.com/backstage/releases/latest.json", { method: "POST" }),
    { PUBLIC_MEDIA: bucket },
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");

  const unavailable = await deployedWorker.fetch(
    new Request("https://download.photos-by-elie.com/backstage/releases/latest.json"),
    {},
  );
  assert.equal(unavailable.status, 503);
});

test("deployed Worker root redirects direct auth-domain visits to Account", async () => {
  const response = await deployedWorker.fetch(new Request("https://auth.photos-by-elie.com/"), {
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://photos-by-elie.com/?account=1");
});

test("deployed Worker serves public R2 media byte ranges", async () => {
  const reviewedMusicKey = NON_REVOCABLE_PUBLIC_ASSET_KEYS[0];
  const publicR2 = createFakeR2({
    [reviewedMusicKey]: {
      body: new Uint8Array([0, 1, 2, 3, 4, 5]),
      httpMetadata: { contentType: "audio/mpeg" },
    },
  });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    PUBLIC_MEDIA: publicR2,
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };

  const response = await deployedWorker.fetch(new Request(`https://worker.test/media/${reviewedMusicKey}`, {
    headers: { range: "bytes=1-3" },
  }), env);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("content-range"), "bytes 1-3/6");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("hex"), "010203");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
});

test("deployed Worker returns a no-store 400 for malformed media percent encoding", async () => {
  let bucketReads = 0;
  const response = await deployedWorker.fetch(new Request("https://worker.test/media/%E0%A4%A"), {
    PUBLIC_MEDIA: {
      head: async () => { bucketReads += 1; return null; },
      get: async () => { bucketReads += 1; return null; },
    },
  });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Malformed media key");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(bucketReads, 0);
});

test("Worker health fails while lifecycle authority is blocked and succeeds only when ready", async () => {
  const blocked = new TestD1();
  const base = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };
  const blockedResponse = await deployedWorker.fetch(new Request("https://worker.test/health"), {
    ...base,
    ACCESS_DB: blocked,
  });
  assert.equal(blockedResponse.status, 503);
  const readyResponse = await deployedWorker.fetch(new Request("https://worker.test/health"), {
    ...base,
    ACCESS_DB: await readyLifecycleD1(["health-media"]),
  });
  assert.equal(readyResponse.status, 200);
  assert.equal((await readyResponse.json()).lifecycle, "ready");
  assert.equal(readyResponse.headers.get("cache-control"), "no-store");
});

test("real-estate delivery links fail closed when their batch has no canonical media identity", async () => {
  const privateR2 = createFakeR2();
  const store = createMemoryStore();
  const galleries = [{ key: "corine-real-estate", username: "Corine", accessCode: "LaConcha" }];
  const deliverables = createRealEstateDeliverables({ privateBucket: privateR2, store, galleries });
  const session = { galleryKey: "corine-real-estate", username: "Corine" };
  const record = await deliverables.putDeliverable({
    galleryKey: "corine-real-estate",
    realEstateSession: session,
    deliverable: {
      id: "identityless-pdf",
      type: "pdf",
      status: "ready",
      filename: "identityless.pdf",
      outputs: { pdf: { key: "outputs/identityless.pdf", contentType: "application/pdf" } },
      batch: { batchId: "identityless", projects: [{ items: [] }] },
    },
  });
  await privateR2.put(record.outputs.pdf.key, new TextEncoder().encode("%PDF"), {
    httpMetadata: { contentType: "application/pdf" },
  });
  await assert.rejects(deliverables.createDeliveryLinks({
    galleryKey: "corine-real-estate",
    realEstateSession: session,
    deliverableIds: [record.id],
  }), { code: "lifecycle_identity_unavailable" });
});
