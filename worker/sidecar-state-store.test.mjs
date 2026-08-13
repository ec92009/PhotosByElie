import assert from "node:assert/strict";
import test from "node:test";

import {
  createD1SidecarStateStore,
  createMemorySidecarStateStore,
} from "./sidecar-state-store.mjs";

test("Sidecar upsert rejects every tombstone-family write", async () => {
  const store = createMemorySidecarStateStore();
  await assert.rejects(
    () => store.putDecision({ assetId: "asset-1", state: { tombstoneState: "active" } }),
    /Sidecar tombstone-family writes are disabled/
  );

  await assert.rejects(
    () => store.putDecision({ assetId: "asset-1", state: { tombstoneState: "restored" } }),
    /Sidecar tombstone-family writes are disabled/
  );
});

test("Sidecar action restore and tombstone cannot bypass the Waste Basket gateway", async () => {
  const store = createMemorySidecarStateStore();
  await assert.rejects(
    () => store.applyDecision({ assetId: "asset-2", action: "tombstone" }),
    /Sidecar lifecycle writes are disabled/
  );
  await assert.rejects(
    () => store.applyDecision({ assetId: "asset-2", action: "restore" }),
    /Sidecar lifecycle writes are disabled/
  );
});

test("D1 editorial batch strips lifecycle input and preserves stored tombstone state", async () => {
  const batches = [];
  const currentRow = {
    asset_id: "asset-d1",
    rating: 0,
    color: "",
    pick_state: "undecided",
    metadata_state: "blocked",
    title: "",
    keywords_json: "[]",
    rework_category: "",
    rework_comment: "",
    metadata_ai_rung: "",
    metadata_ai_evidence_json: "[]",
    metadata_ai_note: "",
    metadata_ai_attempt_count: 0,
    metadata_ai_last_error: "",
    metadata_ai_last_attempt_at: "",
    tombstone_state: "active",
    tombstone_reason: "gateway receipt",
    tombstoned_at: "2026-08-13T12:00:00Z",
    pending_sync_count: 0,
    last_action: "waste-basket-empty",
    updated_at: "2026-08-13T12:00:00Z",
  };
  const database = {
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          return {
            sql,
            values,
            async all() {
              return { results: sql.includes("FROM pbe_sidecar_decisions") ? [currentRow] : [] };
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };
  const store = createD1SidecarStateStore({
    database,
    now: () => new Date("2026-08-13T12:01:00Z"),
    randomUUID: () => "d1-batch-test",
  });

  const results = await store.applyDecisions([
    { assetId: "asset-d1", action: "rating", rating: 5 },
    { assetId: "asset-d1", action: "pick" },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[1].state.rating, 5);
  assert.equal(results[1].state.pickState, "picked");
  assert.equal(results[1].state.tombstoneState, "active");
  assert.equal(results[1].state.tombstoneReason, "gateway receipt");
  assert.equal(batches.length, 1);
  assert.equal(batches[0].filter((statement) => statement.sql.includes("pbe_sidecar_decisions")).length, 1);

  await assert.rejects(
    () => store.applyDecisions([{ assetId: "asset-d1", action: "restore" }]),
    /Sidecar lifecycle writes are disabled/
  );
});
