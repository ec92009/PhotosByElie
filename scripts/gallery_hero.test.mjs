import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "gallery.html"), "utf8");
const css = fs.readFileSync(path.join(root, "photos.css"), "utf8");
const js = fs.readFileSync(path.join(root, "gallery-hero.js"), "utf8");
const countries = ["france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"];

test("country galleries expose a layered panorama hero", () => {
  assert.match(html, /data-gallery-hero/);
  assert.match(html, /data-gallery-hero-image/);
  assert.match(html, /gallery-hero-shade/);
  assert.match(html, /gallery-hero\.js/);
});

test("every live country receives a shared hero asset", () => {
  countries.forEach((country) => {
    assert.match(js, new RegExp(`${country}: \\{ src: "\\./assets/gallery-heroes/${country}\\.jpg"`));
    assert.ok(fs.existsSync(path.join(root, "assets", "gallery-heroes", `${country}.jpg`)));
  });
});

test("gallery hero motion is slow, linear, reversible, and reduced-motion safe", () => {
  assert.match(js, /Math\.min\(52000, Math\.max\(30000/);
  assert.match(js, /easing: "linear"/);
  assert.match(js, /direction: "alternate"/);
  assert.match(js, /reducedMotion\.matches/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("utility galleries retain the neutral hero", () => {
  assert.match(js, /if \(!entry\) return/);
});
