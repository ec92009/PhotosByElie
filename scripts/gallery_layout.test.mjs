import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(repoRoot, "gallery-layout.js"), "utf8");

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const makeCard = (photoIndex, captionHeight = 18) => {
  const values = new Map();
  let writes = 0;
  const caption = { getBoundingClientRect: () => ({ height: captionHeight }) };
  return {
    dataset: { photoIndex: String(photoIndex) },
    media: {},
    caption,
    querySelector: (selector) => selector === "[data-photo-caption]" ? caption : null,
    style: {
      getPropertyValue: (name) => values.get(name) || "",
      setProperty: (name, value) => {
        writes += 1;
        values.set(name, String(value));
      },
      removeProperty: (name) => values.delete(name),
      get: (name) => values.get(name),
    },
    writes: () => writes,
  };
};

const makeHarness = ({ photos, cards, width = 1000, storage = makeStorage() } = {}) => {
  let frameId = 0;
  const frames = new Map();
  const observed = new Set();
  const observeCalls = [];
  const unobserveCalls = [];
  let resizeCallback = null;
  const rootStyles = new Map();
  const root = {
    clientWidth: width,
    dataset: {},
    style: {
      setProperty: (name, value) => rootStyles.set(name, String(value)),
      getPropertyValue: (name) => rootStyles.get(name) || "",
    },
    querySelectorAll: (selector) => selector === "[data-photo-index]"
      ? cards.current
      : cards.current.flatMap((card) => [card.media, card.caption]),
  };
  const windowObject = {
    location: { href: "https://example.test/gallery.html?columns=3", search: "?columns=3" },
    history: { state: null, replaceState() {} },
    matchMedia: () => ({ matches: false }),
    localStorage: storage,
    getComputedStyle: () => ({
      getPropertyValue: (name) => name === "--gallery-masonry-row-height" ? "8px" : "",
      rowGap: "7px",
      columnGap: "6px",
    }),
    requestAnimationFrame: (callback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { resizeCallback = callback; }
      observe(target) { observed.add(target); observeCalls.push(target); }
      unobserve(target) { observed.delete(target); unobserveCalls.push(target); }
    },
  };
  const sandbox = { URL, URLSearchParams, localStorage: storage, window: windowObject };
  vm.runInNewContext(source, sandbox);
  const controller = sandbox.window.photosByElieGalleryLayout.createMasonryController({
    root,
    getPhotos: () => photos.current,
    dimensionsFor: (photo) => photo?.dimensions,
    isPanorama: (photo) => Boolean(photo?.panorama),
    defaultFitMode: "fit",
  });
  return {
    controller,
    root,
    observed,
    observeCalls,
    unobserveCalls,
    pendingFrames: () => frames.size,
    triggerResize: () => resizeCallback?.([]),
    flushFrames: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    setWidth: (nextWidth) => { root.clientWidth = nextWidth; },
  };
};

test("maps mixed geometry through stable card indices and avoids unchanged writes", () => {
  const photos = { current: [
    { dimensions: { width: 2, height: 3 } },
    { dimensions: { width: 4, height: 1 }, panorama: true },
    { dimensions: { width: 16, height: 9 } },
  ] };
  const cards = { current: [makeCard(2), makeCard(0), makeCard(1, 34)] };
  const harness = makeHarness({ photos, cards });
  harness.controller.applyPreviewLayout();
  assert.deepEqual(cards.current.map((card) => card.style.get("--gallery-column-span")), ["1", "1", "3"]);
  assert.notEqual(cards.current[0].style.get("--gallery-masonry-span"), cards.current[1].style.get("--gallery-masonry-span"));
  const writes = cards.current.map((card) => card.writes());
  harness.controller.applyPreviewLayout();
  assert.deepEqual(cards.current.map((card) => card.writes()), writes);
});

test("clears invalid indices and Fit spans when geometry or mode is invalid", () => {
  const photos = { current: [{ dimensions: { width: 3, height: 2 } }] };
  const valid = makeCard(0);
  const invalid = makeCard("bogus");
  const outOfRange = makeCard(5);
  const cards = { current: [valid, invalid, outOfRange] };
  const harness = makeHarness({ photos, cards });
  harness.controller.applyPreviewLayout();
  assert.ok(valid.style.get("--gallery-masonry-span"));
  assert.equal(invalid.style.get("--gallery-masonry-span"), undefined);
  assert.equal(outOfRange.style.get("--gallery-masonry-span"), undefined);
  harness.setWidth(0);
  harness.controller.applyPreviewLayout();
  assert.equal(valid.style.get("--gallery-masonry-span"), undefined);
  assert.equal(harness.pendingFrames(), 0);
  harness.controller.setFitMode("fill");
  harness.setWidth(1000);
  harness.controller.applyPreviewLayout();
  assert.equal(valid.style.get("--gallery-column-span"), undefined);
});

test("observer ownership is incremental and one resize frame is coalesced", () => {
  const photos = { current: [{ dimensions: { width: 3, height: 2 } }] };
  const first = makeCard(0);
  const cards = { current: [first] };
  const harness = makeHarness({ photos, cards });
  harness.controller.applyPreviewLayout();
  const initialObserveCount = harness.observeCalls.length;
  harness.controller.applyPreviewLayout();
  assert.equal(harness.observeCalls.length, initialObserveCount);
  harness.triggerResize();
  harness.triggerResize();
  harness.triggerResize();
  assert.equal(harness.pendingFrames(), 1);
  harness.flushFrames();
  assert.equal(harness.pendingFrames(), 0);

  const replacement = makeCard(0);
  cards.current = [replacement];
  harness.controller.applyPreviewLayout();
  assert.equal(harness.unobserveCalls.includes(first.media), true);
  assert.equal(harness.unobserveCalls.includes(first.caption), true);
  assert.equal(harness.observed.has(replacement.media), true);
  assert.equal(harness.observed.has(replacement.caption), true);
});

test("invalid geometry stays quiescent and recovers only from observer input", () => {
  const photos = { current: [{ dimensions: { width: 3, height: 2 } }] };
  const card = makeCard(0);
  const cards = { current: [card] };
  const harness = makeHarness({ photos, cards, width: 0 });
  harness.controller.applyPreviewLayout();
  assert.equal(harness.pendingFrames(), 0);
  harness.flushFrames();
  assert.equal(harness.pendingFrames(), 0);
  harness.setWidth(600);
  harness.triggerResize();
  assert.equal(harness.pendingFrames(), 1);
  harness.flushFrames();
  assert.ok(card.style.get("--gallery-masonry-span"));
  assert.equal(harness.pendingFrames(), 0);
});

test("public consumers reconcile stale layout after every empty transition", () => {
  const gallery = fs.readFileSync(path.join(repoRoot, "photo-gallery.js"), "utf8");
  const campaign = fs.readFileSync(path.join(repoRoot, "campaign.js"), "utf8");
  const hidden = fs.readFileSync(path.join(repoRoot, "hidden-page.js"), "utf8");
  assert.match(gallery, /renderedGalleryPhotos = \[\];\s+galleryRoot\.innerHTML = "";\s+applyGalleryPreviewLayout\(\[\]\);/);
  assert.match(gallery, /setGalleryStatus\([\s\S]*?applyGalleryPreviewLayout\(\[\]\);\s+return;/);
  assert.match(campaign, /if \(!terms\.length\) \{\s+searchEntries = \[\];[\s\S]*?searchLayout\?\.applyPreviewLayout\(\[\]\);/);
  for (const marker of [
    "Owner controls are only available on localhost",
    "Loading Waste Basket photos",
    "No Waste Basket photos",
  ]) {
    const start = hidden.indexOf(marker);
    assert.notEqual(start, -1);
    const branch = hidden.slice(Math.max(0, start - 300), start + 500);
    assert.match(branch, /renderedPhotos = \[\];/);
    assert.match(branch, /applyPreviewLayout\(\);/);
  }
});
