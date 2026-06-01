#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import catalogTsv from "./catalog_tsv.cjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const catalogWindow = catalogTsv.loadCatalogWindow(repoRoot);

const workerCollections = Object.fromEntries(
  Object.entries(catalogWindow.photosByElieData || {}).map(([key, collection]) => [key, {
    ...collection,
    photos: (collection.photos || []).map(({ pricingTier: _pricingTier, ...photo }) => photo),
  }])
);

const lines = [
  `export const collections = ${JSON.stringify(workerCollections, null, 2)};`,
  `export const resolutions = ${JSON.stringify(catalogWindow.photosByElieResolutions || [], null, 2)};`,
  `export const frameOptions = ${JSON.stringify(catalogWindow.photosByElieFrameOptions || [], null, 2)};`,
  `export const videoPriceTiers = ${JSON.stringify(catalogWindow.photosByElieVideoPriceTiers || {}, null, 2)};`,
  `export const podAutomation = ${JSON.stringify(catalogWindow.photosByEliePodAutomation || {}, null, 2)};`,
  `export const podSuppliers = ${JSON.stringify(catalogWindow.photosByEliePodSuppliers || [], null, 2)};`,
  `export const podQualityTiers = ${JSON.stringify(catalogWindow.photosByEliePodQualityTiers || [], null, 2)};`,
  `export const podOptions = ${JSON.stringify(catalogWindow.photosByEliePodOptions || [], null, 2)};`,
  "",
];

const output = path.join(repoRoot, "worker", "photos-catalog.generated.mjs");
fs.writeFileSync(output, lines.join("\n"));
console.log(path.relative(repoRoot, output));
