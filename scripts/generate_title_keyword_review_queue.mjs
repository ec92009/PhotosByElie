#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import catalogTsv from "./catalog_tsv.cjs";

const REPO_ROOT = process.cwd();
const DEFAULT_LIMIT = 100;
const LOCAL_GENERATOR_MODEL = "local-metadata-rules-v1";
const REVIEW_FLAG = "Title_Keywords_Reviewed";
const PROPOSED_FLAG = "Title_Keywords_Proposed";
const REJECTED_FLAG = "Title_Keywords_Rejected";
const PARKED_FLAG = "Title_Keywords_Parked";
const MIN_PROPOSED_KEYWORDS = 10;
const TITLE_KEYWORD_PARK_REJECTED_COUNT = 10;
const DEFAULT_MODEL_RETRIES = 2;
const DEFAULT_MODEL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MODEL_CONCURRENCY = 3;
const OWNER_STATE_DB_MAX_BUFFER = Math.max(
  16 * 1024 * 1024,
  Number(process.env.PBE_OWNER_STATE_DB_MAX_BUFFER || 0),
);
const DEFAULT_MODEL_LADDER = [
  "codex-gpt-5.4-mini",
  "codex-gpt-5.6-luna-xhigh-vision",
  "codex-gpt-5.6-sol-high-vision",
];
const MODEL_CATALOG = [
  {
    alias: "codex-gpt-5.4-mini",
    label: "Free",
    resolvedModel: "gpt-5.4-mini",
    reasoningEffort: "low",
    vision: false,
    estimatedCost: "Lowest-cost OpenAI rung",
  },
  {
    alias: "codex-gpt-5.6-luna-xhigh-vision",
    label: "Luna XHigh vision",
    resolvedModel: "gpt-5.6-luna",
    reasoningEffort: "xhigh",
    vision: true,
    estimatedCost: "Higher: xhigh + image",
  },
  {
    alias: "codex-gpt-5.6-sol-high-vision",
    label: "Sol High vision",
    resolvedModel: "gpt-5.6-sol",
    reasoningEffort: "high",
    vision: true,
    estimatedCost: "High: high + image",
  },
];
const SUPPORTED_MODEL_ALIASES = new Set(MODEL_CATALOG.map((item) => item.alias));
const normalizeModelLadder = (value) => {
  let candidate = value;
  if (typeof candidate === "string") {
    const raw = candidate.trim();
    if (!raw) candidate = [];
    else if (raw.startsWith("[")) candidate = JSON.parse(raw);
    else candidate = raw.split(",");
  }
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("title/keyword model ladder must contain at least one supported OpenAI rung");
  }
  if (candidate.length > MODEL_CATALOG.length) {
    throw new Error(`title/keyword model ladder may contain at most ${MODEL_CATALOG.length} supported OpenAI rungs`);
  }
  const aliasesByKey = new Map(MODEL_CATALOG.map((item) => [item.alias.toLowerCase(), item.alias]));
  const normalized = [];
  for (const item of candidate) {
    const raw = typeof item === "object" && item !== null ? item.alias || item.model : item;
    const alias = aliasesByKey.get(String(raw || "").trim().toLowerCase());
    if (!alias) {
      throw new Error(`unsupported title/keyword model ladder rung ${String(raw || "<empty>")}; Ollama and local-inference models are out of scope`);
    }
    if (normalized.includes(alias)) throw new Error(`title/keyword model ladder contains duplicate rung ${alias}`);
    normalized.push(alias);
  }
  return normalized;
};
const envModelLadder = process.env.PBE_TITLE_KEYWORD_MODEL_LADDER;
let MODEL_LADDER = normalizeModelLadder(envModelLadder || DEFAULT_MODEL_LADDER);
let GENERATOR_MODEL = (process.env.PBE_TITLE_KEYWORD_GENERATOR_MODEL || MODEL_LADDER[0]).trim();
const MODEL_RETRIES = Math.max(1, Number(process.env.PBE_TITLE_KEYWORD_MODEL_RETRIES || DEFAULT_MODEL_RETRIES));
const MODEL_TIMEOUT_MS = Math.max(30_000, Number(process.env.PBE_TITLE_KEYWORD_MODEL_TIMEOUT_MS || DEFAULT_MODEL_TIMEOUT_MS));
const MODEL_CONCURRENCY = Math.max(1, Number(process.env.PBE_TITLE_KEYWORD_MODEL_CONCURRENCY || DEFAULT_MODEL_CONCURRENCY));
const PROGRESS_ENABLED = process.env.PBE_TITLE_KEYWORD_PROGRESS !== "0";
const PROGRESS_STARTED_AT = Date.now();

const durationLabel = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pair = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pair(minutes)}:${pair(seconds)}` : `${pair(minutes)}:${pair(seconds)}`;
};

const progress = (message) => {
  if (!PROGRESS_ENABLED) return;
  process.stderr.write(`[title-keyword ${durationLabel(Date.now() - PROGRESS_STARTED_AT)}] ${message}\n`);
};

const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), items.length);
  const runners = new Array(workerCount).fill(null).map(async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const readText = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
const { loadCatalogWindow } = catalogTsv;

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

const uniqueValues = (items) => {
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

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const runOwnerStateDb = (args, options = {}) => {
  const result = spawnSync("python3", ["scripts/owner_state_db.py", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer || OWNER_STATE_DB_MAX_BUFFER,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Owner.sqlite command failed.").trim());
  }
  return result.stdout || "";
};

const isLocalGeneratorModel = (model) => String(model || "").trim() === LOCAL_GENERATOR_MODEL;

const isAiGeneratorModel = (model) => {
  const value = String(model || "").trim();
  return Boolean(value && !isLocalGeneratorModel(value) && SUPPORTED_MODEL_ALIASES.has(value));
};

const modelLevel = (model) => {
  const value = String(model || "").trim();
  const index = MODEL_LADDER.findIndex((item) => item === value);
  return index >= 0 ? index : 0;
};

const generatorModelInfo = (model = GENERATOR_MODEL) => {
  const candidate = String(model || GENERATOR_MODEL || DEFAULT_MODEL_LADDER[0]).trim();
  const selected = SUPPORTED_MODEL_ALIASES.has(candidate) ? candidate : MODEL_LADDER[0];
  const level = modelLevel(selected);
  const catalog = MODEL_CATALOG.find((item) => item.alias === selected) || MODEL_CATALOG[0];
  return {
    model: selected,
    model_level: level,
    model_maxed: level >= MODEL_LADDER.length - 1,
    model_ladder: MODEL_LADDER,
    label: catalog.label,
    resolved_model: catalog.resolvedModel,
    reasoning_effort: catalog.reasoningEffort,
    vision: catalog.vision,
    estimated_cost: catalog.estimatedCost,
  };
};

const generatorModelInfoAtLevel = (level) => {
  const normalized = Math.min(Math.max(0, Number(level) || 0), MODEL_LADDER.length - 1);
  return generatorModelInfo(MODEL_LADDER[normalized] || GENERATOR_MODEL);
};

const firstAiGeneratorInfo = () => {
  const index = MODEL_LADDER.findIndex((model) => isAiGeneratorModel(model));
  return generatorModelInfoAtLevel(index >= 0 ? index : 0);
};

const nextModelAfterLevel = (level) => {
  if (!Number.isFinite(Number(level))) return firstAiGeneratorInfo();
  const normalized = Number(level);
  const next = Math.min(Math.max(0, normalized + 1), MODEL_LADDER.length - 1);
  return generatorModelInfoAtLevel(next);
};

const selectedGeneratorForRow = (row) => {
  if (!row?.reworkPriority) return generatorModelInfo();
  const previousModel = String(row.previousGeneratorModel || "").trim();
  const previousIndex = MODEL_LADDER.findIndex((item) => item === previousModel);
  if (previousIndex >= 0 && previousIndex >= MODEL_LADDER.length - 1) {
    return { ...generatorModelInfoAtLevel(MODEL_LADDER.length - 1), exhausted: true };
  }
  if (previousIndex >= 0) return generatorModelInfoAtLevel(previousIndex + 1);
  return firstAiGeneratorInfo();
};

const loadOwnerGeneratorState = () => {
  progress(`Loading Owner.sqlite generator state with maxBuffer=${OWNER_STATE_DB_MAX_BUFFER} bytes.`);
  const stdout = runOwnerStateDb(["--title-keyword-generator-state-json", "--park-retry-exhausted"]);
  const payload = JSON.parse(stdout);
  const state = createProposalState();
  for (const item of payload.queue || []) {
    mergeProposedPhoto(state, item.photo_id, {
      review_state: item.review_state,
      rework_priority: item.rework_priority === true,
      rejected_count: Number(item.rejected_count || 0),
      rejection_comment: item.owner_comment || "",
      latest_attempt: Number(item.latest_attempt || 1),
      latest_proposed_batch_id: item.latest_proposed_batch_id || "",
      latest_proposed_at: item.latest_proposed_at || "",
      latest_generator_model: item.latest_generator_model || "",
      latest_generator_model_level: item.latest_generator_model_level,
      latest_generator_model_maxed: item.latest_generator_model_maxed === true,
      latest_model_ladder: Array.isArray(item.latest_model_ladder) ? item.latest_model_ladder : [],
      latest_proposal_title: item.latest_proposal_title || "",
      latest_proposal_keywords: Array.isArray(item.latest_proposal_keywords) ? item.latest_proposal_keywords : [],
      latest_proposal_status: item.latest_proposal_status || "",
      latest_proposal_reason: item.latest_proposal_reason || "",
      state_tags: item.state_tags || [],
    });
  }
  progress(
    `Loaded Owner.sqlite generator state: queue=${(payload.queue || []).length} ` +
    `blacklist=${(payload.keyword_blacklist || []).length} parked_retry_exhausted=${Number(payload.parked_retry_exhausted || payload.parked_twice_rejected || 0)}`,
  );
  return {
    state,
    blacklist: blacklistRules(Array.isArray(payload.keyword_blacklist) ? payload.keyword_blacklist : []),
    counts: payload.counts || {},
    modelLadder: Array.isArray(payload.model_ladder) ? normalizeModelLadder(payload.model_ladder) : null,
    modelCatalog: Array.isArray(payload.model_catalog) ? payload.model_catalog : MODEL_CATALOG,
    parkRejectedCount: Number(payload.park_retry_rejected_count || TITLE_KEYWORD_PARK_REJECTED_COUNT),
    parkedRetryExhausted: Number(payload.parked_retry_exhausted || payload.parked_twice_rejected || 0),
  };
};

const normalizedPhotoId = (value) => String(value || "").trim();

const cleanText = (value) => String(value || "")
  .replace(/\.[a-z0-9]{2,5}$/i, "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const keywordTokens = (value) => cleanText(value)
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const blacklistRules = (items) => (items || [])
  .map((value) => {
    const raw = String(value || "").trim();
    return { raw, tokens: keywordTokens(raw) };
  })
  .filter((rule) => rule.raw && rule.tokens.length);

const hasTokenSequence = (tokens, blockedTokens) => {
  if (!blockedTokens.length || blockedTokens.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - blockedTokens.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < blockedTokens.length; offset += 1) {
      if (tokens[index + offset] !== blockedTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

const hasBlacklistedTerm = (keyword, rules) => {
  const tokens = keywordTokens(keyword);
  if (!tokens.length) return false;
  return (rules || []).some((rule) => hasTokenSequence(tokens, rule.tokens));
};

const allowedKeywords = (items, rules) => uniqueKeywords(items)
  .filter((keyword) => !hasBlacklistedTerm(keyword, rules));

const STATE_KEYWORDS = new Set([REVIEW_FLAG, PROPOSED_FLAG, REJECTED_FLAG, PARKED_FLAG].map((value) => value.toLowerCase()));
const NON_PHOTO_KEYWORDS = new Set([
  "notmyphoto",
  "not my photo",
]);

const normalizedReviewKeyword = (keyword) => {
  const value = cleanText(keyword);
  if (!value) return "";
  const comparable = value.toLowerCase();
  if (NON_PHOTO_KEYWORDS.has(comparable)) return "";
  if (/^family\s*4\+$/i.test(value)) return "Family travel";
  return value;
};

const reviewableKeywords = (items, rules) => allowedKeywords((items || []).map(normalizedReviewKeyword), rules)
  .filter((keyword) => {
    const normalized = keyword.toLowerCase();
    return !STATE_KEYWORDS.has(normalized) && !NON_PHOTO_KEYWORDS.has(normalized);
  });

const proposalKeywordsWithFloor = (proposed, currentNonBlacklisted, rules) => {
  const proposedKeywords = reviewableKeywords(proposed, rules);
  const floorKeywords = reviewableKeywords(currentNonBlacklisted, rules);
  if (proposedKeywords.length >= floorKeywords.length) return proposedKeywords;
  return reviewableKeywords([...floorKeywords, ...proposedKeywords], rules);
};

const keywordSetEquals = (left, right) => {
  const leftSet = new Set(uniqueKeywords(left).map((item) => item.toLowerCase()));
  const rightSet = new Set(uniqueKeywords(right).map((item) => item.toLowerCase()));
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return true;
};

const titleCase = (value) => cleanText(value)
  .split(" ")
  .map((word) => {
    if (!word) return "";
    if (/^[A-Z0-9]{2,}$/.test(word)) return word;
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
  })
  .join(" ")
  .trim();

const normalizedComparable = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const isPlaceholderTitle = (title, originalFile = "") => {
  const value = cleanText(title);
  if (!value) return true;
  if (/^\d{4}[\s:-]?\d{2}[\s:-]?\d{2}/.test(value)) return true;
  if (/^(dsc|dscf|d5h|img|pxl|dj?i|_mg|sam)[\s-]*\d+[a-z]?$/i.test(value)) return true;
  if (/^[a-z]{1,5}[\s-]*\d{3,}[a-z]?$/i.test(value)) return true;
  if (/^\d{3,}$/.test(value)) return true;
  const originalStem = cleanText(path.basename(String(originalFile || ""), path.extname(String(originalFile || ""))));
  return Boolean(originalStem && normalizedComparable(value) === normalizedComparable(originalStem));
};

const originalMetadataAcceptable = ({ currentTitle, currentKeywords, blacklist, sourceFile, photo }) => {
  const sourcePath = sourceFile?.path || metadataValue(photo, "Original file");
  if (!currentTitle || isPlaceholderTitle(currentTitle, sourcePath)) return false;
  return reviewableKeywords(currentKeywords, blacklist).length >= MIN_PROPOSED_KEYWORDS;
};

const mythTitleName = (title) => {
  const raw = String(title || "").trim();
  const match = raw.match(/^([A-Z][A-Za-z]+)\s+-\s+/) || cleanText(raw).match(/^([A-Z][A-Za-z]+)\s+/);
  const name = match?.[1] || "";
  if (/^(dsc|dscf|d5h|img|pxl|dj?i|_mg|sam)$/i.test(name)) return "";
  return name;
};

const compactPromptTitle = (title, keywords = []) => {
  const value = cleanText(title);
  const name = mythTitleName(value);
  if (!name) return "";
  if (!/(prominent|foreground|background|mucha|abstract|created by|goddess|gods|given a box)/i.test(value)) return "";
  const keywordText = (keywords || []).join(" ");
  if (/mucha|art nouveau/i.test(`${value} ${keywordText}`)) return `${name} in Mucha Style`;
  return `${name} Mythology Portrait`;
};

const compactPromptKeywords = (title) => {
  const value = cleanText(title);
  const name = mythTitleName(value);
  if (!name) return [];
  return uniqueKeywords([
    name,
    /artemis/i.test(name) ? "Goddess" : "",
    "Greek mythology",
    /mucha|art nouveau/i.test(value) ? "Mucha inspired" : "",
    /mucha|art nouveau/i.test(value) ? "Art Nouveau" : "",
    "AI",
    "Generated image",
  ].filter(Boolean));
};

const compactDescriptiveTitle = (title) => {
  const value = cleanText(title);
  if (!value) return "";
  const withoutStyle = value
    .replace(/,\s*[^,]*\bstyle\b.*$/i, "")
    .replace(/\b(cut\s+paper)\b/i, "paper")
    .trim();
  if (/^bronze statue of a horse\b/i.test(withoutStyle)) return "Bronze Horse Statue";
  if (/^a japanese fishing village at sunset\b/i.test(withoutStyle)) return "Japanese Fishing Village at Sunset";
  return withoutStyle !== value && withoutStyle ? titleCase(withoutStyle) : "";
};

const titleFromInternalMetadata = ({ currentTitle, keywords, galleryLabel, context }) => {
  const sourceText = `${currentTitle || ""} ${(keywords || []).join(" ")} ${(context?.parts || []).join(" ")}`.toLowerCase();
  const family = /family\s*4\+|family travel|family trip|family/i.test(sourceText);
  const gallery = cleanText(galleryLabel);
  const cityOrVenue = context?.title || context?.venue || context?.city || "";
  if (/notmyphoto|not my photo|family\s*4\+/.test(sourceText)) {
    if (family && gallery && !/^(photo|photos)$/i.test(gallery)) return `Family Travel in ${gallery}`;
    if (family && cityOrVenue) return `Family Travel, ${cityOrVenue}`;
    if (family) return "Family Travel";
    if (cityOrVenue) return cityOrVenue;
  }
  return "";
};

const splitPathSegments = (sourcePath) => String(sourcePath || "")
  .split(/[\\/]+/)
  .map((part) => cleanText(part))
  .filter(Boolean);

const usefulPathParts = (sourcePath) => {
  const segments = splitPathSegments(sourcePath);
  const folders = segments.slice(0, -1);
  const parts = [];
  for (const folder of folders) {
    const withoutYear = folder.replace(/^\d{4}\s+/, "").trim();
    withoutYear
      .split(/\s*,\s*|\s+-\s+|\s+\/\s+/)
      .map((part) => cleanText(part))
      .filter(Boolean)
      .forEach((part) => parts.push(part));
  }
  return uniqueKeywords(parts).filter((part) => {
    if (/^\d{1,4}$/.test(part)) return false;
    if (/^(upscale|scaled|edit|jpg|jpeg|tif|tiff|raw|exports?)$/i.test(part)) return false;
    if (/^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}$/i.test(part)) return false;
    return true;
  });
};

const contextTextParts = (value) => {
  const base = cleanText(value).replace(/^\d{4}\s+/, "").trim();
  if (!base) return [];
  return uniqueKeywords(base
    .split(/\s*,\s*|\s+-\s+|\s+\/\s+|\s+·\s+/)
    .map((part) => cleanText(part).replace(/^\d{4}\s+/, "").trim())
    .filter((part) => part && !/^\d{1,4}$/.test(part)));
};

const sourceAlbumFromPhoto = (photo, sourceFile = {}) => {
  const candidates = [
    sourceFile?.apple_photos_album?.title,
    sourceFile?.applePhotosAlbum?.title,
    sourceFile?.apple_photos?.album?.title,
    sourceFile?.applePhotos?.album?.title,
    metadataValue(photo, "Apple Photos album"),
    metadataValue(photo, "Album"),
  ];
  return cleanText(candidates.find((candidate) => String(candidate || "").trim()) || "");
};

const sourceGpsFromPhoto = (photo, sourceFile = {}) => {
  const candidates = [
    sourceFile?.gps,
    sourceFile?.apple_photos?.location,
    sourceFile?.applePhotos?.location,
    photo?.gps,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)) || {};
};

const compactVenue = (value) => titleCase(value)
  .replace(/^Collection Of The\s+/i, "")
  .replace(/^Colleccion Del\s+/i, "")
  .replace(/^Coleccion Del\s+/i, "")
  .replace(/^Museo\s+Ruso$/i, "Museo Ruso")
  .trim();

const cityRegionKeyword = (city) => {
  const key = cleanText(city).toLowerCase();
  return {
    malaga: "Andalusia",
    valencia: "Valencian Community",
    paris: "Ile-de-France",
    madrid: "Community of Madrid",
    barcelona: "Catalonia",
    lisbon: "Lisbon",
    porto: "Northern Portugal",
    rome: "Lazio",
    venice: "Veneto",
    pisa: "Tuscany",
    bratislava: "Bratislava",
    "new york": "New York",
    miami: "Florida",
    mexico: "Mexico",
  }[key] || "";
};

const galleryContextKeywords = (galleryLabel) => {
  const gallery = cleanText(galleryLabel);
  const lower = gallery.toLowerCase();
  const keywords = [gallery];
  if (["france", "italy", "spain", "portugal", "slovakia"].includes(lower)) {
    keywords.push(`${gallery} travel`, "European travel", "Europe", "Travel photography", "Travel archive");
  } else if (lower === "usa" || lower === "united states") {
    keywords.push("USA travel", "United States", "American travel", "Travel photography", "Travel archive");
  } else if (lower === "mexico") {
    keywords.push("Mexico travel", "Latin America travel", "Travel photography", "Travel archive");
  } else if (lower) {
    keywords.push(`${gallery} travel`, "Travel photography", "Travel archive");
  }
  return keywords;
};

const captureContextKeywords = (capture) => {
  const raw = String(capture?.raw || capture?.sort || "").trim();
  const match = raw.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);
  if (!match) return [];
  const [, year, month] = match;
  const monthName = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][Number(month)] || "";
  const season = Number(month) <= 2 || Number(month) === 12
    ? "Winter travel"
    : Number(month) <= 5
    ? "Spring travel"
    : Number(month) <= 8
    ? "Summer travel"
    : "Autumn travel";
  return [`${year} travel`, monthName ? `${monthName} travel` : "", season].filter(Boolean);
};

const localContextKeywordFloor = ({ photo, galleryLabel, context, currentTitle, sourceFile, capture }) => {
  const sourceText = `${currentTitle || ""} ${sourceFile?.path || ""} ${(context?.parts || []).join(" ")}`.toLowerCase();
  const keywords = [
    ...galleryContextKeywords(galleryLabel),
    context?.city,
    context?.venue,
    cityRegionKeyword(context?.city),
    ...captureContextKeywords(capture),
  ];
  if (/family\s*4\+|family/.test(sourceText)) {
    keywords.push("Family travel", "Family trip", "Travel memories", "Personal travel archive");
  }
  if (String(photo?.sourceOrigin || "").toLowerCase() === "camera") {
    keywords.push("Camera original", "Documentary travel", "Candid travel", "Location-based metadata");
  }
  if (String(photo?.sourceOrigin || "").toLowerCase() === "ai") {
    keywords.push("AI image", "Digital artwork", "Illustrative image");
  }
  return uniqueKeywords(keywords);
};

const imageShapeKeywords = (photo) => {
  const rawSize = metadataValue(photo, "Original size") || metadataValue(photo, "Preview file");
  const match = String(rawSize || "").match(/(\d{3,5})\s*x\s*(\d{3,5})/);
  if (!match) return [];
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const ratio = width / height;
  if (ratio >= 1.8) return ["wide composition", "landscape orientation"];
  if (ratio > 1.08) return ["landscape orientation"];
  if (ratio <= 0.56) return ["vertical composition", "portrait orientation"];
  if (ratio < 0.92) return ["portrait orientation"];
  return ["square format"];
};

const titleKeywordHints = (title, sourceOrigin) => {
  const value = cleanText(title);
  const lower = value.toLowerCase();
  const hints = [];
  if (/bronze.*horse|horse.*bronze/.test(lower)) {
    hints.push("Horse", "Bronze", "Statue", "Horse statue", "Bronze sculpture", "Equestrian sculpture");
  }
  if (/remington/.test(lower)) {
    hints.push("Remington", "Western art");
  }
  if (/japanese.*fishing.*village/.test(lower)) {
    hints.push("Japanese", "Japan", "Fishing village", "Sunset", "Sunset scene", "Coastal village", "Paper illustration");
  }
  if (/pandora/.test(lower)) {
    hints.push("Pandora", "Greek mythology", "Mythology portrait", "Classical mythology");
  }
  if (/artemis/.test(lower)) {
    hints.push("Artemis", "Goddess", "Greek mythology", "Mythology portrait", "Classical mythology");
  }
  if (String(sourceOrigin || "").toLowerCase() === "ai") {
    hints.push("AI", "Generated image", "Generative image", "Illustration", "Prompt-based image");
  }
  return uniqueKeywords(hints);
};

const metadataExpansionKeywords = ({ photo, galleryLabel, context, currentTitle, sourceFile, capture }) => {
  const sourceText = `${sourceFile?.path || ""} ${currentTitle || ""} ${(context.parts || []).join(" ")}`.toLowerCase();
  const origin = String(photo?.sourceOrigin || "").toLowerCase();
  const keywords = [
    galleryLabel,
    context.city,
    cityRegionKeyword(context.city),
    context.venue,
    ...context.parts,
    ...imageShapeKeywords(photo),
    ...localContextKeywordFloor({ photo, galleryLabel, context, currentTitle, sourceFile, capture }),
  ];

  if (origin === "camera") {
    keywords.push("Photograph", "Travel photography");
  }
  if (origin === "ai") {
    keywords.push("AI", "Generated image", "Generative image", "Illustration", "Prompt-based image");
  }
  if (/museo|museum|gallery|collection|colleccion|coleccion/.test(sourceText)) {
    keywords.push("Museum", "Art", "Art museum", "Museum collection", "Exhibition", "Gallery", "Cultural venue");
  }
  if (/museo ruso|russian museum|colleccion del museo ruso|coleccion del museo ruso/.test(sourceText)) {
    keywords.push("Museo Ruso", "Museo Ruso Malaga", "Russian Museum Collection", "Malaga museum");
  }
  if (/aquarium/.test(sourceText)) {
    keywords.push("Aquarium", "Valencia aquarium", "Marine life", "Sea life", "Aquatic life", "Ocean life", "Aquarium photography");
  }
  if (/\bpisa\b/.test(sourceText)) {
    keywords.push("Pisa", "Italy", "Tuscany", "Italian travel", "Historic city", "Architecture", "Cityscape", "Landmark");
  }
  if (/church|cathedral/.test(sourceText)) {
    keywords.push("Church", "Sacred architecture", "Interior architecture");
  }
  if (/beach|coast|sea|ocean/.test(sourceText)) {
    keywords.push("Coast", "Seascape", "Waterfront");
  }
  if (/street|market|city/.test(sourceText)) {
    keywords.push("City", "Urban photography", "Street scene");
  }

  keywords.push(...titleKeywordHints(currentTitle, photo?.sourceOrigin));
  return uniqueKeywords(keywords);
};

const CONTEXT_CITY_PATTERN = /malaga|málaga|valencia|paris|madrid|barcelona|lisbon|porto|rome|venice|pisa|bratislava|new york|miami|mexico|ronda|nerja|albi|bilbao|seville|sevilla|cordoba|córdoba|granada|cadiz|florence|san gimignano|aveiro|coimbra|cascais/i;

const contextFromSource = (sourcePath, galleryLabel, hints = {}) => {
  const hintParts = [
    ...contextTextParts(hints.albumTitle),
    ...contextTextParts(hints.location),
  ];
  const parts = uniqueKeywords([...usefulPathParts(sourcePath), ...hintParts]).map(titleCase).filter(Boolean);
  const city = parts.find((part) => CONTEXT_CITY_PATTERN.test(part)) || "";
  const venue = parts.find((part) => part !== city && /aquarium|museum|museo|cathedral|church|castle|palace|beach|coast|garden|park|bridge|tower|street|market|gallery|collection|colleccion|coleccion/i.test(part)) || "";
  const cleanedVenue = venue ? compactVenue(venue) : "";
  const titleContext = cleanedVenue && city
    ? `${cleanedVenue}, ${city}`
    : cleanedVenue || city || "";
  const sourceText = `${cleanedVenue} ${sourcePath} ${hints.albumTitle || ""} ${hints.location || ""}`;
  const inferredKeywords = [
    galleryLabel,
    city,
    cleanedVenue,
    ...hintParts.map(titleCase),
    /museo|museum|collection|colleccion|coleccion/i.test(sourceText) ? "Museum" : "",
    /museo|museum|gallery|art|collection|colleccion|coleccion/i.test(sourceText) ? "Art" : "",
    /aquarium/i.test(sourceText) ? "Aquarium" : "",
    /aquarium/i.test(sourceText) ? "Marine life" : "",
    /church|cathedral/i.test(sourceText) ? "Church" : "",
    /beach|coast|sea|ocean/i.test(sourceText) ? "Coast" : "",
    /street|market|city/i.test(sourceText) ? "City" : "",
  ];
  return {
    parts,
    city,
    venue: cleanedVenue,
    title: titleContext,
    albumTitle: hints.albumTitle || "",
    location: hints.location || "",
    keywords: uniqueKeywords(inferredKeywords.filter(Boolean)),
  };
};

const GENERIC_TITLE_KEYWORDS = new Set([
  "ai",
  "art",
  "city",
  "coast",
  "gallery",
  "generated image",
  "illustration",
  "landscape orientation",
  "museum",
  "panoramic",
  "photograph",
  "portrait orientation",
  "prompt based image",
  "square format",
  "travel",
  "travel photography",
  "trip",
  "wide composition",
]);

const titleKeywordCandidate = (keyword, galleryLabel) => {
  const value = titleCase(keyword);
  if (!value) return "";
  const comparable = normalizedComparable(value);
  if (!comparable) return "";
  if (comparable === normalizedComparable(galleryLabel)) return "";
  if (GENERIC_TITLE_KEYWORDS.has(value.toLowerCase())) return "";
  if (/^title keywords /.test(value.toLowerCase())) return "";
  if (/^\d+$/.test(value)) return "";
  if (/^\d{4}\s+\d{2}\s+\d{2}/.test(value)) return "";
  return value;
};

const keywordTitleJoiner = (primary, secondary) => {
  if (!secondary) return primary;
  if (/\b(anchor|beach|bridge|castle|cathedral|church|coast|garden|harbor|market|monastery|museum|palace|park|statue|street|tower)\b/i.test(secondary)) {
    return `${primary} ${secondary}`;
  }
  return `${primary}, ${secondary}`;
};

const titleFromKeywordHints = ({ keywords, galleryLabel, context }) => {
  const candidates = uniqueKeywords([
    ...(keywords || []),
    context?.venue,
    context?.city,
    ...(context?.parts || []),
  ])
    .map((keyword) => titleKeywordCandidate(keyword, galleryLabel))
    .filter(Boolean);
  const primary = candidates[0] || "";
  if (!primary) return "";
  const secondary = candidates.find((candidate) => normalizedComparable(candidate) !== normalizedComparable(primary)) || "";
  const title = keywordTitleJoiner(primary, secondary);
  return isPlaceholderTitle(title) ? "" : title;
};

const proposalForPhoto = ({ photo, galleryLabel, currentTitle, currentKeywords, currentKeywordsRaw, blacklist, sourceFile, capture }) => {
  const albumTitle = sourceAlbumFromPhoto(photo, sourceFile);
  const location = metadataValue(photo, "Location");
  const context = contextFromSource(sourceFile?.path || "", galleryLabel, { albumTitle, location });
  const withoutBlacklisted = currentKeywords.filter((keyword) => !hasBlacklistedTerm(keyword, blacklist));
  const removedBlacklisted = currentKeywords.filter((keyword) => hasBlacklistedTerm(keyword, blacklist));
  const placeholder = isPlaceholderTitle(currentTitle, sourceFile?.path || metadataValue(photo, "Original file"));
  const originalAcceptable = originalMetadataAcceptable({ currentTitle, currentKeywords, blacklist, sourceFile, photo });
  if (originalAcceptable) {
    const cleanCurrentKeywords = allowedKeywords(currentKeywords, blacklist);
    return {
      title: currentTitle,
      keywords: removedBlacklisted.length ? cleanCurrentKeywords : currentKeywords,
      status: removedBlacklisted.length ? "blacklist_cleanup" : "no_change_needed",
      confidence: "high",
      reason: removedBlacklisted.length
        ? "Original title and keywords are acceptable; proposal only removes blacklisted keyword noise."
        : "Original title and keywords are acceptable; no owner review change is needed.",
      removedBlacklisted,
      keywordTargetMet: reviewableKeywords(cleanCurrentKeywords, blacklist).length >= MIN_PROPOSED_KEYWORDS,
      noChangeNeeded: removedBlacklisted.length === 0,
      blacklistOnlyCleanup: removedBlacklisted.length > 0 && keywordSetEquals(cleanCurrentKeywords, withoutBlacklisted),
    };
  }
  const promptTitle = compactPromptTitle(currentTitle, currentKeywords);
  const descriptiveTitle = compactDescriptiveTitle(currentTitle);
  const keywordTitle = titleFromKeywordHints({ keywords: withoutBlacklisted, galleryLabel, context });
  const internalTitle = titleFromInternalMetadata({ currentTitle, keywords: withoutBlacklisted, galleryLabel, context });
  const promptKeywords = compactPromptKeywords(currentTitle);
  const expansionKeywords = metadataExpansionKeywords({ photo, galleryLabel, context, currentTitle, sourceFile, capture });
  const proposedTitle = promptTitle || descriptiveTitle || internalTitle || (placeholder ? (context.title || keywordTitle) : currentTitle);
  const proposedKeywords = allowedKeywords(
    [...withoutBlacklisted, ...context.keywords, ...promptKeywords, ...expansionKeywords],
    blacklist,
  );
  const safeProposedKeywords = proposalKeywordsWithFloor(proposedKeywords, withoutBlacklisted, blacklist);
  const hasUsefulKeywords = safeProposedKeywords.filter((keyword) => keyword.toLowerCase() !== galleryLabel.toLowerCase()).length > 0;
  const weakTitle = !proposedTitle || isPlaceholderTitle(proposedTitle, sourceFile?.path || metadataValue(photo, "Original file"));
  const needsContext = weakTitle || !hasUsefulKeywords;

  return {
    title: weakTitle ? "" : proposedTitle,
    keywords: safeProposedKeywords,
    status: needsContext ? "needs_owner_context" : (placeholder ? "source_context" : (promptTitle ? "metadata_cleanup" : "metadata_context")),
    confidence: needsContext ? "low" : (placeholder || promptTitle ? "medium" : "high"),
    reason: needsContext
      ? "Catalog metadata does not provide enough image-specific context for a reliable title/keyword proposal."
      : (promptTitle || descriptiveTitle
        ? "Compacts a long prompt-like title into a cleaner owner-review title and keeps relevant metadata keywords."
        : (placeholder
        ? "Derived from source folder/path context; owner should verify the specific image subject."
        : "Keeps useful existing catalog metadata and removes blacklisted keyword noise.")),
    removedBlacklisted,
    keywordTargetMet: safeProposedKeywords.length >= MIN_PROPOSED_KEYWORDS,
    noChangeNeeded: false,
    blacklistOnlyCleanup: false,
  };
};

const modelOutputSchema = () => ({
  type: "object",
  additionalProperties: false,
  required: ["title", "keywords", "confidence", "status", "reason", "needs_owner_context"],
  properties: {
    title: { type: "string", minLength: 1 },
    keywords: {
      type: "array",
      minItems: MIN_PROPOSED_KEYWORDS,
      items: { type: "string", minLength: 1 },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    status: { type: "string" },
    reason: { type: "string" },
    needs_owner_context: { type: "boolean" },
  },
});

const codexBinary = () => String(process.env.PBE_TITLE_KEYWORD_CODEX_BIN || "codex").trim() || "codex";

const codexModelConfig = (modelInfo) => {
  const rawModel = String(modelInfo?.model || "").trim();
  if (!isAiGeneratorModel(rawModel)) return null;
  const withoutPrefix = rawModel.replace(/^codex-/i, "");
  const vision = /(?:^|-)vision$/i.test(withoutPrefix) || /-vision-/i.test(withoutPrefix);
  const effortMatch = withoutPrefix.match(/-(xhigh|high|medium|low)(?:-vision)?$/i);
  const model = withoutPrefix
    .replace(/-(xhigh|high|medium|low)(?:-vision)?$/i, "")
    .replace(/-vision$/i, "");
  const reasoningEffort = effortMatch?.[1]?.toLowerCase() || (/mini$/i.test(model) ? "low" : "medium");
  return {
    model,
    reasoningEffort,
    vision,
  };
};

const stripJsonFence = (value) => String(value || "")
  .trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/i, "")
  .trim();

const parseModelProposalText = (value) => {
  const text = stripJsonFence(value);
  if (!text) throw new Error("Model returned an empty response.");
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw error;
  }
};

const existingLocalPath = (candidate) => {
  const raw = String(candidate || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return "";
  const clean = raw.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  const candidates = [
    clean,
    path.join("assets", clean),
    path.join("assets", "public", clean),
  ];
  for (const relative of candidates) {
    const absolute = path.join(REPO_ROOT, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  }
  return "";
};

const localPreviewPathForPhoto = (photo) => {
  const media = photo?.media || {};
  const preview = media?.publicPreview || {};
  return existingLocalPath(photo?.imageSrc)
    || existingLocalPath(photo?.gallerySrc)
    || existingLocalPath(preview?.detailKey)
    || existingLocalPath(preview?.galleryKey)
    || existingLocalPath(metadataValue(photo, "Preview file"));
};

const modelPromptForPhoto = ({
  row,
  photo,
  galleryLabel,
  currentTitle,
  currentKeywords,
  blacklist,
  sourceFile,
  meta,
  localProposal,
  requestedGenerator,
  previewPath,
  retryNote = "",
}) => {
  const media = photo?.media || {};
  const preview = media?.publicPreview || {};
  const albumTitle = sourceAlbumFromPhoto(photo, sourceFile);
  const gps = sourceGpsFromPhoto(photo, sourceFile);
  const context = {
    photo_id: String(photo?.id || ""),
    gallery: galleryLabel,
    capture: row.capture || {},
    current_title: currentTitle,
    current_keywords: reviewableKeywords(currentKeywords, blacklist),
    source_path: String(sourceFile?.path || ""),
    source_origin: String(photo?.sourceOrigin || ""),
    pricing_tier: String(photo?.pricingTier || ""),
    location: metadataValue(photo, "Location"),
    apple_photos_album: albumTitle,
    gps,
    camera: meta.camera,
    lens: meta.lens,
    exposure: meta.exposure,
    focal_length: meta.focal_length,
    original_file: meta.original_file,
    original_size: meta.original_size,
    public_preview_keys: {
      gallery: String(preview?.galleryKey || ""),
      detail: String(preview?.detailKey || ""),
    },
    local_preview_path: previewPath || "",
    owner_rework: {
      requested: row.reworkPriority === true,
      comment: row.reworkComment || "",
      previous_title: row.previousProposalTitle || "",
      previous_keywords: row.previousProposalKeywords || [],
      previous_status: row.previousProposalStatus || "",
      previous_reason: row.previousProposalReason || "",
      previous_generator_model: row.previousGeneratorModel || "",
      previous_generator_model_level: row.previousGeneratorModelLevel,
    },
    local_metadata_fallback: {
      title: localProposal.title || "",
      keywords: localProposal.keywords || [],
      status: localProposal.status || "",
      reason: localProposal.reason || "",
    },
    requested_generator: requestedGenerator,
    retry_note: retryNote,
  };
  return [
    "Generate one Photos By Elie Owner-review metadata proposal for the photo described below.",
    "Return JSON only, matching this shape: {\"title\":\"...\",\"keywords\":[\"...\"],\"confidence\":\"low|medium|high\",\"status\":\"model_rework|model_context|needs_owner_context\",\"reason\":\"...\",\"needs_owner_context\":false}.",
    "Rules:",
    "- The title must be non-empty, human-readable, and photo-relevant.",
    "- Do not use all-numeric, date-like, filename-style, camera-stem, or keyword-dump titles.",
    "- Use visible pixels when an image is attached. If no pixels are attached, use only reliable context: current keywords, gallery, source path, capture time, location fields, and the local fallback.",
    "- Existing keywords are clues, not proof. For example, Pisa may suggest the Leaning Tower, but only name it if the pixels or reliable context support it.",
    "- For rework, materially improve on the previous rejected proposal and follow the Owner comment.",
    "- Provide at least 10 concise searchable keywords when possible. Do not include workflow flags like Title_Keywords_Reviewed, Title_Keywords_Proposed, Title_Keywords_Rejected, or Title_Keywords_Parked.",
    "- If uncertain, still provide a conservative working title and set needs_owner_context to true.",
    "",
    JSON.stringify(context, null, 2),
  ].join("\n");
};

const codexInvocation = ({ modelInfo, imagePath = "" }) => {
  const codexConfig = codexModelConfig(modelInfo);
  if (!codexConfig?.model) throw new Error(`No Codex model mapping for ${modelInfo?.model || "unknown model"}.`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-title-keyword-model-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "proposal.json");
  fs.writeFileSync(schemaPath, JSON.stringify(modelOutputSchema(), null, 2) + "\n");
  const args = [
    "-a",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "-C",
    REPO_ROOT,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "-m",
    codexConfig.model,
  ];
  if (codexConfig.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${codexConfig.reasoningEffort}"`);
  }
  if (codexConfig.vision && imagePath) {
    args.push("--image", imagePath);
  }
  args.push("-");
  return { args, outputPath };
};

const invokeCodexProposalModel = ({ modelInfo, prompt, imagePath = "" }) => {
  const { args, outputPath } = codexInvocation({ modelInfo, imagePath });
  const result = spawnSync(codexBinary(), args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input: prompt,
    timeout: MODEL_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Codex model invocation failed with status ${result.status}.`).trim());
  }
  const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : (result.stdout || "");
  return parseModelProposalText(output);
};

const invokeCodexProposalModelAsync = ({ modelInfo, prompt, imagePath = "" }) => {
  const { args, outputPath } = codexInvocation({ modelInfo, imagePath });
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), args, {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeout = null;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn(value);
    };
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, MODEL_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle(reject, error);
    });
    child.on("close", (status) => {
      if (timedOut) {
        settle(reject, new Error(`Codex model invocation timed out after ${durationLabel(MODEL_TIMEOUT_MS)}.`));
        return;
      }
      if (status !== 0) {
        settle(reject, new Error((stderr || stdout || `Codex model invocation failed with status ${status}.`).trim()));
        return;
      }
      try {
        const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : stdout;
        settle(resolve, parseModelProposalText(output));
      } catch (error) {
        settle(reject, error);
      }
    });
    child.stdin.end(prompt);
  });
};

const normalizeModelProposal = ({ payload, localProposal, currentKeywords, blacklist, sourcePath }) => {
  const title = cleanText(payload?.title || "");
  if (!title || isPlaceholderTitle(title, sourcePath)) {
    throw new Error(`Model returned a placeholder or empty title: ${payload?.title || ""}`);
  }
  const proposedKeywords = reviewableKeywords([
    ...(Array.isArray(payload?.keywords) ? payload.keywords : splitKeywordText(payload?.keywords || "")),
    ...(localProposal?.keywords || []),
    ...(currentKeywords || []),
  ], blacklist);
  const confidence = ["low", "medium", "high"].includes(String(payload?.confidence || ""))
    ? String(payload.confidence)
    : "medium";
  const needsOwnerContext = payload?.needs_owner_context === true || String(payload?.status || "") === "needs_owner_context";
  const rawStatus = String(payload?.status || "").trim();
  const fallbackStatus = localProposal?.status === "rework_requested" ? "model_rework" : "model_context";
  const allowedStatuses = new Set(["model_rework", "model_context", "needs_owner_context", "metadata_context", "metadata_cleanup", "source_context"]);
  const safeProposedKeywords = proposalKeywordsWithFloor(proposedKeywords, currentKeywords, blacklist);
  return {
    title,
    keywords: safeProposedKeywords,
    status: needsOwnerContext ? "needs_owner_context" : (allowedStatuses.has(rawStatus) ? rawStatus : fallbackStatus),
    confidence: needsOwnerContext ? "low" : confidence,
    reason: String(payload?.reason || "Generated by the selected title/keyword model using local catalog context.").trim(),
    removedBlacklisted: localProposal?.removedBlacklisted || [],
    keywordTargetMet: safeProposedKeywords.length >= MIN_PROPOSED_KEYWORDS,
    noChangeNeeded: false,
    blacklistOnlyCleanup: false,
  };
};

const generateModelProposal = async ({
  row,
  photo,
  galleryLabel,
  currentTitle,
  currentKeywords,
  blacklist,
  sourceFile,
  meta,
  localProposal,
  requestedGenerator,
}) => {
  const previewPath = localPreviewPathForPhoto(photo);
  let lastError = "";
  progress(
    `Model start ${row.id}: requested=${requestedGenerator.model} level=${requestedGenerator.model_level} ` +
    `attempts=${MODEL_RETRIES} preview=${previewPath ? path.relative(REPO_ROOT, previewPath) : "none"}`,
  );
  for (let attempt = 1; attempt <= MODEL_RETRIES; attempt += 1) {
    const prompt = modelPromptForPhoto({
      row,
      photo,
      galleryLabel,
      currentTitle,
      currentKeywords,
      blacklist,
      sourceFile,
      meta,
      localProposal,
      requestedGenerator,
      previewPath,
      retryNote: lastError ? `Previous attempt failed validation: ${lastError}` : "",
    });
    try {
      progress(`Model attempt ${attempt}/${MODEL_RETRIES} ${row.id}: invoking ${requestedGenerator.model}`);
      const payload = await invokeCodexProposalModelAsync({ modelInfo: requestedGenerator, prompt, imagePath: previewPath });
      const proposal = normalizeModelProposal({
        payload,
        localProposal,
        currentKeywords,
        blacklist,
        sourcePath: sourceFile?.path || meta.original_file || "",
      });
      progress(
        `Model success ${row.id}: ${requestedGenerator.model} title="${proposal.title.slice(0, 80)}" ` +
        `keywords=${proposal.keywords.length}`,
      );
      return {
        ok: true,
        proposal,
        previewPath,
        attempts: attempt,
      };
    } catch (error) {
      lastError = String(error?.message || error || "unknown model error").slice(0, 800);
      progress(`Model attempt failed ${attempt}/${MODEL_RETRIES} ${row.id}: ${lastError}`);
    }
  }
  progress(`Model blocked ${row.id}: ${lastError || "Model invocation failed."}`);
  return {
    ok: false,
    previewPath,
    attempts: MODEL_RETRIES,
    error: lastError || "Model invocation failed.",
  };
};

const hasMetadataFlag = (photo, flag) => {
  const target = String(flag || "").trim();
  if (!target) return false;
  const rawFlags = metadataValue(photo, "Flags");
  if (rawFlags && splitKeywordText(rawFlags).some((part) => part === target)) return true;
  const keywords = splitKeywordText(metadataValue(photo, "Keywords"));
  return keywords.some((keyword) => keyword === target);
};

const isReviewed = (photo) => hasMetadataFlag(photo, REVIEW_FLAG);

const isApprovedProposal = (entry) => {
  const tags = Array.isArray(entry?.state_tags) ? entry.state_tags : [];
  return tags.includes(REVIEW_FLAG) || entry?.review_state === "approved" || entry?.review_state === "applied";
};

const isAlreadyProposed = (photo, proposedState) => {
  const photoId = normalizedPhotoId(photo?.id);
  return hasMetadataFlag(photo, PROPOSED_FLAG) || Boolean(photoId && proposedState.photosById.has(photoId));
};

const proposalStateEntry = (photo, proposedState) => {
  const photoId = normalizedPhotoId(photo?.id);
  return photoId ? proposedState.photosById.get(photoId) || null : null;
};

const isParkedProposal = (entry) => {
  const tags = Array.isArray(entry?.state_tags) ? entry.state_tags : [];
  return tags.includes(PARKED_FLAG) || entry?.review_state === "parked" || entry?.parked === true;
};

const isRejectedForRework = (photo, proposedState) => {
  const entry = proposalStateEntry(photo, proposedState);
  if (isParkedProposal(entry)) return false;
  if (Number(entry?.rejected_count || 0) >= TITLE_KEYWORD_PARK_REJECTED_COUNT) return false;
  const tags = Array.isArray(entry?.state_tags) ? entry.state_tags : [];
  return hasMetadataFlag(photo, REJECTED_FLAG)
    || tags.includes(REJECTED_FLAG)
    || entry?.review_state === "rejected"
    || entry?.rework_priority === true;
};

const mergeBatchRecord = (state, payload, relativePath) => {
  const batchId = String(payload?.batch_id || "").trim();
  if (!batchId) return;
  const existing = state.batchesById.get(batchId) || {
    batch_id: batchId,
    generated_at: "",
    proposal_files: [],
    photo_count: 0,
  };
  const generatedAt = String(payload?.generated_at || "").trim();
  if (generatedAt) existing.generated_at = generatedAt;
  existing.proposal_files = uniqueValues([
    ...(existing.proposal_files || []),
    relativePath,
    payload?.proposal_files?.batch,
  ]);
  existing.photo_count = Array.isArray(payload?.photos) ? payload.photos.length : existing.photo_count;
  state.batchesById.set(batchId, existing);
};

const stateTagsForEntry = (item, extraTags = []) => {
  const parked = isParkedProposal(item) || extraTags.includes(PARKED_FLAG);
  const base = uniqueValues([...(item?.state_tags || []), ...extraTags]);
  if (parked) {
    return uniqueValues(base.filter((tag) => tag !== PROPOSED_FLAG && tag !== REJECTED_FLAG).concat(PARKED_FLAG));
  }
  return uniqueValues(base.filter((tag) => tag !== PARKED_FLAG).concat(PROPOSED_FLAG));
};

const mergeProposedPhoto = (state, photoId, detail = {}) => {
  const normalizedId = normalizedPhotoId(photoId);
  if (!normalizedId) return;
  const existing = state.photosById.get(normalizedId) || {
    photo_id: normalizedId,
    state_tags: [PROPOSED_FLAG],
    review_state: "proposed",
    rework_priority: false,
    rejection_comment: "",
    rejected_count: 0,
    first_proposed_batch_id: "",
    latest_proposed_batch_id: "",
    first_proposed_at: "",
    latest_proposed_at: "",
    latest_attempt: 1,
    proposal_files: [],
  };
  existing.state_tags = stateTagsForEntry(existing, Array.isArray(detail.state_tags) ? detail.state_tags : []);
  const batchId = String(detail.batch_id || "").trim();
  const firstBatchId = String(detail.first_proposed_batch_id || "").trim();
  const latestBatchId = String(detail.latest_proposed_batch_id || "").trim();
  const generatedAt = String(detail.generated_at || "").trim();
  const firstProposedAt = String(detail.first_proposed_at || "").trim();
  const latestProposedAt = String(detail.latest_proposed_at || "").trim();
  const rejectionComment = String(detail.rejection_comment || detail.latest_rejection_comment || "").trim();
  if (!existing.first_proposed_batch_id) existing.first_proposed_batch_id = firstBatchId || batchId;
  if (latestBatchId || batchId) existing.latest_proposed_batch_id = latestBatchId || batchId;
  if (!existing.first_proposed_at) existing.first_proposed_at = firstProposedAt || generatedAt;
  if (latestProposedAt || generatedAt) existing.latest_proposed_at = latestProposedAt || generatedAt;
  if (detail.review_state) existing.review_state = String(detail.review_state);
  if (detail.rework_priority != null) existing.rework_priority = Boolean(detail.rework_priority);
  if (isParkedProposal(existing)) {
    existing.state_tags = stateTagsForEntry(existing, [PARKED_FLAG]);
    existing.review_state = "parked";
    existing.rework_priority = false;
  }
  if (existing.state_tags.includes(REJECTED_FLAG) && !isParkedProposal(existing)) {
    existing.review_state = "rejected";
    existing.rework_priority = true;
  }
  if (Number.isFinite(Number(detail.rejected_count))) existing.rejected_count = Number(detail.rejected_count);
  if (Number.isFinite(Number(detail.latest_attempt))) existing.latest_attempt = Math.max(1, Number(detail.latest_attempt));
  if (detail.latest_generator_model != null) existing.latest_generator_model = String(detail.latest_generator_model || "").trim();
  if (Number.isFinite(Number(detail.latest_generator_model_level))) existing.latest_generator_model_level = Number(detail.latest_generator_model_level);
  if (detail.latest_generator_model_maxed != null) existing.latest_generator_model_maxed = Boolean(detail.latest_generator_model_maxed);
  if (Array.isArray(detail.latest_model_ladder)) existing.latest_model_ladder = detail.latest_model_ladder;
  if (detail.latest_proposal_title != null) existing.latest_proposal_title = String(detail.latest_proposal_title || "").trim();
  if (detail.latest_proposal_keywords != null) existing.latest_proposal_keywords = uniqueKeywords(detail.latest_proposal_keywords || []);
  if (detail.latest_proposal_status != null) existing.latest_proposal_status = String(detail.latest_proposal_status || "").trim();
  if (detail.latest_proposal_reason != null) existing.latest_proposal_reason = String(detail.latest_proposal_reason || "").trim();
  if (rejectionComment) existing.rejection_comment = rejectionComment;
  if (detail.clear_rejection) {
    existing.review_state = "proposed";
    existing.rework_priority = false;
    existing.rejection_comment = "";
    existing.state_tags = stateTagsForEntry({
      ...existing,
      state_tags: uniqueValues(existing.state_tags || []).filter((tag) => tag !== REJECTED_FLAG && tag !== PARKED_FLAG),
      review_state: "proposed",
    });
  }
  existing.proposal_files = uniqueValues([
    ...(existing.proposal_files || []),
    ...(Array.isArray(detail.proposal_files) ? detail.proposal_files : []),
    detail.proposal_file,
  ]);
  state.photosById.set(normalizedId, existing);
};

const parkProposedPhoto = (state, photoId, detail = {}) => {
  const normalizedId = normalizedPhotoId(photoId);
  if (!normalizedId) return;
  const existing = state.photosById.get(normalizedId) || {
    photo_id: normalizedId,
    state_tags: [],
    review_state: "parked",
    rework_priority: false,
    rejection_comment: "",
    rejected_count: 0,
    first_proposed_batch_id: "",
    latest_proposed_batch_id: "",
    first_proposed_at: "",
    latest_proposed_at: "",
    proposal_files: [],
  };
  existing.photo_id = normalizedId;
  existing.state_tags = stateTagsForEntry({ ...existing, review_state: "parked" }, [PARKED_FLAG]);
  existing.review_state = "parked";
  existing.rework_priority = false;
  existing.parked = true;
  existing.parked_reason = String(detail.reason || "Unable to generate a defensible non-placeholder title from current local metadata.").trim();
  existing.parked_at = String(detail.parked_at || new Date().toISOString());
  existing.parked_from_batch_id = String(detail.batch_id || "").trim();
  existing.parked_from_rework = detail.rework_priority === true;
  existing.rejection_comment = String(existing.rejection_comment || detail.rejection_comment || "").trim();
  if (detail.latest_proposal_title != null) existing.latest_proposal_title = String(detail.latest_proposal_title || "").trim();
  if (detail.latest_proposal_keywords != null) existing.latest_proposal_keywords = uniqueKeywords(detail.latest_proposal_keywords || []);
  existing.proposal_files = uniqueValues(existing.proposal_files || []);
  state.photosById.set(normalizedId, existing);
};

const mergeBatchPayload = (state, payload, relativePath, options = {}) => {
  if (!payload || typeof payload !== "object") return;
  mergeBatchRecord(state, payload, relativePath);
  const batchId = String(payload?.batch_id || "").trim();
  const generatedAt = String(payload?.generated_at || "").trim();
  const proposalFile = String(payload?.proposal_files?.batch || relativePath || "").trim();
  for (const item of payload.photos || []) {
    mergeProposedPhoto(state, item?.photo_id || item?.photoId, {
      batch_id: batchId,
      generated_at: generatedAt,
      proposal_file: proposalFile,
      clear_rejection: options.clearRejection === true,
    });
  }
};

const createProposalState = () => ({
  photosById: new Map(),
  batchesById: new Map(),
});

const loadProposalState = (queueDir, proposedStatePath) => {
  const state = createProposalState();
  const absoluteStatePath = path.join(REPO_ROOT, proposedStatePath);
  const payload = readJsonFile(absoluteStatePath);
  if (payload && typeof payload === "object") {
    for (const photoId of payload.photo_ids || []) {
      mergeProposedPhoto(state, photoId);
    }
    for (const item of payload.photos || []) {
      mergeProposedPhoto(state, item?.photo_id || item?.photoId, item || {});
    }
    for (const batch of payload.batches || []) {
      mergeBatchRecord(state, { ...batch, photos: new Array(Number(batch?.photo_count || 0)) }, batch?.proposal_files?.[0] || "");
    }
  }

  const absoluteQueueDir = path.join(REPO_ROOT, queueDir);
  if (!fs.existsSync(absoluteQueueDir)) return state;
  const batchFiles = fs.readdirSync(absoluteQueueDir)
    .filter((name) => /^batch-\d{4}-\d{2}-\d{2}.*\.json$/i.test(name))
    .sort();
  for (const name of batchFiles) {
    const relativePath = path.join(queueDir, name);
    const batchPayload = readJsonFile(path.join(REPO_ROOT, relativePath));
    mergeBatchPayload(state, batchPayload, relativePath);
  }
  return state;
};

const proposalStatePayload = (state) => {
  const photos = [...state.photosById.values()]
    .map((item) => ({
      ...item,
      state_tags: stateTagsForEntry(item),
      proposal_files: uniqueValues(item.proposal_files || []),
    }))
    .sort((a, b) => a.photo_id.localeCompare(b.photo_id));
  const batches = [...state.batchesById.values()]
    .map((item) => ({
      ...item,
      proposal_files: uniqueValues(item.proposal_files || []),
    }))
    .sort((a, b) => String(a.batch_id).localeCompare(String(b.batch_id)));
  return {
    format: "photosbyelie-title-keyword-proposal-state",
    schema_version: 1,
    updated_at: new Date().toISOString(),
    state_flag: PROPOSED_FLAG,
    review_flag: REVIEW_FLAG,
    parked_flag: PARKED_FLAG,
    photo_count: photos.length,
    photo_ids: photos.map((item) => item.photo_id),
    photos,
    batches,
  };
};

const writeProposalState = (proposedStatePath, state) => {
  const outputPath = path.join(REPO_ROOT, proposedStatePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(proposalStatePayload(state), null, 2) + "\n");
};

const syncOwnerDb = () => {
  const result = spawnSync("python3", ["scripts/owner_state_db.py", "--import-owner-actions", "--force"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: OWNER_STATE_DB_MAX_BUFFER,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Owner.sqlite sync failed.").trim());
  }
};

const parseArgs = (argv) => {
  const args = { limit: DEFAULT_LIMIT, includeAlreadyProposed: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--limit") {
      const raw = argv[index + 1];
      index += 1;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) args.limit = Math.floor(parsed);
      continue;
    }
    if (value === "--include-already-proposed") {
      args.includeAlreadyProposed = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      args.help = true;
    }
  }
  return args;
};

const runBatchId = (date = new Date()) => {
  const [datePart, timePart = ""] = date.toISOString().split("T");
  const safeTime = timePart
    .replace("Z", "")
    .replace(/\./g, "-")
    .replace(/:/g, "");
  return `${datePart}-${safeTime}Z`;
};

const main = async () => {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/generate_title_keyword_review_queue.mjs [--limit 100] [--include-already-proposed]\n" +
      "Normal runs use Owner.sqlite as source of truth and write JSON only as review-page batch views.\n" +
      "Set PBE_TITLE_KEYWORD_MODEL_CONCURRENCY to tune parallel model calls.\n",
    );
    process.exit(0);
  }

  const queueDir = path.join("assets", "owner-actions", "title-keyword-review-queue");
  const batchId = runBatchId();
  const batchFilename = `batch-${batchId}.json`;
  const batchPath = path.join(queueDir, batchFilename);
  const latestPath = path.join(queueDir, "latest.json");
  const proposalStatePath = path.join("assets", "owner-actions", "Owner.sqlite");
  const ownerGeneratorState = loadOwnerGeneratorState();
  MODEL_LADDER = normalizeModelLadder(
    envModelLadder || ownerGeneratorState.modelLadder || MODEL_LADDER,
  );
  const envGenerator = String(process.env.PBE_TITLE_KEYWORD_GENERATOR_MODEL || "").trim();
  if (envGenerator && !MODEL_LADDER.includes(envGenerator)) {
    throw new Error(`PBE_TITLE_KEYWORD_GENERATOR_MODEL ${envGenerator} is not selected in the saved model ladder`);
  }
  GENERATOR_MODEL = envGenerator || MODEL_LADDER[0];
  progress(
    `Starting batch ${batchId}: limit=${args.limit} generator=${GENERATOR_MODEL} ` +
    `ladder=${MODEL_LADDER.join(" > ")}`,
  );
  const proposedState = ownerGeneratorState.state;

  const photosData = loadCatalogWindow(REPO_ROOT).photosByElieData;
  if (!photosData || typeof photosData !== "object") {
    throw new Error("Could not load SQLite-backed catalog data (window.photosByElieData).");
  }

  const blacklist = ownerGeneratorState.blacklist;

  const flattened = [];
  for (const [galleryKey, collection] of Object.entries(photosData)) {
    const galleryLabel = String(collection?.title || galleryKey);
    const photos = Array.isArray(collection?.photos) ? collection.photos : [];
    for (const photo of photos) {
      flattened.push({ galleryKey, galleryLabel, photo });
    }
  }

  const skippedReviewed = [];
  const skippedProposed = [];
  const skippedParked = [];
  const candidates = [];

  for (const row of flattened) {
    const photo = row.photo || {};
    const stateEntry = proposalStateEntry(photo, proposedState);
    if (isReviewed(photo) || isApprovedProposal(stateEntry)) {
      skippedReviewed.push(String(photo?.id || ""));
      continue;
    }
    if (isParkedProposal(stateEntry)) {
      skippedParked.push(String(photo?.id || ""));
      continue;
    }
    const reworkPriority = isRejectedForRework(photo, proposedState);
    if (!args.includeAlreadyProposed && isAlreadyProposed(photo, proposedState) && !reworkPriority) {
      skippedProposed.push(String(photo?.id || ""));
      continue;
    }
    const capture = captureForPhoto(photo);
    const sort = capture.sort || "";
    candidates.push({
      ...row,
      capture,
      captureSort: sort || `0000-00-00T00:00:00`,
      id: String(photo?.id || ""),
      reworkPriority,
      reworkComment: String(stateEntry?.rejection_comment || stateEntry?.latest_rejection_comment || "").trim(),
      previousGeneratorModel: String(stateEntry?.latest_generator_model || "").trim(),
      previousGeneratorModelLevel: Number.isFinite(Number(stateEntry?.latest_generator_model_level))
        ? Number(stateEntry.latest_generator_model_level)
        : null,
      previousGeneratorModelMaxed: stateEntry?.latest_generator_model_maxed === true,
      previousModelLadder: Array.isArray(stateEntry?.latest_model_ladder) ? stateEntry.latest_model_ladder : [],
      previousProposalTitle: String(stateEntry?.latest_proposal_title || "").trim(),
      previousProposalKeywords: Array.isArray(stateEntry?.latest_proposal_keywords) ? stateEntry.latest_proposal_keywords : [],
      previousProposalStatus: String(stateEntry?.latest_proposal_status || "").trim(),
      previousProposalReason: String(stateEntry?.latest_proposal_reason || "").trim(),
      proposalAttempt: Math.max(Number(stateEntry?.latest_attempt || 0), Number(stateEntry?.rejected_count || 0)) + 1,
      rejectedCount: Number(stateEntry?.rejected_count || 0),
    });
  }

  candidates.sort((a, b) => {
    if (a.reworkPriority !== b.reworkPriority) return a.reworkPriority ? -1 : 1;
    const sortCompare = String(b.captureSort).localeCompare(String(a.captureSort));
    if (sortCompare) return sortCompare;
    return String(b.id).localeCompare(String(a.id));
  });

  const reworkCandidates = candidates.filter((row) => row.reworkPriority);
  const ordinaryCandidates = candidates.filter((row) => !row.reworkPriority);
  progress(
    `Loaded ${flattened.length} photos; candidates=${candidates.length} ` +
    `rework=${reworkCandidates.length} ordinary=${ordinaryCandidates.length} ` +
    `skipped_reviewed=${skippedReviewed.length} skipped_proposed=${skippedProposed.length} ` +
    `skipped_parked=${skippedParked.length}`,
  );

  const buildPhotoRecord = async (row) => {
    const photo = row.photo || {};
    const currentKeywordsRaw = metadataValue(photo, "Keywords");
    const currentKeywords = uniqueKeywords(splitKeywordText(currentKeywordsRaw));

    const currentTitle = String(photo?.title || metadataValue(photo, "Metadata title") || photo?.id || "").trim();

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
    const sourceAlbumTitle = sourceAlbumFromPhoto(photo, sourceFile);
    const sourcePlaceHint = metadataValue(photo, "Location");
    const sourceGps = sourceGpsFromPhoto(photo, sourceFile);
    const localProposal = proposalForPhoto({
      photo,
      galleryLabel: row.galleryLabel,
      currentTitle,
      currentKeywords,
      currentKeywordsRaw,
      blacklist,
      sourceFile,
      capture: row.capture,
    });
    const requestedGenerator = selectedGeneratorForRow(row);
    let actualGenerator = isAiGeneratorModel(requestedGenerator.model) ? requestedGenerator : generatorModelInfo();
    let proposal = { ...localProposal };
    let modelBlocker = null;
    let modelAttempts = 0;
    let modelPreviewPath = "";
    if (row.reworkPriority) {
      const comment = row.reworkComment ? ` Owner note: ${row.reworkComment.slice(0, 240)}` : "";
      proposal.status = proposal.status === "needs_owner_context" ? proposal.status : "rework_requested";
      proposal.confidence = proposal.confidence === "low" ? "low" : "medium";
      const escalation = row.previousGeneratorModel
        ? ` Previous generator: ${row.previousGeneratorModel}; requested next generator: ${requestedGenerator.model}.`
        : ` Requested rework generator: ${requestedGenerator.model}.`;
      proposal.reason = `Owner rejected a previous proposal; this photo was prioritized for a new title/keyword attempt.${comment}${escalation}`;
    }
    if (requestedGenerator.exhausted === true) {
      modelBlocker = {
        kind: "model_ladder_exhausted",
        requested_generator: requestedGenerator,
        attempts: 0,
        message: "Latest rejected proposal already used the strongest configured model.",
      };
    } else if (isAiGeneratorModel(requestedGenerator.model)) {
      const modelResult = await generateModelProposal({
        row,
        photo,
        galleryLabel: row.galleryLabel,
        currentTitle,
        currentKeywords,
        blacklist,
        sourceFile,
        meta,
        localProposal: proposal,
        requestedGenerator,
      });
      modelAttempts = modelResult.attempts || 0;
      modelPreviewPath = modelResult.previewPath || "";
      if (modelResult.ok) {
        proposal = modelResult.proposal;
        actualGenerator = requestedGenerator;
      } else {
        modelBlocker = {
          kind: "model_escalation_blocker",
          requested_generator: requestedGenerator,
          attempts: modelResult.attempts || MODEL_RETRIES,
          preview_path: modelResult.previewPath || "",
          message: modelResult.error || "Selected model could not produce a valid proposal.",
        };
      }
    }

    const record = {
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
        gallery_key: String(photo?.media?.publicPreview?.galleryKey || ""),
        detail_key: String(photo?.media?.publicPreview?.detailKey || ""),
      },
      source: {
        origin: String(photo?.sourceOrigin || ""),
        pricingTier: String(photo?.pricingTier || ""),
        album: sourceAlbumTitle,
        placeHint: sourcePlaceHint,
        gps: sourceGps,
        file: {
          path: String(sourceFile?.path || ""),
          type: String(sourceFile?.type || ""),
          bytes: Number(sourceFile?.bytes || 0),
        },
      },
      state: {
        tags: [PROPOSED_FLAG],
        rework_requested: row.reworkPriority,
        rework_comment: row.reworkComment,
        proposal_attempt: row.proposalAttempt,
        previous_generator: row.previousGeneratorModel ? {
          model: row.previousGeneratorModel,
          model_level: row.previousGeneratorModelLevel,
          model_maxed: row.previousGeneratorModelMaxed,
          model_ladder: row.previousModelLadder,
        } : null,
        previous_proposal: row.previousProposalTitle || row.previousProposalKeywords.length ? {
          title: row.previousProposalTitle,
          keywords: row.previousProposalKeywords,
          status: row.previousProposalStatus,
          reason: row.previousProposalReason,
        } : null,
        requested_generator: requestedGenerator,
        model_attempts: modelAttempts,
        model_preview_path: modelPreviewPath,
      },
      current: {
        title: currentTitle,
        keywords_raw: currentKeywordsRaw,
        keywords: currentKeywords,
      },
      proposed: {
        title: proposal.title,
        keywords: proposal.keywords,
        status: proposal.status,
        confidence: proposal.confidence,
        reason: proposal.reason,
        generator: actualGenerator,
      },
      changes: {
        removed_blacklisted: proposal.removedBlacklisted,
        blacklisted_keyword_count: proposal.removedBlacklisted.length,
        blacklist_only_cleanup: proposal.blacklistOnlyCleanup === true,
        no_change_needed: proposal.noChangeNeeded === true,
        keyword_target: MIN_PROPOSED_KEYWORDS,
        keyword_target_met: proposal.keywordTargetMet,
      },
      meta,
    };
    return { record, modelBlocker };
  };

  const photos = [];
  const parkedRows = [];
  const noChangeRows = [];
  const unresolvedReworkRows = [];
  const modelBlockedRows = [];
  let ordinaryNewCount = 0;

  const logCandidateOutcome = (row, outcome) => {
    progress(
      `Progress ${outcome} ${row.id}: proposals=${photos.length} rework=${photos.filter((item) => item?.state?.rework_requested === true).length} ` +
      `ordinary=${ordinaryNewCount}/${args.limit} blocked=${modelBlockedRows.length} ` +
      `unresolved_rework=${unresolvedReworkRows.length} parked=${parkedRows.length} no_change=${noChangeRows.length}`,
    );
  };

  const applyCandidateResult = (row, built, ordinarySlot = false) => {
    const record = built.record;
    if (built.modelBlocker?.kind === "model_ladder_exhausted") {
      parkedRows.push({ row, record, blocker: built.modelBlocker });
      logCandidateOutcome(row, "parked_ladder_exhausted");
      return false;
    }
    if (built.modelBlocker) {
      modelBlockedRows.push({ row, record, blocker: built.modelBlocker });
      logCandidateOutcome(row, "model_blocked");
      return false;
    }
    if (record?.changes?.no_change_needed === true && row.reworkPriority !== true) {
      noChangeRows.push({ row, record });
      logCandidateOutcome(row, "no_change_reviewed");
      return true;
    }
    const title = String(record?.proposed?.title || "").trim();
    const sourcePath = record?.source?.file?.path || record?.meta?.original_file || "";
    if (!title || isPlaceholderTitle(title, sourcePath)) {
      if (row.reworkPriority === true && Number(row.rejectedCount || 0) < TITLE_KEYWORD_PARK_REJECTED_COUNT) {
        unresolvedReworkRows.push({ row, record });
        logCandidateOutcome(row, "unresolved_rework_kept_rejected");
        return false;
      }
      parkedRows.push({ row, record });
      logCandidateOutcome(row, "parked_untitled");
      return false;
    }
    photos.push(record);
    if (ordinarySlot) ordinaryNewCount += 1;
    logCandidateOutcome(row, row.reworkPriority ? "added_rework" : "added_ordinary");
    return true;
  };

  const addCandidate = async (row, ordinarySlot = false) => applyCandidateResult(row, await buildPhotoRecord(row), ordinarySlot);

  const reworkGroupsByModel = new Map();
  for (const row of reworkCandidates) {
    const requested = selectedGeneratorForRow(row);
    const key = `${String(requested.model_level).padStart(3, "0")}:${requested.model}`;
    if (!reworkGroupsByModel.has(key)) reworkGroupsByModel.set(key, { requested, rows: [] });
    reworkGroupsByModel.get(key).rows.push(row);
  }
  const reworkGroups = [...reworkGroupsByModel.values()]
    .sort((a, b) => Number(a.requested.model_level || 0) - Number(b.requested.model_level || 0));
  let reworkOffset = 0;
  for (const group of reworkGroups) {
    progress(
      `Rework model batch ${group.requested.model} level=${group.requested.model_level}: ` +
      `${group.rows.length} rows concurrency=${MODEL_CONCURRENCY}`,
    );
    const builtRows = await mapWithConcurrency(group.rows, MODEL_CONCURRENCY, async (row, groupIndex) => {
      progress(
        `Rework candidate ${reworkOffset + groupIndex + 1}/${reworkCandidates.length}: ${row.id} ` +
        `rejected_count=${row.rejectedCount} requested=${group.requested.model}`,
      );
      return buildPhotoRecord(row);
    });
    group.rows.forEach((row, index) => {
      applyCandidateResult(row, builtRows[index], false);
    });
    reworkOffset += group.rows.length;
  }
  for (let index = 0; index < ordinaryCandidates.length; index += 1) {
    const row = ordinaryCandidates[index];
    if (ordinaryNewCount >= args.limit) break;
    progress(`Ordinary candidate ${index + 1}/${ordinaryCandidates.length}: ${row.id} ordinary=${ordinaryNewCount}/${args.limit}`);
    await addCandidate(row, true);
  }

  const ordinaryBatch = photos.filter((item) => item?.state?.rework_requested !== true);
  const reworkBatch = photos.filter((item) => item?.state?.rework_requested === true);
  const rangeNewest = photos[0]?.capture?.sort || "";
  const rangeOldest = photos[photos.length - 1]?.capture?.sort || "";
  const ordinaryRangeNewest = ordinaryBatch[0]?.capture?.sort || "";
  const ordinaryRangeOldest = ordinaryBatch[ordinaryBatch.length - 1]?.capture?.sort || "";
  const parkedAt = new Date().toISOString();
  const parkedExportRows = [];
  for (const parked of parkedRows) {
    const parkedDetail = {
      batch_id: batchId,
      parked_at: parkedAt,
      rework_priority: parked.row.reworkPriority,
      rejection_comment: parked.row.reworkComment,
      latest_proposal_title: parked.record?.proposed?.title,
      latest_proposal_keywords: parked.record?.proposed?.keywords || [],
      reason: parked.blocker?.kind === "model_ladder_exhausted"
        ? "Model ladder exhausted after Owner rejected the strongest configured model proposal."
        : parked.row.reworkPriority
        ? "Rejected/rework photo still needs owner context; parked until a stronger title tool is available."
        : "Unable to generate a defensible non-placeholder title from current local metadata.",
      latest_attempt: Math.max(1, Number(parked.row.proposalAttempt || 1)),
      rejected_count: Number(parked.row.rejectedCount || 0),
    };
    parkedExportRows.push({ photo_id: parked.record.photo_id, ...parkedDetail });
  }
  const reviewedAt = new Date().toISOString();
  const noChangeExportRows = noChangeRows.map(({ row, record }) => ({
    photo_id: record.photo_id,
    batch_id: batchId,
    reviewed_at: reviewedAt,
    latest_attempt: Math.max(1, Number(row.proposalAttempt || 1)),
    title: record.current.title,
    keywords: record.current.keywords,
    keyword_target: MIN_PROPOSED_KEYWORDS,
    reason: "Original title and keywords were already acceptable; marked reviewed without queuing owner approval.",
    generator: record.proposed.generator,
  }));
  const generatorCounts = {};
  for (const record of photos) {
    const model = String(record?.proposed?.generator?.model || "unknown");
    generatorCounts[model] = (generatorCounts[model] || 0) + 1;
  }
  const reworkGeneratorCounts = {};
  for (const record of reworkBatch) {
    const model = String(record?.proposed?.generator?.model || "unknown");
    reworkGeneratorCounts[model] = (reworkGeneratorCounts[model] || 0) + 1;
  }
  const qualitySummaryFor = (records) => {
    const summary = {
      empty_title_count: 0,
      placeholder_title_count: 0,
      keyword_target_miss_count: 0,
      needs_owner_context_count: 0,
      source_context_count: 0,
      low_confidence_count: 0,
    };
    for (const record of records) {
      const title = String(record?.proposed?.title || "").trim();
      const sourcePath = record?.source?.file?.path || record?.meta?.original_file || "";
      if (!title) summary.empty_title_count += 1;
      if (title && isPlaceholderTitle(title, sourcePath)) summary.placeholder_title_count += 1;
      if (record?.changes?.keyword_target_met !== true) summary.keyword_target_miss_count += 1;
      if (record?.proposed?.status === "needs_owner_context") summary.needs_owner_context_count += 1;
      if (record?.proposed?.status === "source_context") summary.source_context_count += 1;
      if (record?.proposed?.confidence === "low") summary.low_confidence_count += 1;
    }
    return summary;
  };
  const qualitySummary = qualitySummaryFor(photos);
  const modelBlockedExportRows = modelBlockedRows.map(({ row, record, blocker }) => ({
    photo_id: record.photo_id,
    rework_requested: row.reworkPriority === true,
    rejected_count: Number(row.rejectedCount || 0),
    requested_generator: blocker.requested_generator,
    attempts: blocker.attempts || 0,
    message: blocker.message || "",
    preview_path: blocker.preview_path || "",
  }));

  const payload = {
    format: "photosbyelie-title-keyword-review-queue",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    batch_id: batchId,
    limit: args.limit,
    ordinary_new_limit: args.limit,
    review_flag: REVIEW_FLAG,
    model_ladder: MODEL_LADDER,
    model_catalog: ownerGeneratorState.modelCatalog || MODEL_CATALOG,
    proposal_state: {
      flag: PROPOSED_FLAG,
      parked_flag: PARKED_FLAG,
      path: proposalStatePath,
      include_already_proposed: args.includeAlreadyProposed,
    },
    proposal_files: {
      batch: batchPath,
      latest: latestPath,
    },
    range: {
      newest: rangeNewest,
      oldest: rangeOldest,
      ordinary_newest: ordinaryRangeNewest,
      ordinary_oldest: ordinaryRangeOldest,
    },
    selection: {
      total_count: photos.length,
      ordinary_new_count: ordinaryBatch.length,
      rework_count: reworkBatch.length,
      ordinary_new_limit: args.limit,
      parked_count: parkedRows.length,
      parked_rework_count: parkedRows.filter((item) => item.row.reworkPriority).length,
      parked_ordinary_count: parkedRows.filter((item) => !item.row.reworkPriority).length,
      no_change_reviewed_count: noChangeRows.length,
      unresolved_rework_count: unresolvedReworkRows.length,
      model_blocked_count: modelBlockedRows.length,
      model_blocked_rework_count: modelBlockedRows.filter((item) => item.row.reworkPriority).length,
      model_blocked_ordinary_count: modelBlockedRows.filter((item) => !item.row.reworkPriority).length,
      candidate_count: candidates.length,
      generator_counts: generatorCounts,
      rework_generator_counts: reworkGeneratorCounts,
      quality_summary: qualitySummary,
    },
    skipped: {
      reviewed: skippedReviewed.filter(Boolean),
      proposed: skippedProposed.filter(Boolean),
      parked: skippedParked.filter(Boolean),
      newly_parked: parkedRows.map((item) => item.record.photo_id).filter(Boolean),
      no_change_reviewed: noChangeRows.map((item) => item.record.photo_id).filter(Boolean),
      unresolved_rework: unresolvedReworkRows.map((item) => item.record.photo_id).filter(Boolean),
      model_blocked: modelBlockedExportRows,
    },
    photos,
  };

  progress(
    `Quality summary: empty_titles=${qualitySummary.empty_title_count} ` +
    `placeholder_titles=${qualitySummary.placeholder_title_count} ` +
    `keyword_target_miss=${qualitySummary.keyword_target_miss_count} ` +
    `needs_owner_context=${qualitySummary.needs_owner_context_count}`,
  );
  progress(`Writing batch JSON ${batchPath} with ${photos.length} proposals.`);
  fs.mkdirSync(path.join(REPO_ROOT, queueDir), { recursive: true });
  fs.writeFileSync(path.join(REPO_ROOT, batchPath), JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(path.join(REPO_ROOT, latestPath), JSON.stringify(payload, null, 2) + "\n");
  progress(`Importing batch ${batchId} into Owner.sqlite.`);
  runOwnerStateDb(["--import-title-keyword-batch-file", batchPath]);
  if (parkedExportRows.length) {
    const parkedTmpPath = path.join("tmp", `title-keyword-parked-${batchId}-${Date.now()}.json`);
    fs.mkdirSync(path.join(REPO_ROOT, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(REPO_ROOT, parkedTmpPath), JSON.stringify(parkedExportRows, null, 2) + "\n");
    progress(`Marking ${parkedExportRows.length} rows parked in Owner.sqlite.`);
    runOwnerStateDb(["--park-title-keyword-rows-file", parkedTmpPath]);
  }
  if (noChangeExportRows.length) {
    const noChangeTmpPath = path.join("tmp", `title-keyword-reviewed-no-change-${batchId}-${Date.now()}.json`);
    fs.mkdirSync(path.join(REPO_ROOT, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(REPO_ROOT, noChangeTmpPath), JSON.stringify(noChangeExportRows, null, 2) + "\n");
    progress(`Marking ${noChangeExportRows.length} no-change rows reviewed in Owner.sqlite.`);
    runOwnerStateDb(["--mark-title-keyword-reviewed-file", noChangeTmpPath]);
  }
  progress(`Completed batch ${batchId}.`);

  process.stdout.write(
    `Wrote ${photos.length} proposals -> ${batchPath}\n` +
    `Updated latest -> ${latestPath}\n` +
    "Updated Owner.sqlite\n" +
    `Range: ${rangeNewest || "—"} .. ${rangeOldest || "—"}\n` +
    `Skipped reviewed: ${skippedReviewed.length}\n` +
    `Skipped proposed: ${skippedProposed.length}\n` +
    `Skipped parked: ${skippedParked.length}\n` +
    `Parked retry-exhausted before selection: ${ownerGeneratorState.parkedRetryExhausted} (threshold ${ownerGeneratorState.parkRejectedCount})\n` +
    `Ordinary new: ${ordinaryBatch.length}/${args.limit}\n` +
    `Rework priority: ${reworkBatch.length}\n` +
    `Generator counts: ${JSON.stringify(generatorCounts)}\n` +
    `Rework generator counts: ${JSON.stringify(reworkGeneratorCounts)}\n` +
    `Quality summary: ${JSON.stringify(qualitySummary)}\n` +
    `Model escalation blockers: ${modelBlockedRows.length} (rework ${modelBlockedRows.filter((item) => item.row.reworkPriority).length}, ordinary ${modelBlockedRows.filter((item) => !item.row.reworkPriority).length})\n` +
    `Marked reviewed without changes: ${noChangeRows.length}\n` +
    `Unresolved rework kept rejected: ${unresolvedReworkRows.length}\n` +
    `Parked untitled: ${parkedRows.length}\n`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exit(1);
  });
}

export {
  codexModelConfig,
  normalizeModelLadder,
  firstAiGeneratorInfo,
  generatorModelInfo,
  invokeCodexProposalModel,
  isAiGeneratorModel,
  isLocalGeneratorModel,
  nextModelAfterLevel,
  parseModelProposalText,
  proposalForPhoto,
  selectedGeneratorForRow,
};
