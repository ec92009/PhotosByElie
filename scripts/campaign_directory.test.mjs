import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
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

test("verified portraits use inline native controls with no eager video download", () => {
  assert.match(directory, /video\.portraitMp4 \? 'video' : 'iframe'/);
  assert.match(directory, /player\.src = video\.portraitMp4/);
  assert.match(directory, /player\.controls = true/);
  assert.match(directory, /player\.playsInline = true/);
  assert.match(directory, /player\.preload = 'none'/);
  assert.match(directory, /Watch it on YouTube below/);
  assert.match(directory, /credit\.textContent = video\.musicCredit/);
  assert.doesNotMatch(directory, /player\.autoplay\s*=/);
  assert.match(css, /\.campaign-directory-video video/);
});

test("the actual directory renderer preserves playback, credit and failure links", () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.events = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    querySelector() { return this.children.find(node => node.className === 'campaign-directory-caption'); }
  }
  const context = { document: { createElement: tag => new Element(tag) },
    captionFor: () => Object.assign(new Element('div'), {className:'campaign-directory-caption'}) };
  const start = directory.indexOf('  const videoCardFor =');
  const end = directory.indexOf('  const load =', start);
  const render = vm.runInNewContext(directory.slice(start, end) + '\nvideoCardFor;', context);
  const video = {portraitMp4:'https://download.photos-by-elie.com/assets/campaign-media/native-test.mp4',
    portraitEmbedUrl:'https://www.youtube-nocookie.com/embed/G_oZ7jXQhwA?rel=0',
    watchUrl:'https://www.youtube.com/watch?v=RkzQdeQQ67Q', musicCredit:'Licensed track credit'};
  const card = render({title:'Córdoba',imageUrl:'https://download.photos-by-elie.com/media/expo/test_900.jpg'}, video);
  const frame = card.children[0], player = frame.children[0], caption = card.children[1];
  assert.equal(card.dataset.campaignRepresentation, 'native-portrait-video');
  assert.equal(player.tag, 'video'); assert.equal(player.src, video.portraitMp4);
  assert.equal(player.controls, true); assert.equal(player.playsInline, true); assert.equal(player.preload, 'none');
  assert.equal(player['aria-label'], 'Córdoba');
  assert.equal(caption.children[0].href, video.watchUrl);
  assert.equal(caption.children[1].textContent, video.musicCredit);
  player.events.error();
  assert.equal(frame.children[0].role, 'status');
  assert.equal(caption.children[0].href, video.watchUrl);
  const fallback = render({title:'Córdoba'}, {...video,portraitMp4:undefined});
  assert.equal(fallback.children[0].children[0].tag, 'iframe');
  assert.equal(fallback.children[0].children[0].src, video.portraitEmbedUrl);
});
