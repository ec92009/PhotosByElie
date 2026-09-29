import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";

// Real local D1 enforces workerd SQL limits that desktop SQLite does not.
// No remote bindings, credentials, provider calls or production data.
test("real local D1 prepares, applies and replays six legacy identities", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "legacy-identity-d1-test", modules: true,
    script: 'export default { fetch() { return new Response("local only"); } };',
    compatibilityDate: "2026-07-10", d1Databases: ["DB"],
  }] }));
  try {
    const database = await mf.getD1Database("DB");
    for (const name of ["0012_lifecycle_deny_plane.sql", "0013_lifecycle_manifest_reconciliation.sql", "0017_legacy_identity_reconciliation.sql"]) {
      const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
        .replace(/^--.*$/gm, "").replace(/\s+/g, " ");
      await database.exec(sql);
    }
    const members = Array.from({ length: 6 }, (_, index) => {
      const media = `legacy-${index}`;
      return { canonicalAssetId: media, canonicalMediaId: media, bindings: [
        { bucket: "public", objectKey: `expo/${media}_900.jpg` },
        { bucket: "public", objectKey: `expo/${media}_1800.jpg` },
        { bucket: "private", objectKey: `masters/${media}.jpg` },
      ] };
    });
    const store = createD1LifecycleDenyStore({ database });
    await store.seedVisibleBatch({ seedId: "local-d1-seed", items: members });
    await store.activate({ activationId: "local-d1-activation", ...await summarizeLifecycleManifest(members) });
    const request = { repairId: "local-d1-repair", actorId: "test-connector", prepareOnly: true,
      items: members.map((member, index) => ({ ...member, previousAssetId: member.canonicalAssetId,
        canonicalAssetId: `native-${index}`, bindings: member.bindings.slice(0, 2),
        sourceSha256: "a".repeat(64), authoritySha256: "b".repeat(64) })) };
    const plan = await store.reconcileLegacyIdentity(request);
    assert.equal(plan.state, "prepared");
    const apply = { ...request, prepareOnly: false, envelope: plan.envelope };
    const receipt = await store.reconcileLegacyIdentity(apply);
    assert.equal(receipt.correctedMediaCount, 6);
    assert.equal(receipt.mediaCount, 6);
    assert.equal(receipt.bindingCount, 18);
    assert.deepEqual(await store.reconcileLegacyIdentity(apply), receipt);
    const actual = await database.prepare("SELECT canonical_asset_id FROM pbe_lifecycle_media_identity ORDER BY canonical_media_id").all();
    assert.deepEqual(actual.results.map(row => row.canonical_asset_id), members.map((_, i) => `native-${i}`));
    const privateBindings = await database.prepare("SELECT count(*) AS n FROM pbe_lifecycle_media_bindings WHERE bucket='private'").first();
    assert.equal(privateBindings.n, 6);
  } finally { await mf.dispose(); }
});
