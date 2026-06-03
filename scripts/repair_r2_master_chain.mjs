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
const RAW_SOURCE_TYPES = new Set(["DNG", "NEF", "CR2", "CR3", "ARW", "RAF", "ORF", "RW2", "RAW", "PEF", "SRW", "RWL"]);
const requiresPrivateRenders = (photo) => String(photo?.media?.type || "photo").toLowerCase() === "photo";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueFor = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const publicBucket = valueFor("--public-bucket", "photosbyelie-public");
const privateBucket = valueFor("--private-bucket", "photosbyelie-private");
const repair = hasFlag("--repair");
const prune = hasFlag("--prune");
const writeManifests = hasFlag("--write-manifests") || repair || prune;
const limit = Number(valueFor("--limit", "0")) || 0;
const manifestPath = valueFor("--manifest", "assets/private-delivery-manifest.json");
const auditPath = valueFor("--audit", ".review-logs/r2-master-chain-audit.json");
const privateInventoryPath = valueFor("--private-inventory", ".review-logs/r2-private-inventory.json");
const publicPreviewIdsPath = valueFor("--public-preview-ids", ".review-logs/r2-public-preview-ids.json");
const sourceRootArgs = args.flatMap((arg, index) => arg === "--source-root" ? [args[index + 1]] : []).filter(Boolean);
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
const quoteS3Path = (value) => `/${String(value).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/")}`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const basename = (value) => String(value || "").split(/[\\/]/).pop();
const sourceType = (source) => String(source?.type || basename(source?.path).split(".").pop() || "").toUpperCase();
const normalizedExtension = (value, fallback = "jpg") => {
  const extension = String(value || fallback).trim().toLowerCase().replace(/^\./, "");
  if (["jpeg", "jpe"].includes(extension)) return "jpg";
  if (extension === "tiff") return "tif";
  if (extension === "m4v") return "mp4";
  return extension || fallback;
};
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
  return flat ? `jpg-${flat[1]}mp` : "";
};
const isFlatMasterKey = (key) => {
  const value = String(key || "");
  const rest = value.slice("masters/".length);
  return value.startsWith("masters/") && rest && !rest.includes("/");
};
const previewPhotoId = (key) => basename(key).replace(/_(900|1800)\.jpg$/i, "").replace(/_short_5s_720p\.mp4$/i, "");
const decodeXml = (value) => String(value || "")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&");

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

const s3RequestOnce = async (method, bucket, key = "", body = Buffer.alloc(0), contentType = "", query = "") => {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(`https://${host}${canonicalPath}${query ? `?${query}` : ""}`, {
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

const listPrefix = async (bucket, prefix) => {
  const keys = [];
  let token = "";
  do {
    const response = await s3Request("GET", bucket, "", Buffer.alloc(0), "", queryString({
      "continuation-token": token,
      "list-type": "2",
      "max-keys": "1000",
      prefix,
    }));
    const xml = await response.text();
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => decodeXml(match[1])));
    token = decodeXml(xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] || "");
  } while (token);
  return keys;
};

const getObjectBytes = async (bucket, key) => {
  const response = await s3Request("GET", bucket, key);
  return Buffer.from(await response.arrayBuffer());
};

const putObject = async (bucket, key, body, contentType) => {
  await s3Request("PUT", bucket, key, body, contentType);
};

const deleteObject = async (bucket, key) => {
  await s3Request("DELETE", bucket, key);
};

const writeJson = async (filePath, payload) => {
  const target = fullPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
};

const run = (command, commandArgs) => new Promise((resolve, reject) => {
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
  "/Volumes/Saturn/Pictures/Phone Exports",
  "/Volumes/Saturn-1/Pictures/LR/Camera",
  "/Volumes/Saturn-1/Pictures/LR/Apple Photo Albums",
  "/Volumes/Saturn-1/Pictures/LR/_All Leonardo",
  "/Volumes/Saturn-1/Pictures/Phone Exports",
  path.join(os.homedir(), "Pictures/LR/Camera"),
  path.join(os.homedir(), "Pictures/LR/Apple Photo Albums"),
  path.join(os.homedir(), "Pictures/LR/_All Leonardo"),
  path.join(os.homedir(), "Pictures/Phone Exports"),
];
const sourceRoots = [...sourceRootArgs, ...defaultRoots];
const recursiveSourceRoots = sourceRoots.filter((root) => /(?:^|\/)Phone Exports$/i.test(root));

const fileExists = async (filePath) => {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
};

const isAllowedSourcePath = (filePath) => !String(filePath || "").split(path.sep).some((part) => part.toLowerCase() === "apple photo albums with faces");

const findByBasename = async (root, names) => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (!isAllowedSourcePath(candidate)) continue;
    if (entry.isFile() && names.has(entry.name.toLowerCase())) return candidate;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findByBasename(path.join(root, entry.name), names);
    if (found) return found;
  }
  return "";
};

const findLocalSource = async (source) => {
  const sourcePath = String(source?.path || "");
  if (!sourcePath) return "";
  const pathVariants = (candidate) => {
    const parsed = path.parse(candidate);
    const extensions = new Set([parsed.ext]);
    if (parsed.ext) {
      extensions.add(parsed.ext.toLowerCase());
      extensions.add(parsed.ext.toUpperCase());
    }
    if ([".jpg", ".jpeg", ".jpe"].includes(parsed.ext.toLowerCase())) {
      [".jpg", ".jpeg", ".JPG", ".JPEG"].forEach((extension) => extensions.add(extension));
    }
    return [...extensions].map((extension) => path.join(parsed.dir, `${parsed.name}${extension}`));
  };
  if (path.isAbsolute(sourcePath)) {
    for (const candidate of pathVariants(sourcePath)) {
      if (isAllowedSourcePath(candidate) && await fileExists(candidate)) return candidate;
    }
  }
  const basenameVariants = new Set(pathVariants(basename(sourcePath)).map((candidate) => path.basename(candidate).toLowerCase()));
  for (const root of sourceRoots) {
    const candidates = [
      path.join(root, sourcePath),
      path.join(root, basename(sourcePath)),
    ].flatMap(pathVariants);
    for (const candidate of candidates) {
      if (isAllowedSourcePath(candidate) && await fileExists(candidate)) return candidate;
    }
  }
  for (const root of recursiveSourceRoots) {
    const found = await findByBasename(root, basenameVariants);
    if (found) return found;
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

const contentTypeFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if ([".tif", ".tiff"].includes(extension)) return "image/tiff";
  if (extension === ".png") return "image/png";
  return "application/octet-stream";
};

const masterKeyFor = (photo, source) => `masters/${photo.id}.${normalizedExtension(source?.type || basename(source?.path).split(".").pop())}`;
const renderKeyFor = (photo, _source, productId) => {
  const match = String(productId || "").match(/^jpg-(\d+)mp$/);
  return match ? `renders/${photo.id}_${match[1]}mp.jpg` : "";
};
const publicPreviewKeysFor = (photo) => [
  photo.media?.publicPreview?.galleryKey || `expo/${photo.id}_900.jpg`,
  photo.media?.publicPreview?.detailKey || `expo/${photo.id}_1800.jpg`,
];

const catalog = new Map();
for (const [collectionKey, collection] of Object.entries(collections)) {
  for (const photo of collection.photos || []) {
    const source = (photo.sourceFiles || []).find((candidate) => !RAW_SOURCE_TYPES.has(sourceType(candidate)));
    if (!source?.path) continue;
    catalog.set(photo.id, { ...photo, collectionKey, source });
  }
}

const [initialMasterKeys, initialRenderKeys, publicPreviewKeys] = await Promise.all([
  listPrefix(privateBucket, "masters/"),
  listPrefix(privateBucket, "renders/"),
  listPrefix(publicBucket, "expo/"),
]);

const masterKeys = new Set(initialMasterKeys);
const renderKeys = new Set(initialRenderKeys);
const publicKeys = new Set(publicPreviewKeys.filter((key) => /_(900|1800)\.jpg$/i.test(key) || /_short_5s_720p\.mp4$/i.test(key)));
const masterIds = new Set([...masterKeys].filter(isFlatMasterKey).map(keyPhotoId));
const masterKeysById = new Map();
for (const key of masterKeys) {
  if (!isFlatMasterKey(key)) continue;
  const id = keyPhotoId(key);
  if (id) masterKeysById.set(id, key);
}
const repaired = { masters: [], renders: [] };
const missing = { masters: [], renders: [], publicPreviews: [] };
const pruned = { privateRenders: [], publicPreviews: [] };
let repairedPhotoCount = 0;

for (const photo of catalog.values()) {
  const masterKey = masterKeyFor(photo, photo.source);
  const presentMasterKey = masterKeysById.get(photo.id);
  let localSource = "";
  let sourceForRendering = "";

  if (!presentMasterKey && repair && (!limit || repairedPhotoCount < limit)) {
    localSource = await findLocalSource(photo.source);
    if (localSource) {
      await putObject(privateBucket, masterKey, await fs.readFile(localSource), contentTypeFor(localSource));
      masterKeys.add(masterKey);
      masterKeysById.set(photo.id, masterKey);
      masterIds.add(photo.id);
      repaired.masters.push(masterKey);
      repairedPhotoCount += 1;
      console.log(`repaired master ${masterKey}`);
    }
  }

  if (!masterKeysById.has(photo.id)) {
    missing.masters.push({ photoId: photo.id, key: masterKey, sourcePath: photo.source.path });
    continue;
  }

  if (requiresPrivateRenders(photo)) {
    for (const [productId, megapixels] of PRODUCTS) {
      const renderKey = renderKeyFor(photo, photo.source, productId);
      if (renderKeys.has(renderKey)) continue;
      if (repair && (!limit || repairedPhotoCount < limit || repaired.masters.includes(masterKey))) {
        if (!sourceForRendering) {
          localSource = localSource || await findLocalSource(photo.source);
          if (localSource) {
            sourceForRendering = localSource;
          } else {
            const tempSource = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "pbe-master-chain-")), basename(photo.source.path));
            await fs.writeFile(tempSource, await getObjectBytes(privateBucket, masterKey));
            sourceForRendering = tempSource;
          }
        }
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pbe-render-"));
        try {
          const outputPath = path.join(tempDir, `${productId}.jpg`);
          let dimensions;
          try {
            dimensions = await dimensionsFor(sourceForRendering);
          } catch (error) {
            missing.renders.push({
              photoId: photo.id,
              productId,
              key: renderKey,
              sourcePath: photo.source.path,
              error: String(error?.message || error),
            });
            console.warn(`render skipped (dimensions) ${renderKey}: ${String(error?.message || error)}`);
            continue;
          }
          const longEdge = longEdgeForMegapixels(dimensions, megapixels);
          await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", "-Z", String(longEdge), sourceForRendering, "--out", outputPath]);
          await putObject(privateBucket, renderKey, await fs.readFile(outputPath), "image/jpeg");
          renderKeys.add(renderKey);
          repaired.renders.push(renderKey);
          console.log(`repaired render ${renderKey}`);
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
        continue;
      }
      missing.renders.push({ photoId: photo.id, productId, key: renderKey });
    }
  }

  for (const key of publicPreviewKeysFor(photo)) {
    if (!publicKeys.has(key)) missing.publicPreviews.push({ photoId: photo.id, key });
  }
}

for (const key of [...renderKeys].sort()) {
  const id = keyPhotoId(key);
  if (masterIds.has(id)) continue;
  pruned.privateRenders.push(key);
  if (prune) {
    await deleteObject(privateBucket, key);
    renderKeys.delete(key);
    console.log(`pruned private render ghost ${key}`);
  }
}

for (const key of [...publicKeys].sort()) {
  const id = previewPhotoId(key);
  if (masterIds.has(id)) continue;
  pruned.publicPreviews.push(key);
  if (prune) {
    await deleteObject(publicBucket, key);
    publicKeys.delete(key);
    console.log(`pruned public preview ghost ${key}`);
  }
}

const renderProductsById = new Map();
const renderKeysById = new Map();
for (const key of renderKeys) {
  const id = keyPhotoId(key);
  if (!id) continue;
  const productId = renderProductId(key);
  if (!productId || !PRODUCTS.has(productId)) continue;
  if (!renderProductsById.has(id)) renderProductsById.set(id, new Set());
  if (!renderKeysById.has(id)) renderKeysById.set(id, {});
  renderProductsById.get(id).add(productId);
  renderKeysById.get(id)[productId] = key;
}

const records = {};
let catalogMasterPhotoIds = 0;
let catalogRenderTripletPhotoIds = 0;
for (const photo of catalog.values()) {
  const masterKey = masterKeyFor(photo, photo.source);
  const presentMasterKey = masterKeysById.get(photo.id);
  const products = renderProductsById.get(photo.id) || new Set();
  if (presentMasterKey) catalogMasterPhotoIds += 1;
  const needsPrivateRenders = requiresPrivateRenders(photo);
  if (needsPrivateRenders && [...PRODUCTS.keys()].every((productId) => products.has(productId))) catalogRenderTripletPhotoIds += 1;
  records[photo.id] = {
    id: photo.id,
    collectionKey: photo.collectionKey,
    sourcePath: photo.source.path,
    mediaType: String(photo.media?.type || "photo"),
    privateMaster: {
      expectedKey: masterKey,
      key: presentMasterKey || "",
      present: Boolean(presentMasterKey),
      targetPresent: masterKeys.has(masterKey),
    },
    privateRenders: needsPrivateRenders ? Object.fromEntries([...PRODUCTS.keys()].map((productId) => {
      const key = renderKeyFor(photo, photo.source, productId);
      return [productId, {
        expectedKey: key,
        key: renderKeysById.get(photo.id)?.[productId] || "",
        present: products.has(productId),
        targetPresent: renderKeys.has(key),
      }];
    })) : {},
    publicPreviews: {
      present: publicPreviewKeysFor(photo).every((key) => publicKeys.has(key)),
    },
  };
}

const privateInventory = {
  schema: "photosbyelie.private-r2-inventory.v1",
  bucket: privateBucket,
  generatedAt: new Date().toISOString(),
  masterKeys: [...masterKeys].sort(),
  renderKeys: [...renderKeys].sort(),
};
const completePreviewIds = [...catalog.values()]
  .filter((photo) => masterIds.has(photo.id) && publicPreviewKeysFor(photo).every((key) => publicKeys.has(key)))
  .map((photo) => photo.id)
  .sort();
const publicPreviewIds = {
  schema: "photosbyelie.public-preview-ids.v1",
  bucket: publicBucket,
  generatedAt: new Date().toISOString(),
  complete_pairs: completePreviewIds,
};
const privateDeliveryManifest = {
  schema: "photosbyelie.private-delivery-manifest.v1",
  updatedAt: new Date().toISOString(),
  privateBucket,
  catalogPhotos: catalog.size,
  privateMasterPhotoIds: catalogMasterPhotoIds,
  privateRenderTripletPhotoIds: catalogRenderTripletPhotoIds,
  records,
};
if (writeManifests) {
  await writeJson(privateInventoryPath, privateInventory);
  await writeJson(publicPreviewIdsPath, publicPreviewIds);
  await writeJson(manifestPath, privateDeliveryManifest);
}
await writeJson(auditPath, {
  schema: "photosbyelie.r2-master-chain-audit.v1",
  generatedAt: new Date().toISOString(),
  repair,
  prune,
  writeManifests,
  publicBucket,
  privateBucket,
  catalogPhotos: catalog.size,
  privateMasters: masterKeys.size,
  privateRenders: renderKeys.size,
  publicPreviews: publicKeys.size,
  repaired,
  missing,
  pruned,
});

console.log(`Done. Masters ${masterKeys.size}; renders ${renderKeys.size}; public previews ${publicKeys.size}.`);
console.log(`Repaired ${repaired.masters.length} masters and ${repaired.renders.length} renders.`);
console.log(`${prune ? "Pruned" : "Would prune"} ${pruned.privateRenders.length} private render ghosts and ${pruned.publicPreviews.length} public preview ghosts.`);
if (missing.masters.length || missing.renders.length || missing.publicPreviews.length) {
  console.log(`Still missing: ${missing.masters.length} masters, ${missing.renders.length} renders, ${missing.publicPreviews.length} public previews.`);
}
