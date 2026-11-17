import assert from "node:assert/strict";
import test from "node:test";
import { bindingDigest, canonicalJson, validateVideoBinding, previewMembers } from "./campaign-video-contract.mjs";
import { campaignVideoResponse, isCampaignVideoRequest } from "./campaign-video-hosting.mjs";
import { catalogOperationId, createPublicCatalogAuthority } from "./public-catalog-authority.mjs";
import { catalogBytes, catalogResponse } from "./campaign-video-catalog-test-support.mjs";
import deployedWorker from "./deployed-worker.mjs";
import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";
import { apiUrl, publicUrl, authHeaders, declaration, fixture, hash, videoBytes, TestD1 } from "./campaign-video-test-support.mjs";

const code = async (response, status, expected) => {
  assert.equal(response.status, status);
  const body = await response.json();
  if (expected) assert.equal(body.error?.code, expected);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  return body;
};

test("canonical binding hash uses the declaration alone, sorted keys, unchanged arrays", async () => {
  const value = declaration(8);
  const reversedKeys = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(await bindingDigest(value), await bindingDigest(reversedKeys));
  assert.equal(await bindingDigest(value), hash(canonicalJson(value)));
  assert.notEqual(await bindingDigest(value), await bindingDigest({ ...value, components: [...value.components].reverse() }));
  assert.equal(canonicalJson({ z: "é", a: [2, 1] }), '{"a":[2,1],"z":"é"}');
});

test("weekly approved count exceptions 1,8,9 and standard12 preserve exact receipt", () => {
  for (const count of [1, 8, 9, 12]) assert.equal(validateVideoBinding(declaration(count)).approvedPhotoCount, count);
  for (const receipt of ["2026-09-25/youtube-refill/owner-approval.txt", "owner message 2026-09-25: sí", "user:selection-8"]) {
    const value = declaration(8); value.approvalReceipt = receipt; value.approvedPhotoCountException.receipt = receipt;
    assert.equal(validateVideoBinding(value).approvalReceipt, receipt);
  }
  for (const mutate of [
    (v) => { delete v.approvedPhotoCountException; },
    (v) => { v.approvedPhotoCountException.count = true; },
    (v) => { v.approvedPhotoCountException.receipt = "new approval invented"; },
    (v) => { v.approvedPhotoCount = 12; },
    (v) => { v.components[0].canonicalMediaId = v.components[1].canonicalMediaId; },
    (v) => { v.components[0].sourceKey = "masters/private.jpg"; },
    (v) => { v.components[0].canonicalMediaId = "../private"; },
    (v) => { v.video.width = 1920; },
    (v) => { v.video.durationMilliseconds = 30000.5; },
    (v) => { v.video.size = 64 * 1024 * 1024 + 1; },
    (v) => { v.approvalReceipt = "https://private.test"; },
    (v) => { v.approvalReceipt = "bad\nreceipt"; },
  ]) { const value = declaration(8); mutate(value); assert.throws(() => validateVideoBinding(value)); }
});

test("native connector only; no browser/cookie/query/origin upgrade or data writes", async () => {
  const f = fixture();
  for (const [headers, status] of [[{}, 401], [{ authorization: "Bearer wrong" }, 403],
    [{ ...authHeaders, origin: "https://photos-by-elie.com" }, 403],
    [{ ...authHeaders, cookie: "owner=not-authority" }, 403],
    [{ ...authHeaders, "sec-fetch-site": "same-site" }, 403]]) {
    await code(await f.fetch(apiUrl, { headers }), status);
  }
  await code(await f.fetch(`${apiUrl}?token=never-allowed`, { headers: authHeaders }), 400);
  await code(await f.fetch(apiUrl.replace("auth.photos-by-elie.com", "download.photos-by-elie.com"), { headers: authHeaders }), 404);
  assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM pbe_campaign_videos").get().n, 0);
  assert.equal(f.bucket.puts, 0);
});

test("opaque native Photos IDs round-trip without loosening public media or source-key rules", async () => {
  const binding = declaration();
  const id = '4BBAA87D-9330-4C4C-A11A-332166C281F4:001:AfjAbhpA+cZGePXLT2BkgEl6WMZW';
  binding.components[0].canonicalAssetId = id;
  binding.components[1].canonicalAssetId = '1771BFE7-370A-497D-B499-FD72B65835C2:001:Ad41tbP1NGEFh/LkQamoHN+xrGAZ';
  const f = fixture(binding);
  await code(await f.reserve(), 200);
  assert.equal((await f.fetch(apiUrl, {headers:authHeaders})).status, 200);
  assert.equal(validateVideoBinding(binding).components[0].canonicalAssetId, id);
  for (const invalid of ['https://private.test/original', '../master', 'a/b', `${id}\n`,
    '4BBAA87D-9330-4C4C-A11A-332166C281F4:001:../original']) {
    const value = declaration(); value.components[0].canonicalAssetId = invalid;
    assert.throws(() => validateVideoBinding(value));
  }
  for (const key of ['assetId','canonicalMediaId']) {
    const value = declaration(); value.components[0][key] = id;
    assert.throws(() => validateVideoBinding(value));
  }
});

test("unconfigured/disabled host fails closed and only native assets are intercepted", async () => {
  const f = fixture(undefined, { enabled: false });
  await code(await f.reserve(), 503, "campaign_video_host_disabled");
  assert.equal(isCampaignVideoRequest("/assets/campaign-media/cascais-2026.mp4"), false);
  assert.equal(isCampaignVideoRequest("/assets/campaign-media/native-cascais.mp4"), true);
  for (const slug of ["native--test", "test", "native-../original", `native-${"a".repeat(121)}`]) {
    await code(await fixture().fetch(apiUrl.replace("native-test", slug), { headers: authHeaders }), 404);
  }
});

test("deployed entrypoint wires only the scoped private binding and existing connector auth", async () => {
  const f = fixture();
  const env = { ACCESS_DB: f.database, PRIVATE_MEDIA: f.bucket, OWNER_CONNECTOR_TOKENS_JSON: JSON.stringify({ max: "test-connector-only" }),
    CAMPAIGN_VIDEO_HOST_ENABLED: "true" };
  await code(await deployedWorker.fetch(new Request(apiUrl), env), 401);
  await code(await deployedWorker.fetch(new Request(apiUrl, { headers: authHeaders }), env), 404);
  env.CAMPAIGN_VIDEO_HOST_ENABLED = "false";
  await code(await deployedWorker.fetch(new Request(apiUrl, { headers: authHeaders }), env), 503, "campaign_video_host_disabled");
  assert.equal(f.bucket.puts, 0);
});

test("reservation is immutable/idempotent; queue cannot be re-slugged and GET never writes", async () => {
  const f = fixture(declaration(9));
  await code(await f.fetch(apiUrl, { headers: authHeaders }), 404, "campaign_video_not_found");
  const first = await code(await f.reserve(), 200);
  assert.equal(first.state, "reserved"); assert.equal(first.objectState, "absent");
  assert.equal(first.publicUrl, publicUrl);
  assert.equal(first.portraitMp4, publicUrl);
  assert.deepEqual(await code(await f.reserve(), 200), first);
  const before = f.database.sqlite.prepare("SELECT total_changes() n").get().n;
  await code(await f.fetch(apiUrl, { headers: authHeaders }), 200);
  assert.equal(f.database.sqlite.prepare("SELECT total_changes() n").get().n, before);
  assert.ok(f.database.sessions.every((session) => session === "first-primary"));
  await code(await f.reserve(declaration(9), `${apiUrl}-different`), 409, "campaign_video_binding_conflict");
  const changed = declaration(9); changed.video.sha256 = "d".repeat(64);
  await code(await f.reserve(changed), 409, "campaign_video_binding_conflict");
  assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM pbe_campaign_videos").get().n, 1);
  assert.equal(f.bucket.puts, 0);
});

test("streamed declaration is capped by actual bytes despite false Content-Length", async () => {
  const f = fixture();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16385)); controller.close(); } });
  await code(await f.fetch(apiUrl, { method: "POST", headers: { ...authHeaders, "content-type": "application/json", "content-length": "1" },
    body: stream, duplex: "half" }), 413, "campaign_video_binding_too_large");
  assert.equal(f.bucket.puts, 0);
});

test("exact conditional upload reconciles and publicly streams full/HEAD/ranged bytes", async () => {
  const f = fixture(declaration(8));
  const reserved = await code(await f.reserve(), 200);
  const uploaded = await code(await f.upload(reserved), 200);
  assert.equal(uploaded.objectState, "verified"); assert.equal(uploaded.state, "ready");
  assert.equal(uploaded.publicUrl, publicUrl); assert.equal(uploaded.portraitMp4, publicUrl);
  assert.match([...f.bucket.objects.keys()][0], /^campaign-videos\/v1\/[a-f0-9]{64}\.mp4$/);
  assert.doesNotMatch(JSON.stringify(uploaded), /masters|private|sourceSha|objectKey|token|test-connector/);
  assert.deepEqual(await code(await f.fetch(apiUrl, { headers: authHeaders }), 200), uploaded);
  await code(await f.upload(reserved), 200);
  assert.equal(f.bucket.puts, 1);
  const full = await f.fetch(publicUrl); assert.equal(full.status, 200);
  assert.equal(hash(new Uint8Array(await full.arrayBuffer())), hash(videoBytes));
  const head = await f.fetch(publicUrl, { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(head.headers.get("content-length"), String(videoBytes.length));
  for (const [range, start, end] of [["bytes=0-9", 0, 10], ["bytes=4-", 4, videoBytes.length], ["bytes=-5", videoBytes.length - 5, videoBytes.length]]) {
    const partial = await f.fetch(publicUrl, { headers: { range } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes ${start}-${end - 1}/${videoBytes.length}`);
    assert.equal(partial.headers.get("content-type"), "video/mp4");
    assert.equal(partial.headers.get("accept-ranges"), "bytes");
    assert.match(partial.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), videoBytes.subarray(start, end));
  }
  for (const range of ["bytes=999-", "bytes=9-1", "bytes=-0", "bytes=0-1,5-6", "nonsense", "bytes=-999999999999999999999"]) {
    const bad = await f.fetch(publicUrl, { headers: { range } });
    assert.equal(bad.status, 416); assert.equal(bad.headers.get("content-range"), `bytes */${videoBytes.length}`);
  }
});

test("public video delivery is scoped to download while the API stays on auth", async () => {
  const f = fixture();
  const reserved = await code(await f.reserve(), 200);
  await code(await f.upload(reserved), 200);
  for (const origin of ["https://photos-by-elie.com", "https://auth.photos-by-elie.com",
    "https://photosbyelie-checkout-mock.ec92009.workers.dev", "https://example.com"]) {
    const url = `${origin}/assets/campaign-media/native-test.mp4`;
    for (const method of ["GET", "HEAD"]) await code(await f.fetch(url, { method }), 404, "campaign_video_not_found");
  }
  assert.equal(f.bucket.gets, 0);
  assert.equal((await f.fetch(publicUrl, { method: "HEAD" })).status, 200);
  await code(await f.fetch(publicUrl, { method: "POST" }), 405, "campaign_video_method_not_allowed");
  await code(await f.fetch(apiUrl.replace("auth.", "download."), { headers: authHeaders }), 404, "campaign_video_not_found");
  const reconciled = await code(await f.fetch(apiUrl, { headers: authHeaders }), 200);
  assert.equal(reconciled.publicUrl, publicUrl); assert.equal(reconciled.portraitMp4, publicUrl);
});

test("length, hash, MIME, signature and approval mismatch never leave servable objects", async () => {
  for (const [body, headers, status] of [
    [videoBytes.subarray(0, 10), {}, 400], [Buffer.concat([videoBytes, Buffer.from("extra")]), {}, 400],
    [Buffer.alloc(videoBytes.length), {}, 415], [videoBytes, { "content-length": "999" }, 400],
    [videoBytes, { "content-type": "image/jpeg" }, 415], [videoBytes, { "content-encoding": "gzip" }, 415],
    [videoBytes, { "x-pbe-binding-sha256": "a".repeat(64) }, 409],
  ]) {
    const f = fixture(); const reserved = await code(await f.reserve(), 200);
    await code(await f.upload(reserved, body, headers), status);
    assert.equal(f.bucket.objects.size, 0);
  }
  const binding = declaration(); binding.video.sha256 = "f".repeat(64);
  const f = fixture(binding); const reserved = await code(await f.reserve(), 200);
  await code(await f.upload(reserved), 503, "campaign_video_upload_unconfirmed");
  assert.equal(f.bucket.objects.size, 0);
});

test("lost successful PUT is recovered by GET, not another overwrite", async () => {
  const f = fixture(); const reserved = await code(await f.reserve(), 200);
  f.bucket.loseResponse = true;
  await code(await f.upload(reserved), 503, "campaign_video_upload_unconfirmed");
  const reconciled = await code(await f.fetch(apiUrl, { headers: authHeaders }), 200);
  assert.equal(reconciled.objectState, "verified");
  await code(await f.upload(reserved), 200);
  assert.equal(f.bucket.puts, 1);
});

test("existing conflicting R2 metadata is not absent and never overwritten", async () => {
  const f = fixture(); const reserved = await code(await f.reserve(), 200);
  await code(await f.upload(reserved), 200);
  const stored = [...f.bucket.objects.values()][0]; stored.customMetadata.bindingSha256 = "bad";
  for (const response of [await f.fetch(apiUrl, { headers: authHeaders }), await f.upload(reserved), await f.fetch(publicUrl)]) {
    await code(response, 409, "campaign_video_object_conflict");
  }
  assert.equal(f.bucket.puts, 1);
});

test("simultaneous exact uploads create once and a false-length multi-chunk stream cannot commit", async () => {
  const f = fixture(); const reserved = await code(await f.reserve(), 200);
  const responses = await Promise.all([f.upload(reserved), f.upload(reserved)]);
  for (const response of responses) assert.equal((await code(response, 200)).objectState, "verified");
  assert.equal(f.bucket.objects.size, 1);
  const fresh = fixture(); const receipt = await code(await fresh.reserve(), 200);
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(videoBytes); controller.enqueue(new Uint8Array([99])); controller.close();
  } });
  await code(await fresh.fetch(`${apiUrl}/content`, { method: "PUT", duplex: "half", body,
    headers: { ...authHeaders, "content-type": "video/mp4", "content-length": String(videoBytes.length),
      "x-pbe-video-sha256": hash(videoBytes), "x-pbe-binding-sha256": receipt.bindingSha256 } }),
  400, "campaign_video_length_mismatch");
  assert.equal(fresh.bucket.objects.size, 0);
});

test("a declaration cannot expose arbitrary or unregistered private objects", async () => {
  const f = fixture();
  f.bucket.objects.set("masters/original.jpg", { bytes: Buffer.from("PRIVATE"), size: 7 });
  await code(await f.fetch(publicUrl), 404);
  await code(await f.fetch(`${publicUrl}?key=masters/original.jpg`), 400);
  await code(await f.fetch(publicUrl.replace("native-test.mp4", "native-..%2Fmasters%2Foriginal.jpg")), 404);
  assert.equal(f.bucket.gets, 0);
});

test("current eligibility failure, armed barrier or changing fence blocks serving and upload", async () => {
  const f = fixture(); const reserved = await code(await f.reserve(), 200);
  f.lifecycle.denied = true;
  await code(await f.upload(reserved), 410);
  assert.equal(f.bucket.puts, 0);
  f.lifecycle.denied = false; await code(await f.upload(reserved), 200);
  f.lifecycle.denied = true;
  for (const method of ["GET", "HEAD"]) await code(await f.fetch(publicUrl, { method }), 410);
  await code(await f.fetch(apiUrl, { headers: authHeaders }), 410);
  f.lifecycle.denied = false;
  f.bucket.onGet = () => { f.lifecycle.revision++; };
  await code(await f.fetch(publicUrl), 409, "lifecycle_fence_changed");
  f.bucket.onGet = undefined;
  f.catalog.photos.delete("media-0");
  await code(await f.fetch(publicUrl), 410, "campaign_video_component_ineligible");
});

test("existing real lifecycle store denies later armed photo without registration mutation", async () => {
  const binding = declaration(8); const database = new TestD1();
  const lifecycle = createD1LifecycleDenyStore({ database });
  const items = previewMembers(binding);
  await lifecycle.seedVisibleBatch({ seedId: "video-test-seed", items });
  await lifecycle.activate({ activationId: "video-test-active", ...await summarizeLifecycleManifest(items) });
  const f = fixture(binding, { database, lifecycle });
  const reserved = await code(await f.reserve(), 200); await code(await f.upload(reserved), 200);
  await lifecycle.armBatch({ operationId: "deny-component", operation: "x", denied: true, items: [items[0]] });
  const before = database.sqlite.prepare("SELECT total_changes() n FROM pbe_lifecycle_control").get().n;
  await code(await f.fetch(publicUrl), 410);
  await code(await f.fetch(apiUrl, { headers: authHeaders }), 410);
  assert.equal(database.sqlite.prepare("SELECT total_changes() n FROM pbe_lifecycle_control").get().n, before);
});

test("fresh primary lifecycle reads reject an R2-time denial despite a stale request-session replica", async (t) => {
  const binding = declaration(8), primary = new TestD1();
  const lifecycle = createD1LifecycleDenyStore({ database: primary });
  const items = previewMembers(binding);
  await lifecycle.seedVisibleBatch({ seedId: "primary-review", items });
  await lifecycle.activate({ activationId: "primary-review-active", ...await summarizeLifecycleManifest(items) });
  const f = fixture(binding, { database: primary, lifecycle });
  const reserved = await code(await f.reserve(), 200);
  await code(await f.upload(reserved), 200);
  const bytes = catalogBytes(binding.components.map((c) => c.canonicalMediaId));
  const sha256 = hash(bytes), authority = createPublicCatalogAuthority(primary);
  const transition = { schema: "photosbyelie.publicCatalogTransition.v1", phase: "prepare",
    expectedGeneration: 0, projectionRevision: 1, sha256, operationId: await catalogOperationId(1, sha256) };
  await authority.prepare(transition, "max");
  await authority.commit({ ...transition, phase: "commit", expectedGeneration: 1 }, "max", async () => {});

  // Synthetic in-memory snapshot only. D1 first-primary permits subsequent
  // session reads to use a replica consistent with the first query's bookmark.
  const replica = new TestD1();
  for (const { name } of primary.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    assert.match(name, /^[a-z0-9_]+$/);
    for (const row of primary.sqlite.prepare(`SELECT * FROM ${name}`).all()) {
      const columns = Object.keys(row);
      replica.sqlite.prepare(`INSERT OR REPLACE INTO ${name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .run(...Object.values(row));
    }
  }
  const sessions = [];
  const raw = {
    prepare: (sql) => primary.prepare(sql), batch: (statements) => primary.batch(statements),
    withSession(constraint) {
      assert.equal(constraint, "first-primary");
      const queries = []; sessions.push(queries);
      return {
        prepare(sql) {
          const target = queries.length === 0 ? primary : replica;
          queries.push(sql); return target.prepare(sql);
        },
        batch: (statements) => primary.batch(statements),
      };
    },
  };
  t.mock.method(globalThis, "fetch", async () => catalogResponse(bytes, { age: "600" }));
  const env = { ACCESS_DB: raw, PRIVATE_MEDIA: f.bucket, CAMPAIGN_VIDEO_HOST_ENABLED: "true" };
  const allowed = await campaignVideoResponse(new Request(publicUrl), env);
  assert.equal(allowed.status, 200);
  assert.equal(hash(new Uint8Array(await allowed.arrayBuffer())), binding.video.sha256);

  f.bucket.onGet = () => lifecycle.armBatch({ operationId: "deny-during-r2", operation: "x", denied: true, items: [items[0]] });
  const denied = await campaignVideoResponse(new Request(publicUrl), env);
  await code(denied, 410, "campaign_video_component_ineligible");
  await assert.rejects(() => lifecycle.assertAllowed([items[0].canonicalMediaId]), { code: "asset_lifecycle_denied" });
  // The old snapshot still grants access: the result depends on fresh reads,
  // not a changed catalog, incidental replica progress or unconditional denial.
  const staleLifecycle = createD1LifecycleDenyStore({ database: replica });
  assert.ok((await staleLifecycle.assertAllowed([items[0].canonicalMediaId])).digest);
  assert.equal((await authority.read()).state, "verified");
  assert.equal(f.bucket.gets, 2);
  assert.ok(sessions.length > 2);
  assert.ok(sessions.every((queries) => queries.length === 1));
});
