import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const videoRules = require("../campaign-video.js");
const catalogTsv = require("./catalog_tsv.cjs");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const campaignIds = [
  "youtube-puerto-marina-benalmadena-2026-09-07",
  "youtube-ronda-above-the-gorge-2026-09-08",
  "youtube-alhambra-patterns-quiet-courtyards-2026-09-09",
  "youtube-cascais-life-beside-the-atlantic-2026-09-11",
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

test("the four September campaigns use public YouTube pairs and public catalog photos", () => {
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
  assert.match(script, /photosByElieCampaignVideo\?\.render\(document\.querySelector\('\[data-campaign-video-section\]'\), campaign\.video\)/);
  assert.match(styles, /\.campaign-video-frame\{[\s\S]*?aspect-ratio:16 \/ 9/);
  assert.match(social, /data-campaign-sources="[^"]*youtube/);
  assert.match(social, /campaign-video\.js/);
});

test("published films render before catalog readiness while still-photo access stays guarded", () => {
  const detail = fs.readFileSync(path.join(repoRoot, "campaign.js"), "utf8");
  const directory = fs.readFileSync(path.join(repoRoot, "campaigns.js"), "utf8");
  assert.ok(detail.indexOf("photosByElieCampaignVideo?.render") < detail.indexOf("await window.photosByElieCatalogReady"));
  assert.match(directory, /normalize\(campaign.video\)\?\.portraitMp4/);
  assert.match(directory, /if \(entries.length \|\| publicFilm\)/);
  assert.match(directory, /Still photographs currently unavailable/);
  assert.match(directory, /rules.publicCampaign\(campaign\)/);
});

test("Cascais embeds the exact approved portrait derivative without exposing masters", () => {
  const campaign = JSON.parse(fs.readFileSync(path.join(repoRoot, "assets/campaigns", `${campaignIds[3]}.json`)));
  const video = videoRules.validate(campaign.video);
  assert.equal(video.videoId, "nH0HWGyJPg4");
  assert.equal(video.shortId, "MVldzjl-aYE");
  assert.match(video.musicCredit, /AbsoluteSound.*Pixabay/);
  const bytes = fs.readFileSync(path.join(repoRoot, video.portraitMp4));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),
    "a852bcb9cec50e56b8a299cf4e2f78f7d58bcc6030883e4eaec5d594e79987e3");
  for (const unsafe of ["https://example.com/private.mp4", "//example.com/video.mp4", "../private.mp4",
    "./assets/campaign-media/../masters/file.mp4", "./assets/campaign-media/%2e%2e/file.mp4", "./assets/campaign-media/file.mp4?token=secret"]) {
    assert.equal(videoRules.normalize({ ...campaign.video, portraitMp4: unsafe }), null);
  }
});

test("portrait player keeps native controls, inline mobile playback, and visible failure fallback", () => {
  const script = fs.readFileSync(path.join(repoRoot, "campaign-video.js"), "utf8");
  const styles = fs.readFileSync(path.join(repoRoot, "photos.css"), "utf8");
  assert.match(script, /player.controls = true/);
  assert.match(script, /player.playsInline = true/);
  assert.match(script, /player.preload = "metadata"/);
  assert.match(script, /addEventListener\("error"/);
  assert.match(styles, /\.campaign-video-frame--portrait\{[\s\S]*?aspect-ratio:9 \/ 16/);
});
