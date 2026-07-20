import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "landing-concept", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "landing-concept", "landing.css"), "utf8");
const js = fs.readFileSync(path.join(root, "landing-concept", "landing.js"), "utf8");

test("landing concept remains isolated and search-engine private", () => {
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.match(html, /Review concept · v142\.3/);
  assert.doesNotMatch(html, /_1800|masters\//);
});

test("landing concept exposes complete review controls", () => {
  assert.match(html, /id="settings-dialog"/);
  assert.match(html, /id="language-select"/);
  assert.match(html, /name="theme"/);
  assert.match(html, /name="surface"/);
  assert.match(html, /id="transparency-range"/);
  assert.match(html, /class="version-pill"/);
});

test("landing concept has keyboard, autoplay, and reduced-motion behavior", () => {
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /8500/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("landing concept ships only tracked, display-sized clean derivatives", () => {
  const assetsDir = path.join(root, "landing-concept", "assets");
  const images = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".jpg"));
  assert.equal(images.length, 6);
  for (const image of images) {
    const bytes = fs.statSync(path.join(assetsDir, image)).size;
    assert.ok(bytes < 1_300_000, `${image} is too large for the landing sequence`);
  }
});
