#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { loadCatalogWindow } = require("./catalog_tsv.cjs");
const expoManifestPath = path.join(repoRoot, "assets", "expo-manifest.json");
const outputPath = path.join(repoRoot, "assets", "media-sidecar.json");

const readJson = (filePath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
};

const basename = (value) => String(value || "").split(/[\\/]/).pop();
const normalizedExtension = (value, fallback = "jpg") => {
  const extension = String(value || fallback).trim().toLowerCase().replace(/^\./, "");
  if (["jpeg", "jpe"].includes(extension)) return "jpg";
  if (extension === "tiff") return "tif";
  if (extension === "m4v") return "mp4";
  return extension || fallback;
};

const keyFor = (photoId, size) => `expo/${photoId}_${size}.jpg`;
const privateMasterKey = (photo) => {
  const source = (photo.sourceFiles || [])[0] || {};
  const extension = normalizedExtension(source.type || basename(source.path).split(".").pop());
  return photo.id && extension ? `masters/${photo.id}.${extension}` : "";
};
const privateRenderKeys = (photo) => {
  if (!photo.id) return {};
  if (String(photo.media?.type || photo.media_type || photo.mediaType || "photo").toLowerCase() === "video") return {};
  return {
    "jpg-6mp": `renders/${photo.id}_6mp.jpg`,
    "jpg-3mp": `renders/${photo.id}_3mp.jpg`,
    "jpg-1mp": `renders/${photo.id}_1mp.jpg`,
  };
};

const expoManifest = readJson(expoManifestPath, {});
const sourceById = new Map((expoManifest.photos || []).map((row) => [row.id, row]));
const photos = {};
const collections = loadCatalogWindow(repoRoot).photosByElieData || {};

Object.entries(collections).forEach(([collectionKey, collection]) => {
  (collection.photos || []).forEach((photo) => {
    const source = sourceById.get(photo.id) || {};
    const sourceFile = (photo.sourceFiles || [])[0] || {};
    const galleryCountry = source.gallery_country || {};
    photos[photo.id] = {
      id: photo.id,
      collectionKey,
      collectionTitle: collection.title || collectionKey,
      sourcePath: source.relative_path || sourceFile.path || "",
      sourceFile: {
        path: sourceFile.path || source.relative_path || "",
        type: sourceFile.type || "",
        bytes: sourceFile.bytes || null,
      },
      sourceMode: source.source_mode || "",
      originalGalleryCountry: {
        slug: galleryCountry.slug || collectionKey,
        label: galleryCountry.label || collection.title || collectionKey,
        source: galleryCountry.source || "",
      },
      publicPreview: {
        galleryKey: photo.media?.publicPreview?.galleryKey || keyFor(photo.id, "900"),
        detailKey: photo.media?.publicPreview?.detailKey || keyFor(photo.id, "1800"),
      },
      privateDelivery: {
        masterKey: privateMasterKey(photo),
        renderKeys: privateRenderKeys(photo),
      },
    };
  });
});

const payload = {
  schema: "photosbyelie.media-sidecar.v1",
  publicPreviewKeyScheme: "expo/<photo-id>_900.jpg and expo/<photo-id>_1800.jpg for photos or expo/<photo-id>_short_5s_720p.mp4 for videos",
  privateMasterKeyScheme: "masters/<photo-id>.<original-format>",
  privateRenderKeyScheme: "renders/<photo-id>_<1|3|6>mp.jpg",
  photosCount: Object.keys(photos).length,
  photos,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(path.relative(repoRoot, outputPath));
