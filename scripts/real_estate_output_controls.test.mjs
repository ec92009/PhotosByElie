import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../real-estate.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../real-estate.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../photos.css", import.meta.url), "utf8");
const sharedStyles = readFileSync(new URL("../shared.css", import.meta.url), "utf8");
const siteScript = readFileSync(new URL("../photos.js", import.meta.url), "utf8");
const basketScript = readFileSync(new URL("../basket.js", import.meta.url), "utf8");
const likedScript = readFileSync(new URL("../liked.js", import.meta.url), "utf8");
const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cloudWorker = readFileSync(new URL("../worker/cloud-worker.mjs", import.meta.url), "utf8");
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

test("Video action queues the cloud renderer while it is busy", () => {
  assert.match(script, /Generating video\.\.\./);
  assert.doesNotMatch(script, /Queueing video\.\.\./);
  assert.match(script, /if \(!isCloudRenderMode\) return;/);
  const slideshowShare = script.match(/const shareSlideshowPlan = async[\s\S]*?\n  let crcTable/)?.[0] || "";
  assert.ok(slideshowShare.indexOf("queueCloudOutputs") >= 0);
  assert.ok(slideshowShare.indexOf("queueCloudOutputs") < slideshowShare.indexOf("ensureVideoExportReady"));
  assert.match(script, /const waitForCloudAssemblyJob = async/);
  assert.match(script, /Generating in the cloud/);
});

test("Cloud output progress is determinate, phase-aware, and localized", () => {
  assert.match(script, /job\?\.progress/);
  assert.match(script, /re\.cloud\.progress_detail/);
  assert.match(script, /current: percent/);
  assert.match(script, /total: 100/);
  assert.match(script, /cloudRenderEndpoint\(cloudRenderJobId, "", "progress"\)/);
  assert.match(script, /phase === "render"/);
  assert.match(styles, /progress::-webkit-progress-value/);
  assert.match(siteScript, /'re\.cloud\.phase\.video-transcoding': 'Convirtiendo video a MP4'/);
  assert.match(siteScript, /'re\.cloud\.generating_title': 'Generando en la nube'/);
});

test("Cloud render credentials stay out of the public page request URL", () => {
  assert.match(script, /cloudRenderParams = new URLSearchParams\(String\(window\.location\.hash/);
  assert.match(cloudWorker, /url\.hash = new URLSearchParams/);
  assert.doesNotMatch(cloudWorker, /url\.searchParams\.set\("cloudRenderToken"/);
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
  assert.match(script, /slideshowAssetTimeoutMs = 12000/);
  assert.match(script, /Timed out loading slideshow image/);
  assert.match(script, /Timed out loading slideshow music/);
  assert.match(script, /slideshowMusicPreparedManifestKey = "assets\/music\/slideshow-guitar\/pixabay\/pixabay-guitar-candidates-prepared-060s\.json"/);
  assert.match(script, /slideshowMusicMaxDecodeSeconds = 60\.25/);
  assert.match(script, /preparedR2Key/);
  assert.match(script, /duration <= slideshowMusicMaxDecodeSeconds/);
});

test("Video closing card carries a 25 mm-equivalent Photos By Elie QR code", () => {
  assert.match(script, /VIDEO_CLOSING_QR_SIZE_PX = 25 \* 96 \/ 25\.4/);
  assert.match(script, /drawVideoClosingQr/);
  assert.match(script, /if \(outro\) \{[\s\S]*drawVideoClosingQr/);
  assert.match(script, /PDF_FOOTER_QR_MATRIX\.forEach/);
  assert.match(script, /PDF_FOOTER_QR_URL = "https:\/\/photos-by-elie\.com\/"/);
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
  assert.match(siteScript, /const accountIsAuthenticated = \(\) => state\.authenticated \|\| state\.scopedAuthenticated/);
  assert.match(siteScript, /accountEntry\.hidden = activeAuth/);
  assert.match(siteScript, /accountButton\.hidden = !activeAuth/);
  assert.match(siteScript, /accountEntryMode === 'signin'/);
  assert.match(siteScript, /signupButton\.hidden = accountEntryMode === 'signin'/);
  assert.match(siteScript, /signinButton\.hidden = accountEntryMode !== 'signin'/);
  assert.match(siteScript, /entrySignupButton\?\.addEventListener\('click', \(\) => beginGoogleLogin\('signup'\)\)/);
  assert.match(siteScript, /entrySigninButton\?\.addEventListener\('click', \(\) => openAccount\('signin', entrySigninButton\)\)/);
  assert.match(siteScript, /setScopedSession\(\{ kind = "", label = "" \} = \{\}\)/);
  assert.match(script, /setScopedSession\?\.\(\{[\s\S]*kind: "real-estate"/);
  assert.match(script, /photosbyelie:scopedaccountlogout/);
  assert.equal((siteScript.match(/data-account-signout-inline/g) || []).length, 2);
  assert.doesNotMatch(siteScript, /data-account-signout(?:\s|>)/);
  assert.match(siteScript, /const clearAccountDataFromDevice = \(\) =>/);
  assert.match(siteScript, /window\.photosByElieLiked\.write\(\[\]\)/);
  assert.match(siteScript, /window\.photosByElieBasket\.write\(\[\]\)/);
  assert.match(siteScript, /state\.orders = \[\]/);
  assert.match(siteScript, /photosbyelie:accountdatacleared/);
  assert.match(basketScript, /photosbyelie:accountdatacleared/);
  assert.match(likedScript, /photosbyelie:accountdatacleared/);
  assert.match(sharedStyles, /\.account-entry-actions\{/);
  assert.doesNotMatch(home, /real-estate\.html\?logout=1&client=elie/);
});
