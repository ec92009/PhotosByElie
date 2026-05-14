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
  "",
];

const output = path.join(repoRoot, "worker", "photos-catalog.generated.mjs");
fs.writeFileSync(output, lines.join("\n"));
console.log(path.relative(repoRoot, output));
