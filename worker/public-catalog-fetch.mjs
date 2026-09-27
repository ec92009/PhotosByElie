import { bytesHex, videoError } from "./campaign-video-contract.mjs";
import { MAX_CATALOG_BYTES, readPublicCatalogStills } from "./campaign-video-sqlite.mjs";

export const PUBLIC_CATALOG_URL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite";
const unavailable = () => videoError(503, "campaign_video_catalog_unavailable");

/** Read only the existing public artifact; authority is supplied separately, never inferred from HTTP Age. */
export async function fetchPublicCatalog({ fetchImpl = fetch, now = () => Date.now(), requireFresh = false,
  expectedSha256, mediaIds = [] } = {}) {
  let response;
  let reader;
  const startedAt = now();
  try {
    response = await fetchImpl(PUBLIC_CATALOG_URL, { method: "GET", redirect: "manual", cache: "no-store",
      headers: { accept: "application/octet-stream, application/vnd.sqlite3, application/x-sqlite3",
        "accept-encoding": "identity", "cache-control": "no-cache, no-store, max-age=0" },
      signal: AbortSignal.timeout(10000) });
    const type = response.headers.get("content-type")?.split(";")[0].trim();
    const date = Date.parse(response.headers.get("date"));
    const age = response.headers.get("age");
    const length = response.headers.get("content-length");
    if (response.status !== 200 || response.redirected || (response.url && response.url !== PUBLIC_CATALOG_URL)
        || !["application/octet-stream", "application/vnd.sqlite3", "application/x-sqlite3"].includes(type)
        || (response.headers.get("content-encoding") || "identity") !== "identity"
        || response.headers.has("content-range")
        || (requireFresh && (!Number.isFinite(date) || now() - date > 30000 || date - now() > 5000
          || (age !== null && age !== "0")))
        || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_CATALOG_BYTES || Number(length) < 512))) {
      throw unavailable();
    }
    reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const buffer = new Uint8Array(length === null ? MAX_CATALOG_BYTES : Number(length));
    let count = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || count + value.byteLength > buffer.length) throw unavailable();
      buffer.set(value, count); count += value.byteLength;
    }
    if (count < 512 || (length !== null && count !== Number(length)) || now() - startedAt > 30000
        || (requireFresh && now() - date > 30000)) throw unavailable();
    const bytes = buffer.subarray(0, count);
    const sha256 = bytesHex(await crypto.subtle.digest("SHA-256", bytes));
    if (expectedSha256 && sha256 !== expectedSha256) throw videoError(409, "campaign_video_catalog_changed");
    return { ...readPublicCatalogStills(bytes, mediaIds), sha256,
      expiresAt: requireFresh ? date + 30000 : startedAt + 30000 };
  } catch (error) {
    if (reader) await reader.cancel().catch(() => {});
    else if (response?.body) await response.body.cancel().catch(() => {});
    if (["campaign_video_catalog_changed", "campaign_video_catalog_invalid"].includes(error?.code)) throw error;
    throw unavailable();
  } finally { reader?.releaseLock(); }
}
