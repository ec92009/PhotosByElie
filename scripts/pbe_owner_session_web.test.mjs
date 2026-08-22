import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ownerSessionSource = read("pbe-owner-session.js");

const runSessionClient = ({
  search,
  fetch,
  catalogReady = Promise.resolve(),
  sharedReady = Promise.resolve(),
  data = {},
}) => {
  let banner = null;
  const bannerSlots = new Map();
  const bodyClasses = new Set();
  const makeSlot = () => ({
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener: () => {},
    setAttribute(name, value) { this[name] = String(value); },
  });
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: {
      dataset: {},
      classList: {
        add: (...names) => names.forEach((name) => bodyClasses.add(name)),
        remove: (...names) => names.forEach((name) => bodyClasses.delete(name)),
        contains: (name) => bodyClasses.has(name),
      },
      prepend: () => {},
    },
    querySelector: (selector) => selector === "[data-pbe-owner-session]" ? banner : null,
    createElement: () => {
      banner = {
        className: "", dataset: {}, innerHTML: "", title: "",
        setAttribute(name, value) { this[name] = String(value); },
        getBoundingClientRect: () => ({ height: 40 }),
        querySelector: (selector) => {
          if (!bannerSlots.has(selector)) bannerSlots.set(selector, makeSlot());
          return bannerSlots.get(selector);
        },
      };
      return banner;
    },
  };
  const window = {
    location: { hostname: "127.0.0.1", pathname: "/gallery.html", search, hash: "" },
    history: { replaceState: () => {} },
    dispatchEvent: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    photosByElieCatalogReady: catalogReady,
    photosByElieSharedGalleryReady: sharedReady,
    photosByElieData: data,
  };
  vm.runInNewContext(read("pbe-owner-session.js"), {
    window, document, fetch, URLSearchParams, encodeURIComponent,
    CustomEvent: class CustomEvent {}, Date, setTimeout,
  });
  return {
    window,
    document,
    banner: () => banner,
    bannerSlot: (selector) => bannerSlots.get(selector) || null,
  };
};

test("gallery and detail bootstrap the Backstage session before Owner actions", () => {
  for (const page of ["gallery.html", "photo.html"]) {
    const html = read(page);
    const sessionIndex = html.indexOf("pbe-owner-session.js");
    const actionsIndex = html.indexOf("hidden-actions.js");
    assert.ok(sessionIndex >= 0, `${page} loads the PBE Owner session client`);
    assert.ok(actionsIndex > sessionIndex, `${page} loads Owner actions after the session client`);
    assert.match(html, /pbe-owner-session\.js\?v=226\.2/);
  }
  assert.match(read("photo-gallery.js"), /await window\.photosByEliePageReady\(\)/);
  assert.match(
    read("photo-gallery.js"),
    /if \(isPBEOwnerGallery\) \{[\s\S]*const ownerGallery = window\.photosByElieData\?\.\[pbeOwnerGalleryKey\]/,
  );
  assert.match(read("gallery.html"), /photo-gallery\.js\?v=226\.2/);
  assert.match(read("photo-detail.js"), /await window\.photosByEliePageReady\(\)/);
  assert.match(read("pbe-owner-session.js"), /if \(ownerSurface\) \{[\s\S]*await window\.photosByEliePBEOwnerSessionReady/);
  assert.match(read("photo-gallery.js"), /const setCollectionLabel = \(element\) => \{[\s\S]*if \(isPBEOwnerGallery\) delete element\.dataset\.i18n;/);
});

test("Owner cold launch exposes one busy loading region until the frozen fixture is ready", async () => {
  let resolveSession;
  const sessionResponse = new Promise((resolve) => { resolveSession = resolve; });
  const session = {
    id: "session-loading", state: "ready", fixtureId: "fixture-expo",
    fixtureBreadcrumb: "Expo", expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const client = runSessionClient({
    search: "?gallery=pbe-owner",
    fetch: async (url) => {
      if (url.endsWith("/session")) return sessionResponse;
      if (url.endsWith("/gallery")) return response({
        ok: true,
        gallery: {
          fixtureId: session.fixtureId,
          fixtureBreadcrumb: session.fixtureBreadcrumb,
          items: [],
          summary: { filtered: 0 },
        },
      });
      throw new Error(`unexpected request ${url}`);
    },
  });

  assert.equal(client.banner().dataset.state, "checking");
  assert.equal(client.banner()["aria-busy"], "true");
  assert.equal(client.bannerSlot("[data-pbe-owner-title]").textContent, "Loading PBE Owner");
  assert.match(client.bannerSlot("[data-pbe-owner-message]").textContent, /Loading the frozen Backstage fixture/);
  assert.equal(client.bannerSlot("[data-pbe-owner-close]").hidden, true);

  resolveSession(response({ ok: true, session }));
  await client.window.photosByEliePBEOwnerSessionReady;

  assert.equal(client.banner().dataset.state, "ready");
  assert.equal(client.banner()["aria-busy"], "false");
  assert.equal(client.bannerSlot("[data-pbe-owner-title]").textContent, "PBE Owner · Expo");
  assert.equal(client.bannerSlot("[data-pbe-owner-close]").hidden, false);
  assert.equal(client.document.body.dataset.pbeOwnerSessionState, "ready");
});

test("Owner cold-launch failure leaves a distinct actionable non-busy state", async () => {
  let resolveSession;
  const sessionResponse = new Promise((resolve) => { resolveSession = resolve; });
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const client = runSessionClient({
    search: "?gallery=pbe-owner",
    fetch: async (url) => {
      if (url.endsWith("/session")) return sessionResponse;
      throw new Error(`unexpected request ${url}`);
    },
  });

  assert.equal(client.banner().dataset.state, "checking");
  resolveSession(response({ ok: false, error: { message: "Load failed" } }, 503));
  await client.window.photosByEliePBEOwnerSessionReady;

  assert.equal(client.banner().dataset.state, "unavailable");
  assert.equal(client.banner()["aria-busy"], "false");
  assert.equal(client.bannerSlot("[data-pbe-owner-title]").textContent, "PBE Owner unavailable");
  assert.match(client.bannerSlot("[data-pbe-owner-message]").textContent, /Reopen PBE Owner from Backstage to retry/);
  assert.equal(client.bannerSlot("[data-pbe-owner-close]").hidden, true);
  assert.equal(client.document.body.dataset.pbeOwnerSessionState, "unavailable");
});

test("native Owner uses fast gallery previews and reserves full previews for detail", () => {
  assert.match(ownerSessionSource, /galleryUrl:[^\n]+`\$\{previewUrl\}\?size=gallery`/);
  assert.match(ownerSessionSource, /detailUrl:[^\n]+`\$\{previewUrl\}\?size=detail`/);
});

test("hosted Owner page readiness ignores a rejected public catalog", async () => {
  let rejectCatalog;
  let rejectShared;
  const catalogReady = new Promise((_, reject) => { rejectCatalog = reject; });
  const sharedReady = new Promise((_, reject) => { rejectShared = reject; });
  const session = {
    id: "session-owner", state: "ready", fixtureId: "fixture-owner",
    fixtureBreadcrumb: "RE > Owner", expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const fetch = async (url) => {
    if (url.endsWith("/session")) return response({ ok: true, session });
    if (url.endsWith("/gallery")) return response({
      ok: true,
      gallery: {
        fixtureId: session.fixtureId,
        fixtureBreadcrumb: "collection.pbe-owner",
        items: [{ assetId: "owner-photo", filename: "owner-photo.jpg", mediaType: "photo" }],
        summary: { filtered: 1 },
      },
    });
    throw new Error(`unexpected request ${url}`);
  };
  const { window } = runSessionClient({
    search: "?gallery=%20PBE-OWNER%20",
    fetch,
    catalogReady,
    sharedReady,
  });
  window.photosByElieHiddenActionsReady = Promise.resolve();
  rejectCatalog(new Error("public catalog unavailable"));
  rejectShared(new Error("shared catalog unavailable"));

  const context = await window.photosByEliePageReady();

  assert.equal(context.mode, "pbe-owner");
  assert.equal(context.galleryKey, "pbe-owner");
  assert.equal(context.gallery.fixtureId, session.fixtureId);
  assert.equal(context.gallery.title, session.fixtureBreadcrumb);
  assert.deepEqual(Array.from(context.gallery.photos, (photo) => photo.id), ["owner-photo"]);
});

test("invalid Owner session fails closed without falling through to France", async () => {
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const { window } = runSessionClient({
    search: "?gallery=pbe-owner",
    fetch: async (url) => {
      if (url.endsWith("/session")) {
        return response({ ok: false, error: { message: "Backstage lease rejected" } }, 401);
      }
      throw new Error(`unexpected request ${url}`);
    },
    data: { france: { title: "France", photos: [{ id: "france-one" }] } },
  });
  window.photosByElieHiddenActionsReady = Promise.resolve();

  await assert.rejects(window.photosByEliePageReady(), /Backstage lease rejected/);
  assert.equal(window.photosByEliePBEOwnerSession.state().ready, false);
  assert.equal(window.photosByElieData["pbe-owner"], undefined);
  assert.deepEqual(Array.from(window.photosByElieData.france.photos, (photo) => photo.id), ["france-one"]);
  assert.match(read("photo-gallery.js"), /normalized === pbeOwnerGalleryKey\) return pbeOwnerGalleryKey/);
});

test("public page readiness is independent of the Owner session promise", async () => {
  const { window } = runSessionClient({
    search: "?gallery=spain",
    fetch: async () => { throw new Error("public readiness must not fetch an Owner session"); },
  });
  window.photosByElieHiddenActionsReady = Promise.resolve();
  window.photosByEliePBEOwnerSessionReady = new Promise(() => {});

  const context = await Promise.race([
    window.photosByEliePageReady(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("public readiness waited for Owner")), 100)),
  ]);

  assert.equal(context.mode, "public");
});

test("public hidden actions initialize while Owner readiness remains pending", async () => {
  const window = {
    location: { hostname: "127.0.0.1", search: "?gallery=spain" },
    photosByEliePBEOwnerSession: { isReady: () => false },
    photosByEliePBEOwnerSessionReady: new Promise(() => {}),
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  vm.runInNewContext(read("hidden-actions.js"), {
    window,
    URLSearchParams,
    CustomEvent: class CustomEvent {},
  });

  const hiddenIds = await Promise.race([
    window.photosByElieHiddenActionsReady,
    new Promise((_, reject) => setTimeout(() => reject(new Error("public hidden actions waited for Owner")), 100)),
  ]);

  assert.deepEqual(Array.from(hiddenIds), []);
});

test("detail controller renders explicit failure without public fallback", async (t) => {
  for (const [label, search, expectedMeta] of [
    ["Owner", "?gallery=%20PBE-OWNER%20&id=france-one", "PBE Owner unavailable"],
    ["public", "?gallery=france&id=france-one", "Photo unavailable"],
  ]) {
    await t.test(label, async () => {
      const elements = {
        preview: { setAttribute: (name) => { elements.preview[name] = true; } },
        purchase: { setAttribute: (name) => { elements.purchase[name] = true; } },
        shortcut: { setAttribute: (name) => { elements.shortcut[name] = true; } },
        meta: { textContent: "", removeAttribute: () => {} },
        title: { textContent: "", removeAttribute: () => {} },
      };
      const selectors = {
        "[data-photo-preview]": elements.preview,
        ".purchase-panel": elements.purchase,
        "[data-detail-shortcut-hint]": elements.shortcut,
        "[data-photo-meta]": elements.meta,
        "[data-photo-title]": elements.title,
      };
      const document = {
        body: { dataset: {} },
        head: {
          querySelector: () => null,
          append: () => {},
        },
        createElement: () => ({}),
        querySelector: (selector) => selectors[selector] || null,
      };
      let replaced = "";
      const window = {
        location: { search, replace: (value) => { replaced = value; } },
        photosByEliePageReady: async () => { throw new Error("Fixture authorization unavailable"); },
        photosByElieData: { france: { title: "France", photos: [{ id: "france-one" }] } },
      };

      await vm.runInNewContext(read("photo-detail.js"), {
        window,
        document,
        URLSearchParams,
      });

      assert.equal(replaced, "");
      assert.equal(elements.preview.hidden, true);
      assert.equal(elements.purchase.hidden, true);
      assert.equal(elements.meta.textContent, expectedMeta);
      assert.equal(elements.title.textContent, "Fixture authorization unavailable");
    });
  }
});

test("browser session handoff exchanges an opaque ticket for an HttpOnly session", () => {
  const source = read("pbe-owner-session.js");
  const host = read("scripts/local_server.py");
  assert.match(source, /const fragmentKey = "pbe_owner_ticket"/);
  assert.match(source, /parameters\.delete\(fragmentKey\)/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /request\("\/browser\/bootstrap"/);
  assert.doesNotMatch(source, /Authorization/);
  assert.match(source, /lifecycleStoragePrefix = "photosbyelie-pbe-owner-lifecycle:"/);
  assert.match(source, /pendingActionStoragePrefix = "photosbyelie-pbe-owner-pending-action:"/);
  assert.match(source, /const lifecycleStorage = \(\) => \{\s*try \{\s*return window\.sessionStorage \|\| null;/);
  assert.match(source, /storage\.setItem\(key, JSON\.stringify\(lifecycle\)\)/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*(?:browserTicket|pbe_owner_ticket|state\.session)/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /deviceCredential|api[_-]?key/i);
  assert.match(source, /window\.setInterval\(heartbeat, 30_000\)/);
  assert.match(source, /\[401, 403, 409\]\.includes\(response\.status\).*failClosed/s);
  assert.match(host, /#pbe_owner_ticket=/);
  assert.doesNotMatch(host, /#pbe_owner_session=/);
  assert.match(host, /"HttpOnly"/);
  assert.match(host, /"SameSite=Strict"/);
  assert.match(host, /bootstrap_browser/);
  assert.match(source, /role", "region"/);
  assert.match(source, /aria-label", "PBE Owner session"/);
  assert.match(source, /role="status" aria-live="polite"/);
});

test("a stale in-flight heartbeat cannot reopen a closed Owner session", async () => {
  let heartbeatCallback = null;
  let resolveHeartbeat = null;
  const session = {
    id: "session-generation-one",
    state: "ready",
    fixtureId: "fixture-current",
    fixtureBreadcrumb: "Current fixture",
    expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const fetch = async (url) => {
    if (url.endsWith("/session")) return response({ ok: true, session });
    if (url.endsWith("/gallery")) {
      return response({
        ok: true,
        gallery: {
          fixtureId: session.fixtureId,
          fixtureBreadcrumb: session.fixtureBreadcrumb,
          items: [],
          summary: { filtered: 0 },
        },
      });
    }
    if (url.endsWith("/session/heartbeat")) {
      return new Promise((resolve) => { resolveHeartbeat = resolve; });
    }
    if (url.endsWith("/session/close")) {
      return response({ ok: true, session: { ...session, state: "closed" } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const children = {
    title: { textContent: "" },
    message: { textContent: "" },
    close: { disabled: false, addEventListener: () => {} },
  };
  let banner = null;
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} }, prepend: () => {} },
    querySelector: (selector) => selector === "[data-pbe-owner-session]" ? banner : null,
    createElement: () => {
      banner = {
        className: "",
        dataset: {},
        innerHTML: "",
        setAttribute: () => {},
        getBoundingClientRect: () => ({ height: 40 }),
        querySelector: (selector) => ({
          "[data-pbe-owner-title]": children.title,
          "[data-pbe-owner-message]": children.message,
          "[data-pbe-owner-close]": children.close,
        }[selector] || null),
      };
      return banner;
    },
  };
  const window = {
    location: {
      hostname: "127.0.0.1",
      pathname: "/gallery.html",
      search: "?gallery=pbe-owner",
      hash: "",
    },
    history: { replaceState: () => {} },
    clearInterval: () => {},
    setInterval: (callback) => {
      heartbeatCallback = callback;
      return 1;
    },
    dispatchEvent: () => {},
  };
  vm.runInNewContext(read("pbe-owner-session.js"), {
    window,
    document,
    fetch,
    URLSearchParams,
    CustomEvent: class CustomEvent {},
    Date,
  });

  await window.photosByEliePBEOwnerSessionReady;
  assert.equal(window.photosByEliePBEOwnerSession.state().ready, true);
  const pendingHeartbeat = heartbeatCallback();
  await window.photosByEliePBEOwnerSession.close();
  resolveHeartbeat(response({ ok: true, session }));
  await pendingHeartbeat;

  const finalState = window.photosByEliePBEOwnerSession.state();
  assert.equal(finalState.phase, "unavailable");
  assert.equal(finalState.ready, false);
  assert.equal(finalState.session, null);
});

test("hosted PBE X is bound to the frozen fixture and guarded Waste Basket actions", () => {
  const session = read("pbe-owner-session.js");
  const actions = read("hidden-actions.js");
  const gallery = read("photo-gallery.js");
  const localHost = read("scripts/local_server.py");
  assert.doesNotMatch(session, /fixtureId: state\.session\.fixtureId/);
  assert.match(session, /action\/status\?requestId=/);
  assert.match(session, /remains safely queued for the trusted Mac connector/);
  assert.match(session, /request\("\/gallery"\)/);
  assert.match(session, /window\.photosByElieData\[galleryKey\]/);
  assert.match(actions, /isHostedOwnerSurface\(\).*pbeOwnerSession\?\.isReady/s);
  assert.match(actions, /Boolean\(localEnabled && isHostedOwnerSurface\(\) && pbeOwnerSession\?\.isReady\?\.\(\)\)/);
  assert.match(actions, /const wasteBasketContext = \{ source: "owner-gallery"/);
  assert.match(actions, /pbeOwnerSession\.action\(action, requestPayload\)/);
  assert.match(actions, /pbeOwnerSession\.recordLifecycleResult\?\.\(payload\)/);
  assert.match(actions, /photosbyelie:pbeowneractionresult[\s\S]*applyServerState\(event\.detail\)/);
  assert.match(gallery, /ensureGalleryCommandBar\(\);\s*renderGallery\(\{ scrollSelection: false \}\);/);
  assert.doesNotMatch(gallery, /ensureGalleryKeyboardHint/);
  assert.doesNotMatch(actions, /credentials:\s*"include"/);
  assert.match(localHost, /"waste-basket-x"/);
  assert.match(localHost, /"waste-basket-x-many"/);
  assert.match(localHost, /"waste-basket-restore"/);
  assert.match(localHost, /pbe_owner_action_forbidden/);
  assert.match(localHost, /"source": "owner-gallery"/);
  assert.match(localHost, /"owner_mode": True/);
  assert.match(localHost, /"owner_authorized": True/);
  assert.match(localHost, /\?gallery=pbe-owner/);
  assert.match(localHost, /assert_pbe_owner_x_scope/);
  assert.match(localHost, /queue_hosted_lifecycle_request/);
  assert.match(gallery, /const detailHrefForPhotoId = \(photoId\) => \{[\s\S]*if \(isPBEOwnerGallery\) detailParams\.set\("gallery", pbeOwnerGalleryKey\);[\s\S]*return versionedHref/);
  assert.match(gallery, /window\.location\.assign\(detailHrefForPhotoId\(photo\.id\)\)/);
  assert.match(gallery, /const href = detailHrefForPhotoId\(photo\.id\);/);
});

test("hosted action queues sanitized intent and polls its opaque result", async () => {
  const session = {
    id: "session-one", state: "ready", fixtureId: "fixture-current",
    fixtureBreadcrumb: "Current fixture", expiresAt: "2030-01-01T12:00:00Z",
  };
  const calls = [];
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const fetch = async (url, options = {}) => {
    calls.push([url, options]);
    if (url.endsWith("/session")) return response({ ok: true, session });
    if (url.endsWith("/gallery")) return response({
      ok: true,
      gallery: { fixtureId: session.fixtureId, items: [], summary: { filtered: 0 } },
    });
    if (url.endsWith("/action")) {
      return response({ ok: true, requestId: "hlr-opaque", state: "queued" }, 202);
    }
    if (url.includes("/action/status?requestId=hlr-opaque")) {
      return response({ ok: true, site: { hidden: ["photo-one"] }, hiddenPhotoIds: ["photo-one"] });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} }, prepend: () => {} },
    querySelector: () => null,
    createElement: () => ({
      className: "", dataset: {}, innerHTML: "", setAttribute: () => {},
      getBoundingClientRect: () => ({ height: 40 }), querySelector: () => null,
    }),
  };
  const window = {
    location: { hostname: "127.0.0.1", pathname: "/gallery.html", search: "?gallery=pbe-owner", hash: "" },
    history: { replaceState: () => {} }, dispatchEvent: () => {},
    setInterval: () => 1, clearInterval: () => {}, setTimeout: (callback) => { callback(); return 1; },
  };
  vm.runInNewContext(read("pbe-owner-session.js"), {
    window, document, fetch, URLSearchParams, encodeURIComponent,
    CustomEvent: class CustomEvent {}, Date,
    crypto: { randomUUID: () => "browser-random" },
  });
  await window.photosByEliePBEOwnerSessionReady;
  const result = await window.photosByEliePBEOwnerSession.action("waste-basket-x", {
    photo_id: "photo-one", fixtureId: "fixture-attacker", source: "attacker",
    owner_mode: true, owner_authorized: true, requestKey: "attacker-key",
    lifecycleMembers: [{ canonicalAssetId: "attacker" }],
  });
  assert.deepEqual(Array.from(result.hiddenPhotoIds), ["photo-one"]);
  const actionCall = calls.find(([url]) => url.endsWith("/action"));
  const body = JSON.parse(actionCall[1].body);
  assert.deepEqual(body, { action: "waste-basket-x", photo_id: "photo-one" });
  assert.match(actionCall[1].headers["Idempotency-Key"], /^pbe-owner-[a-z0-9]+-browser-random$/);
  assert.equal(calls.filter(([url]) => url.includes("/action/status?")).length, 1);
});

test("lifecycle truth persists by session and projection retry never replays authority", async () => {
  const values = new Map();
  const sessionStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const session = {
    id: "lifecycle-session", state: "ready", fixtureId: "fixture-current",
    fixtureBreadcrumb: "Current fixture", expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  let retryMode = "applied";
  let latestStatus = null;
  const retryBodies = [];
  const fetch = async (url, options = {}) => {
    if (url.endsWith("/session")) return response({ ok: true, session });
    if (url.endsWith("/gallery")) return response({
      ok: true,
      gallery: { fixtureId: session.fixtureId, items: [], summary: { filtered: 0 } },
    });
    if (url.includes("/action/status?requestId=")) {
      if (!latestStatus) throw new Error("unexpected lifecycle status lookup");
      return response(latestStatus);
    }
    if (url.endsWith("/action/projection-retry")) {
      retryBodies.push(JSON.parse(options.body));
      if (retryMode === "stale") {
        return response({
          ok: false,
          error: { code: "pbe_owner_projection_stale", message: "Projection state changed; refresh status." },
        }, 409);
      }
      if (retryMode === "expired") {
        return response({
          ok: false,
          error: { code: "pbe_owner_session_expired", message: "Owner session expired." },
        }, 403);
      }
      return response({
        ok: true,
        requestId: "hlr-one",
        state: "completed",
        authoritative_committed: true,
        authoritative: { state: "committed", operationId: "operation-one", revision: 23, receiptState: "applied" },
        projection: { state: "applied", retryable: false },
        catalogPublication: { state: "pending", receipt: null },
        projectionRetry: { available: false, operationRevision: 23, attempt: 1 },
      });
    }
    throw new Error(`unexpected request ${url}`);
  };

  const boot = async () => {
    const node = () => ({
      textContent: "", hidden: false, disabled: false, dataset: {},
      addEventListener(_type, callback) { this.listener = callback; },
    });
    const nodes = {
      title: node(), message: node(), close: node(), lifecycle: node(),
      authoritative: node(), projection: node(), publication: node(),
      layerHelp: node(), retryError: node(), retry: node(),
    };
    let banner = null;
    const document = {
      documentElement: { style: { setProperty: () => {} } },
      body: { classList: { add: () => {} }, prepend: () => {} },
      querySelector: (selector) => selector === "[data-pbe-owner-session]" ? banner : null,
      createElement: () => {
        banner = {
          className: "", dataset: {}, innerHTML: "", setAttribute: () => {},
          getBoundingClientRect: () => ({ height: 80 }),
          querySelector: (selector) => ({
            "[data-pbe-owner-title]": nodes.title,
            "[data-pbe-owner-message]": nodes.message,
            "[data-pbe-owner-close]": nodes.close,
            "[data-pbe-owner-lifecycle]": nodes.lifecycle,
            "[data-pbe-owner-authoritative]": nodes.authoritative,
            "[data-pbe-owner-projection]": nodes.projection,
            "[data-pbe-owner-publication]": nodes.publication,
            "[data-pbe-owner-layer-help]": nodes.layerHelp,
            "[data-pbe-owner-retry-error]": nodes.retryError,
            "[data-pbe-owner-retry]": nodes.retry,
          }[selector] || null),
        };
        return banner;
      },
    };
    const window = {
      location: { hostname: "127.0.0.1", pathname: "/gallery.html", search: "?gallery=pbe-owner", hash: "" },
      history: { replaceState: () => {} }, dispatchEvent: () => {}, sessionStorage,
      setInterval: () => 1, clearInterval: () => {},
    };
    vm.runInNewContext(read("pbe-owner-session.js"), {
      window, document, fetch, URLSearchParams, encodeURIComponent,
      CustomEvent: class CustomEvent {}, Date,
      crypto: { randomUUID: () => "browser-random" },
    });
    await window.photosByEliePBEOwnerSessionReady;
    return { window, nodes };
  };

  const pending = {
    ok: true,
    requestId: "hlr-one",
    state: "completed",
    authoritative_committed: true,
    authoritative: { state: "committed", operationId: "operation-one", revision: 23, receiptState: "applied" },
    projection: { state: "pending", retryable: true, error_code: "catalog_projection_unconfirmed" },
    catalogPublication: { state: "pending", receipt: null },
    projectionRetry: { available: true, token: "f".repeat(64), operationRevision: 23, attempt: 0 },
  };
  latestStatus = pending;

  const first = await boot();
  first.window.photosByEliePBEOwnerSession.recordLifecycleResult(pending);
  assert.equal(first.nodes.authoritative.textContent, "Committed");
  assert.equal(first.nodes.projection.textContent, "Pending retry");
  assert.equal(first.nodes.publication.textContent, "Pending release receipt");
  assert.match(first.nodes.layerHelp.textContent, /only the local\/static projection/);
  assert.match(first.nodes.layerHelp.textContent, /Backstage Uploads receipt/);
  assert.equal(first.nodes.retry.hidden, false);
  assert.ok(values.has("photosbyelie-pbe-owner-lifecycle:lifecycle-session"));

  const cached = JSON.parse(values.get("photosbyelie-pbe-owner-lifecycle:lifecycle-session"));
  cached.projection = { state: "applied", retryable: false };
  values.set("photosbyelie-pbe-owner-lifecycle:lifecycle-session", JSON.stringify(cached));
  const restored = await boot();
  assert.equal(restored.window.photosByEliePBEOwnerSession.state().lifecycle.requestId, "hlr-one");
  assert.equal(restored.nodes.projection.textContent, "Pending retry");
  await restored.window.photosByEliePBEOwnerSession.retryProjection();
  assert.deepEqual(retryBodies[0], {
    requestId: "hlr-one",
    projectionToken: "f".repeat(64),
    operationRevision: 23,
  });
  assert.equal(restored.nodes.projection.textContent, "Applied locally");
  assert.match(restored.nodes.layerHelp.textContent, /not proven until Backstage Uploads records a release receipt/);
  assert.equal(restored.nodes.retry.hidden, true);
  assert.equal(restored.window.photosByEliePBEOwnerSession.state().ready, true);

  restored.window.photosByEliePBEOwnerSession.recordLifecycleResult({
    ...pending,
    projection: { state: "partial", retryable: true },
    projectionRetry: { available: true, token: "a".repeat(64), operationRevision: 23, attempt: 1 },
  });
  assert.equal(restored.nodes.projection.textContent, "Partially projected");
  assert.match(restored.nodes.layerHelp.textContent, /only the local\/static projection/);
  retryMode = "stale";
  await assert.rejects(
    () => restored.window.photosByEliePBEOwnerSession.retryProjection(),
    /Projection state changed/,
  );
  assert.equal(restored.window.photosByEliePBEOwnerSession.state().ready, true);
  assert.match(restored.window.photosByEliePBEOwnerSession.state().lifecycleRetryError, /changed/);
  assert.equal(
    restored.window.photosByEliePBEOwnerSession.state().lifecycle.projectionRetry.token,
    "f".repeat(64),
  );
  assert.equal(restored.nodes.retry.hidden, false);

  restored.window.photosByEliePBEOwnerSession.recordLifecycleResult({
    ...pending,
    projection: { state: "partial", retryable: false },
    projectionRetry: { available: false, operationRevision: 23, attempt: 1 },
  });
  assert.match(restored.nodes.layerHelp.textContent, /projection needs Backstage review/);
  assert.equal(restored.nodes.retry.hidden, true);

  restored.window.photosByEliePBEOwnerSession.recordLifecycleResult({
    ...pending,
    projection: { state: "skipped-no-static-catalog", retryable: false },
    projectionRetry: { available: false, operationRevision: 23, attempt: 1 },
  });
  assert.equal(restored.nodes.projection.textContent, "Intentionally skipped (no static catalog)");
  assert.equal(restored.nodes.retry.hidden, true);
  const retryCountBeforeNonretryable = retryBodies.length;
  await assert.rejects(
    () => restored.window.photosByEliePBEOwnerSession.retryProjection(),
    /not retryable/,
  );
  assert.equal(retryBodies.length, retryCountBeforeNonretryable);

  restored.window.photosByEliePBEOwnerSession.recordLifecycleResult({
    ...pending,
    projectionRetry: { available: true, token: "b".repeat(64), operationRevision: 23, attempt: 2 },
  });
  retryMode = "expired";
  await assert.rejects(
    () => restored.window.photosByEliePBEOwnerSession.retryProjection(),
    /Owner session expired/,
  );
  const expired = restored.window.photosByEliePBEOwnerSession.state();
  assert.equal(expired.ready, false);
  assert.equal(expired.lifecycle, null);
});

test("lifecycle status remains memory-only when session storage is unavailable", async () => {
  const session = {
    id: "storage-denied-session", state: "ready", fixtureId: "fixture-current",
    fixtureBreadcrumb: "Current fixture", expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const fetch = async (url) => {
    if (url.endsWith("/session")) return response({ ok: true, session });
    if (url.endsWith("/gallery")) return response({
      ok: true,
      gallery: { fixtureId: session.fixtureId, items: [], summary: { filtered: 0 } },
    });
    throw new Error(`unexpected request ${url}`);
  };
  let banner = null;
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} }, prepend: () => {} },
    querySelector: (selector) => selector === "[data-pbe-owner-session]" ? banner : null,
    createElement: () => {
      banner = {
        className: "", dataset: {}, innerHTML: "", setAttribute: () => {},
        getBoundingClientRect: () => ({ height: 40 }), querySelector: () => null,
      };
      return banner;
    },
  };
  const window = {
    location: { hostname: "127.0.0.1", pathname: "/gallery.html", search: "?gallery=pbe-owner", hash: "" },
    history: { replaceState: () => {} }, dispatchEvent: () => {},
    setInterval: () => 1, clearInterval: () => {},
  };
  Object.defineProperty(window, "sessionStorage", {
    get: () => { throw new Error("storage denied"); },
  });
  vm.runInNewContext(read("pbe-owner-session.js"), {
    window, document, fetch, URLSearchParams, encodeURIComponent,
    CustomEvent: class CustomEvent {}, Date,
    crypto: { randomUUID: () => "browser-random" },
  });
  await window.photosByEliePBEOwnerSessionReady;
  assert.doesNotThrow(() => window.photosByEliePBEOwnerSession.recordLifecycleResult({
    requestId: "hlr-storage-denied",
    authoritative: { state: "committed", revision: 8 },
    projection: { state: "pending", retryable: false },
    catalogPublication: { state: "pending", receipt: null },
    projectionRetry: { available: false, operationRevision: 8 },
  }));
  assert.equal(window.photosByEliePBEOwnerSession.state().ready, true);
  assert.equal(window.photosByEliePBEOwnerSession.state().lifecycle.projection.state, "pending");
});

test("poll timeout retains one opaque pending handle and blocks a second POST", async () => {
  const values = new Map();
  const sessionStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const session = {
    id: "timeout-session", state: "ready", fixtureId: "fixture-current",
    fixtureBreadcrumb: "Current fixture", expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  let actionPosts = 0;
  let statusReads = 0;
  const fetch = async (url) => {
    if (url.endsWith("/session")) return response({ ok: true, session, latestAction: null });
    if (url.endsWith("/gallery")) return response({
      ok: true,
      gallery: { fixtureId: session.fixtureId, items: [], summary: { filtered: 0 } },
    });
    if (url.endsWith("/action")) {
      actionPosts += 1;
      return response({ ok: true, requestId: "hlr-timeout", state: "queued" }, 202);
    }
    if (url.includes("/action/status?requestId=hlr-timeout")) {
      statusReads += 1;
      return response({ ok: true, requestId: "hlr-timeout", state: "queued" });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} }, prepend: () => {} },
    querySelector: () => null,
    createElement: () => ({
      className: "", dataset: {}, innerHTML: "", setAttribute: () => {},
      getBoundingClientRect: () => ({ height: 40 }), querySelector: () => null,
    }),
  };
  const window = {
    location: { hostname: "127.0.0.1", pathname: "/gallery.html", search: "?gallery=pbe-owner", hash: "" },
    history: { replaceState: () => {} }, dispatchEvent: () => {}, sessionStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: (callback) => { callback(); return 1; },
  };
  vm.runInNewContext(read("pbe-owner-session.js"), {
    window, document, fetch, URLSearchParams, encodeURIComponent,
    CustomEvent: class CustomEvent {}, Date,
    crypto: { randomUUID: () => "browser-random" },
  });
  await window.photosByEliePBEOwnerSessionReady;

  await assert.rejects(
    () => window.photosByEliePBEOwnerSession.action("waste-basket-x", { photo_id: "photo-one" }),
    /remains safely queued/,
  );
  assert.equal(actionPosts, 1);
  assert.equal(statusReads, 40);
  assert.deepEqual(
    JSON.parse(values.get("photosbyelie-pbe-owner-pending-action:timeout-session")),
    { requestId: "hlr-timeout", state: "queued" },
  );
  assert.equal(window.photosByEliePBEOwnerSession.state().pendingAction.requestId, "hlr-timeout");
  assert.match(window.photosByEliePBEOwnerSession.state().message, /New actions are paused/);

  await assert.rejects(
    () => window.photosByEliePBEOwnerSession.action("waste-basket-x", { photo_id: "photo-two" }),
    /previous PBE Owner action is still safely queued/,
  );
  assert.equal(actionPosts, 1);
  assert.equal(statusReads, 41);
});

test("reload recovers durable action without storage and terminal states remain truthful", async () => {
  const session = {
    id: "recovery-session", state: "ready", fixtureId: "fixture-current",
    fixtureBreadcrumb: "Current fixture", expiresAt: "2030-01-01T12:00:00Z",
  };
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const completed = {
    ok: true,
    requestId: "hlr-recovered",
    state: "completed",
    action: "waste-basket-x",
    hidden_ids: ["photo-one"],
    authoritative_committed: true,
    authoritative: { state: "committed", operationId: "operation-one", revision: 9 },
    projection: { state: "applied", retryable: false },
    catalogPublication: { state: "pending", receipt: null },
    projectionRetry: { available: false, operationRevision: 9 },
  };
  let actionPosts = 0;
  const fetch = async (url) => {
    if (url.endsWith("/session")) return response({
      ok: true,
      session,
      latestAction: { ok: true, requestId: "hlr-recovered", state: "queued" },
    });
    if (url.endsWith("/gallery")) return response({
      ok: true,
      gallery: { fixtureId: session.fixtureId, items: [], summary: { filtered: 0 } },
    });
    if (url.endsWith("/action")) {
      actionPosts += 1;
      const requestId = actionPosts === 1 ? "hlr-failed" : "hlr-expired";
      return response({ ok: true, requestId, state: "queued" }, 202);
    }
    if (url.includes("requestId=hlr-recovered")) return response(completed);
    if (url.includes("requestId=hlr-failed")) return response({
      ok: true, requestId: "hlr-failed", state: "failed", error: "connector failed safely",
    });
    if (url.includes("requestId=hlr-expired")) return response({
      ok: false,
      error: { code: "pbe_owner_session_expired", message: "Owner session expired." },
    }, 403);
    throw new Error(`unexpected request ${url}`);
  };
  const events = [];
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} }, prepend: () => {} },
    querySelector: () => null,
    createElement: () => ({
      className: "", dataset: {}, innerHTML: "", setAttribute: () => {},
      getBoundingClientRect: () => ({ height: 40 }), querySelector: () => null,
    }),
  };
  const window = {
    location: { hostname: "127.0.0.1", pathname: "/gallery.html", search: "?gallery=pbe-owner", hash: "" },
    history: { replaceState: () => {} }, dispatchEvent: (event) => events.push(event),
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: (callback) => { callback(); return 1; },
  };
  Object.defineProperty(window, "sessionStorage", {
    get: () => { throw new Error("storage denied"); },
  });
  vm.runInNewContext(read("pbe-owner-session.js"), {
    window, document, fetch, URLSearchParams, encodeURIComponent, CustomEvent, Date,
    crypto: { randomUUID: () => "browser-random" },
  });
  await window.photosByEliePBEOwnerSessionReady;
  assert.equal(window.photosByEliePBEOwnerSession.state().pendingAction.requestId, "hlr-recovered");

  const recovered = await window.photosByEliePBEOwnerSession.refreshPendingAction();
  assert.equal(recovered.state, "completed");
  assert.equal(window.photosByEliePBEOwnerSession.state().pendingAction, null);
  assert.equal(window.photosByEliePBEOwnerSession.state().lifecycle.requestId, "hlr-recovered");
  assert.equal(
    events.filter((event) => event.type === "photosbyelie:pbeowneractionresult").length,
    1,
  );

  await assert.rejects(
    () => window.photosByEliePBEOwnerSession.action("waste-basket-x", { photo_id: "photo-two" }),
    /connector failed safely/,
  );
  assert.equal(window.photosByEliePBEOwnerSession.state().ready, true);
  assert.equal(window.photosByEliePBEOwnerSession.state().pendingAction, null);
  assert.match(window.photosByEliePBEOwnerSession.state().pendingActionError, /failed safely/);

  await assert.rejects(
    () => window.photosByEliePBEOwnerSession.action("waste-basket-x", { photo_id: "photo-three" }),
    /Owner session expired/,
  );
  assert.equal(window.photosByEliePBEOwnerSession.state().ready, false);
  assert.equal(window.photosByEliePBEOwnerSession.state().phase, "unavailable");
  assert.equal(actionPosts, 2);
});

test("hosted PBE hidden history ignores stale global and prior-session state", async () => {
  const actionsSource = read("hidden-actions.js");
  assert.match(actionsSource, /const readReserveOnly = \(\) => \{\s*if \(isHostedOwnerSurface\(\)\) return \[\];/);
  assert.match(actionsSource, /const readPromotions = \(\) => \{\s*if \(isHostedOwnerSurface\(\)\) return \{\};/);
  assert.match(actionsSource, /const writePromotions = \(state\) => \{\s*const normalized = normalizePromotionState\(state\);\s*if \(isHostedOwnerSurface\(\)\) return normalized;/);
  assert.match(actionsSource, /const writeReserveOnly = \(items\) => \{\s*const normalized = normalize\(items\);\s*if \(isHostedOwnerSurface\(\)\) return normalized;/);

  const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      entries: () => [...values.entries()],
    };
  };
  const legacyBrowserOnlyPhotoId = "legacy-browser-only-photo";
  const localStorage = memoryStorage({
    "photosbyelie-hidden": JSON.stringify(["stale-global-hidden"]),
    "photosbyelie-hidden-history": JSON.stringify(["stale-global-history"]),
    "photosbyelie-reserve-only": JSON.stringify([legacyBrowserOnlyPhotoId]),
    "photosbyelie-reserve-promotions": JSON.stringify({ spain: [legacyBrowserOnlyPhotoId] }),
  });
  const sessionStorage = memoryStorage({
    "photosbyelie-hidden:pbe-owner:prior-session": JSON.stringify(["stale-prior-hidden"]),
    "photosbyelie-hidden-history:pbe-owner:prior-session": JSON.stringify(["stale-prior-history"]),
  });
  const actionCalls = [];
  let busyIndicator = null;
  const document = {
    documentElement: { classList: { toggle: () => {} } },
    body: {
      append: (element) => { busyIndicator = element; },
      toggleAttribute: () => {},
    },
    createElement: () => ({
      className: "",
      dataset: {},
      innerHTML: "",
      setAttribute: () => {},
      querySelector: () => ({ textContent: "" }),
      remove: () => { busyIndicator = null; },
    }),
    querySelector: (selector) => selector === "[data-owner-busy-indicator]" ? busyIndicator : null,
  };
  const window = {
    location: { hostname: "127.0.0.1", search: "?gallery=pbe-owner" },
    localStorage,
    sessionStorage,
    photosByEliePBEOwnerSession: {
      isReady: () => true,
      state: () => ({ session: { id: "current-session", fixtureId: "fixture-current" } }),
      action: async (...args) => {
        actionCalls.push(args);
        return { ok: true, site: { data: {}, owner: {}, reserve: {}, hidden: {} } };
      },
    },
    photosByEliePBEOwnerSessionReady: Promise.resolve(),
    photosByElieHiddenData: {
      hidden: { photos: [{ id: "stale-loaded-hidden" }] },
    },
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  vm.runInNewContext(read("hidden-actions.js"), {
    window,
    document,
    localStorage,
    sessionStorage,
    URLSearchParams,
    CustomEvent: class CustomEvent {},
    fetch: async () => {
      throw new Error("hosted bootstrap must not load the global hidden blacklist");
    },
  });

  const initial = await window.photosByElieHiddenActionsReady;
  assert.deepEqual(Array.from(initial), []);
  assert.deepEqual(Array.from(window.photosByElieHiddenActions.read()), []);
  assert.deepEqual(Array.from(window.photosByElieHiddenActions.readReserveOnly()), []);
  assert.deepEqual(
    Array.from(
      window.photosByElieHiddenActions.filterPhotos([
        { id: legacyBrowserOnlyPhotoId },
        { id: "fixture-visible-photo" },
      ]),
      (photo) => photo.id,
    ),
    [legacyBrowserOnlyPhotoId, "fixture-visible-photo"],
  );
  assert.equal(await window.photosByElieHiddenActions.undo(), null);
  await window.photosByElieHiddenActions.discard("photo-current");
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0][0], "waste-basket-x");
  assert.equal(localStorage.getItem("photosbyelie-hidden"), JSON.stringify(["stale-global-hidden"]));
  assert.equal(localStorage.getItem("photosbyelie-reserve-only"), JSON.stringify([legacyBrowserOnlyPhotoId]));
  assert.equal(
    localStorage.getItem("photosbyelie-reserve-promotions"),
    JSON.stringify({ spain: [legacyBrowserOnlyPhotoId] }),
  );
  assert.equal(sessionStorage.getItem("photosbyelie-hidden:pbe-owner:current-session"), "[]");
  assert.equal(sessionStorage.getItem("photosbyelie-hidden-history:pbe-owner:current-session"), "[]");
  assert.deepEqual(
    sessionStorage.entries().map(([key]) => key).sort(),
    [
      "photosbyelie-hidden-history:pbe-owner:current-session",
      "photosbyelie-hidden-history:pbe-owner:prior-session",
      "photosbyelie-hidden:pbe-owner:current-session",
      "photosbyelie-hidden:pbe-owner:prior-session",
    ],
  );
});

test("Undo preserves retry history on failure and batches multi-restore atomically", async () => {
  const memoryStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  const sessionStorage = memoryStorage({
    "photosbyelie-hidden:pbe-owner:undo-session": JSON.stringify(["photo-a", "photo-b"]),
    "photosbyelie-hidden-history:pbe-owner:undo-session": JSON.stringify(["photo-a", "photo-b"]),
  });
  const actionCalls = [];
  let failNext = true;
  const document = {
    documentElement: { classList: { toggle: () => {} } },
    body: { append: () => {}, toggleAttribute: () => {} },
    createElement: () => ({
      dataset: {},
      setAttribute: () => {},
      querySelector: () => ({ textContent: "" }),
      remove: () => {},
    }),
    querySelector: () => null,
  };
  const window = {
    location: { hostname: "127.0.0.1", search: "?gallery=pbe-owner" },
    localStorage: memoryStorage(),
    sessionStorage,
    photosByEliePBEOwnerSession: {
      isReady: () => true,
      state: () => ({ session: { id: "undo-session", fixtureId: "fixture-current" } }),
      action: async (...args) => {
        actionCalls.push(args);
        if (failNext) {
          failNext = false;
          throw new Error("synthetic gateway rollback");
        }
        return {
          ok: true,
          authoritative_committed: true,
          projection: { state: "pending", retryable: true },
        };
      },
    },
    photosByEliePBEOwnerSessionReady: Promise.resolve(),
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  vm.runInNewContext(read("hidden-actions.js"), {
    window,
    document,
    localStorage: window.localStorage,
    sessionStorage,
    URLSearchParams,
    CustomEvent: class CustomEvent {},
    fetch: async () => { throw new Error("unexpected fetch"); },
  });
  await window.photosByElieHiddenActionsReady;

  await assert.rejects(
    () => window.photosByElieHiddenActions.undo(),
    /synthetic gateway rollback/
  );
  assert.equal(
    sessionStorage.getItem("photosbyelie-hidden-history:pbe-owner:undo-session"),
    JSON.stringify(["photo-a", "photo-b"]),
  );

  const restored = await window.photosByElieHiddenActions.undoMany(["photo-a", "photo-b"]);
  assert.deepEqual(Array.from(restored), ["photo-a", "photo-b"]);
  assert.equal(actionCalls.length, 2);
  assert.equal(actionCalls[1][0], "waste-basket-restore");
  assert.deepEqual(Array.from(actionCalls[1][1].photo_ids), ["photo-a", "photo-b"]);
  assert.equal(
    sessionStorage.getItem("photosbyelie-hidden-history:pbe-owner:undo-session"),
    "[]",
  );
  assert.equal(
    sessionStorage.getItem("photosbyelie-hidden:pbe-owner:undo-session"),
    "[]",
  );
});

test("PBE Owner status remains usable at desktop and narrow widths", () => {
  const css = read("photos.css");
  const session = read("pbe-owner-session.js");
  assert.match(session, /aria-label="Latest lifecycle action" aria-live="polite" aria-atomic="true"/);
  assert.match(session, /<dt>Authoritative lifecycle<\/dt>/);
  assert.match(session, /<dt>Local\/static projection<\/dt>/);
  assert.match(session, /<dt>Public catalog<\/dt>/);
  assert.match(session, /data-pbe-owner-retry-error role="status" aria-live="polite"/);
  assert.match(session, /setAttribute\?\.\("aria-busy", state\.lifecycleRetrying \? "true" : "false"\)/);
  assert.match(session, /Retry repairs only the local\/static projection/);
  assert.match(session, /Backstage Uploads records a release receipt/);
  assert.match(session, /state\.phase === "checking"[\s\S]*\? "Loading PBE Owner"/);
  assert.match(session, /state\.phase === "checking" \|\| state\.pendingAction/);
  assert.match(session, /Reopen PBE Owner from Backstage to retry/);
  assert.match(css, /\.pbe-owner-session\{[\s\S]*position:sticky[\s\S]*top:var\(--fixed-header-offset,86px\)[\s\S]*z-index:75/);
  assert.match(css, /\.pbe-owner-session button:focus-visible\{outline:3px solid #fff/);
  assert.match(css, /\.pbe-owner-session-spinner\{[\s\S]*border-radius:50%/);
  assert.match(css, /\.pbe-owner-session\[data-state="checking"\] \.pbe-owner-session-spinner\{[\s\S]*animation:pbe-owner-session-spin/);
  assert.match(css, /\.pbe-owner-session\.is-command-mounted\{[\s\S]*position:static[\s\S]*background:transparent/);
  assert.doesNotMatch(css, /\.pbe-owner-session\{[\s\S]{0,500}background:#003db3/);
  assert.match(read("photo-gallery.js"), /mountPBEOwnerSessionInCommandBar[\s\S]*commandScroll\.append\(sessionRoot\)/);
  assert.match(css, /\.pbe-owner-lifecycle\{[\s\S]*grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.pbe-owner-lifecycle\[hidden\]\{display:none\}/);
  assert.match(css, /@media \(max-width:700px\)[\s\S]*\.pbe-owner-session\{[\s\S]*position:fixed;[\s\S]*top:var\(--fixed-header-offset,86px\)[\s\S]*grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(css, /@media \(max-width:700px\)[\s\S]*\.pbe-owner-lifecycle\{[\s\S]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /body\.has-pbe-owner-session:not\(\.pbe-owner-session-command-mounted\) main\{[\s\S]*margin-top:calc\(var\(--fixed-header-offset,86px\) \+ var\(--pbe-owner-banner-height,120px\)\)/);
});

test("Google browser Owner is credential provisioning only", () => {
  const owner = read("owner.html");
  const ownerScript = read("new-owner.js");
  const worker = read("worker/checkout-worker.mjs");
  assert.match(owner, /data-owner-provisioning-only(?:[\s>])/);
  assert.match(owner, /ec92009@gmail\.com/);
  assert.doesNotMatch(owner, /owner-activity\.js/);
  assert.doesNotMatch(owner, /access-console\.html/);
  assert.match(ownerScript, /session\?\.canProvisionBackstage/);
  assert.doesNotMatch(ownerScript, /pbe_auth_(?:token|code)|sessionStorage/);
  assert.match(worker, /const PBE_OWNER_PROVISIONER_EMAIL = "ec92009@gmail\.com"/);
  assert.doesNotMatch(worker, /\/owner\/auth\/refresh|pbe_auth_(?:token|code)/);
  assert.match(worker, /session\.provider !== "google-oauth"/);
  assert.match(worker, /session\.purpose !== "browser"/);
  assert.match(worker, /backstage_device_session_required/);
});
