import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import deployedWorker from "./deployed-worker.mjs";
import {
  isNonRevocablePublicAsset,
  NON_REVOCABLE_PUBLIC_ASSET_KEYS,
} from "./non-revocable-public-assets.mjs";

const jsonFilesBelow = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const item = path.join(directory, entry.name);
  if (entry.isDirectory()) return jsonFilesBelow(item);
  return entry.name.endsWith(".json") ? [item] : [];
});

const manifestMusicKeys = () => {
  const keys = new Set();
  const files = [
    ...jsonFilesBelow(new URL("../assets/music/", import.meta.url).pathname),
    new URL("../assets/real-estate/slideshow-music.json", import.meta.url).pathname,
  ];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([name, item]) => {
      if (["r2Key", "src"].includes(name) && typeof item === "string"
          && item.includes("assets/music/") && /\.(?:aac|m4a|mp3|ogg|wav)$/i.test(item)) {
        keys.add(item.replace(/^\.\//, ""));
      }
      visit(item);
    });
  };
  files.forEach((file) => visit(JSON.parse(readFileSync(file, "utf8"))));
  return [...keys].sort();
};

test("non-revocable public allowlist exactly matches intentional music manifests", () => {
  assert.deepEqual(NON_REVOCABLE_PUBLIC_ASSET_KEYS, manifestMusicKeys());
  assert.equal(NON_REVOCABLE_PUBLIC_ASSET_KEYS.length, 70);
});

test("unknown and path-confused music keys are not allowlisted", () => {
  assert.equal(isNonRevocablePublicAsset(NON_REVOCABLE_PUBLIC_ASSET_KEYS[0]), true);
  assert.equal(isNonRevocablePublicAsset("assets/music/unreviewed.mp3"), false);
  assert.equal(isNonRevocablePublicAsset("assets/music/../expo/photo.jpg"), false);
  assert.equal(isNonRevocablePublicAsset("assets/music/slideshow-guitar/pixabay/sample.mp3"), false);
});

const publicR2 = (objects) => ({
  head: async (key) => objects[key] || null,
  get: async (key, options = {}) => {
    const object = objects[key];
    if (!object) return null;
    const bytes = object.bytes;
    const range = options.range;
    const selected = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
    return { ...object, body: selected, size: bytes.length };
  },
});

test("deployed media route serves reviewed music and rejects an existing unknown prefix key", async () => {
  const reviewed = NON_REVOCABLE_PUBLIC_ASSET_KEYS[0];
  const unknown = "assets/music/slideshow-guitar/pixabay/sample.mp3";
  const object = { bytes: new Uint8Array([0, 1, 2, 3]), size: 4, httpMetadata: { contentType: "audio/mpeg" } };
  const env = { PUBLIC_MEDIA: publicR2({ [reviewed]: object, [unknown]: object }) };

  const allowed = await deployedWorker.fetch(new Request(`https://worker.test/media/${reviewed}`, {
    headers: { range: "bytes=1-2" },
  }), env);
  assert.equal(allowed.status, 206);
  assert.deepEqual([...new Uint8Array(await allowed.arrayBuffer())], [1, 2]);

  const rejected = await deployedWorker.fetch(new Request(`https://worker.test/media/${unknown}`), env);
  assert.equal(rejected.status, 404);
  assert.equal(rejected.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("deployed media route rechecks the deny plane after the R2 read", async () => {
  let denied = false;
  const database = {
    batch: async () => [],
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("pbe_lifecycle_control")) return { schema_version: 3, state: "ready" };
          if (sql.includes("pbe_lifecycle_media_bindings")) return { canonical_media_id: "media-one" };
          return null;
        },
        async all() {
          if (!sql.includes("pbe_lifecycle_media_identity")) return { results: [] };
          return { results: [{
            canonical_media_id: "media-one",
            revision: denied ? 1 : 0,
            denied: denied ? 1 : 0,
            lifecycle_state: denied ? "recoverable" : "visible",
            receipt_id: denied ? "receipt-one" : "seed-one",
            barrier_revision: null,
          }] };
        },
      };
    },
  };
  const object = { bytes: new Uint8Array([7, 8, 9]), size: 3, httpMetadata: { contentType: "image/jpeg" } };
  const bucket = {
    head: async () => object,
    get: async () => {
      denied = true;
      return { ...object, body: object.bytes };
    },
  };
  const response = await deployedWorker.fetch(
    new Request("https://worker.test/media/expo/raced.jpg"),
    { ACCESS_DB: database, PUBLIC_MEDIA: bucket },
  );
  assert.equal(response.status, 410);
  assert.equal(await response.text(), "Media unavailable");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

const runCatalogBootstrap = async ({ hostname, visibleMediaIds, responseOk = true }) => {
  const source = readFileSync(new URL("../photos-data.js", import.meta.url), "utf8");
  const events = [];
  const page = {
    location: { hostname, href: `https://${hostname}/gallery.html` },
    photosByElieMediaConfig: { authWorkerBaseUrl: "https://auth.photos-by-elie.com" },
    photosByElieCatalogSqlite: {
      decodeCatalog: () => ({
        data: {
          initial: {
            title: "Initial",
            photos: [
              { id: "media-visible", media: { publicPreview: { galleryKey: "expo/visible.jpg" } } },
              { id: "media-denied", media: { publicPreview: { galleryKey: "expo/denied.jpg" } } },
            ],
          },
        },
        owner: {},
        productCatalog: {},
      }),
    },
    dispatchEvent: (event) => events.push(event),
  };
  page.window = page;
  class MockRequest {
    open(_method, url) { this.url = url; }
    overrideMimeType() {}
    send() {
      this.status = 200;
      this.responseText = this.url.includes("product-pricing.json") ? "{}" : "catalog";
    }
  }
  const context = {
    window: page,
    document: { currentScript: { src: `https://${hostname}/photos-data.js?v=test` }, querySelector: () => null },
    XMLHttpRequest: MockRequest,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    URL,
    Uint8Array,
    console,
    fetch: async () => ({ ok: responseOk, status: responseOk ? 200 : 503, json: async () => ({ visibleMediaIds }) }),
  };
  const { runInNewContext } = await import("node:vm");
  runInNewContext(source, context);
  await page.photosByElieCatalogReady;
  return page;
};

test("public late context registration cannot reintroduce denied media or direct URLs", async () => {
  const page = await runCatalogBootstrap({ hostname: "photos-by-elie.com", visibleMediaIds: ["media-visible"] });
  assert.deepEqual(page.photosByElieData.initial.photos.map((photo) => photo.id), ["media-visible"]);

  page.photosByElieData.late = {
    title: "Late context",
    photos: [
      { id: "media-denied", imageSrc: "/repo/denied.jpg", media: { publicPreview: { galleryKey: "expo/denied.jpg" } } },
      {
        id: "media-visible",
        imageSrc: "/repo/visible.jpg",
        gallerySrc: "/repo/visible-thumb.jpg",
        media: { publicPreview: { galleryKey: "expo/visible.jpg", galleryUrl: "/repo/visible.jpg" } },
      },
    ],
  };
  assert.deepEqual(page.photosByElieData.late.photos.map((photo) => photo.id), ["media-visible"]);
  assert.equal(page.photosByElieData.late.photos[0].imageSrc, "");
  assert.equal(page.photosByElieData.late.photos[0].gallerySrc, "");
  assert.equal("galleryUrl" in page.photosByElieData.late.photos[0].media.publicPreview, false);
  page.photosByElieData.late.photos.push({ id: "media-denied", imageSrc: "/repo/denied-again.jpg" });
  assert.deepEqual(page.photosByElieData.late.photos.map((photo) => photo.id), ["media-visible"]);
});

test("localhost catalog keeps direct context behavior", async () => {
  const page = await runCatalogBootstrap({ hostname: "localhost", visibleMediaIds: [] });
  page.photosByElieData.late = {
    photos: [{ id: "local-only", imageSrc: "/local/photo.jpg" }],
  };
  assert.equal(page.photosByElieData.late.photos[0].imageSrc, "/local/photo.jpg");
});

test("failed public visibility authority leaves a guarded empty catalog", async () => {
  await assert.rejects(
    runCatalogBootstrap({ hostname: "photos-by-elie.com", visibleMediaIds: [], responseOk: false }),
    /lifecycle-authorized public catalog/,
  );
  const page = await runCatalogBootstrap({ hostname: "photos-by-elie.com", visibleMediaIds: [] });
  page.photosByElieData = { late: { photos: [{ id: "not-authorized", imageSrc: "/repo/photo.jpg" }] } };
  assert.deepEqual(page.photosByElieData.late.photos, []);
});

test("public media resolver ignores embedded direct URLs and requires a Worker object key", () => {
  const source = readFileSync(new URL("../photos.js", import.meta.url), "utf8");
  const match = source.match(/window\.photosByElieMediaUrl = \(photo, size = 'gallery'\) => \{[\s\S]*?\n\};/);
  assert.ok(match);
  const install = new Function("window", "isLocalhostMediaPage", "normalizePublicMediaBase", match[0]);
  const photo = { media: { publicPreview: { galleryUrl: "/repo/photo.jpg", galleryKey: "expo/photo.jpg" } } };

  const publicWindow = {
    photosByElieMediaKey: (item) => item.media.publicPreview.galleryKey,
    photosByEliePublicMediaBase: "https://download.photos-by-elie.com/media",
  };
  install(publicWindow, false, (value) => value);
  assert.equal(publicWindow.photosByElieMediaUrl(photo), "https://download.photos-by-elie.com/media/expo/photo.jpg");
  assert.equal(publicWindow.photosByElieMediaUrl({ media: { publicPreview: { galleryUrl: "/repo/photo.jpg" } } }), "");

  const localWindow = { photosByElieMediaKey: () => "", photosByEliePublicMediaBase: "" };
  install(localWindow, true, (value) => value);
  assert.equal(localWindow.photosByElieMediaUrl(photo), "/repo/photo.jpg");
});
