import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("gallery and detail bootstrap the Backstage session before Owner actions", () => {
  for (const page of ["gallery.html", "photo.html"]) {
    const html = read(page);
    const sessionIndex = html.indexOf("pbe-owner-session.js");
    const actionsIndex = html.indexOf("hidden-actions.js");
    assert.ok(sessionIndex >= 0, `${page} loads the PBE Owner session client`);
    assert.ok(actionsIndex > sessionIndex, `${page} loads Owner actions after the session client`);
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

test("hosted PBE X is bound to the frozen fixture and guarded Waste Basket actions", () => {
  const session = read("pbe-owner-session.js");
  const actions = read("hidden-actions.js");
  const gallery = read("photo-gallery.js");
  const localHost = read("scripts/local_server.py");
  assert.match(session, /fixtureId: state\.session\.fixtureId/);
  assert.match(session, /request\("\/gallery"\)/);
  assert.match(session, /window\.photosByElieData\[galleryKey\]/);
  assert.match(actions, /isHostedOwnerSurface\(\).*pbeOwnerSession\?\.isReady/s);
  assert.match(actions, /Boolean\(localEnabled && isHostedOwnerSurface\(\) && pbeOwnerSession\?\.isReady\?\.\(\)\)/);
  assert.match(actions, /const wasteBasketContext = \{ source: "owner-gallery"/);
  assert.match(actions, /pbeOwnerSession\.action\(action, requestPayload\)/);
  assert.match(gallery, /ensureGalleryKeyboardHint\(\);\s*renderGallery\(\{ scrollSelection: false \}\);/);
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
  assert.match(gallery, /if \(isPBEOwnerGallery\) detailParams\.set\("gallery", pbeOwnerGalleryKey\)/);
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
        return { ok: true };
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
