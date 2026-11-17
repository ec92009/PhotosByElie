import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { apiUrl, publicUrl, authHeaders, declaration, hash, videoBytes } from "./campaign-video-test-support.mjs";

// Only synthetic local bindings. No remote option, credential loading or cloud mutation.
test("workerd streams through real FixedLengthStream, D1 and R2 checksum/conditional APIs", async () => {
  const binding = declaration(8);
  binding.components[0].canonicalAssetId = '1771BFE7-370A-497D-B499-FD72B65835C2:001:Ad41tbP1NGEFh/LkQamoHN+xrGAZ';
  const source = `
    import { createCampaignVideoHost } from "./worker/campaign-video-hosting.mjs";
    import { createOwnerConnectorAuth } from "./worker/owner-connector-auth.mjs";
    const binding = ${JSON.stringify(binding)};
    const catalog = { photos: new Map(binding.components.map(c => [c.canonicalMediaId, {photo: {
      media:{type:"photo",publicPreview:{allowed:true,galleryKey:"expo/"+c.canonicalMediaId+"_900.jpg",detailKey:"expo/"+c.canonicalMediaId+"_1800.jpg"}}
    }}])) };
    export default { fetch(request, env) {
      return createCampaignVideoHost({ database:env.DB, bucket:env.VIDEOS,
        catalogReader:{async read(){return {...catalog,sha256:"a".repeat(64),expiresAt:Date.now()+30000};}}, enabled:true,
        connectorAuth:createOwnerConnectorAuth({credentials:{max:"test-connector-only"}}),
        lifecycle:{
          async verifyPublicPreviews({items}) {return {schema:"photosbyelie.publicPreviewObservation.v1",readOnly:true,items:items.map(i=>({...i,allowed:true}))};},
          async assertAllowed() {return {digest:"local-test"};}
        }
      }).fetch(request);
    }};
  `;
  const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022" });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "campaign-video-test", modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: "2026-07-10", compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"], r2Buckets: ["VIDEOS"] }] }));
  try {
    const db = await mf.getD1Database("DB");
    const migration = readFileSync(new URL("../migrations/0016_campaign_videos.sql", import.meta.url), "utf8")
      .replace(/^--.*$/gm, "").replace(/\s+/g, " ");
    await db.exec(migration);
    const reservedResponse = await mf.dispatchFetch(apiUrl, { method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify(binding) });
    assert.equal(reservedResponse.status, 200);
    const reserved = await reservedResponse.json();
    assert.equal(reserved.publicUrl, publicUrl); assert.equal(reserved.portraitMp4, publicUrl);
    const headers = { ...authHeaders, "content-type": "video/mp4", "content-length": String(videoBytes.length),
      "x-pbe-video-sha256": binding.video.sha256, "x-pbe-binding-sha256": reserved.bindingSha256 };
    const uploaded = await mf.dispatchFetch(`${apiUrl}/content`, { method: "PUT", headers, body: videoBytes });
    const receipt = await uploaded.json();
    assert.equal(uploaded.status, 200, JSON.stringify(receipt));
    assert.equal(receipt.objectState, "verified");
    assert.equal(receipt.publicUrl, publicUrl); assert.equal(receipt.portraitMp4, publicUrl);
    const publicResponse = await mf.dispatchFetch(publicUrl);
    assert.equal(publicResponse.status, 200);
    assert.equal(hash(Buffer.from(await publicResponse.arrayBuffer())), binding.video.sha256);
    const range = await mf.dispatchFetch(publicUrl, { headers: { range: `bytes=0-${videoBytes.length - 1}` } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-${videoBytes.length - 1}/${videoBytes.length}`);
    assert.equal(hash(Buffer.from(await range.arrayBuffer())), binding.video.sha256);
    const r2 = await mf.getR2Bucket("VIDEOS");
    const key = `campaign-videos/v1/${reserved.bindingSha256}.mp4`;
    assert.equal(await r2.put(key, videoBytes, { onlyIf: new Headers({ "if-none-match": "*" }) }), null);
    const replay = await mf.dispatchFetch(`${apiUrl}/content`, { method: "PUT", headers, body: videoBytes });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).etag, receipt.etag);
  } finally { await mf.dispose(); }
});
