import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "landing-concept", "index.html"), "utf8");
const productionHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const productionVersion = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const css = fs.readFileSync(path.join(root, "landing-concept", "landing.css"), "utf8");
const js = fs.readFileSync(path.join(root, "landing-concept", "landing.js"), "utf8");

test("landing concept remains isolated and search-engine private", () => {
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.match(html, /Review concept · v143\.4/);
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

test("landing concept exposes all live country collections", () => {
  assert.equal((html.match(/id="country-links"[\s\S]*?<\/nav>/) || [""])[0].match(/gallery=/g)?.length, 7);
  assert.equal((html.match(/class="story-card(?:\s|\")/g) || []).length, 7);
  for (const slug of ["france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"]) {
    assert.match(html, new RegExp(`gallery=${slug}`));
    assert.match(js, new RegExp(`${slug}:`));
  }
  assert.match(js, /aria-expanded/);
  assert.match(js, /Escape/);
  assert.match(css, /\.explore-menu\.is-open/);
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

test("the featured rotation remains entirely outdoors", () => {
  const slides = (html.match(/<figure class="hero-slide[\s\S]*?<\/figure>/g) || []).join("\n");
  assert.doesNotMatch(slides, /pano-madrid|pano-orsay|pano-malmaison/);
  assert.match(slides, /gallery-heroes\/france\.jpg/);
  assert.match(slides, /gallery-heroes\/usa\.jpg/);
  assert.match(slides, /gallery-heroes\/mexico\.jpg/);
  assert.match(slides, /gallery-heroes\/portugal\.jpg/);
});

test("the featured rotation gives Cascais a distinct Atlantic title", () => {
  const titles = [...productionHtml.matchAll(/<figure class="hero-slide[^>]*data-title="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.match(productionHtml, /data-title="Cascais meets the Atlantic"/);
  assert.equal(titles.filter((title) => title.startsWith("The bay")).length, 1);
});

test("landing concept ships only tracked, display-sized clean derivatives", () => {
  const assetsDir = path.join(root, "landing-concept", "assets");
  const sharedDir = path.join(root, "assets", "gallery-heroes");
  const images = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".jpg"));
  const sharedImages = fs.readdirSync(sharedDir).filter((name) => name.endsWith(".jpg"));
  assert.equal(images.length + sharedImages.length, 13);
  assert.equal(sharedImages.length, 7);
  assert.equal((html.match(/class="hero-slide(?:\s|\")/g) || []).length, 6);
  for (const image of images) {
    const bytes = fs.statSync(path.join(assetsDir, image)).size;
    assert.ok(bytes < 1_300_000, `${image} is too large for the landing sequence`);
  }
  for (const image of sharedImages) {
    const bytes = fs.statSync(path.join(sharedDir, image)).size;
    assert.ok(bytes < 1_300_000, `${image} is too large for the shared gallery hero`);
  }
});

test("the production root uses the approved landing experience with discovery metadata", () => {
  assert.doesNotMatch(productionHtml, /noindex|Review concept/);
  assert.match(productionHtml, /<link rel="canonical" href="https:\/\/photos-by-elie\.com\/">/);
  assert.match(productionHtml, /property="og:image"/);
  assert.match(productionHtml, /application\/ld\+json/);
  assert.ok(productionHtml.includes(`landing-concept/landing.css?v=${productionVersion}`));
  assert.ok(productionHtml.includes(`landing-concept/landing.js?v=${productionVersion}`));
  assert.ok(productionHtml.includes(`analytics.js?v=${productionVersion}`));
});

test("the production landing keeps real account entry and ACS routing plumbing", () => {
  assert.match(productionHtml, /id="account-signup"/);
  assert.match(productionHtml, /id="account-signin"/);
  assert.match(productionHtml, /id="account-face"[^>]*hidden/);
  assert.match(productionHtml, /id="account-google-signin"/);
  assert.match(productionHtml, /id="account-username"/);
  assert.match(productionHtml, /id="account-password"/);
  assert.match(productionHtml, /id="account-password-reveal"/);
  assert.match(js, /\/auth\/session/);
  assert.match(js, /\/auth\/google\/login/);
  assert.match(js, /\/real-estate\/login/);
  assert.match(js, /realEstateClients/);
  assert.match(js, /destination\.searchParams\.set\("access", "google"\)/);
  assert.match(js, /\/account\/profile/);
  assert.match(js, /photosbyelie:landingpreferenceschange/);
});

test("the production landing presents the six substantial country collections", () => {
  const countryNav = (productionHtml.match(/id="country-links"[\s\S]*?<\/nav>/) || [""])[0];
  assert.equal(countryNav.match(/gallery=/g)?.length, 6);
  assert.equal((productionHtml.match(/class="story-card(?:\s|\")/g) || []).length, 6);
  for (const slug of ["france", "usa", "spain", "mexico", "italy", "portugal"]) {
    assert.match(countryNav, new RegExp(`gallery=${slug}`));
  }
  assert.doesNotMatch(countryNav, /gallery=slovakia|gallery=panoramas/);
});

test("each production country card fans into catalog-backed destinations", () => {
  assert.equal((productionHtml.match(/class="story-card-fan"/g) || []).length, 6);
  for (const query of ["Versailles", "Giverny", "Louvre", "Madrid", "Andalusia", "Pisa", "San%20Diego", "Puerto%20Vallarta", "Lisbon", "Cascais"]) {
    assert.match(productionHtml, new RegExp(`(?:q=${query}|q=${query.replace(/%20/g, " ")})`));
  }
  assert.equal((productionHtml.match(/data-i18n="others"/g) || []).length, 6);
  assert.match(css, /\.story-card:hover \.story-card-fan/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.story-card \.story-card-fan/);
});

test("the production footer and settings keep required public controls", () => {
  for (const page of ["support.html", "privacy.html", "terms.html", "data-deletion.html"]) {
    assert.match(productionHtml, new RegExp(page.replace(".", "\\.")));
  }
  assert.match(productionHtml, /id="language-select"/);
  assert.match(productionHtml, /name="theme"/);
  assert.match(productionHtml, /id="transparency-range"/);
  assert.match(productionHtml, /id="translucency-range"/);
  assert.match(productionHtml, /class="version-pill site-version-badge"/);
  assert.match(css, /--glass-blur/);
});
