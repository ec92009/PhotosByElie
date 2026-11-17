import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { PUBLIC_CATALOG_URL } from "./campaign-video-catalog.mjs";
import { catalogOperationId } from "./public-catalog-authority.mjs";
import { CATALOG_AUTHORITY_PATH } from "./public-catalog-authority-api.mjs";
import { previewMembers } from "./campaign-video-contract.mjs";
import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";
import { catalogBytes, catalogResponse } from "./campaign-video-catalog-test-support.mjs";
import { apiUrl, publicUrl, authHeaders, declaration, videoBytes, hash } from "./campaign-video-test-support.mjs";

/** The actual production entrypoint uses real workerd fetch/SQLite JS/R2/D1.
 * Outbound HTTPS is intercepted locally: no production data, tokens or mutation.
 */
test("workerd production route sees current SQLite additions/removals and revision races without redeploy", async () => {
  const binding = declaration(8);
  const ids = binding.components.map((c) => c.canonicalMediaId);
  const complete = catalogBytes(ids);
  const removed = catalogBytes(ids, { omit: [ids[0]] });
  let current = removed;
  let requests = 0;
  let beforeCatalogFetch;
  const bundle = await build({ entryPoints: ["worker/deployed-worker.mjs"], bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022" });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "pbe-catalog-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-10", compatibilityFlags: ["nodejs_compat"],
    bindings: { OWNER_CONNECTOR_TOKENS_JSON: JSON.stringify({ max: "test-connector-only" }), CAMPAIGN_VIDEO_HOST_ENABLED: "true",
      PUBLIC_CATALOG_AUTHORITY_ENABLED: "true" },
    d1Databases: ["ACCESS_DB"], r2Buckets: ["PRIVATE_MEDIA"],
    outboundService: async (request) => {
      assert.equal(request.url, PUBLIC_CATALOG_URL);
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("cookie"), null);
      assert.match(request.headers.get("cache-control"), /no-store/);
      requests++; await beforeCatalogFetch?.(requests);
      return catalogResponse(current, { age: "600" });
    },
  }] }));
  const reserve = (url = apiUrl, value = binding) => mf.dispatchFetch(url, {
    method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify(value),
  });
  const upload = (receipt, url = apiUrl) => mf.dispatchFetch(`${url}/content`, {
    method: "PUT", body: videoBytes, headers: { ...authHeaders, "content-type": "video/mp4",
      "content-length": String(videoBytes.length), "x-pbe-binding-sha256": receipt.bindingSha256,
      "x-pbe-video-sha256": hash(videoBytes) },
  });
  let generation = 0;
  const publishCatalog = async () => {
    const sha256 = hash(current);
    const projectionRevision = generation + 1;
    const operationId = await catalogOperationId(projectionRevision, sha256);
    const body = { schema: "photosbyelie.publicCatalogTransition.v1", phase: "prepare", operationId,
      expectedGeneration: generation, projectionRevision, sha256 };
    const address = `https://auth.photos-by-elie.com${CATALOG_AUTHORITY_PATH}`;
    const prepared = await reserve(address, body);
    assert.equal(prepared.status, 200, await prepared.clone().text());
    generation = (await prepared.json()).generation;
    const committed = await reserve(address, { ...body, phase: "commit", expectedGeneration: generation });
    assert.equal(committed.status, 200, await committed.clone().text());
    assert.equal((await committed.json()).state, "verified");
  };
  try {
    const db = await mf.getD1Database("ACCESS_DB");
    for (const name of ["0012_lifecycle_deny_plane.sql", "0013_lifecycle_manifest_reconciliation.sql", "0016_campaign_videos.sql"]) {
      const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
        .replace(/^--.*$/gm, "").replace(/\s+/g, " ");
      await db.exec(sql);
    }
    const lifecycle = createD1LifecycleDenyStore({ database: db });
    const items = previewMembers(binding);
    await lifecycle.seedVisibleBatch({ seedId: "runtime-catalog", items });
    await lifecycle.activate({ activationId: "runtime-catalog-active", ...await summarizeLifecycleManifest(items) });
    const uninitialized = await reserve();
    assert.equal(uninitialized.status, 503); await uninitialized.text();
    assert.equal(requests, 0); // No HTTP-cache fallback without publisher authority.
    // Also parse the real-sized checked-in artifact inside workerd, read-only.
    current = readFileSync(new URL("../assets/catalog/photosbyelie.sqlite", import.meta.url));
    await publishCatalog();
    const snapshotCheck = await reserve();
    const snapshotError = await snapshotCheck.json();
    assert.equal(snapshotCheck.status, 410, JSON.stringify(snapshotError));
    assert.equal(snapshotError.error.code, "campaign_video_component_ineligible");
    current = removed;
    await publishCatalog();
    const missing = await reserve(); assert.equal(missing.status, 410, await missing.text());
    current = complete;
    await publishCatalog();
    const reservedResponse = await reserve();
    const reserved = await reservedResponse.json();
    assert.equal(reservedResponse.status, 200, JSON.stringify(reserved));
    const uploaded = await upload(reserved); assert.equal(uploaded.status, 200, await uploaded.text());
    const full = await mf.dispatchFetch(publicUrl); assert.equal(full.status, 200);
    assert.equal(hash(new Uint8Array(await full.arrayBuffer())), binding.video.sha256);
    const range = await mf.dispatchFetch(publicUrl, { headers: { range: "bytes=0-11" } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 12);
    current = removed;
    await publishCatalog();
    for (const method of ["GET", "HEAD"]) {
      const hidden = await mf.dispatchFetch(publicUrl, { method }); assert.equal(hidden.status, 410); await hidden.text();
    }
    current = complete;
    await publishCatalog();
    const changeAt = requests + 2;
    beforeCatalogFetch = (count) => { if (count === changeAt) current = removed; };
    const drifted = await mf.dispatchFetch(publicUrl);
    assert.equal(drifted.status, 409); assert.equal((await drifted.json()).error.code, "campaign_video_catalog_changed");

    // A second exact declaration tests drift at the final-byte, pre-commit gate.
    beforeCatalogFetch = null; current = complete;
    const secondUrl = `${apiUrl}-second`;
    const second = await (await reserve(secondUrl, { ...binding, queueId: "q-second" })).json();
    const eofChangeAt = requests + 3;
    beforeCatalogFetch = (count) => { if (count === eofChangeAt) current = removed; };
    const interrupted = await upload(second, secondUrl);
    assert.equal(interrupted.status, 409); await interrupted.text();
    const bucket = await mf.getR2Bucket("PRIVATE_MEDIA");
    assert.equal(await bucket.head(`campaign-videos/v1/${second.bindingSha256}.mp4`), null);

    beforeCatalogFetch = null; current = complete;
    await lifecycle.armBatch({ operationId: "runtime-deny", operation: "x", denied: true, items: [items[0]] });
    const denied = await mf.dispatchFetch(publicUrl); assert.equal(denied.status, 410); await denied.text();
    assert.ok(requests >= 20);
  } finally { await mf.dispose(); }
});
