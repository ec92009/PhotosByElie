import assert from "node:assert/strict";
import test from "node:test";

import { createMemorySidecarStateStore } from "./sidecar-state-store.mjs";

const legacyMigration = {
  kind: "PBB-78-legacy-expo-hidden",
  planDigest: "synthetic-plan",
  auditReceipt: "synthetic-receipt",
};

test("Sidecar upsert rejects active tombstones without the audited legacy marker", async () => {
  const store = createMemorySidecarStateStore();
  await assert.rejects(
    () => store.putDecision({ assetId: "asset-1", state: { tombstoneState: "active" } }),
    /Direct global tombstone writes are disabled/
  );

  const result = await store.putDecision({
    assetId: "asset-1",
    state: { tombstoneState: "active", tombstoneReason: "legacy migration" },
    legacyMigration,
  });
  assert.equal(result.tombstoneState, "active");
});

test("Sidecar action tombstones remain marker-gated and batch-safe", async () => {
  const store = createMemorySidecarStateStore();
  await assert.rejects(
    () => store.applyDecision({ assetId: "asset-2", action: "tombstone" }),
    /Direct global tombstone writes are disabled/
  );

  const result = await store.applyDecisions([
    {
      assetId: "asset-2",
      action: "tombstone",
      reason: "legacy migration",
      legacyMigration,
    },
  ]);
  assert.equal(result[0].state.tombstoneState, "active");
});
