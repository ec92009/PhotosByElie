import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsStore } from "./analytics-store.mjs";

const createCountingNamespace = () => {
  const values = new Map();
  const writes = [];
  return {
    async get(key, options = {}) {
      const value = values.get(key);
      if (value == null) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value, options) {
      writes.push({ key, value, options });
      values.set(key, String(value));
    },
    writes,
    values,
  };
};

const events = (count) => Array.from({ length: count }, (_, index) => ({
  event: "page_view",
  path: `/gallery/${index}`,
  sessionId: `session-${index}`,
  email: "buyer@example.com",
  orderId: "PBE-private",
}));

test("analytics batch aggregation writes one count row for twenty events", async () => {
  const namespace = createCountingNamespace();
  const store = createAnalyticsStore({
    namespace,
    prefix: "test",
    persistEvents: false,
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  const saved = await store.putEvents(events(20));

  assert.equal(saved.length, 20);
  assert.equal(namespace.writes.length, 1);
  assert.equal(namespace.writes[0].key, "test:analytics:counts:2026-08-02:page_view");
  assert.equal(JSON.parse(namespace.writes[0].value).count, 20);
});

test("analytics event persistence is opt-in and still aggregates the batch", async () => {
  const namespace = createCountingNamespace();
  const store = createAnalyticsStore({
    namespace,
    prefix: "test",
    persistEvents: true,
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  await store.putEvents(events(20));

  const eventWrites = namespace.writes.filter(({ key }) => key.startsWith("test:analytics:events:2026-08-02:"));
  const countWrites = namespace.writes.filter(({ key }) => key === "test:analytics:counts:2026-08-02:page_view");
  assert.equal(eventWrites.length, 20);
  assert.equal(countWrites.length, 1);
  assert.equal(namespace.writes.length, 21);
  assert.equal(JSON.parse(countWrites[0].value).count, 20);
});
