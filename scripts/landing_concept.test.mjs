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
  assert.match(html, /Review concept · v142\.5/);
  assert.doesNotMatch(html, /_1800|masters\//);
});

test("landing concept keeps the primary header universal", () => {
  assert.match(html, /data-i18n="photos"/);
  assert.match(html, /data-i18n="signIn"/);
  assert.doesNotMatch(html, /data-i18n="realEstate"/);
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
  assert.match(js, /slideDuration = 32000/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /animatePanorama/);
  assert.match(js, /translate3d/);
  assert.match(js, /easing: "linear"/);
  assert.doesNotMatch(js, /offset: 0\.28|ease-in-out/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("landing concept ships only tracked, display-sized clean derivatives", () => {
  const assetsDir = path.join(root, "landing-concept", "assets");
  const images = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".jpg"));
  const panoramas = images.filter((name) => name.startsWith("pano-"));
  assert.equal(images.length, 9);
  assert.equal(panoramas.length, 6);
  assert.equal((html.match(/class="hero-slide(?:\s|\")/g) || []).length, 6);
  for (const image of images) {
    const bytes = fs.statSync(path.join(assetsDir, image)).size;
    assert.ok(bytes < 1_300_000, `${image} is too large for the landing sequence`);
  }
});
