#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_ACCOUNT_ID = "26aa9df8b20960f20cf0e8dba5cb2f88";
const DEFAULT_NAMESPACE_ID = "0ea4d21c491246c986c2c0308bebc560";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

export const CURRENT_LIMITS = {
  snapshotDate: "2026-08-06",
  free: { writesPerDay: 1_000, storageBytes: 1_000_000_000 },
  paid: { includedWritesPerMonth: 1_000_000, includedStorageBytes: 1_000_000_000 },
  sources: [
    "https://developers.cloudflare.com/kv/platform/pricing/",
    "https://developers.cloudflare.com/workers/platform/pricing/",
    "https://developers.cloudflare.com/kv/observability/metrics-analytics/",
  ],
};

const parseArgs = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [key, inlineValue] = item.slice(2).split("=", 2);
    const value = inlineValue ?? (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true");
    values.set(key, value);
  }
  return values;
};

const isoDate = (date) => date.toISOString().slice(0, 10);

const dateWindow = (endDate, days) => {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const boundedDays = Math.max(1, Math.min(31, Number(days) || 31));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (boundedDays - 1));
  return { start: isoDate(start), end: isoDate(end), days: boundedDays };
};

const queryCloudflare = async (fetchImpl, token, query, variables) => {
  const response = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const messages = (payload.errors || []).map((error) => error.message).filter(Boolean);
    throw new Error(messages.join("; ") || `Cloudflare GraphQL returned HTTP ${response.status}.`);
  }
  return payload.data?.viewer?.accounts?.[0] || {};
};

const OPERATIONS_QUERY = `query KvOperations($accountTag: string!, $namespaceId: string, $start: Date, $end: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvOperationsAdaptiveGroups(
        filter: { namespaceId: $namespaceId, date_geq: $start, date_leq: $end }
        limit: 10000
        orderBy: [date_ASC]
      ) {
        sum { requests }
        dimensions { date actionType }
      }
    }
  }
}`;

const STORAGE_QUERY = `query KvStorage($accountTag: string!, $namespaceId: string, $start: Date, $end: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvStorageAdaptiveGroups(
        filter: { namespaceId: $namespaceId, date_geq: $start, date_leq: $end }
        limit: 10000
        orderBy: [date_ASC]
      ) {
        max { keyCount byteCount }
        dimensions { date }
      }
    }
  }
}`;

const summarizeOperations = (rows, recentDays = 7) => {
  const byDate = new Map();
  for (const row of rows) {
    const date = String(row?.dimensions?.date || "");
    const action = String(row?.dimensions?.actionType || "unknown");
    const requests = Math.max(0, Number(row?.sum?.requests) || 0);
    if (!date) continue;
    const day = byDate.get(date) || { date, read: 0, write: 0, delete: 0, list: 0, total: 0 };
    day[action] = Number(day[action] || 0) + requests;
    day.total += requests;
    byDate.set(date, day);
  }
  const daily = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const totals = daily.reduce((sum, day) => {
    for (const action of ["read", "write", "delete", "list", "total"]) sum[action] += Number(day[action] || 0);
    return sum;
  }, { read: 0, write: 0, delete: 0, list: 0, total: 0 });
  const recent = daily.slice(-Math.max(1, recentDays));
  const recentWrites = recent.reduce((sum, day) => sum + day.write, 0);
  const peakWriteDay = daily.reduce((peak, day) => day.write > peak.write ? { date: day.date, write: day.write } : peak, { date: "", write: 0 });
  return {
    daily,
    totals,
    peakWriteDay,
    recent: {
      days: recent.length,
      writes: recentWrites,
      averageWritesPerDay: recent.length ? Math.round(recentWrites / recent.length) : 0,
      projectedWritesPer30Days: recent.length ? Math.round((recentWrites / recent.length) * 30) : 0,
    },
  };
};

export const buildCapacityReport = ({
  operationRows = [],
  storageRows = [],
  accountId = DEFAULT_ACCOUNT_ID,
  namespaceId = DEFAULT_NAMESPACE_ID,
  window,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const operations = summarizeOperations(operationRows);
  const latestStorageRow = [...storageRows]
    .sort((left, right) => String(left?.dimensions?.date || "").localeCompare(String(right?.dimensions?.date || "")))
    .at(-1);
  const storage = {
    date: String(latestStorageRow?.dimensions?.date || ""),
    keyCount: Math.max(0, Number(latestStorageRow?.max?.keyCount) || 0),
    byteCount: Math.max(0, Number(latestStorageRow?.max?.byteCount) || 0),
  };
  const projectedWrites = operations.recent.projectedWritesPer30Days;
  return {
    schemaVersion: 1,
    generatedAt,
    source: "Cloudflare GraphQL Analytics API",
    adaptiveEstimates: true,
    accountId,
    namespaceId,
    window,
    operations,
    storage,
    limits: CURRENT_LIMITS,
    capacity: {
      freeWriteLimitExceededOnPeakDay: operations.peakWriteDay.write > CURRENT_LIMITS.free.writesPerDay,
      projectedPaidWriteAllowanceUsedPercent: CURRENT_LIMITS.paid.includedWritesPerMonth
        ? Number(((projectedWrites / CURRENT_LIMITS.paid.includedWritesPerMonth) * 100).toFixed(1))
        : null,
      paidStorageAllowanceUsedPercent: CURRENT_LIMITS.paid.includedStorageBytes
        ? Number(((storage.byteCount / CURRENT_LIMITS.paid.includedStorageBytes) * 100).toFixed(2))
        : null,
    },
  };
};

export const auditCapacity = async ({
  fetchImpl = fetch,
  token,
  accountId = DEFAULT_ACCOUNT_ID,
  namespaceId = DEFAULT_NAMESPACE_ID,
  endDate = isoDate(new Date()),
  days = 31,
} = {}) => {
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required for the read-only capacity audit.");
  const window = dateWindow(endDate, days);
  const variables = { accountTag: accountId, namespaceId, start: window.start, end: window.end };
  const [operations, storage] = await Promise.all([
    queryCloudflare(fetchImpl, token, OPERATIONS_QUERY, variables),
    queryCloudflare(fetchImpl, token, STORAGE_QUERY, variables),
  ]);
  return buildCapacityReport({
    operationRows: operations.kvOperationsAdaptiveGroups || [],
    storageRows: storage.kvStorageAdaptiveGroups || [],
    accountId,
    namespaceId,
    window,
  });
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const report = await auditCapacity({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: args.get("account-id") || process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
    namespaceId: args.get("namespace-id") || DEFAULT_NAMESPACE_ID,
    endDate: args.get("end-date") || isoDate(new Date()),
    days: args.get("days") || 31,
  });
  const output = args.get("output");
  if (output && output !== "true") fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}
