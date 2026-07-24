import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const galleryHtml = read("gallery.html");
const photoHtml = read("photo.html");
const galleryJs = read("photo-gallery.js");
const detailJs = read("photo-detail.js");
const accountJs = read("photos.js");
const sharedStore = read("shared-gallery-store.js");
const sharedCss = read("shared.css");
const landingHtml = read("index.html");
const legacyHtml = read("shared-galleries.html");

test("shared access maps authorized IDs onto canonical catalog products", () => {
  assert.match(sharedStore, /\/shared-galleries/);
  assert.match(sharedStore, /credentials: "include"/);
  assert.match(sharedStore, /catalogPhotosById/);
  assert.match(sharedStore, /catalog\.get\(id\)/);
  assert.doesNotMatch(sharedStore, /previewUrl|originalUrl|privateBaseUrl/);
  assert.match(sharedStore, /uniquePhotoCount/);
});

test("gallery and detail wait for authenticated shared data", () => {
  for (const html of [galleryHtml, photoHtml]) {
    assert.ok(html.indexOf("photos-data.js") < html.indexOf("shared-gallery-store.js"));
  }
  assert.match(galleryJs, /await window\.photosByElieSharedGalleryReady/);
  assert.match(detailJs, /await window\.photosByElieSharedGalleryReady/);
});

test("shared cards use the normal gallery, detail, likes, and basket path", () => {
  assert.match(galleryJs, /isSharedGallery/);
  assert.match(galleryJs, /detailParams\.set\("gallery", sharedGalleryKey\)/);
  assert.match(galleryJs, /data-gallery-like/);
  assert.match(detailJs, /requestedCollectionEntry/);
  assert.match(detailJs, /detailParams\.set\("gallery", "shared"\)/);
  assert.match(photoHtml, /basket-store\.js/);
  assert.match(photoHtml, /liked-store\.js/);
});

test("shared entry is visible but remains an ordinary gallery link", () => {
  assert.match(accountJs, /account-shared-entry/);
  assert.match(accountJs, /gallery\.html\?gallery=shared/);
  assert.match(accountJs, /sharedGalleryEntry\.hidden = !state\.authenticated/);
  assert.match(sharedCss, /\.account-shared-entry/);
  assert.match(sharedCss, /translateY\(-3px\)/);
  assert.match(landingHtml, /id="account-shared-entry"[^>]+gallery\.html\?gallery=shared/);
});

test("the obsolete private viewer redirects into the standard gallery", () => {
  assert.match(legacyHtml, /noindex,nofollow/);
  assert.match(legacyHtml, /location\.replace\("\.\/gallery\.html\?gallery=shared"\)/);
  assert.equal(fs.existsSync(path.join(root, "shared-galleries.js")), false);
  assert.equal(fs.existsSync(path.join(root, "shared-galleries.css")), false);
});
