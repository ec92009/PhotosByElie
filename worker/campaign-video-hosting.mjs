import {
  API_PREFIX, PUBLIC_PREFIX, SLUG_PATTERN, VIDEO_RECEIPT_SCHEMA,
  assertVideoEligible, bytesHex, readVideoBinding, videoError,
} from "./campaign-video-contract.mjs";
import { createCampaignVideoStore } from "./campaign-video-store.mjs";
import { putVideoStream, videoRange } from "./campaign-video-stream.mjs";
import { createD1LifecycleDenyStore } from "./lifecycle-deny-store.mjs";
import { createCurrentPublicCatalogReader } from "./campaign-video-catalog.mjs";

const AUTH_ORIGIN = "https://auth.photos-by-elie.com";
const SITE_ORIGIN = "https://photos-by-elie.com";
const CACHE_HEADERS = {
  "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store",
  "cloudflare-cdn-cache-control": "no-store", "x-content-type-options": "nosniff",
};
const json = (value, status = 200) => Response.json(value, { status, headers: {
  ...CACHE_HEADERS, "x-pbe-api-version": "1", "x-pbe-request-id": crypto.randomUUID(),
} });
const objectKey = (record) => `campaign-videos/v1/${record.bindingSha256}.mp4`;

/** Only new native-prefixed assets are intercepted; historical static MP4s stay at origin. */
export const isCampaignVideoRequest = (pathname) => pathname.startsWith(API_PREFIX.slice(0, -1))
  || pathname.startsWith(`${PUBLIC_PREFIX}native-`);

/** Immutable integrity comparison, including R2's computed checksum, not ETag-as-SHA. */
function verifiedObject(object, record) {
  if (!object) return null;
  const video = record.binding.video;
  if (object.key !== objectKey(record) || object.size !== video.size
      || object.httpMetadata?.contentType !== "video/mp4"
      || object.httpMetadata?.contentEncoding
      || object.customMetadata?.bindingSha256 !== record.bindingSha256
      || object.customMetadata?.videoSha256 !== video.sha256
      || !object.checksums?.sha256 || bytesHex(object.checksums.sha256) !== video.sha256
      || !object.etag || !Number.isFinite(new Date(object.uploaded).getTime())) {
    throw videoError(409, "campaign_video_object_conflict");
  }
  return object;
}

/** A current receipt is reconciliation, not an assertion of independent public playback. */
function receipt(record, object, now) {
  const path = `${PUBLIC_PREFIX}${record.slug}.mp4`;
  return {
    schema: VIDEO_RECEIPT_SCHEMA, ok: true, slug: record.slug, queueId: record.binding.queueId,
    bindingSha256: record.bindingSha256, videoSha256: record.binding.video.sha256,
    size: record.binding.video.size, contentType: "video/mp4",
    publicUrl: `${SITE_ORIGIN}${path}`, portraitMp4: `.${path}`,
    state: object ? "ready" : "reserved", objectState: object ? "verified" : "absent",
    createdAt: record.createdAt, checkedAt: now().toISOString(),
    ...(object ? { uploadedAt: new Date(object.uploaded).toISOString(), etag: object.httpEtag } : {}),
  };
}

/** Testable route service; production injects only actual R2/D1/lifecycle/auth bindings. */
export function createCampaignVideoHost({ database, bucket, catalogReader, lifecycle, connectorAuth,
  enabled = false, now = () => new Date(), fixedLength } = {}) {
  const eligible = (record, fence) => assertVideoEligible(record.binding, catalogReader, lifecycle, fence);
  const head = async (record) => verifiedObject(await bucket.head(objectKey(record)), record);

  const serve = async (request, record) => {
    const fence = await eligible(record);
    const object = await head(record);
    if (!object) throw videoError(404, "campaign_video_content_absent");
    const headers = new Headers({ ...CACHE_HEADERS, "content-type": "video/mp4", "accept-ranges": "bytes",
      etag: object.httpEtag, "last-modified": new Date(object.uploaded).toUTCString() });
    let range;
    try { range = videoRange(request.headers.get("range"), object.size); }
    catch (error) {
      if (error.status === 416) return new Response(null, { status: 416,
        headers: { ...CACHE_HEADERS, "content-range": `bytes */${object.size}` } });
      throw error;
    }
    // If-Range mismatch requests a full body; validation and lifecycle checks still run.
    const ifRange = request.headers.get("if-range");
    if (range && ifRange && ifRange !== object.httpEtag) range = null;
    headers.set("content-length", String(range ? range.length : object.size));
    if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    if (request.method === "HEAD") {
      await eligible(record, fence);
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    const bodyObject = verifiedObject(await bucket.get(objectKey(record), {
      onlyIf: { etagMatches: object.etag }, ...(range ? { range } : {}),
    }), record);
    if (!bodyObject?.body) throw videoError(409, "campaign_video_object_changed");
    try { await eligible(record, fence); }
    catch (error) { await bodyObject.body.cancel(); throw error; }
    return new Response(bodyObject.body, { status: range ? 206 : 200, headers });
  };

  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.search || url.hash || url.protocol !== "https:") throw videoError(400, "campaign_video_url_invalid");
        const publicMatch = /^\/assets\/campaign-media\/(native-[a-z0-9-]+)\.mp4$/.exec(url.pathname);
        const apiMatch = /^\/api\/v1\/campaign-videos\/(native-[a-z0-9-]+)(\/content)?$/.exec(url.pathname);
        const slug = publicMatch?.[1] || apiMatch?.[1];
        if (!slug || slug.length > 120 || !SLUG_PATTERN.test(slug)) throw videoError(404, "campaign_video_not_found");
        if (url.origin !== (publicMatch ? SITE_ORIGIN : AUTH_ORIGIN)) throw videoError(404, "campaign_video_not_found");
        let connector;
        if (apiMatch) {
          // Native only. A customer cookie or a browser Origin cannot upgrade authority.
          if (request.headers.has("origin") || request.headers.has("cookie") || request.headers.has("sec-fetch-site")) {
            throw videoError(403, "campaign_video_native_only");
          }
          if (!connectorAuth?.requireConnector) throw videoError(503, "campaign_video_auth_unavailable");
          connector = await connectorAuth.requireConnector(request);
        }
        if (!enabled) throw videoError(503, "campaign_video_host_disabled");
        if (!bucket?.head || !bucket?.get || !bucket?.put) throw videoError(503, "campaign_video_storage_unavailable");
        const store = createCampaignVideoStore(database);
        if (publicMatch && !["GET", "HEAD"].includes(request.method)) throw videoError(405, "campaign_video_method_not_allowed");
        if (apiMatch && (!apiMatch[2] ? !["GET", "POST"].includes(request.method) : request.method !== "PUT")) {
          throw videoError(405, "campaign_video_method_not_allowed");
        }
        let record;
        let fence;
        if (apiMatch && request.method === "POST") {
          const binding = await readVideoBinding(request);
          fence = await assertVideoEligible(binding, catalogReader, lifecycle);
          record = await store.reserve(slug, binding, connector.connectorId, now().toISOString());
        } else {
          record = await store.read(slug);
          if (!record) throw videoError(404, "campaign_video_not_found");
        }
        if (publicMatch) return await serve(request, record);
        fence ||= await eligible(record);
        let object = await head(record);
        if (request.method === "PUT") {
          const video = record.binding.video;
          if (request.headers.get("content-type") !== "video/mp4" || request.headers.has("content-encoding")) {
            throw videoError(415, "campaign_video_mp4_required");
          }
          if (request.headers.get("content-length") !== String(video.size)) throw videoError(400, "campaign_video_length_mismatch");
          if (request.headers.get("x-pbe-binding-sha256") !== record.bindingSha256
              || request.headers.get("x-pbe-video-sha256") !== video.sha256) {
            throw videoError(409, "campaign_video_binding_conflict");
          }
          if (!object) {
            await eligible(record, fence);
            await putVideoStream(bucket, objectKey(record), request, record, fixedLength,
              () => eligible(record, fence));
            object = await head(record);
            if (!object) throw videoError(503, "campaign_video_upload_unconfirmed");
          } else if (request.body) await request.body.cancel();
        }
        await eligible(record, fence);
        return json(receipt(record, object, now));
      } catch (error) {
        const known = /^campaign_video_|^owner_connector_auth_|^lifecycle_|^asset_lifecycle_denied$/.test(error?.code || "");
        const status = known && [400, 401, 403, 404, 405, 409, 410, 413, 415, 416, 503].includes(error?.status) ? error.status : 503;
        return json({ ok: false, error: { code: known ? error.code : "campaign_video_dependency_unavailable",
          message: "Campaign video request could not be completed; reconcile before retrying." } }, status);
      }
    },
  };
}

/** Lazy integration avoids changing initialization/errors for any existing endpoint. */
export async function campaignVideoResponse(request, env, { connectorAuth } = {}) {
  try {
    const database = env.ACCESS_DB?.withSession ? env.ACCESS_DB.withSession("first-primary") : env.ACCESS_DB;
    return await createCampaignVideoHost({ database, bucket: env.PRIVATE_MEDIA, connectorAuth,
      catalogReader: createCurrentPublicCatalogReader(),
      enabled: env.CAMPAIGN_VIDEO_HOST_ENABLED === "true",
      lifecycle: createD1LifecycleDenyStore({ database }),
    }).fetch(request);
  } catch {
    return json({ ok: false, error: { code: "campaign_video_dependency_unavailable",
      message: "Campaign video dependencies are unavailable." } }, 503);
  }
}
