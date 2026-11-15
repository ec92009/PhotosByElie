import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { catalogGenerationFor } = require("./catalog_tsv.cjs");
const { decodeCatalog } = require("../catalog-sqlite.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "photos-data.js"), "utf8");
const catalogBytes = readFileSync(path.join(root, "assets/catalog/photosbyelie.sqlite"));
const pricingBytes = readFileSync(path.join(root, "assets/catalog/product-pricing.json"));
const generation = catalogGenerationFor(root);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const arrayBufferFor = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const defaultPhotos = Array.from({ length: 620 }, (_, index) => ({
  id: `media-${String(index).padStart(4, "0")}`, title: `Canonical ${index}`, pricingTier: "original",
  media: { publicPreview: { galleryKey: `expo/media-${index}.jpg` } },
}));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Exercise the generated browser entry point, keeping network scheduling observable.
const startBootstrap = ({
  photos = defaultPhotos, catalog = catalogBytes, pricing = pricingBytes,
  catalogStatus = 200, pricingStatus = 200, lifecycleDelayMs = 0,
  onVisibility, catalogGate, pageUrl = "https://photos-by-elie.com/gallery.html?gallery=spain",
  sourceText = source, crypto = webcrypto, decoder = true, sharedPayload, bodyPhotoId,
} = {}) => {
  const location = new URL(pageUrl);
  const stats = { active: 0, maxActive: 0, decodeCalls: 0, lifecycleCalls: 0, aborted: 0 };
  const requests = [], marks = [], events = [], warnings = [];
  const page = {
    location,
    photosByElieMediaConfig: { authWorkerBaseUrl: "https://auth.photos-by-elie.com" },
    photosByElieCatalogSqlite: decoder ? {
      decodeCatalog: () => {
        stats.decodeCalls += 1;
        return { data: { spain: { title: "Spain", photos } }, owner: {}, productCatalog: {} };
      },
    } : null,
    performance: { now: () => performance.now(), mark: (name) => marks.push(name), measure: () => {} },
    dispatchEvent: (event) => events.push(event),
  };
  page.window = page;
  const document = {
    body: { dataset: { photoId: bodyPhotoId } },
    currentScript: { src: "https://photos-by-elie.com/PhotosByElie/photos-data.js?v=integration" },
    querySelector: () => null,
  };
  const context = {
    window: page, document, crypto, URL, URLSearchParams, Uint8Array, TextDecoder, AbortController,
    console: { warn: (value) => warnings.push(value) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/shared-galleries")) return { ok: true, status: 200, json: async () => sharedPayload };
      if (pathname.endsWith("photosbyelie.sqlite") || pathname.endsWith("product-pricing.json")) {
        const isCatalog = pathname.endsWith("photosbyelie.sqlite");
        if (isCatalog && catalogGate) await catalogGate;
        const status = isCatalog ? catalogStatus : pricingStatus;
        return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => arrayBufferFor(isCatalog ? catalog : pricing) };
      }
      const batch = JSON.parse(options.body).mediaIds;
      const call = stats.lifecycleCalls++;
      stats.maxActive = Math.max(stats.maxActive, ++stats.active);
      try {
        if (lifecycleDelayMs) await delay(lifecycleDelayMs, undefined, { signal: options.signal });
        const payload = onVisibility ? await onVisibility({ batch, call, options, page }) : { visibleMediaIds: batch };
        return { ok: true, status: 200, json: async () => payload };
      } catch (error) {
        if (error.name === "AbortError") stats.aborted += 1;
        throw error;
      } finally { stats.active -= 1; }
    },
  };
  runInNewContext(sourceText, context);
  document.currentScript = null; // Async asset resolution must retain the original script URL/version.
  const ready = page.photosByElieCatalogReady.then(() => null, (error) => error);
  return { page, stats, requests, marks, events, warnings, ready, context };
};
const runBootstrap = async (options) => {
  const result = startBootstrap(options);
  result.error = await result.ready;
  return result;
};
const assertDenied = (result, { decoded = false } = {}) => {
  assert.match(result.error?.message || "", /lifecycle-authorized public catalog/);
  assert.equal(result.page.photosByElieCatalogTimings.state, "failed");
  assert.deepEqual(Object.keys(result.page.photosByElieData), []);
  assert.equal(result.stats.decodeCalls, decoded ? 1 : 0);
  assert.equal(result.events.filter((event) => event.type === "photosbyelie:catalogready").length, 0);
};

test("bootstrap binds both public artifacts and never uses synchronous XHR", () => {
  assert.equal(generation.bytes, catalogBytes.byteLength);
  assert.equal(generation.sha256, hash(catalogBytes));
  assert.equal(generation.pricing.sha256, hash(pricingBytes));
  assert.ok(source.includes(JSON.stringify(generation)));
  assert.doesNotMatch(source, /XMLHttpRequest|responseText/);
  assert.match(source, /fetch\(url\.href, \{ cache: "default", credentials: "same-origin" \}\)/);
});

test("generator is idempotent without touching retained SQLite or Owner state", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "pbe217-generator-"));
  try {
    for (const file of ["photos-data.js", "catalog-sqlite.js", "scripts/write_catalog_tsv.cjs", "scripts/catalog_tsv.cjs", "assets/catalog/photosbyelie.sqlite", "assets/catalog/product-pricing.json"]) {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      cpSync(path.join(root, file), path.join(fixture, file));
    }
    for (let run = 0; run < 2; run += 1) {
      execFileSync(process.execPath, ["scripts/write_catalog_tsv.cjs", "--bootstrap-only"], { cwd: fixture });
      assert.equal(readFileSync(path.join(fixture, "photos-data.js"), "utf8"), source);
      assert.equal(hash(readFileSync(path.join(fixture, generation.path))), generation.sha256);
    }
    assert.throws(() => readFileSync(path.join(fixture, "assets/owner-actions/Owner.sqlite")), /ENOENT/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("bounded lifecycle waits for all batches, preserves deny/revoke results, and reports aggregate timings", async () => {
  const result = await runBootstrap({ lifecycleDelayMs: 8, onVisibility: ({ batch }) => ({ visibleMediaIds: batch.filter((id) => id !== "media-0003") }) });
  assert.equal(result.error, null);
  assert.equal(result.stats.lifecycleCalls, 7);
  assert.equal(result.stats.maxActive, 6);
  const timings = result.page.photosByElieCatalogTimings;
  assert.equal(timings.lifecycleBatchCount, 7);
  assert.equal(timings.lifecycleConcurrency, 6);
  assert.equal(timings.lifecycleMode, "authority");
  assert.equal(timings.checksumVerified, true);
  assert.equal(timings.pricingChecksumVerified, true);
  assert.equal(timings.state, "ready");
  assert.equal(result.page.photosByElieData.spain.photos.length, 619);
  assert.ok(result.marks.includes("pbe:catalog:ready"));
  for (const key of ["downloadMs", "checksumMs", "decodeMs", "pricingDownloadMs", "lifecycleMs", "readyMs"]) assert.ok(Number.isFinite(timings[key]) && timings[key] >= 0);
});

test("async loading stays empty and ignores stale context rows, unknown IDs and canonical collection overrides", async () => {
  const gate = deferred();
  const result = startBootstrap({ catalogGate: gate.promise });
  const stale = { id: "media-0000", title: "Stale", pricingTier: "free", media: { publicPreview: { galleryKey: "expo/wrong.jpg" } } };
  result.page.photosByElieData.context = { photos: [stale, { id: "absent-from-generation" }] };
  result.page.photosByElieData.spain = { title: "Old generation", photos: [{ id: "absent-from-generation" }] };
  await delay(0);
  assert.equal(result.stats.decodeCalls, 0);
  assert.equal(result.page.photosByElieData.context.photos.length, 0);
  assert.equal(result.page.photosByElieData.spain.photos.length, 0);
  gate.resolve();
  assert.equal(await result.ready, null);
  const canonical = result.page.photosByElieData.context.photos[0];
  assert.equal(canonical.title, "Canonical 0");
  assert.equal(canonical.pricingTier, "original");
  assert.equal(canonical.media.publicPreview.galleryKey, "expo/media-0.jpg");
  assert.equal(result.page.photosByElieData.context.photos.length, 1);
  assert.equal(result.page.photosByElieData.spain.title, "Spain");
  assert.ok(result.requests.filter(({ options }) => options.body).every(({ options }) => !options.body.includes("absent-from-generation")));
  const assetRequests = result.requests.filter(({ options }) => !options.body);
  assert.ok(assetRequests.every(({ url }) => url.startsWith("https://photos-by-elie.com/PhotosByElie/assets/catalog/") && url.endsWith("?v=integration")));
});

test("stale, truncated and missing catalog bytes fail before decode or lifecycle", async () => {
  const stale = Buffer.from(catalogBytes); stale[stale.length - 1] ^= 0xff;
  for (const options of [{ catalog: stale }, { catalog: catalogBytes.subarray(0, -20) }, { catalogStatus: 404 }, { crypto: {} }, { decoder: false }]) {
    const result = await runBootstrap(options);
    assertDenied(result);
    assert.equal(result.stats.lifecycleCalls, 0);
  }
});

test("a missing, truncated or stale pricing/policy artifact never installs catalog media", async () => {
  const stale = Buffer.from(pricingBytes); stale[stale.length - 1] ^= 0xff;
  for (const options of [{ pricing: stale }, { pricing: pricingBytes.subarray(0, -1) }, { pricingStatus: 503 }]) {
    const result = await runBootstrap(options);
    assertDenied(result, { decoded: true });
    assert.equal(result.stats.lifecycleCalls, 0);
  }
});

test("matching rolled-back generation succeeds while either mixed direction fails closed", async () => {
  const previous = Buffer.from(catalogBytes); previous.writeUInt32BE(1, 60); // SQLite user_version; fixture only.
  const previousGeneration = { ...generation, sha256: hash(previous) };
  const previousSource = source.replace(JSON.stringify(generation), JSON.stringify(previousGeneration));
  assert.equal((await runBootstrap({ catalog: previous, sourceText: previousSource })).error, null);
  assertDenied(await runBootstrap({ catalog: previous }));
  assertDenied(await runBootstrap({ sourceText: previousSource }));
});

test("malformed and cross-batch lifecycle identities fail closed", async () => {
  for (const payload of [null, {}, { visibleMediaIds: "media-0000" }, { visibleMediaIds: [null] }, { visibleMediaIds: ["unknown"] }, { visibleMediaIds: ["media-0619"] }]) {
    assertDenied(await runBootstrap({ onVisibility: () => payload }), { decoded: true });
  }
});

test("one failed request aborts outstanding work, stops queued batches and cannot publish later", async () => {
  const result = await runBootstrap({ onVisibility: async ({ batch, call, options }) => {
    if (call === 0) throw new Error("synthetic interruption");
    await delay(30, undefined, { signal: options.signal });
    return { visibleMediaIds: batch };
  } });
  assertDenied(result, { decoded: true });
  await delay(40);
  assert.equal(result.stats.lifecycleCalls, 6);
  assert.equal(result.stats.aborted, 5);
  assert.equal(result.stats.active, 0);
  assert.deepEqual(Object.keys(result.page.photosByElieData), []);
});

test("revocation returned during an in-flight batch is omitted without admitting late contexts", async () => {
  const gate = deferred(), called = deferred();
  const result = startBootstrap({ photos: defaultPhotos.slice(0, 2), onVisibility: async ({ batch }) => {
    called.resolve(); await gate.promise; return { visibleMediaIds: batch.filter((id) => id !== "media-0001") };
  } });
  await called.promise;
  result.page.photosByElieData.context = { photos: [defaultPhotos[1]] };
  gate.resolve();
  assert.equal(await result.ready, null);
  assert.deepEqual(Array.from(result.page.photosByElieData.spain.photos, (photo) => photo.id), ["media-0000"]);
  assert.equal(result.page.photosByElieData.context.photos.length, 0);
});

test("detail authorizes one known identity; unknown detail never requests authority", async () => {
  const detail = await runBootstrap({ pageUrl: "https://photos-by-elie.com/photo.html?id=media-0173" });
  assert.equal(detail.error, null);
  assert.equal(detail.stats.lifecycleCalls, 1);
  assert.deepEqual(Array.from(detail.page.photosByElieData.spain.photos, (photo) => photo.id), ["media-0173"]);
  const unknown = await runBootstrap({ pageUrl: "https://photos-by-elie.com/photo.html?id=not-in-catalog" });
  assert.equal(unknown.error, null);
  assert.equal(unknown.stats.lifecycleCalls, 0);
  assert.equal(unknown.page.photosByElieData.spain.photos.length, 0);
});

test("shared-gallery startup maps account IDs to verified visible products", async () => {
  const result = await runBootstrap({
    pageUrl: "https://photos-by-elie.com/gallery.html?gallery=shared",
    onVisibility: ({ batch }) => ({ visibleMediaIds: batch.filter((id) => id !== "media-0001") }),
    sharedPayload: { fixtures: [{ photos: [{ id: "media-0000", title: "Stale shared row" }, { id: "media-0001" }, { id: "unknown" }] }] },
  });
  result.context.sessionStorage = { getItem: () => null };
  runInNewContext(readFileSync(path.join(root, "shared-gallery-store.js"), "utf8"), result.context);
  await result.page.photosByElieSharedGalleryReady;
  assert.equal(result.page.photosByElieSharedGalleryState.status, "ready");
  assert.equal(result.page.photosByElieSharedGalleryState.missingPhotoCount, 2);
  assert.deepEqual(Array.from(result.page.photosByElieData.shared.photos, (photo) => photo.id), ["media-0000"]);
  assert.equal(result.page.photosByElieData.shared.photos[0].title, "Canonical 0");
  assert.equal(result.requests.find(({ url }) => url.endsWith("/shared-galleries")).options.credentials, "include");
});

test("generated photo routes use body identity with query precedence, bounded to generated detail paths", async () => {
  for (const [route, expected] of [
    ["/photo--media-0173.html", "media-0173"],
    ["/PhotosByElie/photo--media-0173.html", "media-0173"],
    ["/photo--media-0173.html?id=media-0002", "media-0002"],
  ]) {
    const result = await runBootstrap({ pageUrl: `https://photos-by-elie.com${route}`, bodyPhotoId: "media-0173" });
    assert.equal(result.error, null);
    assert.equal(result.stats.lifecycleCalls, 1);
    assert.deepEqual(Array.from(result.page.photosByElieData.spain.photos, (photo) => photo.id), [expected]);
  }
  const unknown = await runBootstrap({ pageUrl: "https://photos-by-elie.com/photo--unknown.html", bodyPhotoId: "unknown" });
  assert.equal(unknown.stats.lifecycleCalls, 0);
  assert.equal(unknown.page.photosByElieData.spain.photos.length, 0);
  for (const route of ["/gallery.html", "/basket.html", "/photo--media-0173.html/extra", "/not-photo--media-0173.html", "/photo--_invalid.html"]) {
    const result = await runBootstrap({ pageUrl: `https://photos-by-elie.com${route}`, bodyPhotoId: "media-0173" });
    assert.equal(result.stats.lifecycleCalls, 7);
    assert.equal(result.page.photosByElieData.spain.photos.length, 620);
  }
});

test("localhost timings explicitly exclude lifecycle and retain local contexts", async () => {
  const result = await runBootstrap({ pageUrl: "http://localhost:8000/gallery.html" });
  assert.equal(result.error, null);
  assert.equal(result.stats.lifecycleCalls, 0);
  assert.equal(result.page.photosByElieCatalogTimings.lifecycleMode, "localhost-bypass");
  result.page.photosByElieData.context = { photos: [{ id: "local", imageSrc: "/local.jpg" }] };
  assert.equal(result.page.photosByElieData.context.photos[0].imageSrc, "/local.jpg");
});

test("real decoder reports initialization, table query and projection separately", () => {
  const bundle = decodeCatalog(catalogBytes);
  for (const value of Object.values(bundle.timings)) assert.ok(Number.isFinite(value) && value >= 0);
  assert.deepEqual(Object.keys(bundle.timings), ["sqliteInitMs", "queryMs", "projectionMs"]);
  assert.ok(bundle.counts.mediaItems > 0);
});

test("background product fallback cannot overwrite the generation-bound product catalog", async () => {
  const result = await runBootstrap();
  const accountSource = readFileSync(path.join(root, "photos.js"), "utf8");
  const apply = accountSource.slice(accountSource.indexOf("const applyProductCatalog = (catalog = {}) => {"), accountSource.indexOf("const loadProductCatalog = async () => {"));
  runInNewContext(`${apply}; applyProductCatalog({products:[{id:'stale',prices:{original:0}}]});`, result.context);
  assert.equal(result.page.photosByElieResolutions.some((option) => option.id === "stale"), false);
  assert.equal(result.page.photosByElieCatalogGeneration.pricing.sha256, generation.pricing.sha256);
});
