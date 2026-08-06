import assert from "node:assert/strict";
import test from "node:test";

import { createKvOwnerActionStore } from "./owner-action-store.mjs";

const countingNamespace = () => {
  const values = new Map();
  const writes = [];
  return {
    async get(key, options = {}) {
      const value = values.get(key);
      if (value == null) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value, options) {
      values.set(key, String(value));
      writes.push({ key, options });
    },
    async delete(key) {
      values.delete(key);
    },
    async list() {
      return { keys: [] };
    },
    values,
    writes,
  };
};

const connector = (lastSeenAt, overrides = {}) => ({
  id: "max",
  state: "online",
  hostname: "Max.local",
  platform: "macos arm64",
  version: "1.5",
  capabilities: ["apple-photos", "sidecar"],
  lastSeenAt,
  ...overrides,
});

test("KV connector heartbeats coalesce unchanged presence writes", async () => {
  const namespace = countingNamespace();
  const store = createKvOwnerActionStore({ namespace, prefix: "test" });

  await store.putConnector(connector("2026-08-06T10:00:00.000Z"));
  assert.deepEqual(namespace.writes.map(({ key }) => key), [
    "test:owner-connectors:max",
    "test:owner-connector-head",
  ]);

  const response = await store.putConnector(connector("2026-08-06T10:01:00.000Z"));
  assert.equal(response.lastSeenAt, "2026-08-06T10:01:00.000Z");
  assert.equal(namespace.writes.length, 2);

  await store.putConnector(connector("2026-08-06T10:05:00.000Z"));
  assert.equal(namespace.writes.length, 3);
  assert.equal(namespace.writes[2].key, "test:owner-connectors:max");

  await store.putConnector(connector("2026-08-06T10:05:30.000Z", { version: "1.6" }));
  assert.equal(namespace.writes.length, 4);
  assert.equal(namespace.writes[3].key, "test:owner-connectors:max");
});

test("KV interactive leases write only when the persisted window runs low", async () => {
  const namespace = countingNamespace();
  const store = createKvOwnerActionStore({ namespace, prefix: "test" });
  const lease = (updatedAt, activeUntil, surface = "owner") => ({
    connectorId: "max",
    surface,
    updatedAt,
    activeUntil,
  });

  await store.putInteractiveLease("max", lease("2026-08-06T10:00:00.000Z", "2026-08-06T10:05:00.000Z"));
  assert.equal(namespace.writes.length, 1);
  assert.equal(namespace.writes[0].options.expirationTtl, 600);

  const response = await store.putInteractiveLease("max", lease("2026-08-06T10:00:10.000Z", "2026-08-06T10:05:10.000Z"));
  assert.equal(response.activeUntil, "2026-08-06T10:05:10.000Z");
  assert.equal(namespace.writes.length, 1);

  await store.putInteractiveLease("max", lease("2026-08-06T10:03:01.000Z", "2026-08-06T10:08:01.000Z"));
  assert.equal(namespace.writes.length, 2);

  await store.putInteractiveLease("max", lease("2026-08-06T10:03:02.000Z", "2026-08-06T10:08:02.000Z", "review"));
  assert.equal(namespace.writes.length, 3);
});
