#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import catalogTsv from "./catalog_tsv.cjs";

const REPO_ROOT = process.cwd();
const DEFAULT_LIMIT = 100;
const REVIEW_FLAG = "Title_Keywords_Reviewed";
const PROPOSED_FLAG = "Title_Keywords_Proposed";
const REJECTED_FLAG = "Title_Keywords_Rejected";
const PARKED_FLAG = "Title_Keywords_Parked";
const MIN_PROPOSED_KEYWORDS = 10;

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
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Owner.sqlite command failed.").trim());
  }
  return result.stdout || "";
};

const loadOwnerGeneratorState = () => {
  const stdout = runOwnerStateDb(["--title-keyword-generator-state-json", "--park-twice-rejected"]);
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
      state_tags: item.state_tags || [],
    });
  }
  return {
    state,
    blacklist: blacklistRules(Array.isArray(payload.keyword_blacklist) ? payload.keyword_blacklist : []),
    counts: payload.counts || {},
    parkedTwiceRejected: Number(payload.parked_twice_rejected || 0),
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

const metadataExpansionKeywords = ({ photo, galleryLabel, context, currentTitle, sourceFile }) => {
  const sourceText = `${sourceFile?.path || ""} ${currentTitle || ""} ${(context.parts || []).join(" ")}`.toLowerCase();
  const origin = String(photo?.sourceOrigin || "").toLowerCase();
  const keywords = [
    galleryLabel,
    context.city,
    cityRegionKeyword(context.city),
    context.venue,
    ...context.parts,
    ...imageShapeKeywords(photo),
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

const contextFromSource = (sourcePath, galleryLabel) => {
  const parts = usefulPathParts(sourcePath).map(titleCase).filter(Boolean);
  const city = parts.find((part) => /malaga|valencia|paris|madrid|barcelona|lisbon|porto|rome|venice|pisa|bratislava|new york|miami|mexico/i.test(part)) || "";
  const venue = parts.find((part) => part !== city && /aquarium|museum|museo|cathedral|church|castle|palace|beach|coast|garden|park|bridge|tower|street|market|gallery|collection|colleccion|coleccion/i.test(part)) || "";
  const cleanedVenue = venue ? compactVenue(venue) : "";
  const titleContext = cleanedVenue && city
    ? `${cleanedVenue}, ${city}`
    : cleanedVenue || city || "";
  const inferredKeywords = [
    galleryLabel,
    city,
    cleanedVenue,
    /museo|museum|collection|colleccion|coleccion/i.test(`${cleanedVenue} ${sourcePath}`) ? "Museum" : "",
    /museo|museum|gallery|art|collection|colleccion|coleccion/i.test(`${cleanedVenue} ${sourcePath}`) ? "Art" : "",
    /aquarium/i.test(`${cleanedVenue} ${sourcePath}`) ? "Aquarium" : "",
    /aquarium/i.test(`${cleanedVenue} ${sourcePath}`) ? "Marine life" : "",
    /church|cathedral/i.test(`${cleanedVenue} ${sourcePath}`) ? "Church" : "",
    /beach|coast|sea|ocean/i.test(`${cleanedVenue} ${sourcePath}`) ? "Coast" : "",
    /street|market|city/i.test(`${cleanedVenue} ${sourcePath}`) ? "City" : "",
  ];
  return {
    parts,
    city,
    venue: cleanedVenue,
    title: titleContext,
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

const proposalForPhoto = ({ photo, galleryLabel, currentTitle, currentKeywords, currentKeywordsRaw, blacklist, sourceFile }) => {
  const context = contextFromSource(sourceFile?.path || "", galleryLabel);
  const withoutBlacklisted = currentKeywords.filter((keyword) => !hasBlacklistedTerm(keyword, blacklist));
  const removedBlacklisted = currentKeywords.filter((keyword) => hasBlacklistedTerm(keyword, blacklist));
  const placeholder = isPlaceholderTitle(currentTitle, sourceFile?.path || metadataValue(photo, "Original file"));
  const promptTitle = compactPromptTitle(currentTitle, currentKeywords);
  const descriptiveTitle = compactDescriptiveTitle(currentTitle);
  const keywordTitle = titleFromKeywordHints({ keywords: withoutBlacklisted, galleryLabel, context });
  const promptKeywords = compactPromptKeywords(currentTitle);
  const expansionKeywords = metadataExpansionKeywords({ photo, galleryLabel, context, currentTitle, sourceFile });
  const proposedTitle = promptTitle || descriptiveTitle || (placeholder ? (context.title || keywordTitle) : currentTitle);
  const proposedKeywords = allowedKeywords(
    [...withoutBlacklisted, ...context.keywords, ...promptKeywords, ...expansionKeywords],
    blacklist,
  );
  const hasUsefulKeywords = proposedKeywords.filter((keyword) => keyword.toLowerCase() !== galleryLabel.toLowerCase()).length > 0;
  const weakTitle = !proposedTitle || isPlaceholderTitle(proposedTitle, sourceFile?.path || metadataValue(photo, "Original file"));
  const needsContext = weakTitle || !hasUsefulKeywords;

  return {
    title: weakTitle ? "" : proposedTitle,
    keywords: needsContext && !proposedKeywords.length ? withoutBlacklisted : proposedKeywords,
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
    keywordTargetMet: proposedKeywords.length >= MIN_PROPOSED_KEYWORDS,
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
  if (Number(entry?.rejected_count || 0) >= 2) return false;
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
    process.stdout.write(
      "Usage: node scripts/generate_title_keyword_review_queue.mjs [--limit 100] [--include-already-proposed]\n" +
      "Normal runs use Owner.sqlite as source of truth and write JSON only as review-page batch views.\n",
    );
    process.exit(0);
  }

  const queueDir = path.join("assets", "owner-actions", "title-keyword-review-queue");
  const batchId = localDateString();
  const batchFilename = `batch-${batchId}.json`;
  const batchPath = path.join(queueDir, batchFilename);
  const latestPath = path.join(queueDir, "latest.json");

  const ownerGeneratorState = loadOwnerGeneratorState();
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

  const buildPhotoRecord = (row) => {
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
    const proposal = proposalForPhoto({
      photo,
      galleryLabel: row.galleryLabel,
      currentTitle,
      currentKeywords,
      currentKeywordsRaw,
      blacklist,
      sourceFile,
    });
    if (row.reworkPriority) {
      const comment = row.reworkComment ? ` Owner note: ${row.reworkComment.slice(0, 240)}` : "";
      proposal.status = proposal.status === "needs_owner_context" ? proposal.status : "rework_requested";
      proposal.confidence = proposal.confidence === "low" ? "low" : "medium";
      proposal.reason = `Owner rejected a previous proposal; this photo was prioritized for a new title/keyword attempt.${comment}`;
    }

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
        gallery_key: String(photo?.media?.publicPreview?.galleryKey || ""),
        detail_key: String(photo?.media?.publicPreview?.detailKey || ""),
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
      state: {
        tags: [PROPOSED_FLAG],
        rework_requested: row.reworkPriority,
        rework_comment: row.reworkComment,
        proposal_attempt: row.proposalAttempt,
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
      },
      changes: {
        removed_blacklisted: proposal.removedBlacklisted,
        blacklisted_keyword_count: proposal.removedBlacklisted.length,
        keyword_target: MIN_PROPOSED_KEYWORDS,
        keyword_target_met: proposal.keywordTargetMet,
      },
      meta,
    };
  };

  const photos = [];
  const parkedRows = [];
  let ordinaryNewCount = 0;

  const addCandidate = (row, ordinarySlot = false) => {
    const record = buildPhotoRecord(row);
    const title = String(record?.proposed?.title || "").trim();
    const sourcePath = record?.source?.file?.path || record?.meta?.original_file || "";
    if (!title || isPlaceholderTitle(title, sourcePath)) {
      parkedRows.push({ row, record });
      return false;
    }
    photos.push(record);
    if (ordinarySlot) ordinaryNewCount += 1;
    return true;
  };

  for (const row of reworkCandidates) {
    addCandidate(row, false);
  }
  for (const row of ordinaryCandidates) {
    if (ordinaryNewCount >= args.limit) break;
    addCandidate(row, true);
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
      reason: parked.row.reworkPriority
        ? "Rejected/rework photo still needs owner context; parked until a stronger title tool is available."
        : "Unable to generate a defensible non-placeholder title from current local metadata.",
      latest_attempt: Math.max(1, Number(parked.row.proposalAttempt || 1)),
      rejected_count: Number(parked.row.rejectedCount || 0),
    };
    parkedExportRows.push({ photo_id: parked.record.photo_id, ...parkedDetail });
  }

  const payload = {
    format: "photosbyelie-title-keyword-review-queue",
    schema_version: 1,
    generated_at: new Date().toISOString(),
    batch_id: batchId,
    limit: args.limit,
    ordinary_new_limit: args.limit,
    review_flag: REVIEW_FLAG,
    proposal_state: {
      flag: PROPOSED_FLAG,
      parked_flag: PARKED_FLAG,
      path: proposedStatePath,
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
      candidate_count: candidates.length,
    },
    skipped: {
      reviewed: skippedReviewed.filter(Boolean),
      proposed: skippedProposed.filter(Boolean),
      parked: skippedParked.filter(Boolean),
      newly_parked: parkedRows.map((item) => item.record.photo_id).filter(Boolean),
    },
    photos,
  };

  fs.mkdirSync(path.join(REPO_ROOT, queueDir), { recursive: true });
  fs.writeFileSync(path.join(REPO_ROOT, batchPath), JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(path.join(REPO_ROOT, latestPath), JSON.stringify(payload, null, 2) + "\n");
  runOwnerStateDb(["--import-title-keyword-batch-file", batchPath]);
  if (parkedExportRows.length) {
    const parkedTmpPath = path.join("tmp", `title-keyword-parked-${batchId}-${Date.now()}.json`);
    fs.mkdirSync(path.join(REPO_ROOT, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(REPO_ROOT, parkedTmpPath), JSON.stringify(parkedExportRows, null, 2) + "\n");
    runOwnerStateDb(["--park-title-keyword-rows-file", parkedTmpPath]);
  }

  process.stdout.write(
    `Wrote ${photos.length} proposals -> ${batchPath}\n` +
    `Updated latest -> ${latestPath}\n` +
    "Updated Owner.sqlite\n" +
    `Range: ${rangeNewest || "—"} .. ${rangeOldest || "—"}\n` +
    `Skipped reviewed: ${skippedReviewed.length}\n` +
    `Skipped proposed: ${skippedProposed.length}\n` +
    `Skipped parked: ${skippedParked.length}\n` +
    `Parked twice-rejected before selection: ${ownerGeneratorState.parkedTwiceRejected}\n` +
    `Ordinary new: ${ordinaryBatch.length}/${args.limit}\n` +
    `Rework priority: ${reworkBatch.length}\n` +
    `Parked untitled: ${parkedRows.length}\n`,
  );
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exit(1);
}
