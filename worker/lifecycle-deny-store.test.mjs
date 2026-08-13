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
  assert.equal((await store.markLocallyCommitted(arm)).state, "deployed_applied");
  assert.equal((await store.acknowledge(arm)).state, "locally_acked");
  assert.equal((await store.markLocallyCommitted(arm)).state, "locally_acked");
  await assert.rejects(store.assertAllowed(["media-one"]), { code: "asset_lifecycle_denied" });
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
