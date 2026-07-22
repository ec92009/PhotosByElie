import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public Owner culling waits for cloud auth and uses the Max connector queue", () => {
  const hidden = read("hidden-actions.js");
  const gallery = read("photo-gallery.js");
  const detail = read("photo-detail.js");
  assert.match(hidden, /action:\s*"photo-moderation"/);
  assert.match(hidden, /requestedConnector:\s*"max"/);
  assert.match(hidden, /const markMany = async/);
  assert.match(hidden, /const undoMany = async/);
  assert.match(hidden, /"update-photo-metadata", "save-keyword-blacklist"/);
  assert.match(hidden, /const saveKeywordBlacklist = async/);
  assert.match(hidden, /moderationPayload\[key\] = extra\[key\]/);
  assert.match(hidden, /\["title", "keywords", "mode"\]/);
  assert.doesNotMatch(hidden, /moderationPayload\["restoreTitles"\]/);
  assert.match(hidden, /\/photosbyelie\/wake-owner-action/);
  assert.match(hidden, /body: JSON\.stringify\(\{ actionId \}\)/);
  assert.match(hidden, /const awakened = await tryLocalActionWake\(queued\.action\.id\)/);
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
  assert.match(gallery, /data-owner-cull-select-visible/);
  assert.match(gallery, /data-owner-cull-hide/);
  assert.match(gallery, /data-owner-cull-undo/);
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

test("Owner exposes a contained fixture builder and recoverable Waste Basket manager", () => {
  const owner = read("owner.html");
  const ownerStyles = read("new-owner.css");
  const ownerScript = read("new-owner.js");
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
  assert.match(hiddenActions, /\["hide", "hide-many", "undo-hide", "undo-hide-many", "discard",/);
  assert.match(hiddenActions, /get enabled\(\) \{[\s\S]*return cullingEnabled\(\)/);
  assert.match(hiddenActions, /action: "owner-hidden-metadata"/);
  assert.match(hiddenActions, /if \(remoteCullingEnabled\) refreshRemoteHiddenMetadata\(\)\.catch/);
  assert.match(hiddenActions, /metadataFor/);
  assert.doesNotMatch(hiddenActions, /restoreTitles = Object\.fromEntries/);
  assert.match(hiddenActions, /photoAction\("undo-hide-many", ids\[0\], \{ photo_ids: ids \}\)/);
  assert.match(hidden, /window\.photosByElieHiddenActionsReady/);
  assert.match(review, /data-hidden-restore-selected/);
  assert.match(review, /data-hidden-discard-selected/);
  assert.match(review, /data-hidden-empty/);
  assert.match(review, /Shift[\s\S]*Arrows[\s\S]*select range/);
  assert.match(hidden, /const restorePhotoIds = async/);
  assert.match(hidden, /await restorePhotoIds\(\[selected\.id\]\)/);
  assert.match(hidden, /photosByElieOwnerActivity\?\.hold\?\.\("waste-basket"\)/);
  assert.match(ownerScript, /photosByElieOwnerActivity\?\.hold\?\.\("owner-job", connectorId\)/);
  assert.match(ownerActivity, /document\.visibilityState === "hidden"/);
  assert.match(ownerActivity, /\/owner\/interactive/);
  assert.match(ownerActivity, /setInterval\(touch, 10000\)/);
  assert.match(owner, /owner-activity\.js/);
  assert.match(reviewHtml, /owner-activity\.js/);
  assert.match(hidden, /galleryKey: `expo\/\$\{photoId\}_900\.jpg`/);
  assert.match(hidden, /detailKey: `expo\/\$\{photoId\}_1800\.jpg`/);
  assert.match(hidden, /metadata\.title \|\| "Untitled photo"/);
  assert.match(hidden, /const discardPhotoIds = async/);
  assert.match(hidden, /const extendKeyboardSelection =/);
  assert.match(hidden, /moveKeyboardFocus\(selectedIndex \+ 1, \{ extend: event\.shiftKey \}\)/);
  assert.match(hiddenActions, /if \(localEnabled\) \{[\s\S]*for \(const photoId of ids\) await photoAction\("undo-hide", photoId\);[\s\S]*photoAction\("undo-hide-many"/);
  assert.match(ownerScript, /grid\.prepend\(wasteBasketCard\)/);
  assert.match(ownerScript, /details\.open = isPrimaryAction \|\| isWasteBasket/);
  assert.match(ownerStyles, /\.new-owner-card\[aria-label="Waste Basket"\]\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;/);
});
