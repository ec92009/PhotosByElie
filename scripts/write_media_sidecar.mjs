#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { collections } from "../worker/photos-catalog.generated.mjs";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
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
const safeName = (value, fallback) => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const keyFor = (photoId, size) => `expo/${photoId}_${size}.jpg`;
const privateMasterKey = (photo) => {
  const source = (photo.sourceFiles || [])[0] || {};
  const name = basename(source.path);
  return name ? `masters/${photo.id}/${name}` : "";
};
const privateRenderKeys = (photo) => {
  const source = (photo.sourceFiles || [])[0] || {};
  const name = safeName(basename(source.path), "source");
  if (!name) return {};
  return {
    "jpg-6mp": `renders/${photo.id}/${name}-jpg-6mp.jpg`,
    "jpg-3mp": `renders/${photo.id}/${name}-jpg-3mp.jpg`,
    "jpg-1mp": `renders/${photo.id}/${name}-jpg-1mp.jpg`,
  };
};

const expoManifest = readJson(expoManifestPath, {});
const sourceById = new Map((expoManifest.photos || []).map((row) => [row.id, row]));
const photos = {};

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
      localPreview: {
        gallerySrc: photo.gallerySrc || "",
        detailSrc: photo.imageSrc || "",
      },
      publicPreview: {
        galleryKey: photo.media?.publicPreview?.galleryKey || keyFor(photo.id, "900"),
        detailKey: photo.media?.publicPreview?.detailKey || keyFor(photo.id, "1800"),
      },
      legacyPublicPreview: {
        galleryKey: source.derivatives?.gallery
          ? `expo/${String(source.derivatives.gallery).replace(/^assets\/expo\//, "")}`
          : "",
        detailKey: source.derivatives?.detail
          ? `expo/${String(source.derivatives.detail).replace(/^assets\/expo\//, "")}`
          : "",
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
  publicPreviewKeyScheme: "expo/<photo-id>_<900|1800>.jpg",
  privateMasterKeyScheme: "masters/<photo-id>/<original-file>",
  privateRenderKeyScheme: "renders/<photo-id>/<original-file>-<product-id>.jpg",
  photosCount: Object.keys(photos).length,
  photos,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(path.relative(repoRoot, outputPath));
