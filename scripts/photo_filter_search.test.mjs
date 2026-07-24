import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "photos.js"), "utf8");
const start = source.indexOf("window.photosByEliePhotoFilter = (() => {");
const endMarker = "\n})();";
const end = source.indexOf(endMarker, start);

assert.notEqual(start, -1, "photo filter module should exist");
assert.notEqual(end, -1, "photo filter module should close");

const sandbox = { window: {} };
vm.runInNewContext(source.slice(start, end + endMarker.length), sandbox);
const filter = sandbox.window.photosByEliePhotoFilter;

test("place search keeps useful typo tolerance without matching shorter unrelated names", () => {
  assert.equal(
    filter.matchesSearchTerms(
      { title: "Paris Panorama Near Hotel de Ville" },
      { query: "seville" },
    ),
    false,
  );
  assert.equal(
    filter.matchesSearchTerms(
      { title: "Place de l'Hotel de Ville Panorama, Paris" },
      { query: "seville" },
    ),
    false,
  );
  assert.equal(filter.matchesSearchTerms({ title: "Sevilla" }, { query: "seville" }), true);
  assert.equal(filter.matchesSearchTerms({ title: "Seville Cathedral" }, { query: "sevile" }), true);
});
