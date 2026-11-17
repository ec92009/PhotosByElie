/** Narrow, immutable contract for approved daily portrait derivatives (PBE-215). */
export const VIDEO_BINDING_SCHEMA = "photosbyelie.campaignVideoBinding.v1";
export const VIDEO_RECEIPT_SCHEMA = "photosbyelie.campaignVideoReceipt.v1";
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
export const MAX_DECLARATION_BYTES = 16 * 1024;
export const API_PREFIX = "/api/v1/campaign-videos/";
export const PUBLIC_PREFIX = "/assets/campaign-media/";
export const SLUG_PATTERN = /^native-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
// Apple Photos' opaque cloud identifier is UUID:ordinal:base64. It is an
// identity, never an object key or URL; preserve '+' and '/' exactly.
const NATIVE_ASSET_ID_PATTERN = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}:[0-9]{3}:[A-Za-z0-9+/_=-]{1,128}$/;

export const videoError = (status, code) => Object.assign(new Error(code), { status, code });

/** Reject unknown properties as well as invalid values; never accept source URLs/keys. */
const exactKeys = (value, keys, optional = []) => {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.includes(key) && !optional.includes(key))
      || keys.some((key) => !Object.hasOwn(value, key))) {
    throw videoError(400, "campaign_video_binding_invalid");
  }
};
const validString = (value, pattern = ID_PATTERN) => typeof value === "string" && pattern.test(value);
const validReceipt = (value) => typeof value === "string" && value.length > 0 && value.length <= 512
  && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  && !/[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith("//");

/** Preserve the approved component order while validating the connector's attestation. */
export function validateVideoBinding(value) {
  exactKeys(value, ["schema", "queueId", "selectionSha256", "approvalReceipt",
    "sourceManifestSha256", "validationSha256", "approvedPhotoCount", "video", "components"], ["approvedPhotoCountException"]);
  exactKeys(value.video, ["sha256", "size", "contentType", "width", "height", "durationMilliseconds"]);
  const video = value.video;
  if (value.schema !== VIDEO_BINDING_SCHEMA || !validString(value.queueId)
      || !validReceipt(value.approvalReceipt)
      || [value.selectionSha256, value.sourceManifestSha256, value.validationSha256, video.sha256]
        .some((hash) => !validString(hash, HASH_PATTERN))
      || !Number.isSafeInteger(video.size) || video.size < 12 || video.size > MAX_VIDEO_BYTES
      || video.contentType !== "video/mp4" || video.width !== 1080 || video.height !== 1920
      || !Number.isSafeInteger(video.durationMilliseconds)
      || video.durationMilliseconds < 25000 || video.durationMilliseconds > 35000
      || !Number.isSafeInteger(value.approvedPhotoCount) || value.approvedPhotoCount < 1 || value.approvedPhotoCount > 12
      || !Array.isArray(value.components) || value.components.length !== value.approvedPhotoCount) {
    throw videoError(400, "campaign_video_binding_invalid");
  }
  const exception = value.approvedPhotoCountException;
  if (value.approvedPhotoCount !== 12 || exception !== undefined) {
    exactKeys(exception, ["count", "receipt"]);
    if (exception.count !== value.approvedPhotoCount || exception.receipt !== value.approvalReceipt) {
      throw videoError(400, "campaign_video_count_exception_invalid");
    }
  }
  for (const component of value.components) {
    exactKeys(component, ["assetId", "canonicalAssetId", "canonicalMediaId", "sourceSha256"]);
    if (!validString(component.assetId)
        || !(validString(component.canonicalAssetId) || validString(component.canonicalAssetId, NATIVE_ASSET_ID_PATTERN))
        || !validString(component.canonicalMediaId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
        || !validString(component.sourceSha256, HASH_PATTERN)) {
      throw videoError(400, "campaign_video_binding_invalid");
    }
  }
  for (const key of ["assetId", "canonicalAssetId", "canonicalMediaId"]) {
    if (new Set(value.components.map((item) => item[key])).size !== value.approvedPhotoCount) {
      throw videoError(400, "campaign_video_components_duplicate");
    }
  }
  return value;
}

/** Canonical encoding preserves Unicode receipts, sorted object keys, ordered arrays. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const bytesHex = (bytes) => Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
export const bindingDigest = async (binding) => bytesHex(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(canonicalJson(binding)),
));

/** Count actual UTF-8 bytes; false Content-Length cannot evade the declaration cap. */
export async function readVideoBinding(request) {
  if (request.headers.get("content-type") !== "application/json") throw videoError(415, "campaign_video_json_required");
  if (request.headers.has("content-encoding")) throw videoError(415, "campaign_video_encoding_forbidden");
  const reader = request.body?.getReader();
  if (!reader) throw videoError(400, "campaign_video_binding_invalid");
  const buffer = new Uint8Array(MAX_DECLARATION_BYTES);
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (count + value.byteLength > buffer.length) {
        await reader.cancel();
        throw videoError(413, "campaign_video_binding_too_large");
      }
      buffer.set(value, count);
      count += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count))); }
  catch { throw videoError(400, "campaign_video_binding_invalid"); }
  return validateVideoBinding(value);
}

/** These declarations can reference only the two existing public preview keys. */
export const previewMembers = (binding) => binding.components.map((item) => ({
  canonicalAssetId: item.canonicalAssetId, canonicalMediaId: item.canonicalMediaId,
  bindings: [900, 1800].map((width) => ({ bucket: "public", objectKey: `expo/${item.canonicalMediaId}_${width}.jpg` })),
}));

/** Bind current public-catalog stills and the existing fail-closed lifecycle authority. */
export async function assertVideoEligible(binding, catalogReader, lifecycle, expectedFence) {
  if (!catalogReader?.read || !lifecycle?.verifyPublicPreviews || !lifecycle?.assertAllowed) {
    throw videoError(503, "campaign_video_eligibility_unavailable");
  }
  const ids = binding.components.map((item) => item.canonicalMediaId);
  const catalog = await catalogReader.read(ids, expectedFence?.catalogSha256, expectedFence?.catalogRevision);
  if (!catalog?.photos || !HASH_PATTERN.test(catalog.sha256 || "") || !Number.isFinite(catalog.expiresAt)) {
    throw videoError(503, "campaign_video_eligibility_unavailable");
  }
  if (expectedFence && (catalog.sha256 !== expectedFence.catalogSha256
      || (expectedFence.catalogRevision !== undefined && catalog.revision !== expectedFence.catalogRevision))) {
    throw videoError(409, "campaign_video_catalog_changed");
  }
  for (const item of binding.components) {
    const photo = catalog.photos.get(item.canonicalMediaId)?.photo;
    const preview = photo?.media?.publicPreview;
    if (!photo || photo.media?.type !== "photo" || preview?.allowed !== true
        || preview.galleryKey !== `expo/${item.canonicalMediaId}_900.jpg`
        || preview.detailKey !== `expo/${item.canonicalMediaId}_1800.jpg`) {
      throw videoError(410, "campaign_video_component_ineligible");
    }
  }
  const result = await lifecycle.verifyPublicPreviews({ items: previewMembers(binding) });
  if (result?.schema !== "photosbyelie.publicPreviewObservation.v1" || result.readOnly !== true
      || !Array.isArray(result.items) || result.items.length !== binding.approvedPhotoCount) {
    throw videoError(503, "campaign_video_eligibility_unavailable");
  }
  for (const item of binding.components) {
    const matches = result.items.filter((observation) => observation.canonicalMediaId === item.canonicalMediaId
      && observation.canonicalAssetId === item.canonicalAssetId);
    if (matches.length !== 1 || matches[0].allowed !== true) throw videoError(410, "campaign_video_component_ineligible");
  }
  const lifecycleFence = await lifecycle.assertAllowed(ids, "campaign-video", expectedFence?.lifecycle);
  if (Date.now() > catalog.expiresAt) throw videoError(503, "campaign_video_catalog_unavailable");
  return { catalogSha256: catalog.sha256, lifecycle: lifecycleFence,
    ...(catalog.revision === undefined ? {} : { catalogRevision: catalog.revision }) };
}
