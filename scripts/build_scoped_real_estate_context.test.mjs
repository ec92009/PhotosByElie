import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildScopedContext } from "./build_scoped_real_estate_context.mjs";

test("buildScopedContext isolates the requested album and storage namespace", () => {
  const scoped = buildScopedContext({
    sourcePath: path.resolve("assets/real-estate/corine/app-context.js"),
    albumSlug: "common",
    galleryKey: "agnes-la-concha-common",
    customer: "Agnes",
    galleryTitle: "La Concha / Common",
  });

  assert.equal(scoped.gallery.key, "agnes-la-concha-common");
  assert.equal(scoped.customer.name, "Agnes");
  assert.deepEqual(scoped.albums.map((album) => album.slug), ["common"]);
  assert.equal(scoped.photos.length, 14);
  assert.equal(scoped.photos.every((photo) => photo.albumSlug === "common"), true);
  assert.equal(scoped.gallery.photos.length, 14);
  assert.equal(scoped.cloudPdfWorkflow.selectionStoreKey, "photosbyelie-real-estate-liked-agnes-la-concha-common");
  assert.equal(scoped.cloudPdfWorkflow.batchManifest.template.galleryKey, "agnes-la-concha-common");
  assert.equal(scoped.cloudPdfWorkflow.batchManifest.storageKeyPattern, "real-estate/pdf-batches/agnes-la-concha-common/{batchId}.json");
});
