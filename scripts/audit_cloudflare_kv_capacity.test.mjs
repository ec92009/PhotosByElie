import assert from "node:assert/strict";
import test from "node:test";

import { auditCapacity, buildCapacityReport } from "./audit_cloudflare_kv_capacity.mjs";

test("capacity report calculates recent paid projection and free-plan breach", () => {
  const report = buildCapacityReport({
    operationRows: [
      { dimensions: { date: "2026-08-05", actionType: "write" }, sum: { requests: 12_000 } },
      { dimensions: { date: "2026-08-05", actionType: "read" }, sum: { requests: 30_000 } },
      { dimensions: { date: "2026-08-06", actionType: "write" }, sum: { requests: 8_000 } },
    ],
    storageRows: [
      { dimensions: { date: "2026-08-06" }, max: { keyCount: 1_400, byteCount: 250_000_000 } },
    ],
    window: { start: "2026-08-05", end: "2026-08-06", days: 2 },
    generatedAt: "2026-08-06T00:00:00.000Z",
  });

  assert.equal(report.operations.totals.write, 20_000);
  assert.equal(report.operations.peakWriteDay.write, 12_000);
  assert.equal(report.operations.recent.projectedWritesPer30Days, 300_000);
  assert.equal(report.capacity.freeWriteLimitExceededOnPeakDay, true);
  assert.equal(report.capacity.projectedPaidWriteAllowanceUsedPercent, 30);
  assert.equal(report.capacity.paidStorageAllowanceUsedPercent, 25);
});

test("live audit uses bearer auth without exposing the token in its report", async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.authorization, "Bearer secret-token");
    const request = JSON.parse(options.body);
    const data = request.query.includes("KvOperations")
      ? { kvOperationsAdaptiveGroups: [{ dimensions: { date: "2026-08-06", actionType: "write" }, sum: { requests: 500 } }] }
      : { kvStorageAdaptiveGroups: [{ dimensions: { date: "2026-08-06" }, max: { keyCount: 10, byteCount: 1000 } }] };
    return new Response(JSON.stringify({ data: { viewer: { accounts: [data] } } }), { status: 200 });
  };

  const report = await auditCapacity({
    fetchImpl,
    token: "secret-token",
    accountId: "account",
    namespaceId: "namespace",
    endDate: "2026-08-06",
    days: 1,
  });

  assert.equal(report.operations.totals.write, 500);
  assert.equal(JSON.stringify(report).includes("secret-token"), false);
});
