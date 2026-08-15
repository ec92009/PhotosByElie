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
const landingJs = read("landing-concept/landing.js");
const sharedStore = read("shared-gallery-store.js");
const ownerSession = read("pbe-owner-session.js");
const sharedCss = read("shared.css");
const landingHtml = read("index.html");
const legacyHtml = read("shared-galleries.html");
const sharedVisibilityModule = await import("../shared-gallery-visibility.mjs");

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
  assert.match(galleryJs, /await window\.photosByEliePageReady\(\)/);
  assert.match(detailJs, /await window\.photosByEliePageReady\(\)/);
  assert.match(
    ownerSession,
    /if \(ownerSurface\) \{[\s\S]*return \{ mode: "pbe-owner"[\s\S]*await window\.photosByElieCatalogReady;[\s\S]*await window\.photosByElieSharedGalleryReady;/,
  );
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

test("shared entry stays hidden until the account has shared photos", () => {
  assert.match(accountJs, /account-shared-entry/);
  assert.match(accountJs, /gallery\.html\?gallery=shared/);
  assert.match(accountJs, /sharedGalleryVisible = state\.authenticated/);
  assert.match(accountJs, /state\.sharedPhotoCount > 0/);
  assert.match(accountJs, /refreshSharedGalleryVisibility/);
  assert.match(sharedCss, /\.account-shared-entry/);
  assert.match(sharedCss, /\.site-account-mini-action\.is-shared-gallery\[hidden\]/);
  assert.match(sharedCss, /translateY\(-3px\)/);
  assert.match(landingHtml, /id="account-shared-entry"[^>]+gallery\.html\?gallery=shared/);
  assert.match(landingHtml, /class="account-action account-shared-link"[^>]+hidden/);
  assert.match(landingJs, /sharedPhotoCount/);
  assert.match(landingJs, /\/shared-galleries/);
});

test("shared entry visibility fails closed for loading, zero-share, failure, and sign-out states", () => {
  const loading = { authenticated: true, ...sharedVisibilityModule.sharedGalleryLoadingState() };
  const zeroShares = { authenticated: true, ...sharedVisibilityModule.sharedGalleryResolvedState({ fixtures: [] }) };
  const failed = { authenticated: true, ...sharedVisibilityModule.sharedGalleryClearedState() };
  const signedOut = { authenticated: false, ...sharedVisibilityModule.sharedGalleryResolvedState({ uniquePhotoCount: 2 }) };
  assert.equal(sharedVisibilityModule.sharedGalleryIsVisible(loading), false);
  assert.equal(sharedVisibilityModule.sharedGalleryIsVisible(zeroShares), false);
  assert.equal(sharedVisibilityModule.sharedGalleryIsVisible(failed), false);
  assert.equal(sharedVisibilityModule.sharedGalleryIsVisible(signedOut), false);
});

test("shared entry appears only after unique shared photos are confirmed", () => {
  const payload = {
    uniquePhotoCount: 1,
    fixtures: [
      { photos: [{ id: "photo-1" }, { id: "photo-1" }] },
      { photos: [{ id: "photo-2" }] },
    ],
  };
  const resolved = { authenticated: true, ...sharedVisibilityModule.sharedGalleryResolvedState(payload) };
  assert.equal(resolved.sharedPhotoCount, 2);
  assert.equal(sharedVisibilityModule.sharedGalleryIsVisible(resolved), true);
});

test("the obsolete private viewer redirects into the standard gallery", () => {
  assert.match(legacyHtml, /noindex,nofollow/);
  assert.match(legacyHtml, /location\.replace\("\.\/gallery\.html\?gallery=shared"\)/);
  assert.equal(fs.existsSync(path.join(root, "shared-galleries.js")), false);
  assert.equal(fs.existsSync(path.join(root, "shared-galleries.css")), false);
});
