#!/usr/bin/env node
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
const publicBucket = valueFor("--public-bucket", "photosbyelie-public");
const privateBucket = valueFor("--private-bucket", "photosbyelie-private");
const tombstonePath = valueFor(
  "--discarded-tombstone",
  valueFor("--hidden-blacklist", "assets/discarded/discarded-photo-ids.json")
);
const outputPath = valueFor("--output", "assets/discarded-media-manifest.json");
const ownerDbPath = valueFor("--owner-db", "assets/owner-actions/Owner.sqlite");
const privateInventoryPath = valueFor("--private-inventory", ".review-logs/r2-private-inventory.json");
const publicPreviewIdsPath = valueFor("--public-preview-ids", ".review-logs/r2-public-preview-ids.json");
const dryRun = !hasFlag("--delete");
const ignoreOwnerDb = hasFlag("--ignore-owner-db");
const deepInventory = hasFlag("--deep-inventory") || ignoreOwnerDb;
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

const ownerDbEnabled = () => !ignoreOwnerDb;

const runOwnerDb = (args, options = {}) => {
  if (!ownerDbEnabled()) return { ok: false, skipped: true };
  const result = spawnSync("python3", ["scripts/owner_state_db.py", "--db", ownerDbPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    console.warn(`Owner DB update skipped: ${(result.stderr || result.stdout || "unknown error").trim()}`);
    return { ok: false, skipped: false };
  }
  return { ok: true, stdout: result.stdout || "" };
};

const readOwnerDbDeletedKeys = () => {
  if (!ownerDbEnabled()) return new Set();
  runOwnerDb(["--import-discarded-r2-manifest"]);
  const db = fullPath(ownerDbPath);
  const query = "SELECT bucket || char(9) || object_key FROM r2_objects WHERE lifecycle_state = 'deleted_confirmed';";
  const result = spawnSync("sqlite3", [db, query], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    console.warn(`Owner DB read skipped: ${(result.stderr || result.stdout || "unknown error").trim()}`);
    return new Set();
  }
  return new Set(result.stdout.split(/\r?\n/).filter(Boolean));
};

const writeOwnerDbState = async (entries, state) => {
  if (!ownerDbEnabled() || !entries.length) return;
  const statePath = `.review-logs/r2-object-state-${state}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  await writeJson(statePath, { generatedAt: new Date().toISOString(), objects: entries });
  runOwnerDb(["--r2-state-file", statePath, "--r2-state", state]);
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
    console.log(`${dryRun ? "would check" : "checked"} ${bucket}/${key}`);
    if (progress.completed === 1 || progress.completed % 25 === 0 || progress.completed === progress.total) {
      deleteProgressLine(progress);
    }
  }
  return deleted;
};

const tombstone = await readJson(tombstonePath, {});
const previousManifest = await readJson(outputPath, {});
const currentDiscardedIds = new Set((Array.isArray(tombstone.photo_ids) ? tombstone.photo_ids : [])
  .filter((id) => typeof id === "string" && id));
(Array.isArray(tombstone.photos) ? tombstone.photos : [])
  .map((photo) => photo?.id)
  .filter((id) => typeof id === "string" && id)
  .forEach((id) => currentDiscardedIds.add(id));
const historicalDiscardedIds = new Set((Array.isArray(previousManifest.discardedPhotoIds) ? previousManifest.discardedPhotoIds : [])
  .filter((id) => typeof id === "string" && id));
const discardedIds = new Set(currentDiscardedIds);
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
  publicKeys.add(`expo/${id}_short_5s_720p.mp4`);
}
const keyPhotoId = (key) => {
  const value = String(key || "");
  if (value.startsWith("masters/")) {
    const rest = value.slice("masters/".length);
    return rest.includes("/") ? rest.split("/")[0] : rest.replace(/\.[A-Za-z0-9]+$/, "");
  }
  if (value.startsWith("renders/")) {
    const rest = value.slice("renders/".length);
    return rest.includes("/") ? rest.split("/")[0] : rest.replace(/_(?:1|3|6)mp\.jpg$/i, "");
  }
  return value.split("/")[1] || "";
};

const [currentPublicKeys, masterKeys, renderKeys] = deepInventory
  ? await Promise.all([
      listPrefix(publicBucket, "expo/"),
      listPrefix(privateBucket, "masters/"),
      listPrefix(privateBucket, "renders/"),
    ])
  : [[], [], []];
if (deepInventory) {
  await writeOwnerDbState([
    ...currentPublicKeys.map((key) => ({ bucket: publicBucket, key, photo_id: keyPhotoId(key), kind: key.endsWith(".mp4") ? "public-preview-video" : "public-preview" })),
    ...masterKeys.map((key) => ({ bucket: privateBucket, key, photo_id: keyPhotoId(key), kind: "private-master" })),
    ...renderKeys.map((key) => ({ bucket: privateBucket, key, photo_id: keyPhotoId(key), kind: "private-render" })),
  ], "current");
}
const privateKeys = new Set([...masterKeys, ...renderKeys].filter((key) => discardedIds.has(keyPhotoId(key))));
(Array.isArray(tombstone.private_keys) ? tombstone.private_keys : [])
  .filter((key) => typeof key === "string" && key)
  .forEach((key) => privateKeys.add(key));
(Array.isArray(previousManifest.privateKeys) ? previousManifest.privateKeys : [])
  .filter((key) => typeof key === "string" && key)
  .filter((key) => discardedIds.has(keyPhotoId(key)))
  .forEach((key) => privateKeys.add(key));

const deletedConfirmedKeys = readOwnerDbDeletedKeys();
const alreadyDeleted = (bucket, key) => deletedConfirmedKeys.has(`${bucket}\t${key}`);
const recordedPublicKeys = new Set((Array.isArray(previousManifest.publicKeys) ? previousManifest.publicKeys : []).filter((key) => typeof key === "string" && key));
const recordedPrivateKeys = new Set((Array.isArray(previousManifest.privateKeys) ? previousManifest.privateKeys : []).filter((key) => typeof key === "string" && key));
const publicDeleteCandidates = [...publicKeys].sort().filter((key) => !alreadyDeleted(publicBucket, key));
const privateDeleteCandidates = [...privateKeys].sort().filter((key) => !alreadyDeleted(privateBucket, key));
const ownerDbConfirmedCount = (publicKeys.size + privateKeys.size) - (publicDeleteCandidates.length + privateDeleteCandidates.length);

const deleteProgress = {
  total: publicDeleteCandidates.length + privateDeleteCandidates.length,
  publicTotal: publicDeleteCandidates.length,
  privateTotal: privateDeleteCandidates.length,
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
console.log(`DELETE_CONTEXT ${JSON.stringify({
  mode: "double-check",
  deepInventory,
  currentDiscardedPhotos: currentDiscardedIds.size,
  historicalDiscardedPhotos: historicalDiscardedIds.size,
  ownerDbDeletedConfirmed: ownerDbConfirmedCount,
  note: "This phase rechecks historical banned-photo R2 keys. S3 delete is idempotent, so a checked key usually means it was already gone.",
})}`);
deleteProgressLine(deleteProgress);

await writeOwnerDbState([
  ...publicDeleteCandidates.map((key) => ({ bucket: publicBucket, key, photo_id: keyPhotoId(key), kind: key.endsWith(".mp4") ? "public-preview-video" : "public-preview" })),
  ...privateDeleteCandidates.map((key) => ({ bucket: privateBucket, key, photo_id: keyPhotoId(key), kind: key.startsWith("masters/") ? "private-master" : "private-render" })),
], "marked_for_delete");

const deletedPublic = await deleteKeys(publicBucket, publicDeleteCandidates, deleteProgress, "public");
const deletedPrivate = await deleteKeys(privateBucket, privateDeleteCandidates, deleteProgress, "private");
if (deleteProgress.total === 0) deleteProgressLine(deleteProgress);

await writeOwnerDbState([
  ...deletedPublic.map((key) => ({ bucket: publicBucket, key, photo_id: keyPhotoId(key), kind: key.endsWith(".mp4") ? "public-preview-video" : "public-preview" })),
  ...deletedPrivate.map((key) => ({ bucket: privateBucket, key, photo_id: keyPhotoId(key), kind: key.startsWith("masters/") ? "private-master" : "private-render" })),
], "deleted_confirmed");

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
  publicKeys: [...new Set([...recordedPublicKeys, ...deletedPublic])].sort(),
  privateKeys: [...new Set([...recordedPrivateKeys, ...deletedPrivate])].sort(),
});

console.log(`Done. ${dryRun ? "Would check" : "Checked"} ${deletedPublic.length} public and ${deletedPrivate.length} private banned-photo R2 key checks for ${discardedIds.size} discarded photos; ${ownerDbConfirmedCount} already trusted from Owner DB.`);
