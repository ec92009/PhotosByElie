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
const publicBucket = valueFor("--public-bucket", "photosbyelie-public");
const privateBucket = valueFor("--private-bucket", "photosbyelie-private");
const tombstonePath = valueFor(
  "--discarded-tombstone",
  valueFor("--hidden-blacklist", "assets/discarded/discarded-photo-ids.json")
);
const outputPath = valueFor("--output", "assets/discarded-media-manifest.json");
const privateInventoryPath = valueFor("--private-inventory", ".review-logs/r2-private-inventory.json");
const publicPreviewIdsPath = valueFor("--public-preview-ids", ".review-logs/r2-public-preview-ids.json");
const dryRun = !hasFlag("--delete");
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
if (missingCredentials.length) throw new Error(`Missing R2 S3 credential(s): ${missingCredentials.join(", ")}`);

const host = credentials.endpoint || `${credentials.accountId}.r2.cloudflarestorage.com`;
const fullPath = (value) => path.isAbsolute(value) ? value : path.join(repoRoot, value);
const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(fullPath(filePath), "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = async (filePath, payload) => {
  const target = fullPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
};

const quoteS3Path = (value) => `/${String(value).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")}`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const s3SigningKey = (secretKey, datestamp) => {
  const dateKey = hmac(Buffer.from(`AWS4${secretKey}`, "utf8"), datestamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

const queryString = (params) => Object.entries(params)
  .filter(([, value]) => value !== "")
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  .join("&");

const s3RequestOnce = async (method, bucket, key = "", query = "") => {
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
  const canonicalRequest = [method, canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${datestamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", s3SigningKey(credentials.secretAccessKey, datestamp)).update(stringToSign).digest("hex");
  const requestHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  requestHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(`https://${host}${canonicalPath}${query ? `?${query}` : ""}`, {
      method,
      headers: requestHeaders,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${bucket}/${key}: HTTP ${response.status} ${text}`.trim());
  }
  return response;
};

const s3Request = async (...requestArgs) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await s3RequestOnce(...requestArgs);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(Math.min(60_000, 1500 * (2 ** attempt)));
    }
  }
  throw lastError;
};

const deleteProgressLine = (progress) => {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000));
  console.log([
    "DELETE_PROGRESS",
    progress.completed,
    progress.total,
    progress.publicCompleted,
    progress.privateCompleted,
    elapsedSeconds,
  ].join(" "));
};

const listPrefix = async (bucket, prefix) => {
  const keys = [];
  let token = "";
  do {
    const response = await s3Request("GET", bucket, "", queryString({
      "continuation-token": token,
      "list-type": "2",
      "max-keys": "1000",
      prefix,
    }));
    const xml = await response.text();
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]));
    token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] || "";
  } while (token);
  return keys;
};

const deleteKeys = async (bucket, keys, progress, scope) => {
  const deleted = [];
  for (const key of keys) {
    if (!dryRun) await s3Request("DELETE", bucket, key);
    deleted.push(key);
    progress.completed += 1;
    if (scope === "public") progress.publicCompleted += 1;
    if (scope === "private") progress.privateCompleted += 1;
    console.log(`${dryRun ? "would delete" : "deleted"} ${bucket}/${key}`);
    if (progress.completed === 1 || progress.completed % 25 === 0 || progress.completed === progress.total) {
      deleteProgressLine(progress);
    }
  }
  return deleted;
};

const tombstone = await readJson(tombstonePath, {});
const previousManifest = await readJson(outputPath, {});
const discardedIds = new Set((Array.isArray(tombstone.photo_ids) ? tombstone.photo_ids : [])
  .filter((id) => typeof id === "string" && id));
(Array.isArray(previousManifest.discardedPhotoIds) ? previousManifest.discardedPhotoIds : [])
  .filter((id) => typeof id === "string" && id)
  .forEach((id) => discardedIds.add(id));
(Array.isArray(tombstone.photos) ? tombstone.photos : [])
  .map((photo) => photo?.id)
  .filter((id) => typeof id === "string" && id)
  .forEach((id) => discardedIds.add(id));
if (!discardedIds.size) {
  await writeJson(outputPath, {
    schema: "photosbyelie.discarded-media-manifest.v1",
    updatedAt: new Date().toISOString(),
    dryRun,
    discardedPhotoIds: [],
    publicKeys: [],
    privateKeys: [],
  });
  console.log("No discarded photo ids found.");
  process.exit(0);
}

const publicKeys = new Set((Array.isArray(tombstone.public_preview_keys) ? tombstone.public_preview_keys : [])
  .filter((key) => typeof key === "string" && key));
(Array.isArray(previousManifest.publicKeys) ? previousManifest.publicKeys : [])
  .filter((key) => typeof key === "string" && key)
  .forEach((key) => publicKeys.add(key));
for (const id of discardedIds) {
  publicKeys.add(`expo/${id}_900.jpg`);
  publicKeys.add(`expo/${id}_1800.jpg`);
}
const keyPhotoId = (key) => String(key || "").split("/")[1] || "";

const [masterKeys, renderKeys] = await Promise.all([
  listPrefix(privateBucket, "masters/"),
  listPrefix(privateBucket, "renders/"),
]);
const privateKeys = new Set([...masterKeys, ...renderKeys].filter((key) => discardedIds.has(key.split("/")[1])));
(Array.isArray(tombstone.private_keys) ? tombstone.private_keys : [])
  .filter((key) => typeof key === "string" && key)
  .forEach((key) => privateKeys.add(key));
(Array.isArray(previousManifest.privateKeys) ? previousManifest.privateKeys : [])
  .filter((key) => typeof key === "string" && key)
  .filter((key) => discardedIds.has(keyPhotoId(key)))
  .forEach((key) => privateKeys.add(key));

const deleteProgress = {
  total: publicKeys.size + privateKeys.size,
  publicTotal: publicKeys.size,
  privateTotal: privateKeys.size,
  publicCompleted: 0,
  privateCompleted: 0,
  completed: 0,
  discardedCount: discardedIds.size,
  startedAt: Date.now(),
};
console.log([
  "DELETE_START",
  deleteProgress.total,
  deleteProgress.publicTotal,
  deleteProgress.privateTotal,
  deleteProgress.discardedCount,
].join(" "));
deleteProgressLine(deleteProgress);

const deletedPublic = await deleteKeys(publicBucket, [...publicKeys].sort(), deleteProgress, "public");
const deletedPrivate = await deleteKeys(privateBucket, [...privateKeys].sort(), deleteProgress, "private");
if (deleteProgress.total === 0) deleteProgressLine(deleteProgress);

if (!dryRun) {
  const privateInventory = await readJson(privateInventoryPath, null);
  if (privateInventory && typeof privateInventory === "object") {
    const deletedPrivateSet = new Set(deletedPrivate);
    privateInventory.masterKeys = (privateInventory.masterKeys || []).filter((key) => !deletedPrivateSet.has(key) && !discardedIds.has(keyPhotoId(key)));
    privateInventory.renderKeys = (privateInventory.renderKeys || []).filter((key) => !deletedPrivateSet.has(key) && !discardedIds.has(keyPhotoId(key)));
    privateInventory.generatedAt = new Date().toISOString();
    await writeJson(privateInventoryPath, privateInventory);
  }
  const publicPreviewIds = await readJson(publicPreviewIdsPath, null);
  if (publicPreviewIds && typeof publicPreviewIds === "object" && Array.isArray(publicPreviewIds.complete_pairs)) {
    const deletedIds = new Set([...discardedIds]);
    publicPreviewIds.complete_pairs = publicPreviewIds.complete_pairs.filter((id) => !deletedIds.has(id));
    publicPreviewIds.generatedAt = new Date().toISOString();
    await writeJson(publicPreviewIdsPath, publicPreviewIds);
  }
}

await writeJson(outputPath, {
  schema: "photosbyelie.discarded-media-manifest.v1",
  updatedAt: new Date().toISOString(),
  dryRun,
  publicBucket,
  privateBucket,
  discardedPhotoIds: [...discardedIds].sort(),
  publicKeys: deletedPublic,
  privateKeys: deletedPrivate,
});

console.log(`Done. ${dryRun ? "Would delete" : "Deleted"} ${deletedPublic.length} public and ${deletedPrivate.length} private object references for ${discardedIds.size} discarded photos.`);
