#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const REPO_ROOT = process.cwd();
const DEFAULT_LIMIT = 100;
const REVIEW_FLAG = "Title_Keywords_Reviewed";

const readText = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

const loadWindowData = (relativePath, variableName) => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readText(relativePath), context, { filename: relativePath });
  return context.window?.[variableName] ?? null;
};

const metadataValue = (photo, label) => {
  const items = Array.isArray(photo?.metadata) ? photo.metadata : [];
  for (const item of items) {
    if (item?.label === label && item?.value != null && item?.value !== "") return String(item.value);
  }
  return "";
};

const parseCaptured = (raw) => {
  const value = String(raw || "").trim();
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return { raw: value, date: "", sort: "" };
  const [, year, month, day, hour, minute, second] = match;
  const date = `${year}-${month}-${day}`;
  const sort = `${date}T${hour}:${minute}:${second}`;
  return { raw: value, date, sort };
};

const parseIdCapture = (photoId) => {
  const id = String(photoId || "");
  const match = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!match) return { raw: "", date: "", sort: "" };
  const [, year, month, day, hour, minute, second] = match;
  const date = `${year}-${month}-${day}`;
  return { raw: `${year}:${month}:${day} ${hour}:${minute}:${second}`, date, sort: `${date}T${hour}:${minute}:${second}` };
};

const captureForPhoto = (photo) => {
  const captured = parseCaptured(metadataValue(photo, "Captured"));
  if (captured.sort) return captured;
  return parseIdCapture(photo?.id);
};

const splitKeywordText = (raw) => String(raw || "")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

const uniqueKeywords = (items) => {
  const seen = new Set();
  const next = [];
  for (const item of items || []) {
    const value = String(item || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
};

const isReviewed = (photo) => {
  const rawFlags = metadataValue(photo, "Flags");
  if (rawFlags && rawFlags.split(",").some((part) => part.trim() === REVIEW_FLAG)) return true;
  const keywords = splitKeywordText(metadataValue(photo, "Keywords"));
  return keywords.some((keyword) => keyword.trim() === REVIEW_FLAG);
};

const parseArgs = (argv) => {
  const args = { limit: DEFAULT_LIMIT };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--limit") {
      const raw = argv[index + 1];
      index += 1;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) args.limit = Math.floor(parsed);
      continue;
    }
    if (value === "--help" || value === "-h") {
      args.help = true;
    }
  }
  return args;
};

const localDateString = () => {
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const main = () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/generate_title_keyword_review_queue.mjs [--limit 100]\n");
    process.exit(0);
  }

  const queueDir = path.join("assets", "owner-actions", "title-keyword-review-queue");
  const batchId = localDateString();
  const batchFilename = `batch-${batchId}.json`;
  const batchPath = path.join(queueDir, batchFilename);
  const latestPath = path.join(queueDir, "latest.json");

  const photosData = loadWindowData("photos-data.js", "photosByElieData");
  if (!photosData || typeof photosData !== "object") {
    throw new Error("Could not load photos-data.js (window.photosByElieData).");
  }

  const blacklistPayload = JSON.parse(readText("assets/owner-actions/keyword-blacklist.json"));
  const blacklisted = new Set(
    Array.isArray(blacklistPayload?.keywords)
      ? blacklistPayload.keywords.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
      : [],
  );

  const flattened = [];
  for (const [galleryKey, collection] of Object.entries(photosData)) {
    const galleryLabel = String(collection?.title || galleryKey);
    const photos = Array.isArray(collection?.photos) ? collection.photos : [];
    for (const photo of photos) {
      flattened.push({ galleryKey, galleryLabel, photo });
    }
  }

  const skippedReviewed = [];
  const candidates = [];

  for (const row of flattened) {
    const photo = row.photo || {};
    if (isReviewed(photo)) {
      skippedReviewed.push(String(photo?.id || ""));
      continue;
    }
    const capture = captureForPhoto(photo);
    const sort = capture.sort || "";
    candidates.push({ ...row, capture, captureSort: sort || `0000-00-00T00:00:00`, id: String(photo?.id || "") });
  }

  candidates.sort((a, b) => {
    const sortCompare = String(b.captureSort).localeCompare(String(a.captureSort));
    if (sortCompare) return sortCompare;
    return String(b.id).localeCompare(String(a.id));
  });

  const batch = candidates.slice(0, args.limit);
  const rangeNewest = batch[0]?.capture?.sort || "";
  const rangeOldest = batch[batch.length - 1]?.capture?.sort || "";

  const photos = batch.map((row) => {
    const photo = row.photo || {};
    const currentKeywordsRaw = metadataValue(photo, "Keywords");
    const currentKeywords = uniqueKeywords(splitKeywordText(currentKeywordsRaw));
    const removedBlacklisted = currentKeywords.filter((keyword) => blacklisted.has(keyword.toLowerCase()));
    const proposedKeywords = currentKeywords.filter((keyword) => !blacklisted.has(keyword.toLowerCase()));
    if (!proposedKeywords.length && row.galleryLabel && !blacklisted.has(row.galleryLabel.toLowerCase())) {
      proposedKeywords.push(row.galleryLabel);
    }

    const currentTitle = String(photo?.title || metadataValue(photo, "Metadata title") || photo?.id || "").trim();
    const proposedTitle = currentTitle;

    const meta = {
      captured: row.capture.raw || "",
      camera: metadataValue(photo, "Camera"),
      lens: metadataValue(photo, "Lens"),
      exposure: metadataValue(photo, "Exposure"),
      focal_length: metadataValue(photo, "Focal length"),
      software: metadataValue(photo, "Software"),
      original_file: metadataValue(photo, "Original file"),
      original_size: metadataValue(photo, "Original size"),
    };

    const sourceFile = Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length && typeof photo.sourceFiles[0] === "object"
      ? photo.sourceFiles[0]
      : {};

    return {
      photo_id: String(photo?.id || ""),
      gallery: {
        key: row.galleryKey,
        label: row.galleryLabel,
      },
      capture: {
        raw: row.capture.raw || "",
        date: row.capture.date || "",
        sort: row.capture.sort || "",
      },
      thumbs: {
        gallery: String(photo?.gallerySrc || ""),
        detail: String(photo?.imageSrc || ""),
      },
      source: {
        origin: String(photo?.sourceOrigin || ""),
        pricingTier: String(photo?.pricingTier || ""),
        file: {
          path: String(sourceFile?.path || ""),
          type: String(sourceFile?.type || ""),
          bytes: Number(sourceFile?.bytes || 0),
        },
      },
      current: {
        title: currentTitle,
        keywords_raw: currentKeywordsRaw,
        keywords: currentKeywords,
      },
      proposed: {
        title: proposedTitle,
        keywords: proposedKeywords,
      },
      changes: {
        removed_blacklisted: removedBlacklisted,
        blacklisted_keyword_count: removedBlacklisted.length,
      },
      meta,
    };
  });

  const payload = {
    format: "photosbyelie-title-keyword-review-queue",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    batch_id: batchId,
    limit: args.limit,
    review_flag: REVIEW_FLAG,
    proposal_files: {
      batch: batchPath,
      latest: latestPath,
    },
    range: {
      newest: rangeNewest,
      oldest: rangeOldest,
    },
    skipped: {
      reviewed: skippedReviewed.filter(Boolean),
    },
    photos,
  };

  fs.mkdirSync(path.join(REPO_ROOT, queueDir), { recursive: true });
  fs.writeFileSync(path.join(REPO_ROOT, batchPath), JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(path.join(REPO_ROOT, latestPath), JSON.stringify(payload, null, 2) + "\n");

  process.stdout.write(
    `Wrote ${photos.length} proposals -> ${batchPath}\n` +
    `Updated latest -> ${latestPath}\n` +
    `Range: ${rangeNewest || "—"} .. ${rangeOldest || "—"}\n` +
    `Skipped reviewed: ${skippedReviewed.length}\n`,
  );
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exit(1);
}

