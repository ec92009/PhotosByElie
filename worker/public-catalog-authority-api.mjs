import { authorityError, createPublicCatalogAuthority, validateCatalogTransition } from "./public-catalog-authority.mjs";
import { fetchPublicCatalog } from "./public-catalog-fetch.mjs";

export const CATALOG_AUTHORITY_PATH = "/api/v1/public-catalog/authority";
const HEADERS = { "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store",
  "cloudflare-cdn-cache-control": "no-store", "x-content-type-options": "nosniff", "x-pbe-api-version": "1" };
const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS });

/** Bounded JSON parsing without ever accepting a catalog body, secret or URL. */
async function readTransition(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
      || request.headers.has("content-encoding")) throw authorityError(415, "public_catalog_json_required");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096)) {
    throw authorityError(413, "public_catalog_transition_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw authorityError(400, "public_catalog_transition_invalid");
  try {
    const bytes = new Uint8Array(4096);
    let count = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (count + value.length > bytes.length) throw authorityError(413, "public_catalog_transition_too_large");
      bytes.set(value, count); count += value.length;
    }
    if (length !== null && count !== Number(length)) throw authorityError(400, "public_catalog_transition_invalid");
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)));
    return await validateCatalogTransition(value);
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error?.code?.startsWith("public_catalog_")) throw error;
    throw authorityError(400, "public_catalog_transition_invalid");
  } finally { reader.releaseLock(); }
}

/** Existing connector authority only. No browser cookie, public write or new credential. */
export function createPublicCatalogAuthorityApi({ database, connectorAuth, enabled = false, fetchImpl = fetch,
  now = () => new Date() } = {}) {
  const authority = createPublicCatalogAuthority(database, { now });
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.origin !== "https://auth.photos-by-elie.com" || url.pathname !== CATALOG_AUTHORITY_PATH
            || url.username || url.password || url.search || url.hash) {
          throw authorityError(404, "public_catalog_authority_route_not_found");
        }
        if (request.headers.has("origin") || request.headers.has("cookie") || request.headers.has("sec-fetch-site")) {
          throw authorityError(403, "public_catalog_native_only");
        }
        if (!connectorAuth?.requireConnector) throw authorityError(503, "public_catalog_auth_unavailable");
        const connector = await connectorAuth.requireConnector(request);
        // A restored local Owner may have lost enrollment. Its writer must still
        // see existing authority while hosting is disabled, never infer absence
        // from that flag and silently change the projection underneath it.
        if (request.method === "GET") {
          const record = await authority.read();
          if (!record) throw authorityError(404, "public_catalog_authority_absent");
          return json(authority.receipt(record));
        }
        if (!enabled) throw authorityError(503, "public_catalog_authority_disabled");
        if (request.method !== "POST") throw authorityError(405, "public_catalog_method_not_allowed");
        const value = await readTransition(request);
        const record = value.phase === "prepare"
          ? await authority.prepare(value, connector.connectorId)
          : await authority.commit(value, connector.connectorId, (sha256) => fetchPublicCatalog({
            fetchImpl, now: () => now().getTime(), expectedSha256: sha256,
          }));
        return json(authority.receipt(record));
      } catch (error) {
        const known = /^(public_catalog_|campaign_video_catalog_|owner_connector_auth_)/.test(error?.code || "");
        const status = known && [400, 401, 403, 404, 405, 409, 413, 415, 503].includes(error.status) ? error.status : 503;
        return json({ ok: false, error: { code: known ? error.code : "public_catalog_authority_unavailable",
          message: "Catalog authority could not be verified; reconcile before retrying." } }, status);
      }
    },
  };
}
