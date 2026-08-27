import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const customerPages = [
  "index.html",
  "gallery.html",
  "photo.html",
  "basket.html",
  "liked.html",
  "order.html",
  "support.html",
];

test("customer pages do not expose or load browser Owner capability", () => {
  for (const page of customerPages) {
    const html = read(page);
    assert.doesNotMatch(html, /href=["'][^"']*owner(?:-review)?\.html/i, page);
    assert.doesNotMatch(html, /(?:owner-auth|owner-tools|pbe-owner-session|hidden-actions|hidden-store)\.js/i, page);
    assert.doesNotMatch(html, /data-owner-tools(?:[\s=>])/i, page);
  }
});

test("retired hosted Owner URLs fail closed into customer-only URLs", () => {
  const gallery = read("photo-gallery.js");
  const detail = read("photo-detail.js");
  const sharedGallery = read("shared-gallery-store.js");
  assert.match(gallery, /requestedGalleryKey === pbeOwnerGalleryKey[\s\S]*gallery\.html[\s\S]*gallery["'], ["']selection["'][\s\S]*location\.replace/);
  assert.match(detail, /isRequestedPBEOwnerCollection[\s\S]*params\.delete\(["']gallery["']\)[\s\S]*photo\.html[\s\S]*location\.replace/);
  assert.match(sharedGallery, /photosByEliePageReady = async \(\) => \{[\s\S]*photosByElieCatalogReady[\s\S]*photosByElieSharedGalleryReady[\s\S]*mode: "public"/);
});

test("restricted Backstage recovery stays unlinked and provisioning-only", () => {
  const owner = read("owner.html");
  const provisioning = read("backstage-provisioning.js");
  assert.match(owner, /meta name="robots" content="noindex,nofollow"/);
  assert.match(owner, /data-owner-provisioning-only(?:[\s>])/);
  assert.match(owner, /aria-label="Backstage enrollment"/);
  assert.match(owner, /data-backstage-enroll-create/);
  assert.match(owner, /data-backstage-devices-refresh/);
  assert.match(owner, /backstage-provisioning\.js/);
  assert.doesNotMatch(owner, /new-owner\.js|data-web-owner-mutation-surface|Build a Fixture|Waste Basket|Owner action queue|Apple Photos Real Estate intake/);
  assert.match(provisioning, /canProvisionBackstage === true/);
  assert.match(provisioning, /\/devices\/\$\{encodeURIComponent\(device\.id\)\}\/revoke/);
  assert.doesNotMatch(provisioning, /fixture|culling|review|upload|publish|owner action/i);
});

test("Backstage exposes only the neutral customer preview browser action", () => {
  const fixturePicker = read("native/PhotosByElieBackstage/Sources/BackstageApp/FixturePicker.swift");
  const culling = read("native/PhotosByElieBackstage/Sources/BackstageApp/CullingView.swift");
  assert.doesNotMatch(fixturePicker, /Open PBE Owner|launchPBEOwner|End PBE Owner|pbeOwnerFixtureSession/);
  assert.match(culling, /Button\("View as customer"[\s\S]*viewSelectedPhotoAsCustomer/);
  assert.match(culling, /without creating an Owner session/);
});

test("bookmarked browser Owner workspaces are inert retirement notices", () => {
  const retiredPages = [
    ["owner-review.html", "Review moved to Backstage"],
    ["sidecar.html", "Sidecar moved to Backstage"],
    ["access-console.html", "Access management moved to Backstage"],
  ];
  for (const [page, heading] of retiredPages) {
    const html = read(page);
    assert.match(html, /meta name="robots" content="noindex,nofollow"/, page);
    assert.match(html, new RegExp(`<h1>${heading}</h1>`), page);
    assert.doesNotMatch(html, /<script\b|owner\.html|data-(?:owner|sidecar|acs)-|owner-(?:review|auth|tools)|sidecar\.js|access-console\.js/i, page);
  }
});

test("the connector cannot start a browser Owner helper in normal operation", () => {
  const connector = read("scripts/new_owner_connector.py");
  assert.match(connector, /PBE_ENABLE_LEGACY_BROWSER_OWNER/);
  assert.match(connector, /if not LEGACY_BROWSER_OWNER_ENABLED:[\s\S]*Browser Waste Basket is retired/);
  assert.match(connector, /parsed\.path == LOCAL_WASTE_BASKET_OPEN_PATH[\s\S]*send_response\(410\)/);
});
