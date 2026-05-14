#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { collections } from "../worker/photos-catalog.generated.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const fullPath = (value) => path.isAbsolute(value) ? value : path.join(repoRoot, value);
const outputPath = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : "assets/storage-estimate.json";
const publicBucket = process.argv.includes("--public-bucket")
  ? process.argv[process.argv.indexOf("--public-bucket") + 1]
  : "photosbyelie-public";
const privateBucket = process.argv.includes("--private-bucket")
  ? process.argv[process.argv.indexOf("--private-bucket") + 1]
  : "photosbyelie-private";

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
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const s3SigningKey = (secretKey, datestamp) => {
  const dateKey = hmac(Buffer.from(`AWS4${secretKey}`, "utf8"), datestamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
};
const quoteS3Path = (value) => `/${String(value).split("/").map((part) => encodeURIComponent(part)).join("/")}`;
const queryString = (params) => Object.entries(params)
  .filter(([, value]) => value !== "")
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  .join("&");
const xmlText = (value) => String(value || "")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", "\"")
  .replaceAll("&apos;", "'");

const s3Get = async (bucket, query = "") => {
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
  const canonicalPath = quoteS3Path(bucket);
  const canonicalRequest = ["GET", canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${datestamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", s3SigningKey(credentials.secretAccessKey, datestamp)).update(stringToSign).digest("hex");
  const response = await fetch(`https://${host}${canonicalPath}${query ? `?${query}` : ""}`, {
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now,
      Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  if (!response.ok) throw new Error(`GET ${bucket}: HTTP ${response.status} ${await response.text()}`.trim());
  return response.text();
};

const listObjects = async (bucket, prefix) => {
  const objects = [];
  let token = "";
  do {
    const xml = await s3Get(bucket, queryString({
      "continuation-token": token,
      "list-type": "2",
      "max-keys": "1000",
      prefix,
    }));
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const item = match[1];
      const key = xmlText(item.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "");
      const size = Number(item.match(/<Size>(\d+)<\/Size>/)?.[1] || 0);
      if (key) objects.push({ key, size });
    }
    token = xmlText(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || "");
  } while (token);
  return objects;
};

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(fullPath(file), "utf8"));
  } catch {
    return fallback;
  }
};
const sum = (values) => values.reduce((total, value) => total + Number(value || 0), 0);
const objectBytes = (objects) => sum(objects.map((object) => object.size));
const sourceBytesForPhotos = (photos) => sum(photos.flatMap((photo) => photo.sourceFiles || []).map((file) => file.bytes));
const allCatalogPhotos = Object.values(collections).flatMap((collection) => collection.photos || []);
const hiddenData = await readJson("assets/hidden/hidden-data.json", {});
const hiddenPhotos = Object.values(hiddenData).flatMap((collection) => collection?.photos || []);
const discarded = await readJson("assets/discarded-media-manifest.json", {});

const [publicPreviews, privateMasters, privateRenders] = await Promise.all([
  listObjects(publicBucket, "expo/"),
  listObjects(privateBucket, "masters/"),
  listObjects(privateBucket, "renders/"),
]);

const current = {
  publicPreviewObjects: publicPreviews.length,
  publicPreviewBytes: objectBytes(publicPreviews),
  privateMasterObjects: privateMasters.length,
  privateMasterBytes: objectBytes(privateMasters),
  privateRenderObjects: privateRenders.length,
  privateRenderBytes: objectBytes(privateRenders),
};
current.totalBytes = current.publicPreviewBytes + current.privateMasterBytes + current.privateRenderBytes;

const deletedPublicObjects = Array.isArray(discarded.publicKeys) ? discarded.publicKeys.length : 0;
const deletedRenderObjects = Array.isArray(discarded.privateKeys)
  ? discarded.privateKeys.filter((key) => String(key).startsWith("renders/")).length
  : 0;
const deletedMasterObjects = Array.isArray(discarded.privateKeys)
  ? discarded.privateKeys.filter((key) => String(key).startsWith("masters/")).length
  : 0;
const avgPublicPreviewBytes = current.publicPreviewObjects ? current.publicPreviewBytes / current.publicPreviewObjects : 0;
const avgPrivateRenderBytes = current.privateRenderObjects ? current.privateRenderBytes / current.privateRenderObjects : 0;
const blocked = {
  photoIds: Array.isArray(discarded.discardedPhotoIds) ? discarded.discardedPhotoIds.length : hiddenPhotos.length,
  publicPreviewObjects: deletedPublicObjects,
  publicPreviewBytesEstimate: Math.round(deletedPublicObjects * avgPublicPreviewBytes),
  privateMasterObjects: deletedMasterObjects,
  privateMasterBytes: sourceBytesForPhotos(hiddenPhotos),
  privateRenderObjects: deletedRenderObjects,
  privateRenderBytesEstimate: Math.round(deletedRenderObjects * avgPrivateRenderBytes),
};
blocked.totalBytesEstimate = blocked.publicPreviewBytesEstimate + blocked.privateMasterBytes + blocked.privateRenderBytesEstimate;

const noCleanup = {
  totalBytesEstimate: current.totalBytes + blocked.totalBytesEstimate,
};
const pricing = {
  provider: "Cloudflare R2 Standard storage",
  sourceUrl: "https://developers.cloudflare.com/r2/pricing/",
  storageUsdPerGbMonth: 0.015,
  freeTierGbMonth: 10,
  classAFreeTier: 1_000_000,
  classBFreeTier: 10_000_000,
  classAUsdPerMillion: 4.5,
  classBUsdPerMillion: 0.36,
  workers: {
    provider: "Cloudflare Workers Standard",
    sourceUrl: "https://developers.cloudflare.com/workers/platform/pricing/",
    paidBaseUsdPerMonth: 5,
    includedRequests: 10_000_000,
    includedCpuMs: 30_000_000,
    requestUsdPerMillion: 0.30,
    cpuUsdPerMillionMs: 0.02,
  },
  notes: [
    "Storage bytes are measured; R2 Class A/Class B operations and Workers request/CPU usage need Cloudflare analytics to become invoice-complete.",
    "R2 billing uses GB-month, not GiB-month. Displayed byte totals use binary units.",
    "Current R2 object bytes are read from live bucket listings. Blocked/deleted public preview and private render bytes are estimated from current average object sizes because those objects were already deleted.",
  ],
};
const usdForBytes = (bytes, includeFreeTier = false) => {
  const gb = Number(bytes || 0) / 1_000_000_000;
  const billable = includeFreeTier ? Math.max(0, gb - pricing.freeTierGbMonth) : gb;
  return Number((billable * pricing.storageUsdPerGbMonth).toFixed(4));
};
const cost = {
  currentMonthlyUsd: usdForBytes(current.totalBytes),
  currentMonthlyUsdAfterFreeTier: usdForBytes(current.totalBytes, true),
  noCleanupMonthlyUsdEstimate: usdForBytes(noCleanup.totalBytesEstimate),
  noCleanupMonthlyUsdEstimateAfterFreeTier: usdForBytes(noCleanup.totalBytesEstimate, true),
  avoidedMonthlyUsdEstimate: usdForBytes(blocked.totalBytesEstimate),
};

const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const elapsedRatio = (now - monthStart) / (nextMonthStart - monthStart);
const billing = {
  generatedAt: now.toISOString(),
  month: now.toLocaleString("en-US", { month: "short", year: "numeric" }),
  nextMonth: nextMonthStart.toLocaleString("en-US", { month: "short", year: "numeric" }),
  elapsedMonthRatio: Number(elapsedRatio.toFixed(6)),
  measuredStorageOnly: {
    consumedMonthToDateUsd: Number((cost.currentMonthlyUsdAfterFreeTier * elapsedRatio).toFixed(4)),
    expectedThisMonthUsd: cost.currentMonthlyUsdAfterFreeTier,
    expectedNextMonthUsdAtCurrentRate: cost.currentMonthlyUsdAfterFreeTier,
  },
  withWorkersPaidBaseIfEnabled: {
    expectedThisMonthUsd: Number((cost.currentMonthlyUsdAfterFreeTier + pricing.workers.paidBaseUsdPerMonth).toFixed(4)),
    expectedNextMonthUsdAtCurrentRate: Number((cost.currentMonthlyUsdAfterFreeTier + pricing.workers.paidBaseUsdPerMonth).toFixed(4)),
  },
  unmeasuredLineItems: [
    "R2 Class A/Class B operations",
    "Workers requests and CPU overages",
    "Workers Paid subscription state",
  ],
};

const payload = {
  schema: "photosbyelie.storage-estimate.v1",
  updatedAt: new Date().toISOString(),
  buckets: { public: publicBucket, private: privateBucket },
  catalog: {
    photos: allCatalogPhotos.length,
    sourceBytes: sourceBytesForPhotos(allCatalogPhotos),
  },
  current,
  blocked,
  noCleanup,
  pricing,
  cost,
  billing,
};

await fs.mkdir(path.dirname(fullPath(outputPath)), { recursive: true });
await fs.writeFile(fullPath(outputPath), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${outputPath}: ${current.totalBytes} current bytes, ${noCleanup.totalBytesEstimate} no-cleanup bytes.`);
