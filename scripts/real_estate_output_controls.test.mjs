import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../real-estate.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../real-estate.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../photos.css", import.meta.url), "utf8");
const sharedStyles = readFileSync(new URL("../shared.css", import.meta.url), "utf8");
const siteScript = readFileSync(new URL("../photos.js", import.meta.url), "utf8");
const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const outputActions = html.match(/<div class="real-estate-output-actions">([\s\S]*?)<\/div>/)?.[1] || "";

test("Real Estate output step has one control per cloud action", () => {
  assert.equal((html.match(/data-re-download-pdf/g) || []).length, 1);
  assert.equal((html.match(/data-re-download-slideshow/g) || []).length, 1);
  assert.equal((outputActions.match(/data-re-download-pdf/g) || []).length, 1);
  assert.equal((outputActions.match(/data-re-download-slideshow/g) || []).length, 1);
  assert.equal((outputActions.match(/data-re-shelf-back/g) || []).length, 1);
  assert.equal((outputActions.match(/data-re-view-pdf/g) || []).length, 0);
  assert.equal((outputActions.match(/data-re-view-slideshow/g) || []).length, 0);
});

test("Output Next returns to the finished-products shelf", () => {
  assert.match(outputActions, /data-re-shelf-back[^>]*data-i18n="common\.next"/);
});

test("Cloud output controls upload prepared files without creating stray Selection rows", () => {
  const queueBody = script.match(/const queueCloudOutputs = async[\s\S]*?\n  const openDeliverableUrl/)?.[0] || "";
  assert.doesNotMatch(queueBody, /saveLocalDeliverable\s*\(/);
  assert.match(script, /\/real-estate\/deliverables\/\$\{encodeURIComponent\(record\.id\)\}\/complete/);
  assert.match(script, /owner-review|finished-products shelf/i);
});

test("Finished-product shelf exposes one download action per ready format", () => {
  assert.match(script, /data-re-download-output-url/);
  assert.match(script, /Download \$\{label\}/);
  assert.match(script, /filter\(\(item\) => item\.formats\.some\(\(format\) => format === "pdf" \|\| format === "video"\)\)/);
  assert.match(script, /link\.target = "_blank"/);
  assert.match(styles, /button\.real-estate-deliverable-status\.is-action[\s\S]*font-family:"Space Grotesk"/);
});

test("Video action describes browser rendering while it is busy", () => {
  assert.match(script, /Generating video\.\.\./);
  assert.doesNotMatch(script, /Queueing video\.\.\./);
  assert.match(script, /if \(batch\.slideshowSettings\?\.audioPolicy\?\.musicTrack\) return;/);
  const slideshowShare = script.match(/const shareSlideshowPlan = async[\s\S]*?\n  let crcTable/)?.[0] || "";
  assert.ok(slideshowShare.indexOf("ensureVideoExportReady") < slideshowShare.indexOf("queueCloudOutputs"));
});

test("Real Estate uses Google and ACS rather than a public password form", () => {
  assert.match(html, /data-re-google-login/);
  assert.match(html, /re\.login\.google_hint/);
  assert.doesNotMatch(html, /data-re-login-name/);
  assert.doesNotMatch(html, /data-re-login-code/);
  assert.doesNotMatch(html, /Private client access|Client login/);
  assert.match(styles, /\.real-estate-login-card h1\{[\s\S]*?font-size:clamp\(1\.8rem,4vw,2\.7rem\)/);
});

test("A generic Real Estate URL returns to the public account entry", () => {
  assert.match(script, /!isLocalHost && !requestedClientContext && !pageParams\.get\("context"\)/);
  assert.match(script, /accountLanding\.searchParams\.set\("account", "1"\)/);
});

test("Visitors see account pills and signed-in users return to the face menu", () => {
  assert.match(siteScript, /className = 'account-entry-actions'/);
  assert.match(siteScript, /data-account-entry-signup/);
  assert.match(siteScript, /accountEntry\.hidden = state\.authenticated/);
  assert.match(siteScript, /accountButton\.hidden = !state\.authenticated/);
  assert.match(siteScript, /accountEntryMode === 'signin'/);
  assert.match(siteScript, /signinButton\.classList\.toggle\('primary', accountEntryMode === 'signin'\)/);
  assert.match(sharedStyles, /\.account-entry-actions\{/);
  assert.doesNotMatch(home, /real-estate\.html\?logout=1&client=elie/);
});
