import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const validator = path.join(repoRoot, "scripts", "validate_publish.js");
const catalog = path.join(repoRoot, "assets", "catalog", "photosbyelie.sqlite");

const runValidator = (args = []) => childProcess.spawnSync(
  process.execPath,
  [validator, "--external-media", ...args],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const combinedOutput = (result) => `${result.stdout || ""}${result.stderr || ""}`;
const sha256 = (target) => crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");

const makeOwnerAuthority = (target, includeCatalogIds) => {
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

test("publication validation fails once when Owner authority is omitted", () => {
  const result = runValidator();
  const output = combinedOutput(result);
  assert.equal(result.status, 1);
  assert.equal((output.match(/Owner authority missing\/stale/g) || []).length, 1);
  assert.match(output, /--owner-db or PHOTOSBYELIE_OWNER_DB/);
});

test("publication validation aggregates under-covered Owner authority", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-owner-authority-stale-"));
  try {
    const ownerDb = path.join(root, "Owner.sqlite");
    makeOwnerAuthority(ownerDb, false);
    const before = sha256(ownerDb);
    const result = runValidator(["--owner-db", ownerDb]);
    const output = combinedOutput(result);

    assert.equal(result.status, 1);
    assert.equal((output.match(/Owner authority missing\/stale/g) || []).length, 1);
    assert.match(output, /public media IDs lack reviewed eligibility/);
    assert.doesNotMatch(output, /is not Owner-applied for public title\/keyword visibility/);
    assert.equal(sha256(ownerDb), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publication validation accepts and fingerprints reviewed Owner authority", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-owner-authority-reviewed-"));
  try {
    const ownerDb = path.join(root, "Owner.sqlite");
    makeOwnerAuthority(ownerDb, true);
    const ownerHash = sha256(ownerDb);
    const catalogHash = sha256(catalog);
    const beforeStat = fs.statSync(ownerDb, { bigint: true });
    const result = runValidator(["--owner-db", ownerDb]);
    const output = combinedOutput(result);
    const afterStat = fs.statSync(ownerDb, { bigint: true });

    assert.equal(result.status, 0, output);
    assert.match(output, new RegExp(`Owner DB SHA-256: ${ownerHash}`));
    assert.match(output, new RegExp(`Catalog DB SHA-256: ${catalogHash}`));
    assert.match(output, /Validation OK/);
    assert.equal(sha256(ownerDb), ownerHash);
    assert.equal(afterStat.size, beforeStat.size);
    assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
