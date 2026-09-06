import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "landing-concept", "index.html"), "utf8");
const productionHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const productionVersion = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const css = fs.readFileSync(path.join(root, "landing-concept", "landing.css"), "utf8");
const js = fs.readFileSync(path.join(root, "landing-concept", "landing.js"), "utf8");

const translationMatch = js.match(/const translations = (\{[\s\S]*?\n  \});\n\n  const activeLanguage/);
assert.ok(translationMatch, "landing translations object is readable");
const translations = vm.runInNewContext(`(${translationMatch[1]})`);

const landingTranslationKeys = (...documents) => {
  const keys = new Set();
  for (const document of documents) {
    for (const attribute of ["data-i18n", "data-i18n-aria-label", "data-i18n-alt", "data-title-i18n", "data-location-i18n"]) {
      for (const match of document.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))) keys.add(match[1]);
    }
  }
  return keys;
};

test("landing concept remains isolated and search-engine private", () => {
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.match(html, /data-i18n="reviewConcept">Review concept<\/span> · v143\.4/);
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

test("public language pickers preserve French and Spanish accents", () => {
  for (const document of [html, productionHtml]) {
    assert.match(document, /<option value="fr">Français<\/option>/);
    assert.match(document, /<option value="es">Español<\/option>/);
  }
});

test("landing French and Spanish copy covers all visible and accessible strings", () => {
  const requiredKeys = landingTranslationKeys(html, productionHtml);
  requiredKeys.add("resumeSlideshow");
  for (const language of ["en", "fr", "es"]) {
    const missing = [...requiredKeys].filter((key) => !translations[language][key]);
    assert.deepEqual(missing, [], `${language} is missing landing translations`);
  }
  assert.deepEqual(Object.keys(translations.fr).sort(), Object.keys(translations.en).sort());
  assert.deepEqual(Object.keys(translations.es).sort(), Object.keys(translations.en).sort());
  assert.match(translations.fr.introBody, /habités/);
  assert.match(translations.es.usageIntro, /país/);
  assert.match(js, /\[data-i18n-aria-label\]/);
  assert.match(js, /\[data-i18n-alt\]/);
  assert.equal((productionHtml.match(/data-title-i18n=/g) || []).length, 6);
  assert.equal((productionHtml.match(/data-location-i18n=/g) || []).length, 6);
  assert.equal((html.match(/data-title-i18n=/g) || []).length, 6);
  assert.equal((html.match(/data-location-i18n=/g) || []).length, 6);
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
  assert.match(productionHtml, /id="account-face"[\s\S]*?class="header-icon"/);
  assert.match(js, /face\.replaceChildren\(initial\)/);
  assert.match(css, /\.account-initial/);
  assert.match(productionHtml, /id="settings-open"[\s\S]*?class="header-icon"/);
  assert.doesNotMatch(productionHtml, /<span aria-hidden="true">[●⚙]<\/span>/);
  assert.match(css, /\.header-icon/);
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

test("the production account primary actions keep WCAG AA contrast across themes and states", () => {
  assert.match(productionHtml, /<button class="account-pill account-pill-primary" id="account-signin"/);
  assert.match(productionHtml, /<button class="account-action account-action-primary" id="account-google-signin"/);

  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((selector) => selector.trim()),
    declarations: Object.fromEntries(
      [...match[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)]
        .map((declaration) => [declaration[1], declaration[2].trim()]),
    ),
  }));
  const ruleFor = (selector) => {
    const rule = rules.find((candidate) => candidate.selectors.includes(selector));
    assert.ok(rule, `${selector} must have an explicit CSS rule`);
    return rule;
  };

  const expectedThemes = {
    night: {
      "--account-primary-bg": "#f7f3eb",
      "--account-primary-fg": "#11110f",
      "--account-primary-hover-bg": "#0000b3",
      "--account-primary-hover-fg": "#fffdf6",
      "--account-primary-active-bg": "#000099",
      "--account-primary-active-fg": "#fffdf6",
      "--account-primary-disabled-bg": "#4a4a43",
      "--account-primary-disabled-fg": "#f7f3eb",
      "--account-primary-focus": "#0000b3",
      "--account-primary-focus-guard": "#fffdf6",
    },
    day: {
      "--account-primary-bg": "#1b1b18",
      "--account-primary-fg": "#fffdf6",
      "--account-primary-hover-bg": "#0000b3",
      "--account-primary-hover-fg": "#fffdf6",
      "--account-primary-active-bg": "#000099",
      "--account-primary-active-fg": "#fffdf6",
      "--account-primary-disabled-bg": "#b7b0a2",
      "--account-primary-disabled-fg": "#34312c",
      "--account-primary-focus": "#0000b3",
      "--account-primary-focus-guard": "#fffdf6",
    },
  };
  const rootVariables = ruleFor(":root").declarations;
  const themeVariables = {
    night: rootVariables,
    day: { ...rootVariables, ...ruleFor('[data-theme="day"]').declarations },
  };
  for (const [theme, expected] of Object.entries(expectedThemes)) {
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(themeVariables[theme][name], value, `${theme} ${name} must keep the audited palette`);
    }
  }

  const states = {
    default: { suffix: "", background: "--account-primary-bg", foreground: "--account-primary-fg" },
    hover: { suffix: ":hover", background: "--account-primary-hover-bg", foreground: "--account-primary-hover-fg" },
    "focus-visible": { suffix: ":focus-visible", background: "--account-primary-hover-bg", foreground: "--account-primary-hover-fg" },
    active: { suffix: ":active", background: "--account-primary-active-bg", foreground: "--account-primary-active-fg" },
    disabled: { suffix: ":disabled", background: "--account-primary-disabled-bg", foreground: "--account-primary-disabled-fg" },
  };
  const surfaces = ["account-pill-primary", "account-action-primary"];
  for (const surface of surfaces) {
    for (const [state, values] of Object.entries(states)) {
      const selector = `.${surface}${values.suffix}`;
      const rule = ruleFor(selector);
      assert.equal(rule.declarations.background, `var(${values.background})`, `${selector} background`);
      assert.equal(rule.declarations["border-color"], `var(${values.background})`, `${selector} border`);
      assert.equal(rule.declarations.color, `var(${values.foreground})`, `${selector} text`);
      if (state === "focus-visible") {
        assert.equal(rule.declarations.outline, "3px solid var(--account-primary-focus)");
        assert.equal(rule.declarations["outline-offset"], "3px");
        assert.equal(rule.declarations["box-shadow"], "0 0 0 3px var(--account-primary-focus-guard)");
      }
      if (state === "disabled") {
        assert.ok(rule.selectors.includes(`.${surface}:disabled:hover`));
        assert.ok(rule.selectors.includes(`.${surface}:disabled:active`));
        assert.equal(rule.declarations.cursor, "not-allowed");
        assert.equal(rule.declarations.opacity, "1");
      }
    }
  }

  const luminance = (hex) => {
    assert.match(hex, /^#[\da-f]{6}$/i);
    const channels = hex.slice(1).match(/../g)
      .map((channel) => parseInt(channel, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrastRatio = (foreground, background) => {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  };
  for (const [theme, variables] of Object.entries(themeVariables)) {
    for (const surface of surfaces) {
      for (const [state, values] of Object.entries(states)) {
        const ratio = contrastRatio(variables[values.foreground], variables[values.background]);
        assert.ok(ratio >= 4.5, `${theme} ${surface} ${state} text contrast is ${ratio.toFixed(2)}:1`);
      }
    }
    const focusContrast = contrastRatio(
      variables["--account-primary-focus"],
      variables["--account-primary-focus-guard"],
    );
    assert.ok(focusContrast >= 3, `${theme} two-tone focus indicator contrast is ${focusContrast.toFixed(2)}:1`);
  }

  assert.match(css, /\.primary-nav \{[\s\S]*?font-size: 0\.87rem/);
  const narrowCss = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(narrowCss, /\.account-pill \{[\s\S]*?font-size: 0\.78rem/);
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

test("the production landing restores the latest social shelf in the open grid slot", () => {
  assert.match(productionHtml, /class="social-shelf"/);
  assert.equal((productionHtml.match(/class="social-shelf-item"/g) || []).length, 3);
  const socialShelf = (productionHtml.match(/<aside class="social-shelf"[\s\S]*?<\/aside>/) || [""])[0];
  const socialRoutes = [...socialShelf.matchAll(/campaign\.html\?c=([^&"]+)/g)].map(([, campaign]) => campaign);
  const expectedSocialRoutes = [
    "facebook-del-mar-dog-beach-sunset-2026-07-14",
    "instagram-fuengirola-moon-mediterranean-2026-07-14",
    "pinterest-san-diego-zoo-wildlife-portraits-2026-07-14",
  ];
  assert.deepEqual(socialRoutes, expectedSocialRoutes);
  assert.match(productionHtml, /data-i18n="latestSocial"/);
  assert.doesNotMatch(socialShelf, /<img|latestSocialTitle/);
  assert.match(js, /latestSocial: "Latest social"/);
  assert.match(css, /\.social-shelf \{[\s\S]*?grid-column: span 5/);
  assert.match(css, /\.social-shelf \{[\s\S]*?overflow: hidden/);
  assert.match(css, /\[data-theme="day"\] \.social-shelf/);
});

test("the production landing opens on the Louvre and explains image use", () => {
  const slides = [...productionHtml.matchAll(/<figure class="hero-slide([^>]*)data-title="([^"]+)"/g)];
  assert.equal(slides[0]?.[2], "Paris after the crowds");
  assert.match(slides[0]?.[1] || "", /is-active/);
  assert.match(productionHtml, /<h1 id="hero-title">Paris after the crowds<\/h1>/);
  assert.match(productionHtml, /class="usage-guide"/);
  assert.match(productionHtml, /data-i18n="licensingTitle"/);
  assert.match(productionHtml, /data-i18n="provenanceTitle"/);
  assert.match(productionHtml, /assets\/usage-guide\/wall-art-notre-dame\.webp/);
  assert.match(productionHtml, /assets\/usage-guide\/licensing-contexts\.webp/);
  assert.match(productionHtml, /assets\/usage-guide\/location-provenance\.webp/);
  assert.equal((productionHtml.match(/class="usage-guide-visual"/g) || []).length, 3);
  assert.doesNotMatch(productionHtml, /data-i18n="(?:wallArtBody|licensingBody|provenanceBody)"/);
  assert.match(js, /usageTitle: "Find the image\. Know what you can do with it\."/);
  assert.match(js, /licensingTitle: "Personal, editorial, or commercial"/);
  assert.match(js, /provenanceTitle: "Location"/);
  assert.match(js, /usageAction: "Explore photographs"/);
  assert.match(css, /\.usage-guide-grid/);
  assert.match(css, /\.usage-guide-grid \{[\s\S]*?gap: 20px/);
  assert.match(css, /\.usage-guide-visual/);
  assert.match(css, /\[data-theme="day"\] \.usage-guide/);
  assert.match(css, /color: rgba\(27, 27, 24, 0\.74\)/);
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
