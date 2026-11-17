import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCurrentPublicCatalogReader, PUBLIC_CATALOG_URL } from "./campaign-video-catalog.mjs";
import { MAX_CATALOG_BYTES, readPublicCatalogStills } from "./campaign-video-sqlite.mjs";
import { catalogBytes, catalogOrigin, catalogResponse } from "./campaign-video-catalog-test-support.mjs";
import { apiUrl, publicUrl, authHeaders, declaration, fixture } from "./campaign-video-test-support.mjs";

const ids = declaration(8).components.map((c) => c.canonicalMediaId);
const rejects = (action, code) => assert.rejects(action, (error) => error.code === code);
const responseCode = async (response, status, error) => {
  assert.equal(response.status, status);
  const body = await response.json();
  if (error) assert.equal(body.error?.code, error);
  return body;
};

test("strict reader reuses SQLite scalars, handles interior/overflow pages and the existing artifact", () => {
  const many = Array.from({ length: 500 }, (_, i) => `synthetic-${i}`);
  assert.equal(readPublicCatalogStills(catalogBytes(many), many.slice(0, 8)).photos.size, 8);
  assert.equal(readPublicCatalogStills(catalogBytes(ids, { description: "é".repeat(15000) }), ids).photos.size, 8);
  // Read the existing projection only; no real row values are printed or written.
  assert.equal(readPublicCatalogStills(readFileSync(new URL("../assets/catalog/photosbyelie.sqlite", import.meta.url)), ids).photos.size, 0);
});

test("only exact public camera stills with both JPEG preview rows qualify", () => {
  assert.equal(readPublicCatalogStills(catalogBytes(ids), ids).photos.size, 8);
  for (const options of [{ scope: "owner" }, { scope: null }, { type: "video" }, { origin: "ai" }, { missingPreview: true }]) {
    assert.equal(readPublicCatalogStills(catalogBytes(ids, options), ids).photos.size, 0);
  }
});

test("malformed schema, truncated bytes, page cycles and invalid record bounds fail closed", () => {
  const bytes = catalogBytes(ids);
  const cycle = Buffer.from(bytes); cycle[100] = 5; cycle.writeUInt16BE(0, 103); cycle.writeUInt16BE(4096, 105); cycle.writeUInt32BE(1, 108);
  const corrupt = Buffer.from(bytes); corrupt.writeUInt32BE(0xffffffff, 28);
  const wrongSchema = catalogBytes(ids, { alter(db) { db.exec("ALTER TABLE media_types RENAME COLUMN code TO secret"); } });
  for (const value of [bytes.subarray(0, bytes.length - 1), Buffer.alloc(512), cycle, corrupt, wrongSchema]) {
    assert.throws(() => readPublicCatalogStills(value, ids), (error) => error.code === "campaign_video_catalog_invalid");
  }
});

test("fixed HTTPS origin is freshly fetched with no credentials, redirect or cache fallback", async () => {
  const origin = catalogOrigin(catalogBytes(ids));
  const first = await origin.reader.read(ids);
  await origin.reader.read(ids, first.sha256);
  assert.equal(origin.calls.length, 2);
  for (const { url, init } of origin.calls) {
    assert.equal(url, PUBLIC_CATALOG_URL); assert.equal(init.redirect, "manual"); assert.equal(init.cache, "no-store");
    assert.equal(init.headers["accept-encoding"], "identity"); assert.match(init.headers["cache-control"], /no-cache/);
    assert.equal(init.headers.authorization, undefined); assert.equal(init.headers.cookie, undefined);
  }
  origin.headers.age = "1";
  await rejects(() => origin.reader.read(ids), "campaign_video_catalog_unavailable");
});

test("freshness, status, encoding, type and both declared/actual byte bounds are enforced", async () => {
  const bytes = catalogBytes(ids);
  const badHeaders = [ { date: new Date(Date.now() - 60000).toUTCString() }, { date: "invalid" }, { age: "12" },
    { "content-type": "text/html" }, { "content-encoding": "gzip" }, { "content-range": "bytes 0-1/100" },
    { "content-length": String(MAX_CATALOG_BYTES + 1) }, { "content-length": "512" }, { "content-length": String(bytes.length + 1) } ];
  for (const headers of badHeaders) {
    const reader = createCurrentPublicCatalogReader({ fetchImpl: async () => catalogResponse(bytes, headers) });
    await rejects(() => reader.read(ids), "campaign_video_catalog_unavailable");
  }
  for (const status of [301, 304, 404, 503]) {
    const reader = createCurrentPublicCatalogReader({ fetchImpl: async () => new Response(null, { status }) });
    await rejects(() => reader.read(ids), "campaign_video_catalog_unavailable");
  }
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_CATALOG_BYTES + 1)); }, cancel() { cancelled = true; } });
  const reader = createCurrentPublicCatalogReader({ fetchImpl: async () => new Response(body, {
    headers: { "content-type": "application/octet-stream", date: new Date().toUTCString() },
  }) });
  await rejects(() => reader.read(ids), "campaign_video_catalog_unavailable");
  assert.equal(cancelled, true);
});

test("catalog additions and removals take effect on the same host instance, without deployment", async () => {
  const binding = declaration(8);
  const complete = catalogBytes(ids);
  const absent = catalogBytes(ids, { omit: [ids[0]] });
  const origin = catalogOrigin(absent);
  const f = fixture(binding, { catalogReader: origin.reader });
  await responseCode(await f.reserve(), 410, "campaign_video_component_ineligible");
  origin.bytes = complete;
  const reserved = await responseCode(await f.reserve(), 200);
  await responseCode(await f.upload(reserved), 200);
  const response = await f.fetch(publicUrl); assert.equal(response.status, 200); await response.arrayBuffer();
  origin.bytes = absent;
  for (const method of ["GET", "HEAD"]) await responseCode(await f.fetch(publicUrl, { method }), 410);
  await responseCode(await f.fetch(apiUrl, { headers: authHeaders }), 410);
  origin.bytes = complete; origin.headers.age = "45";
  await responseCode(await f.fetch(publicUrl), 503, "campaign_video_catalog_unavailable");
  assert.equal(f.bucket.puts, 1);
});

test("catalog revision changes before PUT and between public checks do not serve or write", async () => {
  const origin = catalogOrigin(catalogBytes(ids));
  const f = fixture(declaration(8), { catalogReader: origin.reader });
  const reserved = await responseCode(await f.reserve(), 200);
  const changed = catalogBytes(ids, { description: "a new publication revision" });
  f.bucket.onHead = () => { origin.bytes = changed; };
  await responseCode(await f.upload(reserved), 409, "campaign_video_catalog_changed");
  assert.equal(f.bucket.puts, 0);
  f.bucket.onHead = null;
  await responseCode(await f.upload(reserved), 200);
  f.bucket.onGet = () => { origin.bytes = catalogBytes(ids); };
  await responseCode(await f.fetch(publicUrl), 409, "campaign_video_catalog_changed");
});

test("EOF eligibility recheck prevents committing private bytes after catalog or lifecycle drift", async () => {
  for (const change of ["catalog", "lifecycle"]) {
    const origin = catalogOrigin(catalogBytes(ids));
    const f = fixture(declaration(8), { catalogReader: origin.reader });
    const reserved = await responseCode(await f.reserve(), 200);
    f.bucket.onPut = () => {
      if (change === "catalog") origin.bytes = catalogBytes(ids, { omit: [ids[0]] });
      else f.lifecycle.denied = true;
    };
    await responseCode(await f.upload(reserved), change === "catalog" ? 409 : 410);
    assert.equal(f.bucket.objects.size, 0);
  }
});

test("catalog freshness cannot expire during slow eligibility checks before reservation", async () => {
  const base = fixture(declaration(8));
  const snapshot = await base.catalogReader.read();
  const f = fixture(declaration(8), { catalogReader: { async read() { return { ...snapshot, expiresAt: 0 }; } } });
  await responseCode(await f.reserve(), 503, "campaign_video_catalog_unavailable");
  assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM pbe_campaign_videos").get().n, 0);
  assert.equal(f.bucket.puts, 0);
});
