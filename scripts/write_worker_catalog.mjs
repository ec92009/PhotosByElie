#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import catalogTsv from "./catalog_tsv.cjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const output = path.join(repoRoot, "worker", "photos-catalog.generated.mjs");
const allowEmptyCatalogEnv = "PBE_ALLOW_EMPTY_PUBLIC_CATALOG";
const catalogWindow = catalogTsv.loadCatalogWindow(repoRoot);
const storefrontPolicy = { ...(catalogWindow.photosByElieStorefrontPolicy || {}) };
const retiredCollectionKeys = new Set((storefrontPolicy.retiredCollectionKeys || []).map((value) => String(value).toLowerCase()));
const retiredSourceOrigins = new Set((storefrontPolicy.retiredSourceOrigins || []).map((value) => String(value).toLowerCase()));

const photoOriginFor = (photo, collectionKey) => {
  const origin = String(photo?.sourceOrigin || photo?.origin || "").toLowerCase();
  if (origin) return origin;
  if (String(photo?.pricingTier || "").toLowerCase() === "ai") return "ai";
  return String(collectionKey || "").toLowerCase() === "ai" ? "ai" : "camera";
};

function countCatalogPhotos(collections) {
  return Object.values(collections || {}).reduce((total, collection) => {
    const photos = Array.isArray(collection && collection.photos) ? collection.photos : [];
    return total + photos.length;
  }, 0);
}

function existingWorkerCatalogHasMedia() {
  if (!fs.existsSync(output)) {
    return false;
  }
  return fs.readFileSync(output, "utf8").includes("expo/");
}

if (
  countCatalogPhotos(catalogWindow.photosByElieData) === 0 &&
  existingWorkerCatalogHasMedia() &&
  process.env[allowEmptyCatalogEnv] !== "1"
) {
  throw new Error(
    `Refusing to overwrite populated Worker catalog ${path.relative(repoRoot, output)} with zero media rows. ` +
      `Set ${allowEmptyCatalogEnv}=1 if this is intentional.`
  );
}

const workerCollections = Object.fromEntries(
  Object.entries(catalogWindow.photosByElieData || {})
    .filter(([key]) => !retiredCollectionKeys.has(String(key).toLowerCase()))
    .map(([key, collection]) => [key, {
      ...collection,
      photos: (collection.photos || [])
        .filter((photo) => !retiredSourceOrigins.has(photoOriginFor(photo, key)))
        .map(({ pricingTier: _pricingTier, ...photo }) => photo),
    }])
);

const lines = [
  `export const collections = ${JSON.stringify(workerCollections, null, 2)};`,
  `export const storefrontPolicy = ${JSON.stringify(storefrontPolicy, null, 2)};`,
  `export const resolutions = ${JSON.stringify(catalogWindow.photosByElieResolutions || [], null, 2)};`,
  `export const frameOptions = ${JSON.stringify(catalogWindow.photosByElieFrameOptions || [], null, 2)};`,
  `export const videoPriceTiers = ${JSON.stringify(catalogWindow.photosByElieVideoPriceTiers || {}, null, 2)};`,
  `export const podAutomation = ${JSON.stringify(catalogWindow.photosByEliePodAutomation || {}, null, 2)};`,
  `export const podSuppliers = ${JSON.stringify(catalogWindow.photosByEliePodSuppliers || [], null, 2)};`,
  `export const podQualityTiers = ${JSON.stringify(catalogWindow.photosByEliePodQualityTiers || [], null, 2)};`,
  `export const podOptions = ${JSON.stringify(catalogWindow.photosByEliePodOptions || [], null, 2)};`,
  "",
];

fs.writeFileSync(output, lines.join("\n"));
console.log(path.relative(repoRoot, output));
