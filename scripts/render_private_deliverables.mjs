#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collections } from "../worker/photos-catalog.generated.mjs";

const PRODUCTS = new Map([
  ["jpg-6mp", 6],
  ["jpg-3mp", 3],
  ["jpg-1mp", 1],
]);

const args = process.argv.slice(2);
const valuesFor = (name) => args.flatMap((arg, index) => arg === name ? [args[index + 1]] : []).filter(Boolean);
const hasFlag = (name) => args.includes(name);
const photoIds = valuesFor("--photo-id");
const products = valuesFor("--product");
const sourceRootArgs = valuesFor("--source-root");
const dryRun = hasFlag("--dry-run");
const bucket = valuesFor("--bucket")[0] || "photosbyelie-private";
const hasS3BackendEnv = Boolean(
  (process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID)
  && (process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)
  && (process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)
);
const backend = valuesFor("--backend")[0] || process.env.PBE_R2_BACKEND || (hasS3BackendEnv ? "s3" : "wrangler");

if (!["wrangler", "s3"].includes(backend)) {
  throw new Error(`Unsupported backend: ${backend}`);
}

if (!photoIds.length) {
  console.error("Usage: node scripts/render_private_deliverables.mjs --photo-id <id> [--product jpg-6mp] [--dry-run]");
  process.exit(2);
}

const safeName = (value, fallback) => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const basename = (value) => String(value || "").split(/[\\/]/).pop();
const sourceType = (source) => String(source?.type || basename(source?.path).split(".").pop() || "").toUpperCase();
const rawTypes = new Set(["DNG", "NEF", "CR2", "CR3", "ARW", "RAF", "ORF", "RW2", "RAW", "PEF", "SRW", "RWL"]);
const defaultSourceRoots = [
  "/Volumes/Saturn/Pictures/LR/Camera",
  "/Volumes/Saturn-1/Pictures/LR/Camera",
  path.join(os.homedir(), "Pictures/LR/Camera"),
  path.join(os.homedir(), "Pictures/LR/2024"),
];

const catalog = new Map();
Object.values(collections).forEach((collection) => {
  (collection.photos || []).forEach((photo) => catalog.set(photo.id, photo));
});

const run = (command, commandArgs, options = {}) => new Promise((resolve, reject) => {
  if (dryRun && options.mutate) {
    console.log(["DRY", command, ...commandArgs].join(" "));
    resolve("");
    return;
  }
  const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
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

const firstEnv = (...names) => {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
};

const configuredSourceRoots = () => {
  const envRoots = (process.env.PBE_DELIVERY_SOURCE_ROOTS || process.env.PBE_DELIVERY_SOURCE_ROOT || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...sourceRootArgs, ...envRoots, ...defaultSourceRoots];
};

const fileExists = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
};

const findLocalSource = async (source) => {
  const sourcePath = String(source?.path || "");
  if (!sourcePath) return "";
  if (path.isAbsolute(sourcePath) && await fileExists(sourcePath)) return sourcePath;
  for (const root of configuredSourceRoots()) {
    const candidates = [
      path.join(root, sourcePath),
      path.join(root, basename(sourcePath)),
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate;
    }
  }
  return "";
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

const s3Credentials = () => {
  const credentials = {
    accountId: firstEnv("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"),
    accessKeyId: firstEnv("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
    secretAccessKey: firstEnv("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    endpoint: process.env.R2_S3_ENDPOINT || "",
  };
  const missing = [
    ["R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID", credentials.accountId],
    ["R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID", credentials.accessKeyId],
    ["R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY", credentials.secretAccessKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing S3 backend credential(s): ${missing.join(", ")}`);
  return credentials;
};

const s3Request = async (method, objectBucket, key, body = Buffer.alloc(0), contentType = "") => {
  const credentials = s3Credentials();
  const host = credentials.endpoint || `${credentials.accountId}.r2.cloudflarestorage.com`;
  const objectPath = `${objectBucket}/${key}`;
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
  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${datestamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, credentialScope, sha256(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", s3SigningKey(credentials.secretAccessKey, datestamp)).update(stringToSign).digest("hex");
  const requestHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  requestHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}${canonicalPath}`, {
    method,
    headers: requestHeaders,
    body: method === "PUT" ? body : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${objectBucket}/${key}: HTTP ${response.status} ${text}`.trim());
  }
  return response;
};

const getObject = async (objectBucket, key, filePath) => {
  if (backend === "s3") {
    const response = await s3Request("GET", objectBucket, key);
    await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    return;
  }
  await run("npx", ["wrangler", "r2", "object", "get", `${objectBucket}/${key}`, "--remote", "--file", filePath], { mutate: false });
};

const putObject = async (objectBucket, key, filePath, contentType) => {
  if (dryRun) {
    console.log(`DRY ${backend} put ${objectBucket}/${key} --file ${filePath}`);
    return;
  }
  if (backend === "s3") {
    await s3Request("PUT", objectBucket, key, await fs.readFile(filePath), contentType);
    return;
  }
  await run("npx", [
    "wrangler", "r2", "object", "put", `${objectBucket}/${key}`,
    "--remote",
    "--file", filePath,
    "--content-type", contentType,
  ], { mutate: true });
};

const dimensionsFor = async (filePath) => {
  const output = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not read image dimensions for ${filePath}`);
  return { width, height };
};

const longEdgeForMegapixels = ({ width, height }, megapixels) => {
  const sourcePixels = width * height;
  const targetPixels = megapixels * 1_000_000;
  if (targetPixels >= sourcePixels) return Math.max(width, height);
  return Math.max(1, Math.round(Math.max(width, height) * Math.sqrt(targetPixels / sourcePixels)));
};

const selectedProducts = products.length ? products : Array.from(PRODUCTS.keys());
selectedProducts.forEach((product) => {
  if (!PRODUCTS.has(product)) throw new Error(`Unsupported product: ${product}`);
});

let uploaded = 0;
let skipped = 0;

for (const photoId of photoIds) {
  const photo = catalog.get(photoId);
  if (!photo) throw new Error(`Unknown photo id: ${photoId}`);
  const source = (photo.sourceFiles || []).find((candidate) => !rawTypes.has(sourceType(candidate)));
  if (!source) throw new Error(`No developed source for ${photoId}`);

  const sourceKey = `masters/${photoId}/${basename(source.path)}`;
  const renderDir = `renders/${safeName(photoId, "photo")}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pbe-render-"));
  const downloadedSourcePath = path.join(tempDir, basename(source.path));

  console.log(`Photo ${photoId}`);
  const localSourcePath = await findLocalSource(source);
  const sourcePath = localSourcePath || downloadedSourcePath;
  if (localSourcePath) {
    console.log(`  source local ${localSourcePath}`);
  } else {
    console.log(`  source ${sourceKey}`);
    await getObject(bucket, sourceKey, downloadedSourcePath);
  }
  const dimensions = await dimensionsFor(sourcePath);

  for (const product of selectedProducts) {
    const renderKey = `${renderDir}/${safeName(basename(source.path), "source")}-${product}.jpg`;
    const outputPath = path.join(tempDir, `${product}.jpg`);
    const longEdge = longEdgeForMegapixels(dimensions, PRODUCTS.get(product));
    console.log(`  render ${product} -> ${renderKey} (${longEdge}px long edge)`);
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", "-Z", String(longEdge), sourcePath, "--out", outputPath], { mutate: true });
    await putObject(bucket, renderKey, outputPath, "image/jpeg");
    uploaded += 1;
  }

  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log(`Done. Uploaded ${uploaded} private render${uploaded === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`);
