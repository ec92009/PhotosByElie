import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public Owner culling waits for cloud auth and uses the Max connector queue", () => {
  const hidden = read("hidden-actions.js");
  const gallery = read("photo-gallery.js");
  const detail = read("photo-detail.js");
  assert.match(hidden, /action:\s*"photo-moderation"/);
  assert.match(hidden, /requestedConnector:\s*"max"/);
  assert.match(hidden, /const markMany = async/);
  assert.match(hidden, /const undoMany = async/);
  assert.match(hidden, /"update-photo-metadata", "save-keyword-blacklist"/);
  assert.match(hidden, /const saveKeywordBlacklist = async/);
  assert.match(gallery, /ownerEditable: ownerCullingEnabled/);
  assert.match(gallery, /await window\.photosByElieHiddenActionsReady/);
  assert.match(detail, /await window\.photosByElieHiddenActionsReady/);
  assert.match(gallery, /data-owner-cull-select-visible/);
  assert.match(gallery, /data-owner-cull-hide/);
  assert.match(gallery, /data-owner-cull-undo/);
});

test("photo detail and preview omit debugging-only metadata", () => {
  const detail = read("photo-detail.js");
  const html = read("photo.html");
  const photos = read("photos.js");
  assert.match(detail, /"metadata title", "origin"/);
  assert.doesNotMatch(html, /data-photo-info-toggle/);
  assert.match(
    photos,
    /"Keywords",\s*"Captured",\s*"Camera",\s*"Lens",\s*"Exposure",\s*"Focal length",\s*"Original file",\s*"Original size",\s*"Location"/,
  );
  assert.doesNotMatch(photos, /\["Media ID"/);
  assert.doesNotMatch(photos, /\["Path", contextUrl\]/);
  assert.doesNotMatch(photos, /\["Source", isVideo/);
});

test("panorama full-height mode stays escapable and yields autoplay to the visitor", () => {
  const detail = read("photo-detail.js");
  const photos = read("photos.js");
  const styles = read("photos.css");
  assert.match(photos, /const startAutoPan = \(\{ delayMs = 1100, pixelsPerSecond = 22, fromCenter = true \} = \{\}\)/);
  assert.match(photos, /autoPanDirection = -1/);
  assert.match(photos, /autoPanDirection = 1/);
  assert.match(photos, /const startMomentum = \(\) =>/);
  assert.match(photos, /momentumVelocity \*= Math\.pow\(0\.94/);
  assert.match(photos, /prefers-reduced-motion: reduce/);
  assert.match(photos, /scroller\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(photos, /scroller\.addEventListener\("wheel", onWheel/);
  assert.match(photos, /panoPan\?\.stopAutoPan\?\.\(\{ user: true \}\)/);
  assert.match(photos, /data-finder-preview-close/);
  assert.match(photos, /preview\.exit_full_height/);
  assert.match(detail, /panoPan\?\.startAutoPan\?\.\(\{ delayMs: 1100, pixelsPerSecond: 22, fromCenter: true \}\)/);
  assert.match(detail, /document\.body\.append\(panoToggle\)/);
  assert.match(styles, /\.pano-scroll-toggle\.is-full-height-exit\{[\s\S]*position:fixed/);
  assert.match(styles, /\.finder-preview-close\{/);
});
