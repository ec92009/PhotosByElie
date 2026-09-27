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
    portraitEmbedUrl: "https://www.youtube-nocookie.com/embed/zjzcmjEuemU?rel=0",
    watchUrl: "https://www.youtube.com/watch?v=hTGvkze8_ms",
    shortUrl: "https://youtube.com/shorts/zjzcmjEuemU",
    visibility: "public",
  });
  assert.equal(videoRules.normalize({ provider: "youtube", videoId: "bad:id", visibility: "public" }), null);
  assert.equal(videoRules.normalize({ provider: "youtube", videoId: "hTGvkze8_ms", visibility: "private" }), null);
});

test("only the exact download-domain native-video URL is allowed alongside legacy relative films", () => {
  const metadata = { provider: "youtube", videoId: "hTGvkze8_ms", visibility: "public" };
  const origin = "https://download.photos-by-elie.com";
  const directory = "/assets/campaign-media/";
  const hosted = `${origin}${directory}native-test.mp4`;
  const legacy = "./assets/campaign-media/cascais-2026.mp4";
  const spec = fs.readFileSync(path.join(repoRoot, "docs/api/owner-v1.openapi.yaml"), "utf8");
  const receiptPatterns = [...spec.matchAll(/^        (publicUrl|portraitMp4): \{ type: string, pattern: '([^']+)' \}$/gm)];
  assert.deepEqual(receiptPatterns.map((match) => match[1]), ["publicUrl", "portraitMp4"]);
  const schemas = receiptPatterns.map((match) => new RegExp(match[2]));
  for (const portraitMp4 of [hosted, `${origin}${directory}native-a.mp4`, `${origin}${directory}native-${"a".repeat(113)}.mp4`, legacy]) {
    assert.equal(videoRules.normalize({ ...metadata, portraitMp4 })?.portraitMp4, portraitMp4);
    for (const schema of schemas) assert.equal(schema.test(portraitMp4), portraitMp4 !== legacy);
  }
  // Preserve legacy trimming; do not normalize a remotely hosted URL into the allowlist.
  assert.equal(videoRules.normalize({ ...metadata, portraitMp4: ` ${legacy} ` })?.portraitMp4, legacy);
  for (const unsafe of [
    hosted.replace("https:", "http:"), hosted.replace("https:", "HTTPS:"), hosted.replace("https:", ""),
    hosted.replace("download.", ""), hosted.replace("download.", "auth."),
    hosted.replace("download.", "DOWNLOAD."), hosted.replace(".com/", ".com./"),
    hosted.replace(".com/", ".com.evil.test/"), hosted.replace(".com/", ".com:443/"),
    hosted.replace(".com/", ".com:8443/"), hosted.replace("https://", "https://user:pass@"),
    hosted.replace("https://", "https://@"), hosted.replace("download", "%64ownload"),
    hosted.replace("/assets/", "//assets/"), hosted.replace("/assets/", "/other/../assets/"),
    hosted.replace("native-test", "./native-test"), hosted.replace("native-test", "%2e%2e/native-test"),
    hosted.replace("native-test", "%6eative-test"), hosted.replace("native-test", "native-test%2fother"),
    hosted.replace("/assets/", "\\assets/"), hosted.replace("native-test", "native-test%5cother"),
    hosted.replace("native-test", "native--test"), hosted.replace("native-test", "native-test-"),
    hosted.replace("native-test", "native-"), hosted.replace("native-test", "native_thing"),
    hosted.replace("native-test", "cascais-2026"), hosted.replace("native-test", "native-é"),
    hosted.replace("native-test", `native-${"a".repeat(114)}`), hosted.replace(".mp4", ".MP4"),
    `${hosted}?`, `${hosted}?token=secret`, `${hosted}#`, `${hosted}#t=1`,
    ` ${hosted}`, `${hosted} `, `${hosted}\n`, hosted.replace("download", "down\tload"),
    `${origin}/masters/native-test.mp4`, `${origin}/media/native-test.mp4`,
  ]) {
    assert.equal(videoRules.normalize({ ...metadata, portraitMp4: unsafe }), null, unsafe);
    for (const schema of schemas) assert.equal(schema.test(unsafe), false, unsafe);
  }
});

test("allowlisted absolute and legacy films both render native inline players with YouTube fallback", () => {
  const previousDocument = globalThis.document;
  const status = { textContent: "" };
  const frame = { classList: { toggle() {} }, replaceChildren(player) { this.player = player; } };
  const section = { querySelector(selector) {
    return selector === "[data-campaign-video-frame]" ? frame
      : selector === "[data-campaign-video-status]" ? status : null;
  } };
  globalThis.document = { createElement(tag) {
    return { tag, attributes: {}, listeners: {}, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; } };
  } };
  try {
    for (const portraitMp4 of ["https://download.photos-by-elie.com/assets/campaign-media/native-test.mp4",
      "./assets/campaign-media/cascais-2026.mp4"]) {
      const video = videoRules.render(section, { provider: "youtube", videoId: "hTGvkze8_ms",
        visibility: "public", portraitMp4 });
      assert.equal(section.hidden, false); assert.equal(video.portraitMp4, portraitMp4);
      assert.equal(frame.player.tag, "video"); assert.equal(frame.player.src, portraitMp4);
      assert.equal(frame.player.controls, true); assert.equal(frame.player.playsInline, true);
      assert.equal(frame.player.preload, "metadata"); assert.equal(status.textContent, "");
      frame.player.listeners.error(); assert.match(status.textContent, /watch it on YouTube/);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
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

test("campaign detail stays a still-photo collection while the directory owns YouTube playback", () => {
  const html = fs.readFileSync(path.join(repoRoot, "campaign.html"), "utf8");
  const social = fs.readFileSync(path.join(repoRoot, "social.html"), "utf8");
  const script = fs.readFileSync(path.join(repoRoot, "campaign.js"), "utf8");
  assert.match(html, /campaign-video\.js/);
  assert.doesNotMatch(html, /data-campaign-video-section/);
  assert.doesNotMatch(script, /photosByElieCampaignVideo\?\.render/);
  assert.match(social, /data-campaign-sources="[^"]*youtube/);
  assert.match(social, /campaign-video\.js/);
});

test("published films render in the directory before catalog readiness while detail stills stay guarded", () => {
  const directory = fs.readFileSync(path.join(repoRoot, "campaigns.js"), "utf8");
  assert.match(directory, /publicFilm\?\.portraitEmbedUrl/);
  assert.ok(directory.indexOf('videoCampaigns.forEach') < directory.indexOf('await window.photosByElieCatalogReady'));
  assert.match(directory, /if \(card\) grid.append\(card\);/);
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
