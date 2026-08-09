#!/usr/bin/env node
// Explicit legacy/repair cleanup only. PBB-79 gateway tombstones are
// retained and excluded from this old-key removal path.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueFor = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const ownerDbPath = valueFor("--owner-db", "assets/owner-actions/Owner.sqlite");
const publicBucket = valueFor("--public-bucket", "photosbyelie-public");
const privateBucket = valueFor("--private-bucket", "photosbyelie-private");
const reportPath = valueFor("--report", ".review-logs/r2-legacy-cleanup-report.json");
const statePath = valueFor("--state-file", `.review-logs/r2-legacy-cleanup-deleted-${Date.now()}.json`);
const dryRun = !hasFlag("--delete");
const forceCurrent = hasFlag("--force-current");
const limit = Number(valueFor("--limit", "0")) || 0;
const workers = Math.max(1, Number(valueFor("--workers", "4")) || 4);
const requestTimeoutMs = Number(valueFor("--request-timeout-ms", "180000")) || 180000;
const retries = Number(valueFor("--retries", "4")) || 0;

const firstEnv = (...names) => names.map((name) => process.env[name]).find(Boolean) || "";
const credentials = {
  accountId: firstEnv("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"),
  accessKeyId: firstEnv("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
  secretAccessKey: firstEnv("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
  endpoint: process.env.R2_S3_ENDPOINT || "",
};
const missingCredentials = [
  ["R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID", credentials.accountId],
  ["R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID", credentials.accessKeyId],
  ["R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY", credentials.secretAccessKey],
].filter(([, value]) => !value).map(([name]) => name);
if (!dryRun && missingCredentials.length) {
  throw new Error(`Missing R2 S3 credential(s): ${missingCredentials.join(", ")}`);
}

const host = credentials.endpoint || `${credentials.accountId}.r2.cloudflarestorage.com`;
const fullPath = (value) => path.isAbsolute(value) ? value : path.join(repoRoot, value);
const basename = (value) => String(value || "").split(/[\\/]/).pop();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quoteS3Path = (value) => `/${String(value).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")}`;

const writeJson = async (filePath, payload) => {
  const target = fullPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
};

const sqliteJson = (query) => {
  const result = spawnSync("sqlite3", ["-json", fullPath(ownerDbPath), query], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "sqlite3 failed").trim());
  }
  return JSON.parse(result.stdout || "[]");
};

const readGatewayTombstonedIds = () => {
  const table = sqliteJson("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'owner_waste_basket_entries';");
  if (!table.length) return new Set();
  return new Set(sqliteJson(
    "SELECT asset_id FROM owner_waste_basket_entries WHERE state = 'tombstoned';",
  ).map((row) => String(row.asset_id || "").trim()).filter(Boolean));
};

const normalizedExtension = (value) => {
  const ext = String(value || "").trim().toLowerCase().replace(/^\./, "");
  if (["jpeg", "jpe"].includes(ext)) return "jpg";
  if (ext === "tiff") return "tif";
  if (ext === "m4v") return "mp4";
  return ext || "jpg";
};

const legacyShape = (bucket, key) => {
  const value = String(key || "");
  if (bucket === privateBucket && value.startsWith("masters/")) {
    const rest = value.slice("masters/".length);
    return rest.includes("/") ? "legacy-private-master" : "";
  }
  if (bucket === privateBucket && value.startsWith("renders/")) {
    const rest = value.slice("renders/".length);
    return rest.includes("/") ? "legacy-private-render" : "";
  }
  if (bucket === publicBucket && value.startsWith("expo/")) {
    const rest = value.slice("expo/".length);
    return rest.includes("/") ? "legacy-public-preview" : "";
  }
  return "";
};

const flatCounterpart = (bucket, key) => {
  const value = String(key || "");
  if (bucket === privateBucket && value.startsWith("masters/")) {
    const rest = value.slice("masters/".length);
    if (!rest.includes("/")) return "";
    const [photoId, sourceName] = rest.split("/", 2);
    const extension = normalizedExtension(basename(sourceName).split(".").pop());
    return photoId && extension ? `masters/${photoId}.${extension}` : "";
  }
  if (bucket === privateBucket && value.startsWith("renders/")) {
    const rest = value.slice("renders/".length);
    if (!rest.includes("/")) return "";
    const [photoId, sourceName] = rest.split("/", 2);
    const match = String(sourceName || "").match(/-jpg-([136])mp\.jpg$/i);
    return photoId && match ? `renders/${photoId}_${match[1]}mp.jpg` : "";
  }
  if (bucket === publicBucket && value.startsWith("expo/")) {
    const rest = value.slice("expo/".length);
    if (!rest.includes("/")) return "";
    return `expo/${rest.split("/").slice(1).join("/")}`;
  }
  return "";
};

const s3SigningKey = (secretKey, datestamp) => {
  const dateKey = hmac(Buffer.from(`AWS4${secretKey}`, "utf8"), datestamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

const s3RequestOnce = async (method, bucket, key = "") => {
  const objectPath = `${bucket}${key ? `/${key}` : ""}`;
  const payloadHash = sha256(Buffer.alloc(0));
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = now.slice(0, 8);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalPath = quoteS3Path(objectPath);
  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${datestamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", s3SigningKey(credentials.secretAccessKey, datestamp)).update(stringToSign).digest("hex");
  const requestHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  requestHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(`https://${host}${canonicalPath}`, {
      method,
      headers: requestHeaders,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const s3Delete = async (bucket, key) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await s3RequestOnce("DELETE", bucket, key);
      if (response.ok || response.status === 404) return { ok: true, status: response.status };
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${text}`.trim());
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(Math.min(60_000, 1500 * (2 ** attempt)));
    }
  }
  return { ok: false, error: lastError?.message || "delete failed" };
};

const rows = sqliteJson(`
  SELECT bucket, object_key AS key, photo_id, object_kind, lifecycle_state
  FROM r2_objects
  WHERE lifecycle_state IN ('current', 'marked_for_delete')
    AND (
      object_key LIKE 'masters/%/%'
      OR object_key LIKE 'renders/%/%'
      OR object_key GLOB 'expo/*/*'
    )
  ORDER BY bucket, object_key
`);
const gatewayTombstonedIds = readGatewayTombstonedIds();
const currentKeys = new Set(sqliteJson(`
  SELECT bucket || char(9) || object_key AS id
  FROM r2_objects
  WHERE lifecycle_state = 'current'
`).map((row) => row.id));

const skipped = [];
const candidates = [];
for (const row of rows) {
  const legacyKind = legacyShape(row.bucket, row.key);
  if (!legacyKind) continue;
  if (gatewayTombstonedIds.has(String(row.photo_id || "").trim())) {
    skipped.push({ ...row, legacyKind, reason: "PBB-79 gateway tombstone retains source and R2 media" });
    continue;
  }
  const counterpart = flatCounterpart(row.bucket, row.key);
  const counterpartCurrent = counterpart ? currentKeys.has(`${row.bucket}\t${counterpart}`) : false;
  if (row.lifecycle_state === "current" && !counterpartCurrent && !forceCurrent) {
    skipped.push({ ...row, legacyKind, counterpart, reason: "current legacy key has no current flat counterpart" });
    continue;
  }
  candidates.push({ ...row, legacyKind, counterpart, counterpartCurrent });
}

const selected = limit ? candidates.slice(0, limit) : candidates;
const report = {
  schema: "photosbyelie.r2-legacy-cleanup-report.v1",
  generatedAt: new Date().toISOString(),
  dryRun,
  ownerDbPath,
  selected: selected.length,
  candidates: candidates.length,
  skipped: skipped.length,
  deleted: 0,
  failed: 0,
  byKind: {},
  failures: [],
  retainedWasteBasketPhotoIds: [...gatewayTombstonedIds].sort(),
  skippedRows: skipped.slice(0, 200),
};
for (const row of candidates) {
  report.byKind[row.legacyKind] = (report.byKind[row.legacyKind] || 0) + 1;
}

const deletedObjects = [];
let nextIndex = 0;
await Promise.all(Array.from({ length: Math.min(workers, selected.length) }, async () => {
  while (nextIndex < selected.length) {
    const item = selected[nextIndex];
    nextIndex += 1;
    if (dryRun) continue;
    const result = await s3Delete(item.bucket, item.key);
    if (result.ok) {
      report.deleted += 1;
      deletedObjects.push({
        bucket: item.bucket,
        key: item.key,
        photo_id: item.photo_id,
        kind: item.object_kind,
        legacyKind: item.legacyKind,
      });
    } else {
      report.failed += 1;
      if (report.failures.length < 50) {
        report.failures.push({ bucket: item.bucket, key: item.key, error: result.error || "delete failed" });
      }
    }
    const done = report.deleted + report.failed;
    if (done === 1 || done % 100 === 0 || done === selected.length) {
      console.log(`progress ${done}/${selected.length} deleted=${report.deleted} failed=${report.failed}`);
    }
  }
}));

if (!dryRun && deletedObjects.length) {
  await writeJson(statePath, { generatedAt: new Date().toISOString(), objects: deletedObjects });
  const stateResult = spawnSync("python3", [
    "scripts/owner_state_db.py",
    "--db",
    ownerDbPath,
    "--r2-state-file",
    statePath,
    "--r2-state",
    "deleted_confirmed",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  report.ownerDbUpdate = {
    ok: stateResult.status === 0,
    stdout: (stateResult.stdout || "").trim(),
    stderr: (stateResult.stderr || "").trim(),
  };
  if (stateResult.status !== 0) {
    throw new Error(`Owner DB update failed: ${report.ownerDbUpdate.stderr || report.ownerDbUpdate.stdout}`);
  }
}

await writeJson(reportPath, report);
console.log(`Legacy cleanup ${dryRun ? "dry run" : "delete"}: selected ${selected.length}/${candidates.length}, skipped ${skipped.length}, retained ${gatewayTombstonedIds.size} PBB-79 tombstoned photos, deleted ${report.deleted}, failed ${report.failed}.`);
if (dryRun) console.log("Dry run only. Add --delete to remove selected legacy keys and mark them deleted_confirmed.");
