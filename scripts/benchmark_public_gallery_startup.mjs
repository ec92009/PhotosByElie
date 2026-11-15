#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { decodeCatalog } = require("../catalog-sqlite.js");

const endpoint = String(process.env.PBE_LIFECYCLE_VISIBILITY_URL || "https://auth.photos-by-elie.com/lifecycle/visibility");
const catalogBytes = readFileSync(new URL("../assets/catalog/photosbyelie.sqlite", import.meta.url));
const catalog = decodeCatalog(catalogBytes);
const ids = [...new Set(Object.values(catalog.data || {}).flatMap((collection) => (
  collection.photos || []
)).map((photo) => String(photo.id || "").trim()).filter(Boolean))];
const batches = [];
for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));

const run = async (concurrency) => {
  let cursor = 0;
  let visibleCount = 0;
  const visibleIds = new Set();
  const startedAt = performance.now();
  const worker = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor];
      cursor += 1;
      const requested = new Set(batch);
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaIds: batch }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Lifecycle visibility HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.visibleMediaIds)) throw new Error("Lifecycle visibility response is malformed.");
      const visible = payload.visibleMediaIds;
      if (visible.some((id) => !requested.has(id))) throw new Error("Lifecycle authority returned an unrequested media ID.");
      visible.forEach((id) => visibleIds.add(id));
      visibleCount += visible.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  return {
    concurrency, durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000, visibleCount,
    visibleDigest: createHash("sha256").update(JSON.stringify([...visibleIds].sort())).digest("hex"),
  };
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const samples = [];
for (const concurrency of [6, 1, 1, 6]) samples.push(await run(concurrency));
const sequentialMs = median(samples.filter((sample) => sample.concurrency === 1).map((sample) => sample.durationMs));
const parallelMs = median(samples.filter((sample) => sample.concurrency === 6).map((sample) => sample.durationMs));
const visibleCounts = [...new Set(samples.map((sample) => sample.visibleCount))];
if (visibleCounts.length !== 1 || new Set(samples.map((sample) => sample.visibleDigest)).size !== 1) {
  throw new Error("Lifecycle visibility changed during the benchmark.");
}

console.log(JSON.stringify({
  schemaVersion: 1,
  scope: "read-only live lifecycle requests only; excludes download, decode, query and browser render",
  catalogSha256: createHash("sha256").update(catalogBytes).digest("hex"),
  mediaIdCount: ids.length,
  batchCount: batches.length,
  visibleCount: visibleCounts[0],
  sequentialMs,
  boundedParallelMs: parallelMs,
  speedup: Math.round((sequentialMs / parallelMs) * 100) / 100,
  samples,
}, null, 2));
