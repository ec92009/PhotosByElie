import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const photoIds = ["authority-camera-a", "authority-camera-b"];

const runValidator = (root, args = []) => childProcess.spawnSync(
  process.execPath,
  [path.join(root, "scripts", "validate_publish.js"), "--external-media", ...args],
  {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    // An ambient production Owner path must never enter a disposable fixture.
    env: { ...process.env, PHOTOSBYELIE_OWNER_DB: "", PYTHONDONTWRITEBYTECODE: "1" },
  },
);

const combinedOutput = (result) => `${result.stdout || ""}${result.stderr || ""}`;
const sha256 = (target) => crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");

/** Exercise the real validator/decoder against one coherent, synthetic projection. */
const makeFixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-owner-authority-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "assets", "catalog"), { recursive: true });
  for (const file of ["scripts/validate_publish.js", "scripts/catalog_tsv.cjs",
    "scripts/public_catalog_policy.py", "scripts/owner_state_db.py", "catalog-sqlite.js", "photos-data.js"]) {
    fs.copyFileSync(path.join(repoRoot, file), path.join(root, file));
  }
  const catalog = path.join(root, "assets", "catalog", "photosbyelie.sqlite");
  childProcess.execFileSync("python3", ["-c", String.raw`
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.executescript("""
CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT, title TEXT, description TEXT, scope TEXT, sort_order INTEGER);
CREATE TABLE media_types (media_type_id INTEGER PRIMARY KEY, code TEXT);
CREATE TABLE source_origins (source_origin_id INTEGER PRIMARY KEY, code TEXT);
CREATE TABLE formats (format_id INTEGER PRIMARY KEY, extension TEXT);
CREATE TABLE asset_types (asset_type_id INTEGER PRIMARY KEY, code TEXT);
CREATE TABLE media_items (media_id TEXT PRIMARY KEY, collection_id INTEGER, sort_index INTEGER, media_type_id INTEGER,
  camera_id INTEGER, lens_id INTEGER, title TEXT, description TEXT, keyword_ids TEXT, source_origin_id INTEGER) WITHOUT ROWID;
CREATE TABLE media_assets (media_id TEXT, asset_type_id INTEGER, width INTEGER, height INTEGER,
  duration_seconds REAL, bytes INTEGER, format_id INTEGER, PRIMARY KEY(media_id, asset_type_id)) WITHOUT ROWID;
INSERT INTO collections VALUES (1, 'expo', 'Authority fixture', 'Synthetic camera photos', 'public', 1);
INSERT INTO media_types VALUES (1, 'photo');
INSERT INTO source_origins VALUES (1, 'camera');
INSERT INTO formats VALUES (1, 'jpg');
INSERT INTO asset_types VALUES (1, 'still_900'), (2, 'still_1800'), (3, 'full');
""")
for index, media_id in enumerate(json.loads(sys.argv[2])):
    conn.execute("INSERT INTO media_items VALUES (?, 1, ?, 1, NULL, NULL, 'Reviewed camera photo', '', '', 1)", (media_id, index))
    conn.executemany("INSERT INTO media_assets VALUES (?, ?, ?, ?, NULL, 100, 1)",
      [(media_id, 1, 900, 600), (media_id, 2, 1800, 1200), (media_id, 3, 6000, 4000)])
conn.commit()
conn.close()
`, catalog, JSON.stringify(photoIds)]);
  const photos = Object.fromEntries(photoIds.map((id) => [id, {
    collectionKey: "expo",
    publicPreview: { galleryKey: `expo/${id}_900.jpg`, detailKey: `expo/${id}_1800.jpg` },
  }]));
  fs.writeFileSync(path.join(root, "assets", "media-sidecar.json"), JSON.stringify({ photosCount: photoIds.length, photos }));
  // No legacy Expo approvals: eligibility must come from the tested Owner rows.
  fs.writeFileSync(path.join(root, "assets", "expo-manifest.json"), JSON.stringify({ photos: [] }));
  fs.writeFileSync(path.join(root, "assets", "catalog", "product-pricing.json"), JSON.stringify({
    products: [{ id: "original", label: "Original", price: 10 }],
  }));
  const home = { expo: { count: photoIds.length, photos: photoIds.map((id) => ({ id, media: { publicPreview: photos[id].publicPreview } })) } };
  fs.writeFileSync(path.join(root, "home-data.js"), `window.photosByElieHomeData = ${JSON.stringify(home)};`);
  fs.writeFileSync(path.join(root, "gallery.html"), "<!doctype html><title>Synthetic gallery</title>");
  return { root, catalog, ownerDb: path.join(root, "Owner.sqlite") };
};

/** Populate only the disposable authority; never clone or open the real Owner. */
const makeOwnerAuthority = (target, catalog, includeCatalogIds) => {
  const source = String.raw`
import sqlite3, sys
owner_path, catalog_path, include_catalog = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
conn = sqlite3.connect(owner_path)
conn.executescript("""
CREATE TABLE title_keyword_queue (media_id TEXT, latest_attempt INTEGER, review_state TEXT);
CREATE TABLE title_keyword_decisions (media_id TEXT, attempt INTEGER, decision_state TEXT, applied_at TEXT);
CREATE TABLE media_lifecycle (
  media_id TEXT PRIMARY KEY, lifecycle_state TEXT, previous_slug TEXT, source_slug TEXT,
  title TEXT, media_type TEXT, source_paths_json TEXT, public_preview_keys_json TEXT,
  private_keys_json TEXT, hidden_at TEXT, discarded_at TEXT, restored_at TEXT, updated_at TEXT
);
""")
if include_catalog:
    catalog = sqlite3.connect(f"file:{catalog_path}?mode=ro&immutable=1", uri=True)
    ids = [row[0] for row in catalog.execute("SELECT media_id FROM media_items")]
    conn.executemany("INSERT INTO title_keyword_queue VALUES (?, 1, 'applied')", ((value,) for value in ids))
    conn.executemany("INSERT INTO title_keyword_decisions VALUES (?, 1, 'accepted', 'reviewed')", ((value,) for value in ids))
conn.commit()
conn.close()
`;
  childProcess.execFileSync("python3", ["-c", source, target, catalog, includeCatalogIds ? "1" : "0"]);
};

test("publication validation fails once when Owner authority is omitted", (t) => {
  const { root } = makeFixture(t);
  const result = runValidator(root);
  const output = combinedOutput(result);
  assert.equal(result.status, 1);
  assert.equal((output.match(/Owner authority missing\/stale/g) || []).length, 1);
  assert.match(output, /--owner-db or PHOTOSBYELIE_OWNER_DB/);
});

test("publication validation aggregates under-covered Owner authority", (t) => {
  const { root, catalog, ownerDb } = makeFixture(t);
  makeOwnerAuthority(ownerDb, catalog, false);
  const before = sha256(ownerDb);
  const result = runValidator(root, ["--owner-db", ownerDb]);
  const output = combinedOutput(result);

  assert.equal(result.status, 1);
  assert.equal((output.match(/Owner authority missing\/stale/g) || []).length, 1);
  assert.match(output, /2 public media IDs lack reviewed eligibility/);
  assert.doesNotMatch(output, /is not Owner-applied for public title\/keyword visibility/);
  assert.equal(sha256(ownerDb), before);
});

test("publication validation accepts and fingerprints reviewed Owner authority", (t) => {
  const { root, catalog, ownerDb } = makeFixture(t);
  makeOwnerAuthority(ownerDb, catalog, true);
  const ownerHash = sha256(ownerDb);
  const catalogHash = sha256(catalog);
  const beforeStat = fs.statSync(ownerDb, { bigint: true });
  const result = runValidator(root, ["--owner-db", ownerDb]);
  const output = combinedOutput(result);
  const afterStat = fs.statSync(ownerDb, { bigint: true });

  assert.equal(result.status, 0, output);
  assert.match(output, new RegExp(`Owner DB SHA-256: ${ownerHash}`));
  assert.match(output, new RegExp(`Catalog DB SHA-256: ${catalogHash}`));
  assert.match(output, /Validation OK/);
  assert.equal(sha256(ownerDb), ownerHash);
  assert.equal(sha256(catalog), catalogHash);
  assert.equal(afterStat.size, beforeStat.size);
  assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
});

test("publication validation still rejects sidecar drift despite reviewed authority", (t) => {
  const { root, catalog, ownerDb } = makeFixture(t);
  makeOwnerAuthority(ownerDb, catalog, true);
  const target = path.join(root, "assets", "media-sidecar.json");
  const sidecar = JSON.parse(fs.readFileSync(target, "utf8"));
  delete sidecar.photos[photoIds[1]];
  sidecar.photosCount -= 1;
  fs.writeFileSync(target, JSON.stringify(sidecar));
  const result = runValidator(root, ["--owner-db", ownerDb]);
  assert.equal(result.status, 1);
  assert.match(combinedOutput(result), /photosCount is 1; expected 2/);
  assert.match(combinedOutput(result), /authority-camera-b is missing from assets\/media-sidecar.json/);
});

test("publication validation still rejects home count drift despite reviewed authority", (t) => {
  const { root, catalog, ownerDb } = makeFixture(t);
  makeOwnerAuthority(ownerDb, catalog, true);
  fs.writeFileSync(path.join(root, "home-data.js"), "window.photosByElieHomeData = {expo: {count: 0, photos: []}};");
  const result = runValidator(root, ["--owner-db", ownerDb]);
  assert.equal(result.status, 1);
  assert.match(combinedOutput(result), /home-data.js expo count does not match the SQLite-backed public catalog/);
});

test("publication validation still denies hidden media despite reviewed authority", (t) => {
  const { root, catalog, ownerDb } = makeFixture(t);
  makeOwnerAuthority(ownerDb, catalog, true);
  childProcess.execFileSync("python3", ["-c", String.raw`
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO media_lifecycle (media_id, lifecycle_state) VALUES (?, 'hidden')", (sys.argv[2],))
conn.commit()
conn.close()
`, ownerDb, photoIds[1]]);
  const before = sha256(ownerDb);
  const result = runValidator(root, ["--owner-db", ownerDb]);
  assert.equal(result.status, 1);
  assert.match(combinedOutput(result), /authority-camera-b is hidden\/discarded and must not be in the public catalog/);
  assert.equal(sha256(ownerDb), before);
});
