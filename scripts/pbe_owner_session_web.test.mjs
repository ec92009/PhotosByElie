import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const runSessionClient = ({
  search,
  fetch,
  catalogReady = Promise.resolve(),
  sharedReady = Promise.resolve(),
  data = {},
}) => {
  let banner = null;
  const document = {
    documentElement: { style: { setProperty: () => {} } },
    body: { classList: { add: () => {} }, prepend: () => {} },
    querySelector: (selector) => selector === "[data-pbe-owner-session]" ? banner : null,
    createElement: () => {
      banner = {
        className: "", dataset: {}, innerHTML: "", setAttribute: () => {},
        getBoundingClientRect: () => ({ height: 40 }),
        querySelector: () => null,
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
  return { window, document };
};

test("customer gallery and detail do not bootstrap browser Owner capabilities", () => {
  for (const page of ["gallery.html", "photo.html"]) {
    const html = read(page);
    assert.doesNotMatch(html, /pbe-owner-session\.js/, `${page} omits the PBE Owner session client`);
    assert.doesNotMatch(html, /hidden-actions\.js/, `${page} omits Owner actions`);
    assert.doesNotMatch(html, /owner-tools\.js/, `${page} omits Owner tools`);
  }
  assert.match(read("photo-gallery.js"), /await window\.photosByEliePageReady\(\)/);
  assert.match(read("photo-gallery.js"), /requestedGalleryKey === pbeOwnerGalleryKey[\s\S]*searchParams\.set\("gallery", "selection"\)/);
  assert.match(read("gallery.html"), /photo-gallery\.js\?v=239\.0/);
  assert.match(read("photo-detail.js"), /await window\.photosByEliePageReady\(\)/);
  assert.match(read("photo-detail.js"), /isRequestedPBEOwnerCollection[\s\S]*params\.delete\("gallery"\)/);
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

test("detail controller redirects retired Owner URLs and renders public readiness failures", async (t) => {
  await t.test("retired Owner URL", async () => {
    let replaced = "";
    const window = {
      location: {
        href: "https://photos-by-elie.com/photo.html?gallery=%20PBE-OWNER%20&id=france-one",
        search: "?gallery=%20PBE-OWNER%20&id=france-one",
        replace: (value) => { replaced = value; },
      },
    };
    await vm.runInNewContext(read("photo-detail.js"), { window, URL, URLSearchParams });
    assert.equal(replaced, "https://photos-by-elie.com/photo.html?id=france-one");
  });

  await t.test("public readiness failure", async () => {
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
        location: {
          href: "https://photos-by-elie.com/photo.html?gallery=france&id=france-one",
          search: "?gallery=france&id=france-one",
          replace: (value) => { replaced = value; },
        },
        photosByEliePageReady: async () => { throw new Error("Fixture authorization unavailable"); },
        photosByElieData: { france: { title: "France", photos: [{ id: "france-one" }] } },
      };

      await vm.runInNewContext(read("photo-detail.js"), {
        window,
        document,
        URL,
        URLSearchParams,
      });

      assert.equal(replaced, "");
      assert.equal(elements.preview.hidden, true);
      assert.equal(elements.purchase.hidden, true);
      assert.equal(elements.meta.textContent, "Photo unavailable");
      assert.equal(elements.title.textContent, "Fixture authorization unavailable");
  });
});

test("browser session handoff exchanges an opaque ticket for an HttpOnly session", () => {
  const source = read("pbe-owner-session.js");
  const host = read("scripts/local_server.py");
  assert.match(source, /const fragmentKey = "pbe_owner_ticket"/);
  assert.match(source, /parameters\.delete\(fragmentKey\)/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /request\("\/browser\/bootstrap"/);
  assert.doesNotMatch(source, /Authorization/);
  assert.doesNotMatch(source, /sessionStorage/);
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
  assert.match(css, /\.pbe-owner-session\{[\s\S]*position:sticky[\s\S]*top:var\(--fixed-header-offset,86px\)[\s\S]*z-index:75/);
  assert.match(css, /\.pbe-owner-session button:focus-visible\{outline:3px solid #fff/);
  assert.match(css, /@media \(max-width:700px\)[\s\S]*\.pbe-owner-session\{[\s\S]*position:fixed;[\s\S]*top:var\(--fixed-header-offset,86px\)[\s\S]*grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(css, /body\.has-pbe-owner-session main\{[\s\S]*margin-top:calc\(var\(--fixed-header-offset,86px\) \+ var\(--pbe-owner-banner-height,120px\)\)/);
});

test("Google browser Owner is credential provisioning only", () => {
  const owner = read("owner.html");
  const provisioningScript = read("backstage-provisioning.js");
  const worker = read("worker/checkout-worker.mjs");
  assert.match(owner, /data-owner-provisioning-only(?:[\s>])/);
  assert.match(owner, /backstage-provisioning\.js\?v=239\.0/);
  assert.doesNotMatch(owner, /new-owner\.js|pbe-owner-session\.js|hidden-actions\.js|owner-tools\.js/);
  assert.doesNotMatch(owner, /owner-activity\.js/);
  assert.doesNotMatch(owner, /access-console\.html/);
  assert.match(provisioningScript, /currentSession\?\.canProvisionBackstage === true/);
  assert.match(provisioningScript, /ownerPath\("\/owner\/session"\)/);
  assert.doesNotMatch(provisioningScript, /pbe_auth_(?:token|code)|sessionStorage/);
  assert.match(worker, /const PBE_OWNER_PROVISIONER_EMAIL = "ec92009@gmail\.com"/);
  assert.doesNotMatch(worker, /\/owner\/auth\/refresh|pbe_auth_(?:token|code)/);
  assert.match(worker, /session\.provider !== "google-oauth"/);
  assert.match(worker, /session\.purpose !== "browser"/);
  assert.match(worker, /backstage_device_session_required/);
});
