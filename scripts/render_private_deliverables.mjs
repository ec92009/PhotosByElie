#!/usr/bin/env node
import { spawn } from "node:child_process";
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
const dryRun = hasFlag("--dry-run");
const bucket = valuesFor("--bucket")[0] || "photosbyelie-private";

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
  const sourcePath = path.join(tempDir, basename(source.path));

  console.log(`Photo ${photoId}`);
  console.log(`  source ${sourceKey}`);
  await run("npx", ["wrangler", "r2", "object", "get", `${bucket}/${sourceKey}`, "--remote", "--file", sourcePath], { mutate: false });
  const dimensions = await dimensionsFor(sourcePath);

  for (const product of selectedProducts) {
    const renderKey = `${renderDir}/${safeName(basename(source.path), "source")}-${product}.jpg`;
    const outputPath = path.join(tempDir, `${product}.jpg`);
    const longEdge = longEdgeForMegapixels(dimensions, PRODUCTS.get(product));
    console.log(`  render ${product} -> ${renderKey} (${longEdge}px long edge)`);
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", "-Z", String(longEdge), sourcePath, "--out", outputPath], { mutate: true });
    await run("npx", [
      "wrangler", "r2", "object", "put", `${bucket}/${renderKey}`,
      "--remote",
      "--file", outputPath,
      "--content-type", "image/jpeg",
    ], { mutate: true });
    uploaded += 1;
  }

  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log(`Done. Uploaded ${uploaded} private render${uploaded === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.`);
