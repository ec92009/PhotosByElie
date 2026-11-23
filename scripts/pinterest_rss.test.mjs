import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAllFeeds,
  collectCandidates,
  orderCandidatesForBoard,
  selectReleasedItems,
  BOARD_FEEDS,
} from "./build_pinterest_rss.mjs";

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-pin-rss-"));
  const write = (rel, obj) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(obj, null, 2));
  };
  write("socials/Pinterest/2026-07-11/spain-set-a/manifest.json", {
    date: "2026-07-11",
    title: "Seville Courtyard Light",
    board_recommendation: "Spain Travel Photography",
    description: "Five Photos By Elie photographs from Seville.",
    items: [
      { id: "spain-portrait-1", title: "IMG 1234", collection: "spain", width: 1200, height: 1800, public_asset_url: "https://pub-old.r2.dev/expo/spain-portrait-1_1800.jpg" },
      { id: "spain-landscape-1", title: "Alcazar Archway", collection: "spain", width: 1800, height: 1200 },
      { id: "spain-revoked-1", title: "Hidden Photo", collection: "spain", width: 1200, height: 1800 },
    ],
  });
  write("socials/Pinterest/2026-07-10/spain-set-b/manifest.json", {
    date: "2026-07-10",
    title: "Ronda Bridge Dusk",
    board_recommendation: "Spain Travel Photography",
    items: [
      { id: "spain-portrait-2", title: "Puente Nuevo at Dusk", collection: "spain", width: 1200, height: 1800 },
      { id: "spain-portrait-1", title: "Duplicate Across Sets", collection: "spain", width: 1200, height: 1800 },
    ],
  });
  write("socials/Pinterest/2026-07-12/france-set/manifest.json", {
    date: "2026-07-12",
    title: "Louvre Courtyard Reflections",
    board_recommendation: "Paris and France Photography",
    items: [
      { id: "france-portrait-1", title: "Louvre Glass Pyramid", collection: "france", width: 1200, height: 1800 },
    ],
  });
  return root;
}

test("Pinterest RSS fails closed on empty visibility and excludes revoked media IDs", () => {
  const root = makeTempRepo();
  assert.throws(() => collectCandidates(root, new Set()), /visibleSet/);
  const visible = new Set(["spain-portrait-1", "spain-landscape-1", "spain-portrait-2", "france-portrait-1"]);
  const candidates = collectCandidates(root, visible);
  const ids = candidates.map((c) => c.mediaId);
  assert.equal(ids.includes("spain-revoked-1"), false);
  assert.equal(ids.filter((id) => id === "spain-portrait-1").length, 1);

  const portrait1 = candidates.find((c) => c.mediaId === "spain-portrait-1");
  assert.equal(portrait1.imageUrl, "https://download.photos-by-elie.com/media/expo/spain-portrait-1_1800.jpg");
  assert.equal(portrait1.link, "https://photos-by-elie.com/photo.html?id=spain-portrait-1");
  assert.doesNotMatch(portrait1.title, /IMG 1234/);
  assert.match(portrait1.title, /Seville Courtyard Light/);
  assert.doesNotMatch(portrait1.description, /Five Photos By Elie/);
});

test("Pinterest RSS prioritizes portraits, interleaves themes, and drips steadily by date", () => {
  const root = makeTempRepo();
  const visible = new Set(["spain-portrait-1", "spain-landscape-1", "spain-portrait-2", "france-portrait-1"]);
  const spain = orderCandidatesForBoard(collectCandidates(root, visible).filter((c) => c.collection === "spain"));
  assert.deepEqual(spain.map((c) => c.mediaId), ["spain-portrait-1", "spain-portrait-2", "spain-landscape-1"]);

  const day0 = selectReleasedItems(spain, { asOf: "2026-11-23", initialCount: 2, intervalDays: 2 });
  assert.equal(day0.length, 2);
  const day2 = selectReleasedItems(spain, { asOf: "2026-11-25", initialCount: 2, intervalDays: 2 });
  assert.equal(day2.length, 3);

  const feeds = buildAllFeeds({ repoRoot: root, visibleSet: visible, asOf: "2026-11-23" });
  assert.equal(feeds.length, BOARD_FEEDS.length + 1);
  const spainFeed = feeds.find((f) => f.slug === "spain");
  assert.match(spainFeed.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(spainFeed.xml, /<rss version="2\.0" xmlns:media="http:\/\/search\.yahoo\.com\/mrss\/"/);
  assert.match(spainFeed.xml, /<enclosure url="https:\/\/download\.photos-by-elie\.com\/media\/expo\/spain-portrait-1_1800\.jpg"/);
  assert.match(spainFeed.xml, /<link>https:\/\/photos-by-elie\.com\/photo\.html\?id=spain-portrait-1<\/link>/);
  assert.doesNotMatch(spainFeed.xml, /r2\.dev/);
  assert.doesNotMatch(spainFeed.xml, /spain-revoked-1/);
});
