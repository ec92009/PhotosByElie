#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const showSummary = args.has("--summary");
const externalMedia = args.has("--external-media")
  || process.env.PHOTOSBYELIE_EXTERNAL_MEDIA === "1"
  || Boolean(process.env.PHOTOSBYELIE_PUBLIC_MEDIA_BASE);
const rawSourceTypes = new Set(["DNG", "NEF", "CR2", "CR3", "ARW", "RAF", "ORF", "RW2", "RAW", "PEF", "SRW", "RWL"]);

const toPosix = (value) => value.split(path.sep).join("/");
const relative = (value) => toPosix(path.relative(repoRoot, value));

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const fileSize = (target) => {
  try {
    return fs.statSync(target).size;
  } catch {
    return 0;
  }
};

const folderStats = (target) => {
  let bytes = 0;
  let files = 0;
  if (!fs.existsSync(target)) return { bytes, files };
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      fs.readdirSync(current).forEach((entry) => stack.push(path.join(current, entry)));
      continue;
    }
    if (stat.isFile()) {
      bytes += stat.size;
      files += 1;
    }
  }
  return { bytes, files };
};

const runGit = (command) => {
  try {
    return childProcess.execSync(command, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const pathFromStatusLine = (line) => line.slice(3).replace(/^.* -> /, "");

const isPublishPath = (file) => {
  if (!file) return false;
  if (file === "VERSION" || file === "README.md" || file === "SUMMARY.md" || file === "TODO.md") return true;
  if (file === "home-data.js" || file === "photos-data.js" || file === "assets/expo-manifest.json" || file === "assets/media-sidecar.json") return true;
  if (file === "assets/private-delivery-manifest.json") return true;
  if (file.startsWith("assets/expo/")) return true;
  if (file.startsWith("scripts/")) return true;
  return /\.(html|css|js)$/i.test(file);
};

const loadPhotoData = () => {
  const dataPath = path.join(repoRoot, "photos-data.js");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
  return sandbox.window;
};

const loadHomeData = () => {
  const dataPath = path.join(repoRoot, "home-data.js");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
  return sandbox.window.photosByElieHomeData || {};
};

const cleanLocalReference = (reference) => String(reference || "")
  .replace(/[?#].*$/, "")
  .replace(/^\.\//, "");

const localPathFor = (reference) => {
  const clean = cleanLocalReference(reference);
  if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith("/")) return null;
  const resolved = path.resolve(repoRoot, clean);
  return resolved.startsWith(repoRoot) ? resolved : null;
};

const pairFor = (reference) => {
  if (/_900\.jpg$/i.test(reference)) return reference.replace(/_900\.jpg$/i, "_1800.jpg");
  if (/_1800\.jpg$/i.test(reference)) return reference.replace(/_1800\.jpg$/i, "_900.jpg");
  return null;
};

const validate = () => {
  const windowData = loadPhotoData();
  const homeData = loadHomeData();
  const collections = windowData.photosByElieData || {};
  const resolutions = windowData.photosByElieResolutions || [];
  const availableResolutions = windowData.photosByElieAvailableResolutions;
  const errors = [];
  const warnings = [];
  const seenPhotoIds = new Map();
  const seenPublicPreview = new Map();
  const resolutionIds = new Set();

  resolutions.forEach((resolution) => {
    if (!resolution?.id) errors.push("Resolution option is missing an id.");
    if (resolutionIds.has(resolution.id)) errors.push(`Duplicate resolution id: ${resolution.id}`);
    resolutionIds.add(resolution.id);
    if (!resolution.label) errors.push(`Resolution ${resolution.id || "(missing id)"} is missing a label.`);
    if (!Number.isFinite(Number(resolution.price)) || Number(resolution.price) < 0) {
      errors.push(`Resolution ${resolution.id || "(missing id)"} has an invalid price.`);
    }
    if (resolution.minMegapixels !== undefined && (!Number.isFinite(Number(resolution.minMegapixels)) || Number(resolution.minMegapixels) < 0)) {
      errors.push(`Resolution ${resolution.id || "(missing id)"} has invalid minMegapixels.`);
    }
  });

  if (!fs.existsSync(path.join(repoRoot, "gallery.html"))) {
    errors.push("Shared gallery.html page is missing.");
  }

  Object.entries(collections).forEach(([collectionKey, collection]) => {
    if (!collection?.title) errors.push(`Collection ${collectionKey} is missing a title.`);
    if (!Array.isArray(collection?.photos)) {
      errors.push(`Collection ${collectionKey} is missing a photos array.`);
      return;
    }

    collection.photos.forEach((photo, index) => {
      const context = `${collectionKey}.photos[${index}]`;
      if (!photo?.id) {
        errors.push(`${context} is missing an id.`);
        return;
      }
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(photo.id)) {
        errors.push(`${context} has an unsafe detail id: ${photo.id}`);
      }
      if (seenPhotoIds.has(photo.id)) {
        errors.push(`Duplicate photo id ${photo.id} in ${collectionKey}; first seen in ${seenPhotoIds.get(photo.id)}.`);
      } else {
        seenPhotoIds.set(photo.id, collectionKey);
      }
      if (!photo.title) errors.push(`${photo.id} is missing a title.`);
      if (!photo.gallerySrc) errors.push(`${photo.id} is missing gallerySrc.`);
      if (!photo.imageSrc) errors.push(`${photo.id} is missing imageSrc.`);
      const sourceTypes = (photo.sourceFiles || []).map((source) => String(source?.type || "").trim().toUpperCase());
      if (sourceTypes.some((sourceType) => rawSourceTypes.has(sourceType))) {
        errors.push(`${photo.id} has RAW/DNG source metadata and cannot be published.`);
      }
      if (photo.media?.publicPreview?.allowed === false) {
        errors.push(`${photo.id} is marked ineligible for public preview upload.`);
      }
      const origin = typeof windowData.photosByEliePhotoOrigin === "function"
        ? windowData.photosByEliePhotoOrigin(photo, collectionKey)
        : photo.sourceOrigin;
      if (!["camera", "ai"].includes(origin)) {
        errors.push(`${photo.id} has invalid sourceOrigin: ${photo.sourceOrigin || "(missing)"}.`);
      }
      const expectedPricingTier = origin === "ai" ? "ai" : "original";
      if (photo.pricingTier && photo.pricingTier !== expectedPricingTier) {
        errors.push(`${photo.id} pricingTier ${photo.pricingTier} does not match sourceOrigin ${origin}.`);
      }
      if (collectionKey === "ai" && origin !== "ai") {
        errors.push(`${photo.id} is in the AI collection but is not marked as AI origin.`);
      }

      const publicPreview = photo.media?.publicPreview || {};
      const publicGalleryKey = String(publicPreview.galleryKey || "");
      const publicDetailKey = String(publicPreview.detailKey || "");

      if (externalMedia) {
        if (!publicGalleryKey) errors.push(`${photo.id} is missing publicPreview.galleryKey for external media.`);
        if (!publicDetailKey) errors.push(`${photo.id} is missing publicPreview.detailKey for external media.`);
        if (publicGalleryKey && !/_900\.jpg$/i.test(publicGalleryKey)) {
          errors.push(`${photo.id} publicPreview.galleryKey does not end in _900.jpg.`);
        }
        if (publicDetailKey && !/_1800\.jpg$/i.test(publicDetailKey)) {
          errors.push(`${photo.id} publicPreview.detailKey does not end in _1800.jpg.`);
        }
        if (publicGalleryKey && publicGalleryKey !== `expo/${photo.id}_900.jpg`) {
          errors.push(`${photo.id} publicPreview.galleryKey is not flat by photo id.`);
        }
        if (publicDetailKey && publicDetailKey !== `expo/${photo.id}_1800.jpg`) {
          errors.push(`${photo.id} publicPreview.detailKey is not flat by photo id.`);
        }
        if (publicGalleryKey && publicDetailKey && pairFor(publicGalleryKey) !== publicDetailKey) {
          errors.push(`${photo.id} public preview gallery/detail keys do not match.`);
        }
      } else {
        [photo.gallerySrc, photo.imageSrc].filter(Boolean).forEach((reference) => {
          const targetPath = localPathFor(reference);
          if (!targetPath) {
            errors.push(`${photo.id} has a non-local asset reference: ${reference}`);
            return;
          }
          if (!fs.existsSync(targetPath)) errors.push(`${photo.id} references a missing asset: ${cleanLocalReference(reference)}`);
          const paired = pairFor(reference);
          const pairedPath = paired ? localPathFor(paired) : null;
          if (pairedPath && !fs.existsSync(pairedPath)) {
            errors.push(`${photo.id} is missing derivative pair: ${cleanLocalReference(paired)}`);
          }
        });
      }
      seenPublicPreview.set(photo.id, {
        collectionKey,
        galleryKey: publicGalleryKey,
        detailKey: publicDetailKey,
      });

      if (photo.gallerySrc && !/_900\.jpg$/i.test(photo.gallerySrc)) {
        warnings.push(`${photo.id} gallerySrc does not end in _900.jpg.`);
      }
      if (photo.imageSrc && !/_1800\.jpg$/i.test(photo.imageSrc)) {
        warnings.push(`${photo.id} imageSrc does not end in _1800.jpg.`);
      }
      if (photo.gallerySrc && photo.imageSrc && pairFor(photo.gallerySrc) !== photo.imageSrc) {
        errors.push(`${photo.id} gallery/detail derivative names do not match.`);
      }
      if (!Number.isFinite(Number(photo.megapixels)) || Number(photo.megapixels) <= 0) {
        warnings.push(`${photo.id} has missing or invalid megapixels.`);
      }

      const available = typeof availableResolutions === "function"
        ? availableResolutions(photo, resolutions)
        : resolutions;
      const availableIds = new Set();
      if (!Array.isArray(available) || !available.length) {
        warnings.push(`${photo.id} has no available resolution options.`);
      }
      (available || []).forEach((option) => {
        if (!option?.id || !resolutionIds.has(option.id)) {
          errors.push(`${photo.id} exposes unknown resolution option: ${option?.id || "(missing id)"}`);
        }
        if (availableIds.has(option.id)) {
          errors.push(`${photo.id} exposes duplicate available resolution: ${option.id}`);
        }
        availableIds.add(option.id);
      });
    });
  });

  Object.entries(collections).forEach(([collectionKey, collection]) => {
    const homeCollection = homeData[collectionKey];
    if (!homeCollection) {
      errors.push(`home-data.js is missing ${collectionKey}.`);
      return;
    }
    if (Number(homeCollection.count || 0) !== (collection.photos || []).length) {
      errors.push(`home-data.js ${collectionKey} count does not match photos-data.js.`);
    }
    const samples = homeCollection.photos || [];
    if (!samples.length && (collection.photos || []).length) {
      errors.push(`home-data.js ${collectionKey} has no sample photos.`);
    }
    samples.forEach((photo) => {
      if (!photo?.id) errors.push(`home-data.js ${collectionKey} sample is missing an id.`);
      if (!photo?.media?.publicPreview?.galleryKey && !photo?.gallerySrc) {
        errors.push(`home-data.js ${photo?.id || collectionKey} sample is missing gallery media.`);
      }
    });
  });

  const sidecarPath = path.join(repoRoot, "assets", "media-sidecar.json");
  if (!fs.existsSync(sidecarPath)) {
    errors.push("assets/media-sidecar.json is missing.");
  } else {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      const sidecarPhotos = sidecar.photos || {};
      if (Number(sidecar.photosCount) !== seenPhotoIds.size) {
        errors.push(`assets/media-sidecar.json photosCount is ${sidecar.photosCount}; expected ${seenPhotoIds.size}.`);
      }
      seenPublicPreview.forEach((preview, photoId) => {
        const sidecarPhoto = sidecarPhotos[photoId];
        if (!sidecarPhoto) {
          errors.push(`${photoId} is missing from assets/media-sidecar.json.`);
          return;
        }
        if (sidecarPhoto.collectionKey !== preview.collectionKey) {
          errors.push(`${photoId} sidecar collectionKey does not match catalog.`);
        }
        if (sidecarPhoto.publicPreview?.galleryKey !== preview.galleryKey) {
          errors.push(`${photoId} sidecar galleryKey does not match catalog.`);
        }
        if (sidecarPhoto.publicPreview?.detailKey !== preview.detailKey) {
          errors.push(`${photoId} sidecar detailKey does not match catalog.`);
        }
        if (!sidecarPhoto.legacyPublicPreview?.galleryKey || !sidecarPhoto.legacyPublicPreview?.detailKey) {
          warnings.push(`${photoId} sidecar has no legacy public preview key.`);
        }
        if (!sidecarPhoto.privateDelivery?.masterKey) {
          warnings.push(`${photoId} sidecar has no private master key.`);
        }
      });
    } catch (error) {
      errors.push(`assets/media-sidecar.json is not valid JSON: ${error.message}`);
    }
  }

  return { collections, errors, warnings };
};

const printSummary = (collections) => {
  const collectionRows = Object.entries(collections)
    .map(([key, collection]) => ({ key, title: collection.title || key, count: collection.photos?.length || 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const totalPhotos = collectionRows.reduce((sum, row) => sum + row.count, 0);
  const expoStats = folderStats(path.join(repoRoot, "assets", "expo"));
  const importCacheStats = folderStats(path.join(repoRoot, "tmp", "import-cache"));
  const reserveStats = folderStats(path.join(repoRoot, "assets", "reserve"));
  const hiddenStats = folderStats(path.join(repoRoot, "assets", "hidden"));
  const statusOutput = runGit("git status --short -- .");
  const changed = statusOutput
    ? statusOutput.split("\n").filter((line) => isPublishPath(pathFromStatusLine(line)))
    : [];
  const changedBytes = changed.reduce((sum, line) => {
    const file = pathFromStatusLine(line);
    return sum + fileSize(path.join(repoRoot, file));
  }, 0);
  const assetCatalogChanged = changed.filter((line) => {
    const file = pathFromStatusLine(line);
    return file === "home-data.js" || file === "photos-data.js" || file === "assets/expo-manifest.json" || file === "assets/media-sidecar.json" || file.startsWith("assets/expo/");
  });
  const diffStat = runGit("git diff --stat -- .");

  console.log("\nPublish summary");
  console.log("---------------");
  console.log(`Photos: ${totalPhotos}`);
  collectionRows.forEach((row) => console.log(`- ${row.title}: ${row.count}`));
  console.log(`Expo assets: ${expoStats.files} files, ${formatBytes(expoStats.bytes)}`);
  console.log(`Import cache: ${importCacheStats.files} files, ${formatBytes(importCacheStats.bytes)} (ignored/tmp)`);
  console.log(`Reserve compatibility data: ${reserveStats.files} files, ${formatBytes(reserveStats.bytes)} (ignored/local)`);
  console.log(`Hidden assets: ${hiddenStats.files} files, ${formatBytes(hiddenStats.bytes)} (ignored/local)`);
  console.log(`Media validation: ${externalMedia ? "external R2/CDN keys" : "local Expo asset files"}`);
  console.log(`Changed Expo/catalog files: ${assetCatalogChanged.length}`);
  console.log(`Changed publish files: ${changed.length}, current working-tree volume ${formatBytes(changedBytes)}`);
  if (changed.length) {
    changed.slice(0, 20).forEach((line) => console.log(`- ${line}`));
    if (changed.length > 20) console.log(`- ...${changed.length - 20} more`);
  }
  if (diffStat) {
    console.log("\nGit diff stat");
    console.log(diffStat);
  }
};

const { collections, errors, warnings } = validate();

if (warnings.length) {
  console.log("Validation warnings");
  console.log("-------------------");
  warnings.forEach((warning) => console.log(`- ${warning}`));
  console.log("");
}

if (errors.length) {
  console.error("Validation errors");
  console.error("-----------------");
  errors.forEach((error) => console.error(`- ${error}`));
} else {
  console.log("Validation OK");
}

if (showSummary) printSummary(collections);

process.exit(errors.length ? 1 : 0);
