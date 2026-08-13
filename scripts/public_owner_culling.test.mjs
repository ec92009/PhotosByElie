import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("hosted PBE culling waits for Backstage and uses only the local Waste Basket gateway", () => {
  const hidden = read("hidden-actions.js");
  const gallery = read("photo-gallery.js");
  const detail = read("photo-detail.js");
  assert.match(hidden, /pbeOwnerSession\?\.isReady\?\.\(\)/);
  assert.match(hidden, /pbeOwnerSession\.action\(action, requestPayload\)/);
  assert.match(hidden, /source: "owner-gallery"/);
  assert.match(hidden, /const markMany = async/);
  assert.match(hidden, /const undoMany = async/);
  assert.match(hidden, /"waste-basket-x"/);
  assert.match(hidden, /"waste-basket-x-many"/);
  assert.match(hidden, /"waste-basket-restore"/);
  assert.doesNotMatch(hidden, /actionKind:\s*"photo-moderation"/);
  assert.doesNotMatch(hidden, /\/photosbyelie\/wake-owner-action/);
  assert.doesNotMatch(hidden, /owner_authorized|ownerAuthorized/);
  assert.match(hidden, /await queueHideAction\(\{ revertOnError: true \}\)/);
  assert.match(hidden, /throw error;\s*\n\s*\}\);/);
  assert.match(gallery, /ownerEditable: ownerCullingEnabled/);
  assert.match(gallery, /const selectOwnerPhotoFromPointer =/);
  assert.match(gallery, /event\.shiftKey && anchorIndex >= 0/);
  assert.match(gallery, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(gallery, /const extendOwnerKeyboardSelection =/);
  assert.match(gallery, /if \(extend\) extendOwnerKeyboardSelection\(photos, nextIndex\)/);
  assert.match(gallery, /stepGallerySelection\(1, false, \{ extend: event\.shiftKey \}\)/);
  assert.match(gallery, /stepGallerySelection\(-1, true, \{ extend: event\.shiftKey \}\)/);
  assert.match(gallery, /syncOwnerSelectionButtons\(\)/);
  assert.match(gallery, /await window\.photosByElieHiddenActionsReady/);
  assert.match(detail, /await window\.photosByElieHiddenActionsReady/);
  assert.match(gallery, /data-owner-cull-count/);
  assert.doesNotMatch(gallery, /data-owner-cull-select-visible/);
  assert.doesNotMatch(gallery, /data-owner-cull-hide/);
  assert.doesNotMatch(gallery, /data-owner-cull-undo/);
  assert.match(gallery, /event\.key\.toLowerCase\(\) === "x" \|\| event\.key\.toLowerCase\(\) === "b" \|\| event\.key\.toLowerCase\(\) === "h"/);
  assert.match(gallery, /event\.key\.toLowerCase\(\) !== "u"/);
  assert.match(gallery, /moveOwnerSelectionToWasteBasket/);
  assert.match(gallery, /undoLastOwnerCull/);
  assert.match(gallery, /data-owner-cull-touch-hide/);
  assert.match(gallery, /data-owner-cull-touch-undo/);
  assert.match(read("gallery.html"), /data-owner-cull-touch-actions/);
  assert.match(read("photos.css"), /@media \(hover:none\), \(pointer:coarse\)[\s\S]*?owner-cull-touch-actions:not\(\[hidden\]\)/);
});

test("photo detail and preview omit debugging-only metadata", () => {
  const detail = read("photo-detail.js");
  const html = read("photo.html");
  const photos = read("photos.js");
  assert.match(detail, /"metadata title", "origin"/);
  assert.doesNotMatch(html, /data-photo-info-toggle/);
  assert.match(
    photos,
    /"Keywords",\s*"Captured",\s*"Camera",\s*"Lens",\s*"Exposure",\s*"Focal length",\s*"Original file",\s*"Original size",\s*"Location"/,
  );
  assert.doesNotMatch(photos, /\["Media ID"/);
  assert.doesNotMatch(photos, /\["Path", contextUrl\]/);
  assert.doesNotMatch(photos, /\["Source", isVideo/);
});

test("Owner Finder preview falls back to truthful public context media", () => {
  const photos = read("photos.js");

  assert.match(photos, /const contextCandidates = \[/);
  assert.match(photos, /contextDetailUrl/);
  assert.match(photos, /contextGalleryUrl/);
  assert.match(photos, /const showContextPreview = \(note = "", candidateIndex = 0\)/);
  assert.match(photos, /Original source preview unavailable; showing a public context preview\./);
  assert.match(photos, /Original source preview could not be loaded; showing a public context preview\./);
  assert.match(photos, /renderInfo\(\{ eyebrow: "Public preview", state: "warning", note: label \}\)/);
  assert.match(photos, /if \(!infoUrl\) \{\s*showContextPreview\(/);
  assert.match(photos, /if \(!response\.ok \|\| !payload\?\.ok\) \{\s*showContextPreview\(/);
  assert.match(photos, /if \(!previewUrl\) \{\s*showContextPreview\(/);
  assert.match(photos, /renderInfo\(\{ eyebrow: "Owner original preview" \}\)/);
  assert.match(photos, /const safeOwnerFailureReason =/);
  assert.match(photos, /No safe public context preview is available/);
  assert.match(photos, /Local source details remain private\./);
  assert.doesNotMatch(photos, /Path label/);
  assert.doesNotMatch(photos, /Owner mode does not substitute public or lower-resolution previews/);
  assert.match(
    photos,
    /photosByElieSourcePreviewUrl = \(photo, mode = "media"\) => \{\s*if \(!isLocalhostMediaPage \|\| !photo\?\.id\) return "";/,
  );
});

test("panorama full-height mode stays escapable and yields autoplay to the visitor", () => {
  const detail = read("photo-detail.js");
  const photos = read("photos.js");
  const styles = read("photos.css");
  assert.match(photos, /const startAutoPan = \(\{ delayMs = 1100, pixelsPerSecond = 22, fromCenter = true \} = \{\}\)/);
  assert.match(photos, /autoPanDirection = -1/);
  assert.match(photos, /autoPanDirection = 1/);
  assert.match(photos, /const startMomentum = \(\) =>/);
  assert.match(photos, /momentumVelocity \*= Math\.pow\(0\.94/);
  assert.match(photos, /prefers-reduced-motion: reduce/);
  assert.match(photos, /scroller\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(photos, /scroller\.addEventListener\("wheel", onWheel/);
  assert.match(photos, /panoPan\?\.stopAutoPan\?\.\(\{ user: true \}\)/);
  assert.match(photos, /data-finder-preview-close/);
  assert.match(photos, /preview\.exit_full_height/);
  assert.match(detail, /panoPan\?\.startAutoPan\?\.\(\{ delayMs: 1100, pixelsPerSecond: 22, fromCenter: true \}\)/);
  assert.match(detail, /document\.body\.append\(panoToggle\)/);
  assert.match(styles, /\.pano-scroll-toggle\.is-full-height-exit\{[\s\S]*position:fixed/);
  assert.match(styles, /\.finder-preview-close\{/);
});

test("browser Owner is provisioning-only while hosted PBE keeps the recoverable Waste Basket", () => {
  const owner = read("owner.html");
  const ownerStyles = read("new-owner.css");
  const ownerScript = read("new-owner.js");
  const accessConsole = read("access-console.js");
  const review = read("owner-review.js");
  const hidden = read("hidden-page.js");
  const hiddenActions = read("hidden-actions.js");
  const ownerActivity = read("owner-activity.js");
  const reviewHtml = read("owner-review.html");

  assert.match(owner, /aria-label="Build a Fixture"/);
  assert.match(ownerStyles, /\.new-owner-card\[aria-label="Build a Fixture"\]\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
  assert.match(ownerStyles, /@media \(max-width: 900px\)[\s\S]*\.fixture-builder-create,[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(ownerStyles, /\.new-owner-grid > \.new-owner-card,[\s\S]*grid-column:\s*1\s*\/\s*-1;/);
  assert.match(owner, /aria-label="Waste Basket"/);
  assert.match(owner, /\.\/owner-review\.html\?view=blocked/);
  assert.match(ownerScript, /syncWasteBasketControl/);
  assert.match(ownerScript, /wasteBasketLink\.classList\.remove\("is-disabled"\)/);
  assert.doesNotMatch(ownerScript, /wasteBasketLink\.classList\.toggle\("is-disabled"/);
  assert.match(ownerScript, /wasteBasketLink\?\.addEventListener\("click", openWasteBasket\)/);
  assert.match(owner, /data-owner-provisioning-only(?:[\s>])/);
  assert.match(owner, /ec92009@gmail\.com/);
  assert.match(owner, /provisioning only/i);
  assert.match(owner, /macOS Keychain/);
  assert.match(ownerStyles, /body\[data-owner-provisioning-only\][\s\S]*\.new-owner-card:not\(\[aria-label="Backstage enrollment"\]\)[\s\S]*display:\s*none !important/);
  assert.match(ownerScript, /const provisioningOnly = document\.body\.hasAttribute\("data-owner-provisioning-only"\)/);
  assert.match(ownerScript, /session\?\.canProvisionBackstage/);
  assert.match(hiddenActions, /get enabled\(\) \{[\s\S]*return cullingEnabled\(\)/);
  assert.match(hiddenActions, /Boolean\(localEnabled && isHostedOwnerSurface\(\) && pbeOwnerSession\?\.isReady\?\.\(\)\)/);
  assert.doesNotMatch(hiddenActions, /actionKind: "owner-hidden-metadata"/);
  assert.match(hiddenActions, /metadataFor/);
  assert.doesNotMatch(hiddenActions, /restoreTitles = Object\.fromEntries/);
  assert.match(hiddenActions, /photoAction\("waste-basket-restore", ids\[0\], \{ photo_ids: ids/);
  assert.match(hidden, /window\.photosByElieHiddenActionsReady/);
  assert.match(review, /data-hidden-restore-selected/);
  assert.doesNotMatch(review, /data-hidden-discard-selected/);
  assert.match(review, /data-hidden-empty/);
  assert.match(review, /Shift[\s\S]*Arrows[\s\S]*select range/);
  assert.match(hidden, /const restorePhotoIds = async/);
  assert.match(hidden, /await restorePhotoIds\(\[selected\.id\]\)/);
  assert.match(hidden, /photosByElieOwnerActivity\?\.hold\?\.\("waste-basket"\)/);
  assert.match(ownerScript, /photosByElieOwnerActivity\?\.hold\?\.\("owner-job", connectorId\)/);
  assert.match(ownerScript, /ownerApiPath\("\/actions"\)/);
  assert.match(ownerScript, /actionKind:\s*action/);
  assert.match(ownerScript, /"idempotency-key"/);
  assert.match(accessConsole, /\/api\/v1\/acs/);
  assert.match(accessConsole, /"idempotency-key"/);
  assert.match(ownerActivity, /document\.visibilityState === "hidden"/);
  assert.match(ownerActivity, /\/api\/v1\/owner\/interactive/);
  assert.match(ownerActivity, /setInterval\(touch, 10000\)/);
  assert.doesNotMatch(owner, /owner-activity\.js/);
  assert.match(reviewHtml, /owner-activity\.js/);
  assert.match(hidden, /galleryKey: `expo\/\$\{photoId\}_900\.jpg`/);
  assert.match(hidden, /detailKey: `expo\/\$\{photoId\}_1800\.jpg`/);
  assert.match(hidden, /metadata\.title \|\| "Untitled photo"/);
  assert.doesNotMatch(hidden, /const discardPhotoIds = async/);
  assert.match(hidden, /const extendKeyboardSelection =/);
  assert.match(hidden, /moveKeyboardFocus\(selectedIndex \+ 1, \{ extend: event\.shiftKey \}\)/);
  assert.doesNotMatch(hiddenActions, /for \(const photoId of ids\).*waste-basket-restore/s);
  assert.match(hiddenActions, /await photoAction\("waste-basket-restore", ids\[0\], \{ photo_ids: ids/);
  assert.match(ownerScript, /grid\.prepend\(wasteBasketCard\)/);
  assert.match(ownerScript, /details\.open = isPrimaryAction \|\| isWasteBasket/);
  assert.match(ownerStyles, /\.new-owner-card\[aria-label="Waste Basket"\]\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;/);
  assert.match(owner, /aria-label="Backstage enrollment"/);
  assert.match(owner, /data-owner-writer="backstage"/);
  assert.match(owner, /aria-label="Backstage writer status"/);
  assert.match(owner, /data-web-owner-mutation-surface/);
  assert.match(owner, /data-backstage-enroll-create/);
  assert.match(owner, /data-backstage-enroll-code/);
  assert.match(ownerScript, /ownerApiPath\("\/devices"\)/);
  assert.match(ownerScript, /encodeBackstageEnrollment/);
  assert.match(ownerScript, /navigator\.clipboard\.writeText\(code\)/);
  assert.match(ownerScript, /const nativeOwnerCutover = document\.body\.dataset\.ownerWriter === "backstage"/);
  assert.match(ownerScript, /if \(!nativeOwnerCutover && ownerAllowed\(\) && effectiveConnectorId\(\)/);
  assert.match(ownerScript, /if \(!nativeOwnerCutover\) \{[\s\S]*data-fixture-create/);
  assert.match(ownerStyles, /body\[data-owner-writer="backstage"\] \[data-web-owner-mutation-surface\]\s*\{[\s\S]*display:\s*none !important;/);
});
