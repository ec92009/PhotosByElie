import assert from "node:assert/strict";
import test from "node:test";
import { catalogOperationId, createPublicCatalogAuthority, validateCatalogTransition } from "./public-catalog-authority.mjs";
import { createPublicCatalogAuthorityApi, CATALOG_AUTHORITY_PATH } from "./public-catalog-authority-api.mjs";
import { createCurrentPublicCatalogReader } from "./campaign-video-catalog.mjs";
import { createOwnerConnectorAuth } from "./owner-connector-auth.mjs";
import { TestD1, hash } from "./campaign-video-test-support.mjs";
import { catalogBytes, catalogResponse } from "./campaign-video-catalog-test-support.mjs";

const bytes = catalogBytes(["media-test"]);
const sha = hash(bytes);
const url = `https://auth.photos-by-elie.com${CATALOG_AUTHORITY_PATH}`;
const headers = { authorization: "Bearer test-token", "content-type": "application/json" };
const rejects = (fn, code) => assert.rejects(fn, (error) => error.code === code);
async function transition(revision = 1, generation = 0, digest = sha, phase = "prepare") {
  return { schema: "photosbyelie.publicCatalogTransition.v1", phase,
    operationId: await catalogOperationId(revision, digest), expectedGeneration: generation,
    projectionRevision: revision, sha256: digest };
}
const commit = (value) => ({ ...value, phase: "commit", expectedGeneration: value.expectedGeneration + 1 });
function fixture() {
  const database = new TestD1();
  const authority = createPublicCatalogAuthority(database);
  const origin = { bytes, calls: 0, before: null, async fetch() {
    this.calls++; await this.before?.(); return catalogResponse(this.bytes, { age: "600" });
  } };
  const api = createPublicCatalogAuthorityApi({ database, enabled: true,
    connectorAuth: createOwnerConnectorAuth({ credentials: { max: "test-token", other: "other-token" } }),
    fetchImpl: origin.fetch.bind(origin) });
  const post = (value) => api.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(value) }));
  const reader = createCurrentPublicCatalogReader({ authority, fetchImpl: origin.fetch.bind(origin) });
  return { database, authority, origin, api, post, reader };
}

test("strict transition schema rejects unbound, unsafe, extra and noninteger inputs", async () => {
  const valid = await transition();
  await validateCatalogTransition(valid);
  for (const value of [null, [], { ...valid, extra: "private-path" }, { ...valid, schema: "other" },
    { ...valid, phase: "reset" }, { ...valid, operationId: "a".repeat(64) }, { ...valid, sha256: "A".repeat(64) },
    { ...valid, sha256: [valid.sha256] }, { ...valid, operationId: [valid.operationId] },
    { ...valid, projectionRevision: 1.1 }, { ...valid, projectionRevision: true },
    { ...valid, expectedGeneration: -1 }, { ...valid, expectedGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, phase: "commit" }]) {
    await rejects(() => validateCatalogTransition(value), "public_catalog_transition_invalid");
  }
});

test("prepare is immutable, publisher-pinned, idempotent and pending until exact commit", async () => {
  const f = fixture(); const value = await transition();
  assert.equal(await f.authority.read(), null);
  const prepared = await f.authority.prepare(value, "max");
  assert.equal(prepared.state, "pending"); assert.equal(prepared.generation, 1);
  assert.deepEqual(await f.authority.prepare(value, "max"), prepared);
  await rejects(() => f.authority.prepare({}, "max"), "public_catalog_transition_invalid");
  await rejects(() => f.authority.prepare(value, "other"), "public_catalog_publisher_mismatch");
  await rejects(() => f.reader.read(["media-test"]), "campaign_video_catalog_unavailable");
  const wrong = await transition(2, 1, "c".repeat(64));
  await rejects(() => f.authority.prepare(wrong, "max"), "public_catalog_authority_conflict");
  const response = await f.post(commit(value)); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).state, "verified");
  assert.equal((await f.post(commit(value))).status, 200);
  assert.equal((await f.authority.prepare(value, "max")).state, "verified");
  assert.ok(f.database.sessions.length >= 10);
  assert.ok(f.database.sessions.every((s) => s === "first-primary"));
});
test("conflicting concurrent preparation has one winner and no last-writer overwrite", async () => {
  const f = fixture();
  const a = await transition(); const b = await transition(1, 0, "b".repeat(64));
  const result = await Promise.allSettled([f.authority.prepare(a, "max"), f.authority.prepare(b, "max")]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(result.find((r) => r.status === "rejected").reason.code, "public_catalog_authority_conflict");
  const winner = await f.authority.read();
  assert.equal(winner.generation, 1);
  assert.equal(winner.operationId, result.find((r) => r.status === "fulfilled").value.operationId);
});

test("monotonic revisions and CAS reject stale writers while loss of commit response safely replays", async () => {
  const f = fixture(); const first = await transition();
  await f.authority.prepare(first, "max");
  const verify = async () => {};
  await f.authority.commit(commit(first), "max", verify);
  const second = await transition(2, 1);
  await f.authority.prepare(second, "max");
  await rejects(() => f.authority.commit(commit(first), "max", verify), "public_catalog_authority_conflict");
  const done = await f.authority.commit(commit(second), "max", verify);
  assert.deepEqual(await f.authority.commit(commit(second), "max", verify), done);
  const backwards = await transition(1, 2);
  await rejects(() => f.authority.prepare(backwards, "max"), "public_catalog_authority_conflict");
});

test("failed public parity keeps authority pending, never granting current eligibility", async () => {
  const f = fixture(); const value = await transition();
  await f.authority.prepare(value, "max");
  f.origin.bytes = catalogBytes(["other-media"]);
  const mismatch = await f.post(commit(value)); assert.equal(mismatch.status, 409);
  assert.equal((await f.authority.read()).state, "pending");
  await rejects(() => f.reader.read(["media-test"]), "campaign_video_catalog_unavailable");
  assert.equal(f.origin.calls, 1);
});

test("aged bytes require current primary authority, full SHA and two stable generation reads", async () => {
  const f = fixture(); const value = await transition();
  await rejects(() => f.reader.read(["media-test"]), "campaign_video_catalog_unavailable");
  assert.equal(f.origin.calls, 0);
  await f.authority.prepare(value, "max"); await f.post(commit(value));
  const snapshot = await f.reader.read(["media-test"]);
  assert.equal(snapshot.photos.size, 1); assert.equal(snapshot.revision, 1); assert.equal(snapshot.sha256, sha);
  const next = await transition(2, 1);
  f.origin.before = async () => { f.origin.before = null; await f.authority.prepare(next, "max"); };
  await rejects(() => f.reader.read(["media-test"]), "campaign_video_catalog_unavailable");
  await f.post(commit(next));
  // Same bytes after a new publication generation must not satisfy an old operation fence.
  await rejects(() => f.reader.read(["media-test"], snapshot.sha256, snapshot.revision), "campaign_video_catalog_changed");
  f.origin.bytes = catalogBytes(["other-media"]);
  await rejects(() => f.reader.read(["media-test"]), "campaign_video_catalog_changed");
});

test("missing schema/storage and malformed authority never fall back to public cached bytes", async () => {
  for (const database of [undefined, { prepare() { throw new Error("down"); } }]) {
    const f = fixture(); const reader = createCurrentPublicCatalogReader({
      authority: createPublicCatalogAuthority(database), fetchImpl: f.origin.fetch.bind(f.origin) });
    await rejects(() => reader.read(["media-test"]), "campaign_video_catalog_unavailable");
    assert.equal(f.origin.calls, 0);
  }
});

test("API requires native existing connector, exact origin/path, enabled flag and bounded JSON", async () => {
  const f = fixture(); const value = await transition(); const body = JSON.stringify(value);
  for (const [target, init, status] of [
    [url, {}, 401], [url, { headers: { ...headers, cookie: "owner=true" } }, 403],
    [url, { headers: { ...headers, origin: "https://photos-by-elie.com" } }, 403],
    [url, { headers: { ...headers, "sec-fetch-site": "same-origin" } }, 403],
    [url.replace("auth.", "download."), { headers }, 404], [url + "?x=1", { headers }, 404],
    [url + "/", { headers }, 404], [url, { method: "DELETE", headers }, 405],
    [url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body }, 415],
    [url, { method: "POST", headers, body: "x".repeat(4097) }, 413],
    [url, { method: "POST", headers, body: "{" }, 400],
  ]) {
    const response = await f.api.fetch(new Request(target, init));
    assert.equal(response.status, status, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  const absent = await f.api.fetch(new Request(url, { headers }));
  assert.equal(absent.status, 404); assert.equal((await absent.json()).error.code, "public_catalog_authority_absent");
  const disabled = createPublicCatalogAuthorityApi({ database: f.database,
    connectorAuth: createOwnerConnectorAuth({ credentials: { max: "test-token" } }) });
  assert.equal((await disabled.fetch(new Request(url, { headers }))).status, 503);
  assert.equal(await f.authority.read(), null); assert.equal(f.origin.calls, 0);
  // Regex must not coerce single-element arrays into apparently valid hashes.
  assert.equal((await f.post({ ...value, sha256: [value.sha256] })).status, 400);
  assert.equal((await f.post({ ...value, operationId: [value.operationId] })).status, 400);
  assert.equal(await f.authority.read(), null); assert.equal(f.origin.calls, 0);
});
