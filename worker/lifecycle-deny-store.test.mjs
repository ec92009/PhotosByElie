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
  run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
}

class TransactionalD1 {
  constructor({ failAt = 0 } = {}) {
    this.sqlite = new DatabaseSync(":memory:");
    this.failAt = failAt;
    this.beforeBatch = null;
    this.sqlite.exec(readFileSync(new URL("../migrations/0012_lifecycle_deny_plane.sql", import.meta.url), "utf8"));
    this.sqlite.exec(readFileSync(new URL("../migrations/0013_lifecycle_manifest_reconciliation.sql", import.meta.url), "utf8"));
  }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  batch(statements) {
    if (this.beforeBatch) {
      const hook = this.beforeBatch;
      this.beforeBatch = null;
      hook(this.sqlite);
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement, index) => {
        if (this.failAt && index + 1 === this.failAt) throw new Error("injected partial transaction failure");
        return statement.run();
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  activateForTests() {
    this.sqlite.prepare("UPDATE pbe_lifecycle_control SET state = 'ready'").run();
  }
  count(table) { return Number(this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
}

const member = (suffix = "one") => ({
  canonicalAssetId: `asset-${suffix}`,
  canonicalMediaId: `media-${suffix}`,
  bindings: [{ bucket: "public", objectKey: `gallery/${suffix}.jpg` }],
});

const receiptFor = (arm, suffix, denied, lifecycleState) => ({
  receiptId: `receipt-${arm.operationId}-${suffix}`,
  canonicalAssetId: `asset-${suffix}`,
  canonicalMediaId: `media-${suffix}`,
  revision: arm.revision,
  denied,
  lifecycleState,
});

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};
const canonicalDigest = async (value) => Buffer.from(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(canonicalJson(value)),
)).toString("hex");
const abortProofFor = async (arm, overrides = {}) => {
  const armReceiptDigest = await canonicalDigest(arm);
  const body = {
    operationId: arm.operationId,
    operationDigest: arm.operationDigest,
    operation: arm.operation,
    localLifecycleState: "armed",
    localMutationStatus: "absent",
    armReceiptDigest,
    localMutationCommitted: false,
    ...overrides,
  };
  return {
    ...body,
    kind: "owner-sqlite-no-local-commit-v1",
    proofDigest: await canonicalDigest(body),
  };
};

const armCommitApply = async (store, operationId, operation, denied, members) => {
  const arm = await store.armBatch({ operationId, operation, denied, items: members });
  await store.markLocallyCommitted(arm);
  const lifecycleState = denied ? (operation === "empty" ? "tombstoned" : "recoverable") : "restored";
  return {
    arm,
    applied: await store.applyBatch({
      ...arm,
      receipts: members.map((item) => receiptFor(arm, item.canonicalMediaId.replace("media-", ""), denied, lifecycleState)),
    }),
  };
};

const readyStore = async (database, members = [member()]) => {
  const store = createD1LifecycleDenyStore({ database });
  await store.seedVisibleBatch({ seedId: "manifest-ready", items: members });
  await store.activate({ activationId: "activation-ready", ...await summarizeLifecycleManifest(members) });
  return store;
};

const publicMember = (suffix = "one") => ({ ...member(suffix), bindings: [
  { bucket: "public", objectKey: `expo/${suffix}_900.jpg` },
  { bucket: "public", objectKey: `expo/${suffix}_1800.jpg` },
] });

const registrationMember = (suffix = "new") => ({ ...publicMember(suffix), canonicalMediaId: suffix });

test("connector preparation is read-only, hides unrelated bindings and recovers an applied envelope", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database, [{ ...member(), bindings: [
    ...member().bindings, { bucket: "private", objectKey: "masters/secret.jpg" },
  ] }]);
  const input = { prepareOnly: true, actorId: "connector", repairId: "native-run-one", items: [registrationMember()] };
  const before = database.sqlite.prepare("SELECT total_changes() n").get().n;
  const plan = await store.reconcileManifest(input);
  assert.equal(plan.readOnly, true);
  assert.equal(plan.state, "prepared");
  assert.doesNotMatch(JSON.stringify(plan), /secret|masters|gallery\/one/);
  assert.equal(database.sqlite.prepare("SELECT total_changes() n").get().n, before);
  assert.deepEqual(await store.reconcileManifest(input), plan);
  const receipt = await store.reconcileManifest({ ...plan.envelope, actorId: "connector" });
  assert.equal(receipt.state, "applied");
  const replay = await store.reconcileManifest(input);
  assert.equal(replay.state, "applied");
  assert.deepEqual(replay.envelope, plan.envelope);
  assert.deepEqual(await store.reconcileManifest({ ...replay.envelope, actorId: "connector" }), receipt);
  assert.equal((await store.verifyPublicPreviews({ items: input.items })).items[0].allowed, true);
  await assert.rejects(store.reconcileManifest({ ...input, items: [registrationMember("different")] }),
    { code: "public_preview_registration_conflict" });
});

test("preparation rejects private, oversized, aliased, owned and denied registration", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database, [registrationMember("old")]);
  const input = { prepareOnly: true, actorId: "connector", repairId: "bounded", items: [registrationMember()] };
  for (const changes of [
    { actorId: "" }, { repairId: "../unsafe" }, { prepareOnly: "true" },
    { items: [] }, { items: Array.from({length:21}, (_, n) => registrationMember(String(n))) },
    { items: [null] }, { items: [{ ...registrationMember(), canonicalAssetId: 123 }] },
    { items: [{ ...registrationMember(), bindings: [null] }] },
    { items: [{ ...registrationMember(), bindings: [{bucket:"private",objectKey:"masters/new.jpg"}] }] },
    { items: [{ ...registrationMember(), bindings: registrationMember("other").bindings }] },
    { items: [{ ...registrationMember(), canonicalAssetId: "asset-old" }] },
    { items: [registrationMember("old")] },
  ]) await assert.rejects(store.reconcileManifest({ ...input, ...changes }));
  await store.armBatch({ operationId: "deny-old", operation: "x", denied: true, items: [registrationMember("old")] });
  await assert.rejects(store.reconcileManifest({ ...input, items: [{ ...registrationMember(), canonicalAssetId: "asset-old" }] }));
  assert.equal(database.count("pbe_lifecycle_manifest_reconciliations"), 0);
});

test("a recovered registration receipt never reopens a later denied photo", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const input = { prepareOnly: true, actorId: "connector", repairId: "then-denied", items: [registrationMember()] };
  const plan = await store.reconcileManifest(input);
  await store.reconcileManifest({ ...plan.envelope, actorId: "connector" });
  await store.armBatch({ operationId: "deny-new", operation: "x", denied: true, items: input.items });
  const before = database.sqlite.prepare("SELECT total_changes() n").get().n;
  const recovered = await store.reconcileManifest(input);
  await store.reconcileManifest({ ...recovered.envelope, actorId: "connector" });
  assert.equal(database.sqlite.prepare("SELECT total_changes() n").get().n, before);
  assert.equal((await store.verifyPublicPreviews({ items: input.items })).items[0].allowed, false);
});

test("stale registration plans and response-loss retries never create another identity", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const prepare = (id) => store.reconcileManifest({ prepareOnly: true, actorId:"connector", repairId:id, items:[registrationMember(id)] });
  const first = await prepare("first"), stale = await prepare("stale");
  await store.reconcileManifest({ ...first.envelope, actorId:"connector" });
  const count = database.count("pbe_lifecycle_media_identity");
  await assert.rejects(store.reconcileManifest({ ...stale.envelope, actorId:"connector" }), {code:"lifecycle_reconciliation_conflict"});
  assert.equal(database.count("pbe_lifecycle_media_identity"), count);
  const refreshed = await prepare("stale");
  await store.reconcileManifest({ ...refreshed.envelope, actorId:"connector" });
  assert.deepEqual((await prepare("first")).envelope, first.envelope);
});

test("registration rolls back if the authority fence changes just before the transaction", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const plan = await store.reconcileManifest({ prepareOnly:true, actorId:"connector",repairId:"race",items:[registrationMember()] });
  const before = database.count("pbe_lifecycle_media_identity");
  database.beforeBatch = (sqlite) => sqlite.prepare("UPDATE pbe_lifecycle_control SET fencing_epoch=fencing_epoch+1").run();
  await assert.rejects(store.reconcileManifest({ ...plan.envelope, actorId:"connector" }));
  assert.equal(database.count("pbe_lifecycle_media_identity"), before);
  assert.equal(database.count("pbe_lifecycle_manifest_reconciliations"), 0);
  assert.equal(database.sqlite.prepare("SELECT state FROM pbe_lifecycle_control").get().state, "ready");
});

test("public preview observations bind exact identities and keys without writes or private leakage", async () => {
  const database = new TransactionalD1();
  const source = publicMember();
  const store = await readyStore(database, [{ ...source, bindings: [
    ...source.bindings, { bucket: "private", objectKey: "masters/secret.jpg" },
  ] }]);
  const before = database.sqlite.prepare("SELECT total_changes() AS n").get().n;
  for (let retry = 0; retry < 2; retry += 1) {
    const result = await store.verifyPublicPreviews({ items: [source] });
    assert.equal(result.schema, "photosbyelie.publicPreviewObservation.v1");
    assert.equal(result.readOnly, true);
    assert.equal(Date.parse(result.expiresAt) - Date.parse(result.checkedAt), 300000);
    assert.equal(result.items[0].allowed, true);
    assert.equal(result.items[0].canonicalAssetId, source.canonicalAssetId);
    assert.deepEqual(result.items[0].bindings, [...source.bindings].reverse());
    assert.doesNotMatch(JSON.stringify(result), /secret|sourceVersion|private/);
  }
  assert.equal(database.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
});

test("public verification fails closed for missing registration, mismatched identity and swapped allowed keys", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database, [publicMember(), publicMember("two")]);
  const check = async (item) => (await store.verifyPublicPreviews({ items: [item] })).items[0];
  assert.equal((await check(publicMember("missing"))).reason, "identity-missing");
  assert.equal((await check({ ...publicMember(), canonicalAssetId: "wrong-asset" })).reason, "identity-mismatch");
  assert.equal((await check({ ...publicMember(), bindings: publicMember("two").bindings })).reason, "binding-mismatch");
  assert.equal((await check({ ...publicMember(), bindings: publicMember("missing").bindings })).reason, "binding-missing");
  const arm = await store.armBatch({ operationId: "op-public-deny", operation: "x", denied: true, items: [publicMember()] });
  assert.equal((await check(publicMember())).reason, "barrier-armed");
  await store.markLocallyCommitted(arm);
  await store.applyBatch({ ...arm, receipts: [receiptFor(arm, "one", true, "recoverable")] });
  assert.equal((await check(publicMember())).allowed, false);
});

test("public verification bounds its batch and fails closed on unavailable authority", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database, [publicMember()]);
  for (const items of [[], Array.from({ length: 21 }, (_, n) => publicMember(String(n))),
    [{ ...publicMember(), bindings: [{ bucket: "private", objectKey: "masters/one.jpg" }] }],
    [{ ...publicMember(), bindings: [publicMember().bindings[0]] }],
    [{ ...publicMember(), bindings: [publicMember().bindings[0], publicMember("two").bindings[1]] }]]) {
    await assert.rejects(store.verifyPublicPreviews({ items }));
  }
  database.sqlite.prepare("UPDATE pbe_lifecycle_control SET state='blocked'").run();
  await assert.rejects(store.verifyPublicPreviews({ items: [publicMember()] }), { code: "lifecycle_authority_unavailable" });
});

test("migration installs blocked dedicated ACCESS_DB authority and runtime does no DDL", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  await assert.rejects(store.assertAllowed(["media-one"]), { code: "lifecycle_authority_unavailable" });
  const source = readFileSync(new URL("./lifecycle-deny-store.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CREATE TABLE/i);
  assert.equal(database.count("pbe_lifecycle_operations"), 0);
});

test("activation commits the exact ordered manifest digest and freezes mappings", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  await store.seedVisibleBatch({ seedId: "manifest-1", items: [member()] });
  await assert.rejects(store.activate({
    activationId: "activate-1",
    ...await summarizeLifecycleManifest([{ ...member(), bindings: [{ bucket: "public", objectKey: "wrong.jpg" }] }]),
  }), {
    code: "lifecycle_activation_coverage_mismatch",
  });
  const activated = await store.activate({ activationId: "activate-1", ...await summarizeLifecycleManifest([member()]) });
  assert.match(activated.activationDigest, /^[a-f0-9]{64}$/);
  await store.assertObjectAllowed({ bucket: "public", objectKey: "gallery/one.jpg" });
  await assert.rejects(store.assertObjectAllowed({ bucket: "public", objectKey: "gallery/missing.jpg" }), {
    code: "lifecycle_object_binding_missing",
  });
  await assert.rejects(store.armBatch({ operationId: "op-invented", operation: "x", denied: true, items: [member("new")] }), {
    code: "lifecycle_identity_conflict",
  });
  assert.equal(database.count("pbe_lifecycle_media_identity"), 1);
});

test("seed cannot add identity after activation wins the race", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  database.beforeBatch = (sqlite) => sqlite.prepare(
    "UPDATE pbe_lifecycle_control SET state = 'ready' WHERE control_id = 'global'",
  ).run();
  await assert.rejects(
    store.seedVisibleBatch({ seedId: "manifest-raced", items: [member()] }),
    { code: "lifecycle_seed_closed" },
  );
  assert.equal(database.count("pbe_lifecycle_media_identity"), 0);
  assert.equal(database.count("pbe_lifecycle_projection"), 0);
  assert.equal(database.count("pbe_lifecycle_media_bindings"), 0);
});

test("seed replay survives activation but conflicting reuse is rejected", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  const first = await store.seedVisibleBatch({ seedId: "manifest-replay", items: [member()] });
  await store.activate({ activationId: "activation-replay", ...await summarizeLifecycleManifest([member()]) });
  assert.deepEqual(
    await store.seedVisibleBatch({ seedId: "manifest-replay", items: [member()] }),
    first,
  );
  await assert.rejects(
    store.seedVisibleBatch({ seedId: "manifest-replay", items: [member("other")] }),
    { code: "lifecycle_seed_conflict" },
  );
  assert.equal(database.count("pbe_lifecycle_media_identity"), 1);
});

test("ready manifest reconciliation extends authority atomically and replays", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const extension = {
    ...member("two"),
    bindings: [
      { bucket: "private", objectKey: "masters/two.jpg" },
      { bucket: "public", objectKey: "gallery/two.jpg" },
    ],
  };
  const previous = await summarizeLifecycleManifest([member()]);
  const next = await summarizeLifecycleManifest([member(), extension]);
  const seedId = "manifest-repair-seed";
  const seedMembers = [{
    canonicalAssetId: extension.canonicalAssetId,
    canonicalMediaId: extension.canonicalMediaId,
    bindings: extension.bindings,
  }];
  const seedDigest = await canonicalDigest({ seedId, members: seedMembers });
  const request = {
    repairId: "manifest-repair-1",
    actorId: "max",
    previousActivationId: "activation-ready",
    previousActivationDigest: previous.activationDigest,
    previousMediaCount: previous.expectedMediaCount,
    previousBindingCount: previous.expectedBindingCount,
    activationId: "activation-reconciled",
    activationDigest: next.activationDigest,
    expectedMediaCount: next.expectedMediaCount,
    expectedBindingCount: next.expectedBindingCount,
    seedId,
    seedDigest,
    items: seedMembers,
  };

  const applied = await store.reconcileManifest(request);
  assert.equal(applied.state, "applied");
  assert.equal(applied.mediaCount, 2);
  assert.equal(applied.bindingCount, 3);
  assert.equal(applied.addedMediaCount, 1);
  assert.equal(applied.addedBindingCount, 2);
  assert.equal(database.count("pbe_lifecycle_media_identity"), 2);
  assert.equal(database.count("pbe_lifecycle_media_bindings"), 3);
  assert.equal(database.count("pbe_lifecycle_projection"), 2);
  assert.equal(database.count("pbe_lifecycle_manifest_reconciliations"), 1);
  await store.assertObjectAllowed({ bucket: "private", objectKey: "masters/two.jpg" });
  await assert.doesNotReject(store.armBatch({
    operationId: "op-reconciled",
    operation: "empty",
    denied: true,
    items: [extension],
  }));
  assert.deepEqual(await store.reconcileManifest(request), applied);
});

test("one failed arm statement rolls back the whole operation", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  database.failAt = 2;
  await assert.rejects(store.armBatch({ operationId: "op-fail", operation: "x", denied: true, items: [member()] }));
  assert.equal(database.count("pbe_lifecycle_operations"), 0);
  assert.equal(database.count("pbe_lifecycle_barriers"), 0);
  assert.equal(database.count("pbe_lifecycle_media_bindings"), 1);
});

test("activation ready transition rolls back with its durable manifest row", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  await store.seedVisibleBatch({ seedId: "manifest-atomic", items: [member()] });
  database.failAt = 2;
  await assert.rejects(store.activate({ activationId: "activation-atomic", ...await summarizeLifecycleManifest([member()]) }));
  assert.equal(database.sqlite.prepare("SELECT state FROM pbe_lifecycle_control").get().state, "blocked");
  assert.equal(database.count("pbe_lifecycle_activations"), 0);
});

test("activation rejects projection rows that do not exactly match canonical identity", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  await store.seedVisibleBatch({ seedId: "manifest-projection", items: [member()] });
  database.sqlite.prepare("UPDATE pbe_lifecycle_projection SET canonical_asset_id = ? WHERE canonical_media_id = ?")
    .run("asset-wrong", "media-one");
  await assert.rejects(store.activate({
    activationId: "activation-projection",
    ...await summarizeLifecycleManifest([member()]),
  }), { code: "lifecycle_activation_coverage_mismatch" });
  assert.equal(database.sqlite.prepare("SELECT state FROM pbe_lifecycle_control").get().state, "blocked");
});

test("activation verifies a large paged manifest without storing manifest JSON", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  const members = Array.from({ length: 2651 }, (_, index) => member(String(index).padStart(4, "0")));
  for (let index = 0; index < members.length; index += 100) {
    await store.seedVisibleBatch({ seedId: `manifest-large-${index / 100}`, items: members.slice(index, index + 100) });
  }
  const summary = await summarizeLifecycleManifest(members);
  const activated = await store.activate({ activationId: "activation-large", ...summary });
  assert.equal(activated.mediaCount, 2651);
  assert.equal(activated.bindingCount, 2651);
  assert.equal(database.sqlite.prepare("PRAGMA table_info(pbe_lifecycle_activations)").all()
    .some((column) => column.name === "manifest_json"), false);
  assert.equal(database.sqlite.prepare("SELECT expected_row_count FROM pbe_lifecycle_activations").get().expected_row_count, 5302);
});

test("armed barriers survive response loss and same digest replay returns the same revision", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const request = { operationId: "op-response-loss", operation: "x", denied: true, items: [member()] };
  const first = await store.armBatch(request);
  const replay = await store.armBatch(request);
  assert.equal(replay.revision, first.revision);
  await assert.rejects(store.assertAllowed(["media-one"]), { code: "asset_lifecycle_denied" });
  await assert.rejects(store.armBatch({ ...request, denied: false }), { code: "lifecycle_barrier_semantics_invalid" });
  await assert.rejects(store.abort({ operationId: first.operationId, operationDigest: first.operationDigest, proof: {} }), {
    code: "lifecycle_abort_proof_required",
  });
});

test("paid fulfillment settlement and deny arm share one authoritative D1 ordering point", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  const ready = await store.commitFulfillmentReady({
    orderId: "order-ready-then-denied",
    mediaIds: ["media-one"],
    fence,
  });
  assert.equal(ready.state, "ready");
  assert.deepEqual(await store.commitFulfillmentReady({
    orderId: "order-ready-then-denied",
    mediaIds: ["media-one"],
    fence,
  }), ready);

  const arm = await store.armBatch({ operationId: "op-order-deny", operation: "x", denied: true, items: [member()] });
  assert.equal((await store.fulfillmentFor("order-ready-then-denied")).state, "blocked_pending_lifecycle");
  await store.markLocallyCommitted(arm);
  await store.applyBatch({ ...arm, receipts: [receiptFor(arm, "one", true, "recoverable")] });
  assert.deepEqual(await store.fulfillmentFor("order-ready-then-denied"), {
    ...ready,
    state: "manual_refund_review",
    lifecycleOperationId: arm.operationId,
    updatedAt: (await store.fulfillmentFor("order-ready-then-denied")).updatedAt,
  });
});

test("aborting an uncommitted deny arm restores a temporarily blocked fulfillment", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  await store.commitFulfillmentReady({ orderId: "order-arm-aborts", mediaIds: ["media-one"], fence });
  const arm = await store.armBatch({ operationId: "op-order-abort", operation: "x", denied: true, items: [member()] });
  assert.equal((await store.fulfillmentFor("order-arm-aborts")).state, "blocked_pending_lifecycle");
  await store.abort({ ...arm, proof: await abortProofFor(arm) });
  assert.equal((await store.fulfillmentFor("order-arm-aborts")).state, "ready");
});

test("applied denial keeps manual refund review monotonic across a later restore", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  await store.commitFulfillmentReady({ orderId: "order-denied-restored", mediaIds: ["media-one"], fence });
  await armCommitApply(store, "op-order-applied-deny", "x", true, [member()]);
  assert.equal((await store.fulfillmentFor("order-denied-restored")).state, "manual_refund_review");
  await armCommitApply(store, "op-order-later-restore", "restore", false, [member()]);
  assert.equal((await store.fulfillmentFor("order-denied-restored")).state, "manual_refund_review");
});

test("download capabilities are settlement-bound and stop authorizing on an arm", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  await store.commitFulfillmentReady({ orderId: "order-capability", mediaIds: ["media-one"], fence });
  const authorized = await store.authorizeDownloadCapability({ orderId: "order-capability", token: "secret-token" });
  assert.match(authorized.tokenDigest, /^[a-f0-9]{64}$/);
  await store.assertDownloadCapability({ orderId: "order-capability", token: "secret-token" });
  await assert.rejects(store.assertDownloadCapability({ orderId: "order-capability", token: "other-token" }), {
    code: "lifecycle_download_capability_denied",
  });
  await store.armBatch({ operationId: "op-capability-deny", operation: "x", denied: true, items: [member()] });
  await assert.rejects(store.assertDownloadCapability({ orderId: "order-capability", token: "secret-token" }), {
    code: "lifecycle_download_capability_denied",
  });
  await assert.rejects(store.authorizeDownloadCapability({ orderId: "order-capability", token: "late-token" }), {
    code: "lifecycle_download_capability_denied",
  });
});

test("email dispatch claims are idempotent and denied after the settlement is armed", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  await store.commitFulfillmentReady({ orderId: "order-email", mediaIds: ["media-one"], fence });
  const claim = await store.claimEmailDispatch({ orderId: "order-email", idempotencyKey: "email-key" });
  assert.equal(claim.state, "claimed");
  assert.equal((await store.claimEmailDispatch({ orderId: "order-email", idempotencyKey: "email-key" })).dispatchDigest, claim.dispatchDigest);
  assert.equal((await store.completeEmailDispatch({
    orderId: "order-email", idempotencyKey: "email-key", outcome: "failed",
  })).state, "failed");
  assert.equal((await store.completeEmailDispatch({
    orderId: "order-email", idempotencyKey: "email-key", outcome: "sent", providerMessageId: "provider-one",
  })).state, "sent");
  await assert.rejects(store.completeEmailDispatch({
    orderId: "order-email", idempotencyKey: "email-key", outcome: "failed",
  }), { code: "lifecycle_email_dispatch_conflict" });
  await store.armBatch({ operationId: "op-email-deny", operation: "x", denied: true, items: [member()] });
  await assert.rejects(store.claimEmailDispatch({ orderId: "order-email", idempotencyKey: "late-email-key" }), {
    code: "lifecycle_email_dispatch_denied",
  });
});

test("an already armed deny prevents a paid fulfillment settlement", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  await store.armBatch({ operationId: "op-before-order", operation: "x", denied: true, items: [member()] });
  await assert.rejects(store.commitFulfillmentReady({
    orderId: "order-denied-first",
    mediaIds: ["media-one"],
    fence,
  }), { code: "lifecycle_fence_changed" });
  assert.equal(await store.fulfillmentFor("order-denied-first"), null);
});

test("arm rejects operation and denied-state contradictions", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  await assert.rejects(
    store.armBatch({ operationId: "op-visible-x", operation: "x", denied: false, items: [member()] }),
    { code: "lifecycle_barrier_semantics_invalid" },
  );
  await assert.rejects(
    store.armBatch({ operationId: "op-denied-restore", operation: "restore", denied: true, items: [member()] }),
    { code: "lifecycle_barrier_semantics_invalid" },
  );
  assert.equal(database.count("pbe_lifecycle_operations"), 0);
  assert.equal(database.count("pbe_lifecycle_barriers"), 0);
});

test("abort accepts only an exact canonical proof for the durable armed operation", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const arm = await store.armBatch({ operationId: "op-abort", operation: "x", denied: true, items: [member()] });
  const validProof = await abortProofFor(arm);

  await assert.rejects(store.abort({ ...arm, proof: { ...validProof, proofDigest: "0".repeat(64) } }), {
    code: "lifecycle_abort_proof_invalid",
  });
  await assert.rejects(store.abort({ ...arm, proof: await abortProofFor(arm, { operation: "empty" }) }), {
    code: "lifecycle_abort_proof_invalid",
  });
  await assert.rejects(store.abort({ ...arm, proof: await abortProofFor(arm, { armReceiptDigest: "0".repeat(64) }) }), {
    code: "lifecycle_abort_proof_invalid",
  });
  await assert.rejects(store.abort({ ...arm, proof: await abortProofFor(arm, { localMutationStatus: "committed" }) }), {
    code: "lifecycle_abort_proof_invalid",
  });
  await assert.rejects(store.abort({ ...arm, proof: { ...validProof, unexpected: true } }), {
    code: "lifecycle_abort_proof_required",
  });
  assert.equal((await store.abort({ ...arm, proof: validProof })).state, "aborted");
  assert.equal((await store.abort({ ...arm, proof: validProof })).state, "aborted");
  await assert.rejects(store.abort({
    ...arm,
    proof: { ...validProof, localMutationStatus: "failed" },
  }), { code: "lifecycle_abort_conflict" });
  assert.equal(database.count("pbe_lifecycle_barriers"), 0);
});

test("local commit, deploy apply, duplicate apply, and ACK are monotonic", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const arm = await store.armBatch({ operationId: "op-x", operation: "x", denied: true, items: [member()] });
  await assert.rejects(store.applyBatch({
    ...arm,
    receipts: [receiptFor(arm, "one", true, "recoverable")],
  }), { code: "lifecycle_local_commit_required" });
  await assert.rejects(store.markLocallyCommitted({ operationId: "missing", operationDigest: "missing" }), {
    code: "lifecycle_operation_conflict",
  });
  await store.markLocallyCommitted(arm);
  await assert.rejects(store.applyBatch({
    ...arm,
    receipts: [receiptFor(arm, "one", true, "tombstoned")],
  }), { code: "lifecycle_receipt_semantics_invalid" });
  const applied = await store.applyBatch({ ...arm, receipts: [receiptFor(arm, "one", true, "recoverable")] });
  const replay = await store.applyBatch({ ...arm, receipts: [receiptFor(arm, "one", true, "recoverable")] });
  assert.equal(applied.state, "deployed_applied");
  assert.equal(replay.receipts.length, 1);
  await assert.rejects(store.applyBatch({
    ...arm,
    receipts: [{ ...receiptFor(arm, "one", true, "recoverable"), receiptId: "conflicting-receipt" }],
  }), { code: "lifecycle_receipt_conflict" });
  assert.equal((await store.markLocallyCommitted(arm)).state, "deployed_applied");
  assert.equal((await store.acknowledge(arm)).state, "locally_acked");
  assert.equal((await store.markLocallyCommitted(arm)).state, "locally_acked");
  await assert.rejects(store.assertAllowed(["media-one"]), { code: "asset_lifecycle_denied" });
});

test("allowed fences reject a lifecycle revision change during a protected operation", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const fence = await store.assertAllowed(["media-one"], "fulfillment:start");
  const restore = await store.armBatch({ operationId: "op-fence-restore", operation: "restore", denied: false, items: [member()] });
  await store.markLocallyCommitted(restore);
  await store.applyBatch({ ...restore, receipts: [receiptFor(restore, "one", false, "restored")] });
  await assert.rejects(store.assertAllowed(["media-one"], "fulfillment:commit", fence), {
    code: "lifecycle_fence_changed",
  });
});

test("late deny cannot override higher restore and restore requires its applied higher revision", async () => {
  const database = new TransactionalD1();
  const store = await readyStore(database);
  const deny = await store.armBatch({ operationId: "op-deny", operation: "x", denied: true, items: [member()] });
  await store.markLocallyCommitted(deny);
  const restore = await store.armBatch({ operationId: "op-restore", operation: "restore", denied: false, items: [member()] });
  await store.markLocallyCommitted(restore);
  await assert.rejects(store.assertAllowed(["media-one"]), { code: "asset_lifecycle_denied" });
  await store.applyBatch({ ...restore, receipts: [receiptFor(restore, "one", false, "restored")] });
  await store.assertAllowed(["media-one"]);
  const late = await store.applyBatch({ ...deny, receipts: [receiptFor(deny, "one", true, "recoverable")] });
  assert.equal(late.receipts[0].outcome, "stale");
  await store.assertAllowed(["media-one"]);
});

test("missing projection and missing authority fail closed", async () => {
  const database = new TransactionalD1();
  const store = createD1LifecycleDenyStore({ database });
  database.activateForTests();
  await assert.rejects(store.assertAllowed(["media-unknown"]), { code: "asset_lifecycle_denied" });
  const missing = createD1LifecycleDenyStore({ database: {
    prepare: () => ({ bind() { return this; }, first() { throw new Error("no database"); } }),
    batch: () => { throw new Error("no database"); },
  } });
  await assert.rejects(missing.assertAllowed(["media-one"]), { code: "lifecycle_authority_unavailable" });
});
