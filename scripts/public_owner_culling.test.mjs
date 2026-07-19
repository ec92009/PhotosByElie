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
  assert.match(photos, /const metadataRows = \(\) => \[\]/);
});
