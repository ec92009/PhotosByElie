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

test("Every generated PDF page carries the numbered Photos By Elie QR footer", () => {
  assert.match(script, /PDF_FOOTER_QR_SIZE_PT = 10 \* 72 \/ 25\.4/);
  assert.match(script, /PDF_FOOTER_QR_URL = "https:\/\/photos-by-elie\.com\/"/);
  assert.match(script, /Page \$\{pageIndex \+ 1\} \/ \$\{pageCount\}/);
  assert.match(script, /PDF_FOOTER_BRAND = "Photos By Elie"/);
  assert.match(script, /pdfFooterCommandsFor\(\{ pageIndex: index, pageCount: rendered\.pages\.length, pageWidth \}\)/);
  assert.match(script, /\/Font << \/F1 \$\{footerFontId\} 0 R >>/);
});

test("Video action describes browser rendering while it is busy", () => {
  assert.match(script, /Generating video\.\.\./);
  assert.doesNotMatch(script, /Queueing video\.\.\./);
  assert.match(script, /if \(batch\.slideshowSettings\?\.audioPolicy\?\.musicTrack\) return;/);
  const slideshowShare = script.match(/const shareSlideshowPlan = async[\s\S]*?\n  let crcTable/)?.[0] || "";
  assert.ok(slideshowShare.indexOf("ensureVideoExportReady") < slideshowShare.indexOf("queueCloudOutputs"));
});

test("Generated videos include restrained branded presentation polish", () => {
  assert.match(script, /slideshowIntroDurationMs = 2200/);
  assert.match(script, /slideshowOutroDurationMs = 2200/);
  assert.match(script, /drawRecordedBrandCard/);
  assert.match(script, /PROPERTY PRESENTATION/);
  assert.match(script, /photos-by-elie\.com/);
  assert.match(script, /phase: "intro"/);
  assert.match(script, /phase: "outro"/);
  assert.match(script, /slideshowTransitionFraction/);
  assert.match(script, /soft-fade-through-black/);
});

test("Site account sign-in combines Google and legacy credentials without a special Real Estate form", () => {
  assert.doesNotMatch(html, /data-re-google-login|data-re-login-name|data-re-login-code|data-re-login-form/);
  assert.match(siteScript, /data-account-signin-form/);
  assert.match(siteScript, /data-account-login-name/);
  assert.match(siteScript, /data-account-login-password/);
  assert.match(siteScript, /data-account-login-reveal/);
  assert.match(siteScript, /account\.legacy_login/);
  assert.match(siteScript, /account\.show_password/);
  assert.match(siteScript, /signinForm\.hidden = accountEntryMode !== 'signin'/);
  assert.match(siteScript, /body: JSON\.stringify\(\{ username, accessCode \}\)/);
  assert.doesNotMatch(siteScript, /data-account-visitor/);
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
  assert.match(siteScript, /signupButton\.hidden = accountEntryMode === 'signin'/);
  assert.match(siteScript, /signinButton\.hidden = accountEntryMode !== 'signin'/);
  assert.match(siteScript, /entrySignupButton\?\.addEventListener\('click', \(\) => beginGoogleLogin\('signup'\)\)/);
  assert.match(siteScript, /entrySigninButton\?\.addEventListener\('click', \(\) => openAccount\('signin', entrySigninButton\)\)/);
  assert.match(sharedStyles, /\.account-entry-actions\{/);
  assert.doesNotMatch(home, /real-estate\.html\?logout=1&client=elie/);
});
