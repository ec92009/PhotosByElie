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
const copy = hasFlag("--copy");
const deleteOld = hasFlag("--delete-old");
const includeAlreadyCopied = hasFlag("--include-already-copied");

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
  if (["png", "heic", "mp4", "mov"].includes(format)) return format;
  return format;
};

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
const copiedOldKeys = new Set();
for (const line of loadedState.split("\n")) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    if (row.status === "copied" || row.status === "already-copied") copiedOldKeys.add(row.oldKey);
  } catch {}
}

const sidecar = await readJson(sidecarPath, {});
const photos = Object.values(sidecar.photos || {});
const candidates = photos.flatMap((photo) => {
  const oldKey = photo?.privateDelivery?.masterKey || "";
  const format = normalizeFormat(photo?.sourceFile?.type || basename(photo?.sourcePath).split(".").pop());
  const newKey = photo?.id && format ? `masters/${photo.id}.${format}` : "";
  if (!photo?.id || !oldKey || !newKey || oldKey === newKey) return [];
  if (!includeAlreadyCopied && copiedOldKeys.has(oldKey)) return [];
  return [{ id: photo.id, oldKey, newKey, format }];
});

const selected = limit ? candidates.slice(0, limit) : candidates;
const stats = {
  dryRun: !copy,
  deleteOld,
  privateBucket,
  sidecarPath,
  statePath,
  candidates: candidates.length,
  selected: selected.length,
  alreadyCopied: 0,
  missingOld: 0,
  copied: 0,
  copyFailed: 0,
  verified: 0,
  deletedOld: 0,
  deleteSkipped: 0,
};

for (const item of selected) {
  const at = new Date().toISOString();
  const oldHead = await headObject(privateBucket, item.oldKey);
  const newHead = await headObject(privateBucket, item.newKey);
  if (!oldHead && !newHead) {
    stats.missingOld += 1;
    await appendJsonl(statePath, { at, status: "missing-old", ...item });
    console.log(`missing old ${item.oldKey}`);
    continue;
  }
  if (oldHead && newHead && oldHead.bytes === newHead.bytes) {
    stats.alreadyCopied += 1;
    stats.verified += 1;
    if (deleteOld) {
      await deleteObject(privateBucket, item.oldKey);
      stats.deletedOld += 1;
      await appendJsonl(statePath, { at, status: "deleted-old", ...item, bytes: newHead.bytes });
      console.log(`deleted old ${item.oldKey}`);
    } else {
      stats.deleteSkipped += 1;
      await appendJsonl(statePath, { at, status: "already-copied", ...item, bytes: newHead.bytes });
      console.log(`already copied ${item.newKey}`);
    }
    continue;
  }
  if (!oldHead) {
    stats.missingOld += 1;
    await appendJsonl(statePath, { at, status: "missing-old-after-new-mismatch", ...item, newBytes: newHead?.bytes || 0 });
    console.log(`missing old after new mismatch ${item.oldKey}`);
    continue;
  }
  if (!copy) {
    await appendJsonl(statePath, { at, status: "dry-run", ...item, oldBytes: oldHead.bytes, newBytes: newHead?.bytes || 0 });
    console.log(`DRY copy ${item.oldKey} -> ${item.newKey}`);
    continue;
  }
  try {
    await copyObject(privateBucket, item.oldKey, item.newKey);
    const copiedHead = await headObject(privateBucket, item.newKey);
    if (!copiedHead || copiedHead.bytes !== oldHead.bytes) {
      throw new Error(`verification failed: old=${oldHead.bytes} new=${copiedHead?.bytes || 0}`);
    }
    stats.copied += 1;
    stats.verified += 1;
    await appendJsonl(statePath, { at, status: "copied", ...item, bytes: copiedHead.bytes, oldEtag: oldHead.etag, newEtag: copiedHead.etag });
    console.log(`copied ${item.oldKey} -> ${item.newKey}`);
    if (deleteOld) {
      await deleteObject(privateBucket, item.oldKey);
      stats.deletedOld += 1;
      await appendJsonl(statePath, { at: new Date().toISOString(), status: "deleted-old", ...item, bytes: copiedHead.bytes });
      console.log(`deleted old ${item.oldKey}`);
    } else {
      stats.deleteSkipped += 1;
    }
  } catch (error) {
    stats.copyFailed += 1;
    await appendJsonl(statePath, { at, status: "copy-failed", ...item, error: error.message });
    console.error(`failed ${item.oldKey}: ${error.message}`);
  }
}

await writeJson(reportPath, {
  schema: "photosbyelie.r2-asset-key-migration-report.v1",
  generatedAt: new Date().toISOString(),
  ...stats,
});

console.log(`Done. Selected ${stats.selected}/${stats.candidates}. Copied ${stats.copied}; already copied ${stats.alreadyCopied}; missing old ${stats.missingOld}; failed ${stats.copyFailed}; deleted old ${stats.deletedOld}.`);
if (!copy) console.log("Dry run only. Add --copy to copy objects server-side.");
if (!deleteOld) console.log("Old keys retained. Add --delete-old only after runtime migration is complete.");
