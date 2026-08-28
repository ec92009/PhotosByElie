import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("hosted PBE culling waits for Backstage and uses only the local Waste Basket gateway", () => {
  const hidden = read("hidden-actions.js");
  const gallery = read("photo-gallery.js");
  const detail = read("photo-detail.js");
  const session = read("pbe-owner-session.js");
  assert.match(hidden, /pbeOwnerSession\?\.isReady\?\.\(\)/);
  assert.match(hidden, /if \(isHostedOwnerSurface\(\)\) await window\.photosByEliePBEOwnerSessionReady/);
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
  assert.match(gallery, /ownerEditable: false/);
  assert.match(gallery, /const selectOwnerPhotoFromPointer =/);
  assert.match(gallery, /event\.shiftKey && anchorIndex >= 0/);
  assert.match(gallery, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(gallery, /const extendOwnerKeyboardSelection =/);
  assert.match(gallery, /if \(extend\) \{\s*extendOwnerKeyboardSelection\(photos, nextIndex\);/);
  assert.match(gallery, /stepGallerySelection\(delta, !horizontal, \{ extend: event\.shiftKey \}\)/);
  assert.match(gallery, /const focusedControlOwnsGalleryKey = \(target, key\) => \{/);
  assert.match(gallery, /target\.tagName === "BUTTON" && \[" ", "Spacebar", "Enter"\]\.includes\(key\)/);
  assert.doesNotMatch(gallery, /\["INPUT", "TEXTAREA", "SELECT", "BUTTON"\]\.includes\(target\.tagName\)/);
  assert.match(gallery, /if \(focusedControlOwnsGalleryKey\(target, event\.key\)\) return;/);
  assert.match(gallery, /syncGallerySelectionToolbar\(\)/);
  assert.match(gallery, /await window\.photosByEliePageReady\(\)/);
  assert.match(detail, /await window\.photosByEliePageReady\(\)/);
  assert.match(session, /if \(ownerSurface\) \{[\s\S]*await window\.photosByEliePBEOwnerSessionReady;[\s\S]*await window\.photosByElieHiddenActionsReady/);
  assert.match(gallery, /data-owner-cull-count/);
  assert.doesNotMatch(gallery, /data-owner-cull-select-visible/);
  assert.doesNotMatch(gallery, /data-owner-cull-hide/);
  assert.doesNotMatch(gallery, /data-owner-cull-undo/);
  assert.match(gallery, /id: "waste-basket"[\s\S]*shortcut: "x"[\s\S]*moveOwnerSelectionToWasteBasket/);
  assert.match(gallery, /id: "unpick"[\s\S]*shortcut: "u"/);
  assert.match(gallery, /hiddenOnly \? "Unhide" : pickedOnly \? "Unpick" : "Clear decisions"/);
  assert.match(gallery, /id: "undo"[\s\S]*shortcut: commandShortcut\("z", \{ primary: true \}\)[\s\S]*undoLastOwnerCommand/);
  assert.match(gallery, /moveOwnerSelectionToWasteBasket/);
  assert.doesNotMatch(gallery, /data-owner-cull-touch-hide|data-owner-cull-touch-undo/);
  assert.doesNotMatch(read("gallery.html"), /data-owner-cull-touch-actions/);
  assert.match(read("gallery.html"), /gallery-commands\.js[\s\S]*photo-gallery\.js/);
  assert.match(read("scripts/pbe_owner_host_tracked_paths.txt"), /^gallery-commands\.js$/m);
  assert.match(read("photos.css"), /\.gallery-command-bar/);
});

test("photo detail and preview omit debugging-only metadata", () => {
  const detail = read("photo-detail.js");
  const html = read("photo.html");
  const photos = read("photos.js");
  for (const label of ["metadata title", "origin", "camera", "lens", "exposure", "focal length", "original file"]) {
    assert.match(detail, new RegExp(`"${label}"`));
  }
  assert.doesNotMatch(html, /data-photo-info-toggle/);
  assert.match(
    photos,
    /"Keywords",\s*"Captured",\s*\.\.\.\(owner \? \["Camera", "Lens", "Exposure", "Focal length", "Original file"\] : \[\]\),\s*"Original size",\s*"Location"/,
  );
  assert.doesNotMatch(
    photos,
    /"Keywords",\s*"Captured",\s*"Camera",\s*"Lens",\s*"Exposure",\s*"Focal length",\s*"Original file"/,
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

test("browser Owner is setup-only and operational workspaces are retired", () => {
  const owner = read("owner.html");
  const provisioning = read("backstage-provisioning.js");
  const retiredPages = [read("owner-review.html"), read("sidecar.html"), read("access-console.html")];

  assert.match(owner, /data-owner-provisioning-only(?:[\s>])/);
  assert.match(owner, /Restricted recovery/);
  assert.match(owner, /Setup only/);
  assert.match(owner, /macOS Keychain/);
  assert.match(owner, /aria-label="Backstage enrollment"/);
  assert.match(owner, /data-backstage-enroll-create/);
  assert.match(owner, /data-backstage-enroll-code/);
  assert.match(owner, /backstage-provisioning\.js/);
  assert.doesNotMatch(owner, /new-owner\.js|owner-activity\.js|data-web-owner-mutation-surface|Build a Fixture|Waste Basket|Owner action queue/);
  assert.match(provisioning, /canProvisionBackstage === true/);
  assert.match(provisioning, /ownerPath\("\/devices"\)/);
  assert.match(provisioning, /encodeEnrollment/);
  assert.match(provisioning, /navigator\.clipboard\.writeText\(code\)/);
  assert.match(provisioning, /\/devices\/\$\{encodeURIComponent\(device\.id\)\}\/revoke/);
  for (const page of retiredPages) {
    assert.match(page, /Browser workflow retired/);
    assert.doesNotMatch(page, /<script\b|owner\.html|data-(?:owner|sidecar|acs)-/i);
  }
});
