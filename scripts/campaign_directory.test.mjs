import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = fs.readFileSync(path.join(root, "campaigns.js"), "utf8");
const css = fs.readFileSync(path.join(root, "campaigns.css"), "utf8");

test("the All campaigns directory gives public Shorts their own vertical YouTube card", () => {
  assert.match(directory, /campaign-directory-card--video/);
  assert.match(directory, /vertical-youtube-video/);
  assert.match(directory, /video\.portraitEmbedUrl/);
  assert.match(directory, /referrerPolicy = 'strict-origin-when-cross-origin'/);
  assert.match(css, /\.campaign-directory-video\s*\{[\s\S]*?aspect-ratio: 9 \/ 16/);
});

test("older campaign cards require a complete four-photo collage in the two-column directory", () => {
  assert.match(directory, /const fourFrames/);
  assert.match(directory, /frames\.length !== 4/);
  assert.match(directory, /campaign-composite--four/);
  assert.match(css, /\.campaign-directory\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\) \{ \.campaign-directory \{ grid-template-columns: minmax\(0, 1fr\)/);
});
