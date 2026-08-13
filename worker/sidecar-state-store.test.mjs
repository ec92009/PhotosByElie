import assert from "node:assert/strict";
import test from "node:test";

import { createMemorySidecarStateStore } from "./sidecar-state-store.mjs";

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
