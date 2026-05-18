#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { collections } from "../worker/photos-catalog.generated.mjs";

const PRODUCTS = new Map([
  ["jpg-6mp", 6],
  ["jpg-3mp", 3],
  ["jpg-1mp", 1],
]);

const args = process.argv.slice(2);
const valueFor = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};
const hasFlag = (name) => args.includes(name);
const bucket = valueFor("--bucket", "photosbyelie-private");
const limit = Number(valueFor("--limit", "0")) || 0;
const commitEvery = Number(valueFor("--commit-every", "0")) || 0;
const requestTimeoutMs = Number(valueFor("--request-timeout-ms", "180000")) || 180000;
const retries = Number(valueFor("--retries", "4")) || 0;
const push = hasFlag("--push");
const dryRun = hasFlag("--dry-run");
const refreshOnly = hasFlag("--refresh-only");
const manifestPath = valueFor("--manifest", "assets/private-delivery-manifest.json");
const statePath = valueFor("--state-file", ".review-logs/private-deliverable-sync-state.jsonl");
const publicPreviewIdsPath = valueFor("--public-preview-ids", ".review-logs/r2-public-preview-ids.json");
const privateInventoryPath = valueFor("--private-inventory", ".review-logs/r2-private-inventory.json");
const hiddenBlacklistPath = valueFor("--hidden-blacklist", "assets/hidden/hidden-blacklist.json");
const sourceRootArgs = args.flatMap((arg, index) => arg === "--source-root" ? [args[index + 1]] : []).filter(Boolean);

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

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const fullPath = (value) => path.isAbsolute(value) ? value : path.join(repoRoot, value);
const host = credentials.endpoint || `${credentials.accountId}.r2.cloudflarestorage.com`;

const safeName = (value, fallback) => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 160) || fallback;
const basename = (value) => String(value || "").split(/[\\/]/).pop();
const normalizedExtension = (value, fallback = "jpg") => {
  const extension = String(value || fallback).trim().toLowerCase().replace(/^\./, "");
  if (["jpeg", "jpe"].includes(extension)) return "jpg";
  if (extension === "tiff") return "tif";
  if (extension === "m4v") return "mp4";
  return extension || fallback;
};
const quoteS3Path = (value) => `/${String(value).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")}`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const s3SigningKey = (secretKey, datestamp) => {
  const dateKey = hmac(Buffer.from(`AWS4${secretKey}`, "utf8"), datestamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const s3RequestOnce = async (method, key, body = Buffer.alloc(0), contentType = "", query = "") => {
  const objectPath = `${bucket}${key ? `/${key}` : ""}`;
  const payloadHash = sha256(body);
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = now.slice(0, 8);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
  };
  if (method === "PUT") headers["content-type"] = contentType;
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
  const url = `https://${host}${canonicalPath}${query ? `?${query}` : ""}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: method === "PUT" ? body : undefined,
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

const s3Request = async (method, key, body = Buffer.alloc(0), contentType = "", query = "") => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await s3RequestOnce(method, key, body, contentType, query);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(Math.min(60_000, 1500 * (2 ** attempt)));
    }
  }
  throw lastError;
};

const queryString = (params) => Object.entries(params)
  .filter(([, value]) => value !== "")
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  .join("&");

const listPrefix = async (prefix) => {
  const keys = [];
  let token = "";
  do {
    const response = await s3Request("GET", "", Buffer.alloc(0), "", queryString({
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
const appendJsonl = async (filePath, payload) => {
  const target = fullPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify(payload)}\n`);
};

const run = (command, commandArgs, options = {}) => new Promise((resolve, reject) => {
  if (dryRun && options.mutate) {
    console.log(["DRY", command, ...commandArgs].join(" "));
    resolve("");
    return;
  }
  const child = spawn(command, commandArgs, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve(stdout);
    else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
  });
});

const defaultRoots = [
  "/Volumes/Saturn/Pictures/LR/Camera",
  "/Volumes/Saturn/Pictures/LR/Apple Photo Albums",
  "/Volumes/Saturn/Pictures/LR/_All Leonardo",
  "/Volumes/Saturn-1/Pictures/LR/Camera",
  "/Volumes/Saturn-1/Pictures/LR/Apple Photo Albums",
  "/Volumes/Saturn-1/Pictures/LR/_All Leonardo",
  path.join(os.homedir(), "Pictures/LR/Camera"),
  path.join(os.homedir(), "Pictures/LR/Apple Photo Albums"),
  path.join(os.homedir(), "Pictures/LR/_All Leonardo"),
];
const sourceRoots = [...sourceRootArgs, ...defaultRoots];
const fileExists = async (filePath) => {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
};
const findLocalSource = async (source) => {
  const sourcePath = String(source?.path || "");
  if (!sourcePath) return "";
  if (path.isAbsolute(sourcePath) && await fileExists(sourcePath)) return sourcePath;
  for (const root of sourceRoots) {
    const candidates = [path.join(root, sourcePath), path.join(root, basename(sourcePath))];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate;
    }
  }
  return "";
};
const dimensionsFor = async (filePath) => {
  const output = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not read dimensions for ${filePath}`);
  return { width, height };
};
const longEdgeForMegapixels = ({ width, height }, megapixels) => {
  const sourcePixels = width * height;
  const targetPixels = megapixels * 1_000_000;
  if (targetPixels >= sourcePixels) return Math.max(width, height);
  return Math.max(1, Math.round(Math.max(width, height) * Math.sqrt(targetPixels / sourcePixels)));
};
const renderKeyFor = (photo, _source, productId) => {
  const match = String(productId || "").match(/^jpg-(\d+)mp$/);
  return match ? `renders/${photo.id}_${match[1]}mp.jpg` : "";
};
const legacyRenderKeyFor = (photo, source, productId) => (
  `renders/${photo.id}/${safeName(basename(source.path), "source")}-${productId}.jpg`
);
const masterKeyFor = (photo, source) => `masters/${photo.id}.${normalizedExtension(source?.type || basename(source?.path).split(".").pop())}`;
const legacyMasterKeyFor = (photo, source) => `masters/${photo.id}/${basename(source.path)}`;
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
const renderProductId = (key) => {
  const flat = String(key || "").match(/_(1|3|6)mp\.jpg$/i);
  if (flat) return `jpg-${flat[1]}mp`;
  const legacy = String(key || "").match(/-(jpg-[136]mp)\.jpg$/i);
  return legacy ? legacy[1].toLowerCase() : "";
};
const preferTargetKey = (existing, candidate) => {
  if (!existing) return candidate;
  const existingFlat = !existing.slice(existing.indexOf("/") + 1).includes("/");
  const candidateFlat = !candidate.slice(candidate.indexOf("/") + 1).includes("/");
  return candidateFlat && !existingFlat ? candidate : existing;
};
const contentTypeFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if ([".tif", ".tiff"].includes(extension)) return "image/tiff";
  if (extension === ".png") return "image/png";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".m4v") return "video/x-m4v";
  return "application/octet-stream";
};
const mediaTypeFor = (photo) => String(photo?.media?.type || photo?.type || "photo").toLowerCase();
const isVideoPhoto = (photo) => mediaTypeFor(photo) === "video";

const photos = Object.values(collections).flatMap((collection) => (
  (collection.photos || []).map((photo) => ({
    ...photo,
    collectionKey: Object.entries(collections).find(([, candidate]) => candidate === collection)?.[0] || "",
  }))
));

const catalogById = new Map();
for (const [collectionKey, collection] of Object.entries(collections)) {
  for (const photo of collection.photos || []) catalogById.set(photo.id, { ...photo, collectionKey });
}

const loadPrivateInventory = async () => {
  const cached = await readJson(privateInventoryPath, null);
  if (cached?.bucket === bucket && Array.isArray(cached.masterKeys) && Array.isArray(cached.renderKeys)) return cached;
  const [masterKeys, renderKeys] = await Promise.all([listPrefix("masters/"), listPrefix("renders/")]);
  const inventory = {
    schema: "photosbyelie.private-r2-inventory.v1",
    bucket,
    generatedAt: new Date().toISOString(),
    masterKeys,
    renderKeys,
  };
  await writeJson(privateInventoryPath, inventory);
  return inventory;
};

const loadHiddenPhotoIds = async () => {
  const payload = await readJson(hiddenBlacklistPath, {});
  const ids = Array.isArray(payload.photo_ids) ? payload.photo_ids : [];
  return new Set(ids.filter((id) => typeof id === "string" && id));
};

const filterHiddenInventoryKeys = (inventory, hiddenIds) => {
  inventory.masterKeys = (inventory.masterKeys || []).filter((key) => !hiddenIds.has(keyPhotoId(key)));
  inventory.renderKeys = (inventory.renderKeys || []).filter((key) => !hiddenIds.has(keyPhotoId(key)));
};

const rememberInventoryKey = (inventory, hiddenIds, kind, key) => {
  if (hiddenIds.has(keyPhotoId(key))) return;
  const field = kind === "master" ? "masterKeys" : "renderKeys";
  if (!Array.isArray(inventory[field])) inventory[field] = [];
  if (key && !inventory[field].includes(key)) inventory[field].push(key);
};

const hydrateInventoryFromManifest = (inventory, hiddenIds, manifest) => {
  const records = manifest?.records || {};
  if (!records || typeof records !== "object") return;
  for (const record of Object.values(records)) {
    if (!record || typeof record !== "object") continue;
    const master = record.privateMaster || {};
    if (master.present && master.key) rememberInventoryKey(inventory, hiddenIds, "master", master.key);
    for (const render of Object.values(record.privateRenders || {})) {
      if (render?.present && render.key) rememberInventoryKey(inventory, hiddenIds, "render", render.key);
    }
  }
};

const hydrateInventoryFromState = async (inventory, hiddenIds) => {
  let text = "";
  try {
    text = await fs.readFile(fullPath(statePath), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.status !== "uploaded") continue;
    for (const key of row.keys || []) {
      if (String(key).startsWith("masters/")) rememberInventoryKey(inventory, hiddenIds, "master", key);
      if (String(key).startsWith("renders/")) rememberInventoryKey(inventory, hiddenIds, "render", key);
    }
  }
};

const buildManifest = async (inventory, publicIdsPayload) => {
  const masterKeysById = new Map();
  for (const key of inventory.masterKeys || []) {
    const id = keyPhotoId(key);
    if (id) masterKeysById.set(id, preferTargetKey(masterKeysById.get(id), key));
  }
  const renderProductsById = new Map();
  const renderKeysById = new Map();
  for (const key of inventory.renderKeys || []) {
    const id = keyPhotoId(key);
    if (!id) continue;
    const productId = renderProductId(key);
    if (!productId || !PRODUCTS.has(productId)) continue;
    if (!renderProductsById.has(id)) renderProductsById.set(id, new Set());
    if (!renderKeysById.has(id)) renderKeysById.set(id, {});
    renderProductsById.get(id).add(productId);
    renderKeysById.get(id)[productId] = preferTargetKey(renderKeysById.get(id)?.[productId], key);
  }
  const publicPreviewIds = new Set(publicIdsPayload.complete_pairs || []);
  const records = {};
  for (const [photoId, photo] of catalogById) {
    const source = (photo.sourceFiles || [])[0] || {};
    const products = renderProductsById.get(photoId) || new Set();
    const renderProducts = isVideoPhoto(photo) ? [] : [...PRODUCTS.keys()];
    records[photoId] = {
      id: photoId,
      collectionKey: photo.collectionKey,
      sourcePath: source.path || "",
      mediaType: mediaTypeFor(photo),
      privateMaster: {
        expectedKey: masterKeyFor(photo, source),
        legacyKey: legacyMasterKeyFor(photo, source),
        key: masterKeysById.get(photoId) || "",
        present: masterKeysById.has(photoId),
      },
      privateRenders: Object.fromEntries(renderProducts.map((productId) => [
        productId,
        {
          expectedKey: renderKeyFor(photo, source, productId),
          legacyKey: legacyRenderKeyFor(photo, source, productId),
          key: renderKeysById.get(photoId)?.[productId] || "",
          present: products.has(productId),
        },
      ])),
      publicPreviews: {
        present: publicPreviewIds.has(photoId),
      },
    };
  }
  return {
    schema: "photosbyelie.private-delivery-manifest.v1",
    updatedAt: new Date().toISOString(),
    privateBucket: bucket,
    catalogPhotos: catalogById.size,
    privateMasterPhotoIds: masterKeysById.size,
    privateRenderTripletPhotoIds: [...renderProductsById.values()].filter((set) => [...PRODUCTS.keys()].every((productId) => set.has(productId))).length,
    records,
  };
};

const maybeCommit = async (processedCount, final = false) => {
  if (!commitEvery || (!final && processedCount % commitEvery !== 0)) return;
  await run("git", ["add", "assets/catalog", "assets/private-delivery-manifest.json", "assets/media-sidecar.json", "assets/expo-manifest.json", "home-data.js", "photos-data.js", "worker/photos-catalog.generated.mjs", "scripts"]);
  const status = await run("git", ["diff", "--cached", "--quiet"]).then(() => "", () => "dirty");
  if (!status) return;
  const message = final
    ? "photosbyelie: sync private delivery manifests"
    : `photosbyelie: checkpoint private delivery renders ${processedCount}`;
  await run("git", ["commit", "-m", message], { mutate: true });
  if (push) await run("git", ["push", "origin", "main"], { mutate: true });
};

const hiddenIds = await loadHiddenPhotoIds();
const inventory = await loadPrivateInventory();
filterHiddenInventoryKeys(inventory, hiddenIds);
const previousManifest = await readJson(manifestPath, null);
hydrateInventoryFromManifest(inventory, hiddenIds, previousManifest);
await hydrateInventoryFromState(inventory, hiddenIds);
filterHiddenInventoryKeys(inventory, hiddenIds);
inventory.generatedAt = new Date().toISOString();
await writeJson(privateInventoryPath, inventory);
const publicIdsPayload = await readJson(publicPreviewIdsPath, {});
let manifest = await buildManifest(inventory, publicIdsPayload);
await writeJson(manifestPath, manifest);
if (refreshOnly) {
  console.log(`Refreshed ${manifestPath}: ${manifest.privateRenderTripletPhotoIds} complete private render triplets.`);
  process.exit(0);
}
const processed = [];
const failed = [];
for (const record of Object.values(manifest.records)) {
  if (hiddenIds.has(record.id)) continue;
  const photo = catalogById.get(record.id);
  const isVideo = isVideoPhoto(photo);
  if (record.privateMaster.present && (isVideo || Object.values(record.privateRenders).every((item) => item.present))) continue;
  const source = (photo?.sourceFiles || [])[0] || {};
  const localSource = await findLocalSource(source);
  if (!localSource) {
    await appendJsonl(statePath, { at: new Date().toISOString(), id: record.id, status: "missing-local-source", sourcePath: source.path || "" });
    continue;
  }
  const tempDir = isVideo ? "" : await fs.mkdtemp(path.join(os.tmpdir(), "pbe-private-renders-"));
  try {
    console.log(`START ${processed.length + failed.length + 1}: ${record.id}`);
    const uploadedKeys = [];
    if (!record.privateMaster.present) {
      const key = masterKeyFor(photo, source);
      if (!dryRun) {
        await s3Request("PUT", key, await fs.readFile(localSource), contentTypeFor(localSource));
        rememberInventoryKey(inventory, hiddenIds, "master", key);
        record.privateMaster.present = true;
        record.privateMaster.key = key;
      }
      uploadedKeys.push(key);
    }
    if (isVideo) {
      processed.push(record.id);
      await appendJsonl(statePath, { at: new Date().toISOString(), id: record.id, status: dryRun ? "dry-run" : "uploaded", keys: uploadedKeys });
      if (!dryRun) {
        inventory.generatedAt = new Date().toISOString();
        await writeJson(privateInventoryPath, inventory);
        manifest = await buildManifest(inventory, publicIdsPayload);
        await writeJson(manifestPath, manifest);
        await maybeCommit(processed.length);
      }
      console.log(`${processed.length}: ${record.id} ${dryRun ? "would upload" : "uploaded"} ${uploadedKeys.length}`);
      if (limit && processed.length >= limit) break;
      continue;
    }
    const size = await dimensionsFor(localSource);
    for (const [productId, megapixels] of PRODUCTS) {
      if (record.privateRenders[productId].present) continue;
      const outputPath = path.join(tempDir, `${productId}.jpg`);
      const longEdge = longEdgeForMegapixels(size, megapixels);
      await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", "-Z", String(longEdge), localSource, "--out", outputPath], { mutate: true });
      const key = renderKeyFor(photo, source, productId);
      if (!dryRun) {
        await s3Request("PUT", key, await fs.readFile(outputPath), "image/jpeg");
        rememberInventoryKey(inventory, hiddenIds, "render", key);
        record.privateRenders[productId].present = true;
        record.privateRenders[productId].key = key;
      }
      uploadedKeys.push(key);
    }
    processed.push(record.id);
    await appendJsonl(statePath, { at: new Date().toISOString(), id: record.id, status: dryRun ? "dry-run" : "uploaded", keys: uploadedKeys });
    if (!dryRun) {
      inventory.generatedAt = new Date().toISOString();
      await writeJson(privateInventoryPath, inventory);
      manifest = await buildManifest(inventory, publicIdsPayload);
      await writeJson(manifestPath, manifest);
      await maybeCommit(processed.length);
    }
    console.log(`${processed.length}: ${record.id} ${dryRun ? "would upload" : "uploaded"} ${uploadedKeys.length}`);
    if (limit && processed.length >= limit) break;
  } catch (error) {
    failed.push(record.id);
    const message = error?.message || String(error);
    await appendJsonl(statePath, { at: new Date().toISOString(), id: record.id, status: "error", error: message });
    console.log(`${processed.length + failed.length}: ${record.id} failed ${message}`);
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  }
}

manifest = await buildManifest(inventory, publicIdsPayload);
await writeJson(manifestPath, manifest);
if (!dryRun) await maybeCommit(processed.length, true);
console.log(`Done. Processed ${processed.length} photo${processed.length === 1 ? "" : "s"}.`);
if (failed.length) console.log(`Skipped ${failed.length} failed photo${failed.length === 1 ? "" : "s"} for a later retry.`);
