import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const galleryJs = read("photo-gallery.js");
const photosCss = read("photos.css");

test("gallery density uses a two-button stepper instead of a range slider", () => {
  assert.match(galleryJs, /data-gallery-density-step="-1"/);
  assert.match(galleryJs, /data-gallery-density-step="1"/);
  assert.match(galleryJs, /stepGalleryDensity\(Number\(button\.dataset\.galleryDensityStep/);
  assert.doesNotMatch(galleryJs, /data-gallery-density\/>/);
  assert.match(photosCss, /\.gallery-density-stepper button \+ button/);
});

test("fit and fill remain standard actions in one segmented pill", () => {
  assert.match(galleryJs, /gallery-fit-control gallery-fit-split/);
  assert.match(galleryJs, /data-gallery-fit-mode="fit"/);
  assert.match(galleryJs, /data-gallery-fit-mode="fill"/);
  assert.match(photosCss, /\.gallery-fit-control\.gallery-fit-split button \+ button/);
  assert.match(photosCss, /\.gallery-fit-control\.gallery-fit-split button\[aria-pressed="true"\]/);
});

test("density buttons expose localized accessible names and boundary states", () => {
  assert.match(galleryJs, /a11y\.gallery_density_decrease/);
  assert.match(galleryJs, /a11y\.gallery_density_increase/);
  assert.match(galleryJs, /columns <= 1/);
  assert.match(galleryJs, /columns >= maxDensityColumns\(\)/);
});
