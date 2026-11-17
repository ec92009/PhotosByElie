import { videoError } from "./campaign-video-contract.mjs";
import { fetchPublicCatalog } from "./public-catalog-fetch.mjs";
export { PUBLIC_CATALOG_URL } from "./public-catalog-fetch.mjs";
const unavailable = () => videoError(503, "campaign_video_catalog_unavailable");

/** Fresh publisher authority brackets exact public bytes. No bundled or positive-cache fallback. */
export function createCurrentPublicCatalogReader({ fetchImpl = fetch, now = () => Date.now(), authority } = {}) {
  return {
    async read(mediaIds, expectedSha256, expectedRevision) {
      try {
        // Production always supplies the primary-backed authority. The strict HTTP
        // mode remains for isolated diagnostics/tests, not an automatic fallback.
        if (!authority) return await fetchPublicCatalog({ fetchImpl, now, mediaIds, expectedSha256, requireFresh: true });
        const current = await authority.read();
        if (!current || current.state !== "verified") throw unavailable();
        if ((expectedSha256 && current.sha256 !== expectedSha256)
            || (expectedRevision !== undefined && current.generation !== expectedRevision)) {
          throw videoError(409, "campaign_video_catalog_changed");
        }
        const catalog = await fetchPublicCatalog({ fetchImpl, now, mediaIds, expectedSha256: current.sha256 });
        const after = await authority.read();
        if (!after || after.state !== "verified") throw unavailable();
        if (after.generation !== current.generation || after.sha256 !== current.sha256
            || after.operationId !== current.operationId || after.publisherId !== current.publisherId) {
          throw videoError(409, "campaign_video_catalog_changed");
        }
        if (now() > catalog.expiresAt) throw unavailable();
        return { ...catalog, revision: current.generation };
      } catch (error) {
        if (["campaign_video_catalog_changed", "campaign_video_catalog_invalid"].includes(error?.code)) throw error;
        throw unavailable();
      }
    },
  };
}
