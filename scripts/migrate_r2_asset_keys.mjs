#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueFor = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const privateBucket = valueFor("--private-bucket", "photosbyelie-private");
const sidecarPath = valueFor("--sidecar", "assets/media-sidecar.json");
const statePath = valueFor("--state-file", ".review-logs/r2-asset-key-migration.jsonl");
const reportPath = valueFor("--report", ".review-logs/r2-asset-key-migration-report.json");
const limit = Number(valueFor("--limit", "0")) || 0;
const requestTimeoutMs = Number(valueFor("--request-timeout-ms", "180000")) || 180000;
const retries = Number(valueFor("--retries", "4")) || 0;
const workers = Math.max(1, Number(valueFor("--workers", "1")) || 1);
const copy = hasFlag("--copy");
const deleteOld = hasFlag("--delete-old");
const includeAlreadyCopied = hasFlag("--include-already-copied");
const verbose = hasFlag("--verbose") || (limit > 0 && limit <= 50);
const logItem = (...parts) => {
  if (verbose) console.log(...parts);
};

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
if (missingCredentials.length) throw new Error(`Missing R2 S3 credential(s): ${missingCredentials.join(", ")}`);

const host = credentials.endpoint || `${credentials.accountId}.r2.cloudflarestorage.com`;
const fullPath = (value) => path.isAbsolute(value) ? value : path.join(repoRoot, value);
const basename = (value) => String(value || "").split(/[\\/]/).pop();
const quoteS3Path = (value) => `/${String(value).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")}`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeFormat = (value) => {
  const format = String(value || "").trim().toLowerCase().replace(/^\./, "");
  if (["jpg", "jpeg", "jpe"].includes(format)) return "jpg";
  if (["tif", "tiff"].includes(format)) return "tif";
  if (format === "m4v") return "mp4";
  if (["png", "heic", "mp4", "mov"].includes(format)) return format;
  return format;
};

const isFlatMasterKey = (photoId, key) => new RegExp(`^masters/${photoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[A-Za-z0-9]+$`).test(String(key || ""));

const flatMasterKey = (photo) => {
  const source = photo?.sourceFile || {};
  const format = normalizeFormat(source.type || basename(photo?.sourcePath).split(".").pop());
  return photo?.id && format ? `masters/${photo.id}.${format}` : "";
};

const flatRenderKey = (photoId, productId) => {
  const match = String(productId || "").match(/^jpg-(\d+)mp$/);
  return photoId && match ? `renders/${photoId}_${match[1]}mp.jpg` : "";
};

const migrationId = (item) => `${item.bucket}:${item.oldKey}->${item.newKey}`;

const s3SigningKey = (secretKey, datestamp) => {
  const dateKey = hmac(Buffer.from(`AWS4${secretKey}`, "utf8"), datestamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

const s3RequestOnce = async (method, bucket, key = "", body = Buffer.alloc(0), extraHeaders = {}) => {
  const objectPath = `${bucket}${key ? `/${key}` : ""}`;
  const payloadHash = sha256(body);
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = now.slice(0, 8);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join("");
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
      body: method === "PUT" && body.length ? body : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const s3Request = async (...requestArgs) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await s3RequestOnce(...requestArgs);
      if (response.ok || response.status === 404) return response;
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${text}`.trim());
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(Math.min(60_000, 1500 * (2 ** attempt)));
    }
  }
  throw lastError;
};

const headObject = async (bucket, key) => {
  const response = await s3Request("HEAD", bucket, key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HEAD ${bucket}/${key}: HTTP ${response.status}`);
  return {
    key,
    bytes: Number(response.headers.get("content-length") || "0") || 0,
    etag: response.headers.get("etag") || "",
    lastModified: response.headers.get("last-modified") || "",
  };
};

const copyObject = async (bucket, sourceKey, destinationKey) => {
  const response = await s3Request("PUT", bucket, destinationKey, Buffer.alloc(0), {
    "x-amz-copy-source": quoteS3Path(`${bucket}/${sourceKey}`),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`COPY ${bucket}/${sourceKey} -> ${destinationKey}: HTTP ${response.status} ${text}`.trim());
  }
};

const deleteObject = async (bucket, key) => {
  const response = await s3Request("DELETE", bucket, key);
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`DELETE ${bucket}/${key}: HTTP ${response.status} ${text}`.trim());
  }
};

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(fullPath(filePath), "utf8"));
  } catch {
    return fallback;
  }
};

const appendJsonl = async (filePath, payload) => {
  const target = fullPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify(payload)}\n`);
};

const writeJson = async (filePath, payload) => {
  const target = fullPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
};

const loadedState = await fs.readFile(fullPath(statePath), "utf8").catch(() => "");
const copiedMigrationIds = new Set();
const copiedOldKeys = new Set();
for (const line of loadedState.split("\n")) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    if (row.status === "copied" || row.status === "already-copied") {
      if (row.migrationId) copiedMigrationIds.add(row.migrationId);
      if (row.oldKey) copiedOldKeys.add(row.oldKey);
    }
  } catch {}
}

const sidecar = await readJson(sidecarPath, {});
const photos = Object.values(sidecar.photos || {});
const candidates = photos.flatMap((photo) => {
  if (!photo?.id) return [];
  const items = [];
  const delivery = photo.privateDelivery || {};
  const desiredMasterKey = flatMasterKey(photo);
  const currentMasterKey = delivery.masterKey || "";
  const legacyMasterKey = delivery.legacyMasterKey || (isFlatMasterKey(photo.id, currentMasterKey) ? "" : currentMasterKey);
  if (legacyMasterKey && desiredMasterKey && legacyMasterKey !== desiredMasterKey) {
    items.push({
      bucket: privateBucket,
      kind: "master",
      id: photo.id,
      oldKey: legacyMasterKey,
      newKey: desiredMasterKey,
      format: normalizeFormat(photo?.sourceFile?.type || basename(photo?.sourcePath).split(".").pop()),
    });
  }

  const legacyRenderKeys = delivery.legacyRenderKeys || {};
  const renderKeys = delivery.renderKeys || {};
  for (const productId of ["jpg-6mp", "jpg-3mp", "jpg-1mp"]) {
    const desiredRenderKey = flatRenderKey(photo.id, productId);
    const currentRenderKey = renderKeys[productId] || "";
    const legacyRenderKey = legacyRenderKeys[productId] || (currentRenderKey === desiredRenderKey ? "" : currentRenderKey);
    if (legacyRenderKey && desiredRenderKey && legacyRenderKey !== desiredRenderKey) {
      items.push({
        bucket: privateBucket,
        kind: "render",
        id: photo.id,
        productId,
        oldKey: legacyRenderKey,
        newKey: desiredRenderKey,
        format: "jpg",
      });
    }
  }
  return items;
}).filter((item) => includeAlreadyCopied || (!copiedMigrationIds.has(migrationId(item)) && !copiedOldKeys.has(item.oldKey)));

const collisions = new Map();
for (const item of candidates) {
  const existing = collisions.get(item.newKey);
  if (existing && existing.oldKey !== item.oldKey) {
    throw new Error(`Destination key collision for ${item.newKey}: ${existing.oldKey} and ${item.oldKey}`);
  }
  collisions.set(item.newKey, item);
}

const selected = limit ? candidates.slice(0, limit) : candidates;
const stats = {
  dryRun: !copy,
  deleteOld,
  privateBucket,
  sidecarPath,
  statePath,
  workers,
  candidates: candidates.length,
  selected: selected.length,
  byKind: {},
  alreadyCopied: 0,
  missingOld: 0,
  copied: 0,
  copyFailed: 0,
  verified: 0,
  deletedOld: 0,
  deleteSkipped: 0,
  completed: 0,
};

const processItem = async (item) => {
  stats.byKind[item.kind] = (stats.byKind[item.kind] || 0) + 1;
  const at = new Date().toISOString();
  const itemMigrationId = migrationId(item);
  try {
    const oldHead = await headObject(item.bucket, item.oldKey);
    const newHead = await headObject(item.bucket, item.newKey);
    if (!oldHead && !newHead) {
      stats.missingOld += 1;
      await appendJsonl(statePath, { at, status: "missing-old", migrationId: itemMigrationId, ...item });
      logItem(`missing old ${item.oldKey}`);
      return;
    }
    if (oldHead && newHead && oldHead.bytes === newHead.bytes) {
      stats.alreadyCopied += 1;
      stats.verified += 1;
      if (deleteOld) {
        await deleteObject(item.bucket, item.oldKey);
        stats.deletedOld += 1;
        await appendJsonl(statePath, { at, status: "deleted-old", migrationId: itemMigrationId, ...item, bytes: newHead.bytes });
        logItem(`deleted old ${item.oldKey}`);
      } else {
        stats.deleteSkipped += 1;
        await appendJsonl(statePath, { at, status: "already-copied", migrationId: itemMigrationId, ...item, bytes: newHead.bytes });
        logItem(`already copied ${item.newKey}`);
      }
      return;
    }
    if (!oldHead) {
      stats.missingOld += 1;
      await appendJsonl(statePath, { at, status: "missing-old-after-new-mismatch", migrationId: itemMigrationId, ...item, newBytes: newHead?.bytes || 0 });
      logItem(`missing old after new mismatch ${item.oldKey}`);
      return;
    }
    if (newHead && oldHead.bytes !== newHead.bytes) {
      stats.copyFailed += 1;
      await appendJsonl(statePath, {
        at,
        status: "destination-size-mismatch",
        migrationId: itemMigrationId,
        ...item,
        oldBytes: oldHead.bytes,
        newBytes: newHead.bytes,
      });
      console.error(`destination mismatch ${item.newKey} old=${oldHead.bytes} new=${newHead.bytes}`);
      return;
    }
    if (!copy) {
      await appendJsonl(statePath, { at, status: "dry-run", migrationId: itemMigrationId, ...item, oldBytes: oldHead.bytes, newBytes: newHead?.bytes || 0 });
      logItem(`DRY copy ${item.oldKey} -> ${item.newKey}`);
      return;
    }
    try {
      await copyObject(item.bucket, item.oldKey, item.newKey);
      const copiedHead = await headObject(item.bucket, item.newKey);
      if (!copiedHead || copiedHead.bytes !== oldHead.bytes) {
        throw new Error(`verification failed: old=${oldHead.bytes} new=${copiedHead?.bytes || 0}`);
      }
      stats.copied += 1;
      stats.verified += 1;
      await appendJsonl(statePath, { at, status: "copied", migrationId: itemMigrationId, ...item, bytes: copiedHead.bytes, oldEtag: oldHead.etag, newEtag: copiedHead.etag });
      logItem(`copied ${item.oldKey} -> ${item.newKey}`);
      if (deleteOld) {
        await deleteObject(item.bucket, item.oldKey);
        stats.deletedOld += 1;
        await appendJsonl(statePath, { at: new Date().toISOString(), status: "deleted-old", migrationId: itemMigrationId, ...item, bytes: copiedHead.bytes });
        logItem(`deleted old ${item.oldKey}`);
      } else {
        stats.deleteSkipped += 1;
      }
    } catch (error) {
      stats.copyFailed += 1;
      await appendJsonl(statePath, { at, status: "copy-failed", migrationId: itemMigrationId, ...item, error: error.message });
      console.error(`failed ${item.oldKey}: ${error.message}`);
    }
  } finally {
    stats.completed += 1;
    if (stats.completed === 1 || stats.completed % 100 === 0 || stats.completed === selected.length) {
      console.log(`progress ${stats.completed}/${selected.length} copied=${stats.copied} already=${stats.alreadyCopied} missing=${stats.missingOld} failed=${stats.copyFailed}`);
    }
  }
};

let nextIndex = 0;
await Promise.all(Array.from({ length: Math.min(workers, selected.length) }, async () => {
  while (nextIndex < selected.length) {
    const item = selected[nextIndex];
    nextIndex += 1;
    await processItem(item);
  }
}));

await writeJson(reportPath, {
  schema: "photosbyelie.r2-asset-key-migration-report.v1",
  generatedAt: new Date().toISOString(),
  ...stats,
});

console.log(`Done. Selected ${stats.selected}/${stats.candidates}. Copied ${stats.copied}; already copied ${stats.alreadyCopied}; missing old ${stats.missingOld}; failed ${stats.copyFailed}; deleted old ${stats.deletedOld}.`);
if (!copy) console.log("Dry run only. Add --copy to copy objects server-side.");
if (!deleteOld) console.log("Old keys retained. --delete-old is historical only; use cleanup_legacy_r2_keys.mjs for retired key cleanup.");
