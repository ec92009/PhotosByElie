import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values) }; }
  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class TransactionalD1 {
  constructor({ failAt = 0, includeIdentityMigration = true } = {}) {
    this.sqlite = new DatabaseSync(":memory:");
    this.failAt = failAt;
    this.beforeBatch = null;
    this.lastBatchExecuted = 0;
    this.sqlite.exec(readFileSync(new URL("../migrations/0012_lifecycle_deny_plane.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0013_lifecycle_manifest_reconciliation.sql", import.meta.url), "utf8"));
    if (includeIdentityMigration) {
      this.sqlite.exec(readFileSync(new URL("../migrations/0017_legacy_identity_reconciliation.sql", import.meta.url), "utf8"));
    }
  }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  batch(statements) {
    this.lastBatchExecuted = 0;
    if (this.beforeBatch) {
      const hook = this.beforeBatch;
      this.beforeBatch = null;
      hook(this.sqlite);
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement, index) => {
        if (this.failAt && index + 1 === this.failAt) throw new Error("injected partial transaction failure");
        const result = statement.run();
        this.lastBatchExecuted += 1;
        return result;
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  count(table) { return Number(this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
}

const SOURCE_HASH = "a".repeat(64);
const AUTHORITY_HASH = "b".repeat(64);

const legacyMember = (mediaId = "legacy-one", canonicalAssetId = mediaId) => ({
  canonicalMediaId: mediaId,
  canonicalAssetId,
  bindings: [
    { bucket: "public", objectKey: `expo/${mediaId}_900.jpg` },
    { bucket: "public", objectKey: `expo/${mediaId}_1800.jpg` },
    { bucket: "public", objectKey: `gallery/${mediaId}-thumb.jpg` },
    { bucket: "private", objectKey: `masters/${mediaId}.jpg` },
  ],
});

const repairItem = (mediaId = "legacy-one", canonicalAssetId = "native-one") => ({
  canonicalMediaId: mediaId,
  previousAssetId: mediaId,
  canonicalAssetId,
  sourceSha256: SOURCE_HASH,
  authoritySha256: AUTHORITY_HASH,
  bindings: [
    { bucket: "public", objectKey: `expo/${mediaId}_1800.jpg` },
    { bucket: "public", objectKey: `expo/${mediaId}_900.jpg` },
  ],
});

const requestFor = (overrides = {}) => ({
  repairId: "repair-native-one",
  actorId: "owner-connector",
  prepareOnly: true,
  items: [repairItem()],
  ...overrides,
});

const registrationMember = (mediaId = "unrelated-registration") => ({
  canonicalMediaId: mediaId,
  canonicalAssetId: `asset-${mediaId}`,
  bindings: [
    { bucket: "public", objectKey: `expo/${mediaId}_900.jpg` },
    { bucket: "public", objectKey: `expo/${mediaId}_1800.jpg` },
  ],
});

const readyStore = async (database, members = [legacyMember()]) => {
  const store = createD1LifecycleDenyStore({ database });
  await store.seedVisibleBatch({ seedId: "legacy-fixture", items: members });
  await store.activate({
    activationId: "activation-legacy-fixture",
    ...await summarizeLifecycleManifest(members),
  });
  return store;
};

const totalChanges = (database) => Number(database.sqlite.prepare("SELECT total_changes() AS count").get().count);
const identityFor = (database, mediaId) => database.sqlite.prepare(
  "SELECT canonical_media_id, canonical_asset_id FROM pbe_lifecycle_media_identity WHERE canonical_media_id = ?",
).get(mediaId);
const projectionFor = (database, mediaId) => database.sqlite.prepare(
  "SELECT canonical_media_id, canonical_asset_id, revision, denied, lifecycle_state, operation_id, operation_digest, receipt_id "
    + "FROM pbe_lifecycle_projection WHERE canonical_media_id = ?",
).get(mediaId);
const bindingsFor = (database, mediaId) => database.sqlite.prepare(
  "SELECT bucket, object_key, canonical_media_id FROM pbe_lifecycle_media_bindings WHERE canonical_media_id = ? ORDER BY bucket, object_key",
).all(mediaId);
const activationFor = (database) => database.sqlite.prepare(
  "SELECT activation_id, activation_digest, expected_media_count, expected_binding_count FROM pbe_lifecycle_activations",
).get();
const controlFor = (database) => database.sqlite.prepare(
  "SELECT state, fencing_epoch FROM pbe_lifecycle_control WHERE control_id = 'global'",
).get();

const lifecycleReceipt = (arm, item, denied, lifecycleState) => ({
  receiptId: `receipt-${arm.operationId}-${item.canonicalMediaId}`,
  canonicalAssetId: item.canonicalAssetId,
  canonicalMediaId: item.canonicalMediaId,
  revision: arm.revision,
  denied,
  lifecycleState,
});

const applyLifecycle = async (store, operationId, operation, denied, members) => {
  const arm = await store.armBatch({ operationId, operation, denied, items: members });
  await store.markLocallyCommitted(arm);
  const lifecycleState = denied ? (operation === "empty" ? "tombstoned" : "recoverable") : "restored";
  return store.applyBatch({
    ...arm,
    receipts: members.map((item) => lifecycleReceipt(arm, item, denied, lifecycleState)),
  });
};

const applyRepair = (store, request, plan) => store.reconcileLegacyIdentity({
  ...request,
  prepareOnly: false,
  envelope: plan.envelope,
});

test("preparation returns a stable read-only plan without exposing or changing bindings", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = requestFor();
  const beforeChanges = totalChanges(database);
  const beforeIdentity = identityFor(database, "legacy-one");
  const beforeProjection = projectionFor(database, "legacy-one");
  const beforeBindings = bindingsFor(database, "legacy-one");

  const plan = await store.reconcileLegacyIdentity(request);
  assert.equal(plan.schema, "photosbyelie.legacyIdentityRepairPlan.v1");
  assert.equal(plan.readOnly, true);
  assert.equal(plan.state, "prepared");
  assert.equal(plan.envelope.schema, "photosbyelie.legacyIdentityRepairEnvelope.v1");
  assert.equal(plan.envelope.items[0].previousReceiptId, beforeProjection.receipt_id);
  assert.doesNotMatch(JSON.stringify(plan), /masters\/|gallery\/legacy-one-thumb/);
  assert.deepEqual(await store.reconcileLegacyIdentity(request), plan);
  assert.equal(totalChanges(database), beforeChanges);
  assert.deepEqual(identityFor(database, "legacy-one"), beforeIdentity);
  assert.deepEqual(projectionFor(database, "legacy-one"), beforeProjection);
  assert.deepEqual(bindingsFor(database, "legacy-one"), beforeBindings);
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
});

test("apply changes only the asset identity, preserves every binding and advances the revision fence", async () => {
  const database = new TransactionalD1();
  const legacy = legacyMember();
  const store = await readyStore(database, [legacy]);
  const request = requestFor();
  const beforeActivation = activationFor(database);
  const beforeBindings = bindingsFor(database, "legacy-one");
  const beforeFence = await store.assertAllowed(["legacy-one"], "test:before-repair");
  const plan = await store.reconcileLegacyIdentity(request);

  const receipt = await applyRepair(store, request, plan);
  assert.equal(receipt.schema, "photosbyelie.legacyIdentityRepairReceipt.v1");
  assert.equal(receipt.state, "applied");
  assert.equal(receipt.correctedMediaCount, 1);
  assert.equal(receipt.mediaCount, 1);
  assert.equal(receipt.bindingCount, legacy.bindings.length);
  assert.equal(receipt.fencingEpoch, plan.envelope.previousFencingEpoch + 1);
  assert.deepEqual({ ...identityFor(database, "legacy-one") }, {
    canonical_media_id: "legacy-one",
    canonical_asset_id: "native-one",
  });
  const projection = projectionFor(database, "legacy-one");
  assert.equal(projection.canonical_asset_id, "native-one");
  assert.equal(projection.revision, receipt.fencingEpoch);
  assert.equal(projection.denied, 0);
  assert.equal(projection.lifecycle_state, "visible");
  assert.equal(projection.operation_id, `legacy-identity:${request.repairId}`);
  assert.deepEqual(bindingsFor(database, "legacy-one"), beforeBindings);
  assert.equal(database.count("pbe_lifecycle_media_identity"), 1);
  assert.equal(database.count("pbe_lifecycle_media_bindings"), legacy.bindings.length);
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 1);

  const activation = activationFor(database);
  assert.equal(activation.activation_id, plan.envelope.activationId);
  assert.equal(activation.activation_digest, plan.envelope.activationDigest);
  assert.notEqual(activation.activation_id, beforeActivation.activation_id);
  assert.notEqual(activation.activation_digest, beforeActivation.activation_digest);
  assert.equal(activation.expected_media_count, beforeActivation.expected_media_count);
  assert.equal(activation.expected_binding_count, beforeActivation.expected_binding_count);

  const afterFence = await store.assertAllowed(["legacy-one"], "test:after-repair");
  assert.equal(beforeFence.media[0].revision, 0);
  assert.equal(afterFence.media[0].revision, receipt.fencingEpoch);
  assert.notEqual(afterFence.media[0].receiptId, beforeFence.media[0].receiptId);
});

test("an applied repair replays without writes after a later lifecycle denial", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = requestFor();
  const plan = await store.reconcileLegacyIdentity(request);
  const receipt = await applyRepair(store, request, plan);
  const corrected = legacyMember("legacy-one", "native-one");
  await applyLifecycle(store, "deny-after-repair", "x", true, [corrected]);
  const changesAfterDenial = totalChanges(database);

  const replayPlan = await store.reconcileLegacyIdentity(request);
  assert.equal(replayPlan.state, "applied");
  assert.deepEqual(replayPlan.envelope, plan.envelope);
  assert.deepEqual(await applyRepair(store, request, plan), receipt);
  assert.equal(totalChanges(database), changesAfterDenial);
  assert.equal(projectionFor(database, "legacy-one").denied, 1);
  assert.equal(projectionFor(database, "legacy-one").canonical_asset_id, "native-one");
});

test("a repair plan becomes stale after an unrelated lifecycle operation", async () => {
  const database = new TransactionalD1();
  const second = legacyMember("legacy-two");
  const store = await readyStore(database, [legacyMember(), second]);
  const request = requestFor();
  const plan = await store.reconcileLegacyIdentity(request);
  await store.armBatch({ operationId: "unrelated-lifecycle", operation: "x", denied: true, items: [second] });

  await assert.rejects(applyRepair(store, request, plan), { code: "legacy_identity_reconciliation_conflict" });
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
  assert.equal(database.count("pbe_lifecycle_barriers"), 1);
});

test("a repair plan becomes stale after an unrelated public-preview registration", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = requestFor();
  const plan = await store.reconcileLegacyIdentity(request);
  const registration = await store.reconcileManifest({
    prepareOnly: true,
    actorId: "owner-connector",
    repairId: "unrelated-registration",
    items: [registrationMember()],
  });
  await store.reconcileManifest({ ...registration.envelope, actorId: "owner-connector" });

  await assert.rejects(applyRepair(store, request, plan), { code: "legacy_identity_reconciliation_conflict" });
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
  assert.equal(database.count("pbe_lifecycle_media_identity"), 2);
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
});

test("invalid, malformed and duplicate repair inputs are rejected before writes", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  const base = requestFor();
  const beforeChanges = totalChanges(database);
  const valid = repairItem();
  const many = Array.from({ length: 21 }, (_, index) => repairItem(`legacy-${index}`, `native-${index}`));
  const invalidRequests = [
    null,
    {},
    { ...base, actorId: "" },
    { ...base, repairId: "../repair" },
    { ...base, prepareOnly: "true" },
    { ...base, items: [] },
    { ...base, items: many },
    { ...base, items: [null] },
    { ...base, items: [{ ...valid, canonicalMediaId: "bad id", previousAssetId: "bad id" }] },
    { ...base, items: [{ ...valid, previousAssetId: "not-the-media-id" }] },
    { ...base, items: [{ ...valid, canonicalAssetId: valid.previousAssetId }] },
    { ...base, items: [{ ...valid, sourceSha256: "A".repeat(64) }] },
    { ...base, items: [{ ...valid, authoritySha256: "not-a-sha256" }] },
    { ...base, items: [{ ...valid, bindings: [{ bucket: "private", objectKey: "masters/legacy-one.jpg" }] }] },
    { ...base, items: [{ ...valid, bindings: [{ bucket: "public", objectKey: "expo/wrong_900.jpg" }, valid.bindings[0]] }] },
  ];
  for (const invalid of invalidRequests) {
    await assert.rejects(store.reconcileLegacyIdentity(invalid), { code: "legacy_identity_reconciliation_conflict", status: 400 });
  }

  const duplicateItems = [
    [valid, valid],
    [repairItem("legacy-one", "same-native"), repairItem("legacy-two", "same-native")],
    [repairItem("legacy-one", "legacy-two"), repairItem("legacy-two", "native-two")],
  ];
  for (const items of duplicateItems) {
    await assert.rejects(
      store.reconcileLegacyIdentity({ ...base, items }),
      { code: "legacy_identity_reconciliation_conflict", status: 400 },
    );
  }
  assert.equal(totalChanges(database), beforeChanges);
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
});

test("an already-owned target asset ID cannot be claimed by the repair", async () => {
  const database = new TransactionalD1();
  const owner = legacyMember("other-media", "native-one");
  const store = await readyStore(database, [legacyMember(), owner]);
  const beforeChanges = totalChanges(database);

  await assert.rejects(store.reconcileLegacyIdentity(requestFor()), { code: "legacy_identity_reconciliation_conflict" });
  assert.equal(totalChanges(database), beforeChanges);
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
  assert.equal(identityFor(database, "other-media").canonical_asset_id, "native-one");
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
});

test("a non-self legacy asset mapping is not eligible for correction", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database, [legacyMember("legacy-one", "older-asset")]);

  await assert.rejects(store.reconcileLegacyIdentity(requestFor()), { code: "legacy_identity_reconciliation_conflict" });
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "older-asset");
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
});

test("denial, restore history, receipts, barriers and paid fulfillment each refuse repair", async (t) => {
  const cases = [
    {
      name: "denied projection",
      prepare: (store, database, member) => applyLifecycle(store, "deny-before-repair", "x", true, [member]),
    },
    {
      name: "restored projection",
      prepare: async (store, database, member) => {
        await applyLifecycle(store, "deny-before-restore", "x", true, [member]);
        await applyLifecycle(store, "restore-before-repair", "restore", false, [member]);
      },
    },
    {
      name: "lifecycle receipt history",
      prepare: (_store, database) => database.sqlite.prepare(`INSERT INTO pbe_lifecycle_receipts
        (receipt_id, operation_id, operation_digest, canonical_media_id, canonical_asset_id,
         revision, denied, lifecycle_state, outcome, applied_at)
        VALUES ('historical-receipt', 'historical-op', ?, 'legacy-one', 'legacy-one', 1, 0, 'restored', 'applied', '2026-09-29T00:00:00.000Z')`)
        .run("c".repeat(64)),
    },
    {
      name: "armed lifecycle barrier",
      prepare: (store, _database, member) => store.armBatch({
        operationId: "barrier-before-repair", operation: "x", denied: true, items: [member],
      }),
    },
    {
      name: "paid fulfillment reference",
      prepare: async (store) => {
        const fence = await store.assertAllowed(["legacy-one"], "fulfillment:start");
        await store.commitFulfillmentReady({ orderId: "paid-before-repair", mediaIds: ["legacy-one"], fence });
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const database = new TransactionalD1();
      const member = legacyMember();
      const store = await readyStore(database, [member]);
      await scenario.prepare(store, database, member);
      await assert.rejects(store.reconcileLegacyIdentity(requestFor()), {
        code: "legacy_identity_reconciliation_conflict",
      });
      assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
      assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
    });
  }
});

test("global epoch race immediately before batch rolls back every repair write", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = requestFor();
  const plan = await store.reconcileLegacyIdentity(request);
  const beforeActivation = activationFor(database);
  database.beforeBatch = (sqlite) => sqlite.prepare(`UPDATE pbe_lifecycle_control
    SET fencing_epoch = fencing_epoch + 1 WHERE control_id = 'global'`).run();

  await assert.rejects(applyRepair(store, request, plan));
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
  assert.equal(projectionFor(database, "legacy-one").revision, 0);
  assert.deepEqual(activationFor(database), beforeActivation);
  assert.deepEqual({ ...controlFor(database) }, { state: "ready", fencing_epoch: 1 });
});

test("per-item receipt fence race immediately before batch rolls back atomically", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = requestFor();
  const plan = await store.reconcileLegacyIdentity(request);
  const beforeActivation = activationFor(database);
  database.beforeBatch = (sqlite) => sqlite.prepare(`UPDATE pbe_lifecycle_projection
    SET receipt_id = 'concurrent-receipt' WHERE canonical_media_id = 'legacy-one'`).run();

  await assert.rejects(applyRepair(store, request, plan));
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
  assert.equal(projectionFor(database, "legacy-one").canonical_asset_id, "legacy-one");
  assert.equal(projectionFor(database, "legacy-one").receipt_id, "concurrent-receipt");
  assert.deepEqual(activationFor(database), beforeActivation);
  assert.deepEqual({ ...controlFor(database) }, { state: "ready", fencing_epoch: 0 });
});

test("two-item last-member conflict and late failure roll back earlier writes, receipt and activation", async (t) => {
  const members = [legacyMember("legacy-one"), legacyMember("legacy-two")];
  const request = requestFor({
    repairId: "repair-two-items",
    items: [repairItem("legacy-one", "native-one"), repairItem("legacy-two", "native-two")],
  });

  await t.test("last item's changed receipt fence rolls back the first item's writes", async () => {
    const database = new TransactionalD1();
    const store = await readyStore(database, members);
    const plan = await store.reconcileLegacyIdentity(request);
    const beforeActivation = activationFor(database);
    const firstProjection = projectionFor(database, "legacy-one");
    database.beforeBatch = (sqlite) => sqlite.prepare(`UPDATE pbe_lifecycle_projection
      SET receipt_id = 'concurrent-last-item-receipt' WHERE canonical_media_id = 'legacy-two'`).run();

    await assert.rejects(applyRepair(store, request, plan));
    assert.equal(database.lastBatchExecuted, 5);
    assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
    assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
    assert.deepEqual(projectionFor(database, "legacy-one"), firstProjection);
    assert.equal(identityFor(database, "legacy-two").canonical_asset_id, "legacy-two");
    assert.equal(projectionFor(database, "legacy-two").receipt_id, "concurrent-last-item-receipt");
    assert.deepEqual(activationFor(database), beforeActivation);
    assert.deepEqual({ ...controlFor(database) }, { state: "ready", fencing_epoch: 0 });
  });

  await t.test("injected final statement failure rolls back after activation update ran", async () => {
    const database = new TransactionalD1();
    const store = await readyStore(database, members);
    const plan = await store.reconcileLegacyIdentity(request);
    const beforeActivation = activationFor(database);
    const beforeBindings = members.map((member) => bindingsFor(database, member.canonicalMediaId));
    // Two leading statements, three per item, activation update, then ready transition.
    database.failAt = 10;

    await assert.rejects(applyRepair(store, request, plan), (error) => (
      error.message === "injected partial transaction failure"
    ));
    assert.equal(database.lastBatchExecuted, 9);
    assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
    assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
    assert.equal(identityFor(database, "legacy-two").canonical_asset_id, "legacy-two");
    assert.equal(projectionFor(database, "legacy-one").revision, 0);
    assert.equal(projectionFor(database, "legacy-two").revision, 0);
    assert.deepEqual(activationFor(database), beforeActivation);
    assert.deepEqual({ ...controlFor(database) }, { state: "ready", fencing_epoch: 0 });
    assert.deepEqual(bindingsFor(database, "legacy-one"), beforeBindings[0]);
    assert.deepEqual(bindingsFor(database, "legacy-two"), beforeBindings[1]);
  });
});

test("a paid fulfillment intent arriving before batch prevents repair", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = requestFor({ repairId: "repair-paid-intent-race" });
  const plan = await store.reconcileLegacyIdentity(request);
  const beforeActivation = activationFor(database);
  const projection = projectionFor(database, "legacy-one");
  database.beforeBatch = (sqlite) => {
    sqlite.prepare(`INSERT INTO pbe_lifecycle_fulfillment_intents
      (order_id, fence_digest, member_count, created_at) VALUES (?, ?, 1, ?)`)
      .run("paid-intent-race", "d".repeat(64), "2026-09-29T12:00:00.000Z");
    sqlite.prepare(`INSERT INTO pbe_lifecycle_fulfillment_intent_media
      (order_id, canonical_media_id, revision, receipt_id) VALUES (?, ?, ?, ?)`)
      .run("paid-intent-race", "legacy-one", projection.revision, projection.receipt_id);
  };

  await assert.rejects(applyRepair(store, request, plan));
  assert.equal(database.lastBatchExecuted, 2);
  assert.equal(database.count("pbe_lifecycle_identity_reconciliations"), 0);
  assert.equal(database.count("pbe_lifecycle_fulfillment_intents"), 1);
  assert.equal(database.count("pbe_lifecycle_fulfillment_intent_media"), 1);
  assert.equal(identityFor(database, "legacy-one").canonical_asset_id, "legacy-one");
  assert.deepEqual(activationFor(database), beforeActivation);
  assert.deepEqual({ ...controlFor(database) }, { state: "ready", fencing_epoch: 0 });
});

test("reconciliation fails closed when migration 0017 is missing", async () => {
  const database = new TransactionalD1({ includeIdentityMigration: false });
  const store = createD1LifecycleDenyStore({ database });
  const beforeChanges = totalChanges(database);
  assert.equal(database.count("pbe_lifecycle_activations"), 0);
  assert.equal(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'pbe_lifecycle_identity_reconciliations'`).get().count, 0);

  await assert.rejects(store.reconcileLegacyIdentity(requestFor()), (error) => (
    /no such table: pbe_lifecycle_identity_reconciliations/.test(error.message)
  ));
  assert.equal(totalChanges(database), beforeChanges);
});
