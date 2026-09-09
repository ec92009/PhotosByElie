import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const videoRules = require("../campaign-video.js");
const catalogTsv = require("./catalog_tsv.cjs");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const campaignIds = [
  "youtube-puerto-marina-benalmadena-2026-09-07",
  "youtube-ronda-above-the-gorge-2026-09-08",
  "youtube-alhambra-patterns-quiet-courtyards-2026-09-09",
];

test("normalizes explicit public YouTube metadata without accepting arbitrary URLs", () => {
  assert.deepEqual(videoRules.normalize({
    provider: "youtube",
    videoId: "hTGvkze8_ms",
    shortId: "zjzcmjEuemU",
    title: "Alhambra",
    durationSeconds: 40,
    visibility: "public",
  }), {
    provider: "youtube",
    videoId: "hTGvkze8_ms",
    shortId: "zjzcmjEuemU",
    title: "Alhambra",
    durationSeconds: 40,
    embedUrl: "https://www.youtube-nocookie.com/embed/hTGvkze8_ms?rel=0",
    watchUrl: "https://www.youtube.com/watch?v=hTGvkze8_ms",
    shortUrl: "https://youtube.com/shorts/zjzcmjEuemU",
    visibility: "public",
  });
  assert.equal(videoRules.normalize({ provider: "youtube", videoId: "bad:id", visibility: "public" }), null);
  assert.equal(videoRules.normalize({ provider: "youtube", videoId: "hTGvkze8_ms", visibility: "private" }), null);
});

test("the three September campaigns use public YouTube pairs and public catalog photos", () => {
  const collections = catalogTsv.loadCatalogWindow(repoRoot).photosByElieData || {};
  const publicPhotoIds = new Set(Object.values(collections).flatMap((collection) =>
    (collection.photos || []).map((photo) => photo.id)));
  for (const id of campaignIds) {
    const campaign = JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "campaigns", `${id}.json`), "utf8"));
    const video = videoRules.validate(campaign.video, id);
    assert.equal(video.visibility, "public");
    assert.equal(campaign.source, "YouTube");
    assert.equal(campaign.primaryPhotoIds.length, 12);
    assert.equal(campaign.primaryPhotoIds.every((photoId) => publicPhotoIds.has(photoId)), true);
    assert.equal(campaign.public, true);
  }
});

test("campaign detail exposes an accessible privacy-enhanced video surface", () => {
  const html = fs.readFileSync(path.join(repoRoot, "campaign.html"), "utf8");
  const social = fs.readFileSync(path.join(repoRoot, "social.html"), "utf8");
  const script = fs.readFileSync(path.join(repoRoot, "campaign.js"), "utf8");
  const styles = fs.readFileSync(path.join(repoRoot, "photos.css"), "utf8");
  assert.match(html, /data-campaign-video-section[^>]+aria-labelledby="campaign-video-title"[^>]+hidden/);
  assert.match(html, /campaign-video\.js/);
  assert.match(script, /photosByElieCampaignVideo\?\.render\(els\.videoSection, campaign\.video\)/);
  assert.match(styles, /\.campaign-video-frame\{[\s\S]*?aspect-ratio:16 \/ 9/);
  assert.match(social, /data-campaign-sources="[^"]*youtube/);
});
