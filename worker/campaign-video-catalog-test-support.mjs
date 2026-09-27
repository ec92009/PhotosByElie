import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCurrentPublicCatalogReader } from "./campaign-video-catalog.mjs";

/** Create a disposable synthetic public projection, never a real catalog write. */
export function catalogBytes(ids, { omit = [], scope = "public", type = "photo", origin = "camera", missingPreview = false,
  description = "synthetic", alter } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pbe-video-catalog-test-"));
  const path = join(directory, "fixture.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT, title TEXT, description TEXT, scope TEXT);
      CREATE TABLE media_types (media_type_id INTEGER PRIMARY KEY, code TEXT);
      CREATE TABLE source_origins (source_origin_id INTEGER PRIMARY KEY, code TEXT);
      CREATE TABLE formats (format_id INTEGER PRIMARY KEY, extension TEXT);
      CREATE TABLE asset_types (asset_type_id INTEGER PRIMARY KEY, code TEXT);
      CREATE TABLE media_items (media_id TEXT PRIMARY KEY, collection_id INTEGER, sort_index INTEGER, media_type_id INTEGER,
        camera_id INTEGER, lens_id INTEGER, title TEXT, description TEXT, keyword_ids TEXT, source_origin_id INTEGER) WITHOUT ROWID;
      CREATE TABLE media_assets (media_id TEXT, asset_type_id INTEGER, width INTEGER, height INTEGER,
        duration_seconds REAL, bytes INTEGER, format_id INTEGER, PRIMARY KEY(media_id,asset_type_id)) WITHOUT ROWID;
      INSERT INTO formats VALUES (1,'jpg');
      INSERT INTO asset_types VALUES (1,'still_900'),(2,'still_1800');
    `);
    db.prepare("INSERT INTO collections VALUES (1,'expo','Test','Synthetic',?)").run(scope);
    db.prepare("INSERT INTO media_types VALUES (1,?)").run(type);
    db.prepare("INSERT INTO source_origins VALUES (1,?)").run(origin);
    for (const [i, id] of ids.entries()) {
      if (omit.includes(id)) continue;
      db.prepare("INSERT INTO media_items VALUES (?,1,?,1,NULL,NULL,'Test',?,'',1)").run(id, i, description);
      db.prepare("INSERT INTO media_assets VALUES (?,1,900,600,NULL,20,1)").run(id);
      if (!missingPreview) db.prepare("INSERT INTO media_assets VALUES (?,2,1800,1200,NULL,40,1)").run(id);
    }
    alter?.(db);
    db.close();
    return readFileSync(path);
  } finally { if (db.isOpen) db.close(); rmSync(directory, { recursive: true }); }
}

export function catalogResponse(bytes, headers = {}) {
  return new Response(bytes, { headers: { "content-type": "application/octet-stream", "date": new Date().toUTCString(),
    "age": "0", "content-length": String(bytes.length), ...headers } });
}

/** Mutable test origin; the production reader itself never caches or takes caller URLs. */
export function catalogOrigin(bytes) {
  const origin = { bytes, calls: [], headers: {}, beforeRead: null,
    async fetch(url, init) {
      this.calls.push({ url, init });
      await this.beforeRead?.(this.calls.length);
      return catalogResponse(this.bytes, this.headers);
    } };
  origin.reader = createCurrentPublicCatalogReader({ fetchImpl: origin.fetch.bind(origin) });
  return origin;
}
