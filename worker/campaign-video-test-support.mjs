import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createOwnerConnectorAuth } from "./owner-connector-auth.mjs";
import { createCampaignVideoHost } from "./campaign-video-hosting.mjs";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const videoBytes = Buffer.from("000000186674797069736f6d0000000069736f6d61766331000000086d646174", "hex");
export const apiUrl = "https://auth.photos-by-elie.com/api/v1/campaign-videos/native-test";
export const publicUrl = "https://download.photos-by-elie.com/assets/campaign-media/native-test.mp4";
export const authHeaders = { authorization: "Bearer test-connector-only" };

export function declaration(count = 12) {
  return {
    schema: "photosbyelie.campaignVideoBinding.v1", queueId: "q-test", selectionSha256: "a".repeat(64),
    approvalReceipt: "2026-09-25/youtube-refill/owner-approval.txt",
    sourceManifestSha256: "b".repeat(64), validationSha256: "c".repeat(64), approvedPhotoCount: count,
    ...(count === 12 ? {} : { approvedPhotoCountException: {
      count, receipt: "2026-09-25/youtube-refill/owner-approval.txt",
    } }),
    video: { sha256: hash(videoBytes), size: videoBytes.length, contentType: "video/mp4", width: 1080,
      height: 1920, durationMilliseconds: 30000 },
    components: Array.from({ length: count }, (_, i) => ({ assetId: `weekly-${i}`, canonicalAssetId: `asset-${i}`,
      canonicalMediaId: `media-${i}`, sourceSha256: hash(`source-${i}`) })),
  };
}

class Statement {
  constructor(db, sql, values = []) { Object.assign(this, { db, sql, values }); }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values), success: true }; }
  async run() { return { success: true, meta: this.db.prepare(this.sql).run(...this.values) }; }
}

export class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    for (const file of ["0012_lifecycle_deny_plane.sql", "0013_lifecycle_manifest_reconciliation.sql", "0016_campaign_videos.sql"]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    this.sessions = [];
  }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession(value) { this.sessions.push(value); return this; }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

/** In-memory test double enforces atomic conditional writes and full-byte SHA. */
export class TestR2 {
  constructor() { this.objects = new Map(); this.puts = 0; this.gets = 0; this.heads = 0; }
  metadata(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    const { bytes, ...metadata } = object;
    return { ...metadata, httpMetadata: { ...metadata.httpMetadata }, customMetadata: { ...metadata.customMetadata } };
  }
  async head(key) { this.heads++; await this.onHead?.(key); return this.metadata(key); }
  async put(key, body, options) {
    this.puts++;
    await this.onPut?.();
    if (options.onlyIf.get("if-none-match") !== "*") throw new Error("conditional write required");
    if (this.objects.has(key)) return null;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (hash(bytes) !== options.sha256) throw new Error("SHA-256 mismatch");
    if (this.objects.has(key)) return null;
    const digest = createHash("sha256").update(bytes).digest();
    this.objects.set(key, { key, bytes, size: bytes.length, etag: hash(bytes), httpEtag: `"${hash(bytes)}"`,
      checksums: { sha256: digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) },
      uploaded: new Date("2026-09-27T10:00:00.000Z"), httpMetadata: options.httpMetadata, customMetadata: options.customMetadata });
    if (this.loseResponse) throw new Error("provider response lost after commit");
    return this.metadata(key);
  }
  async get(key, options = {}) {
    this.gets++;
    await this.onGet?.(key);
    const metadata = this.metadata(key);
    if (!metadata) return null;
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== metadata.etag) return metadata;
    const bytes = this.objects.get(key).bytes;
    const { offset = 0, length = bytes.length } = options.range || {};
    const response = new Response(bytes.slice(offset, offset + length));
    return { ...metadata, body: response.body };
  }
}

export function fixture(binding = declaration(), overrides = {}) {
  const database = new TestD1();
  const bucket = new TestR2();
  const catalog = { photos: new Map(binding.components.map(({ canonicalMediaId }) => [canonicalMediaId, { photo: {
    id: canonicalMediaId, media: { type: "photo", publicPreview: { allowed: true,
      galleryKey: `expo/${canonicalMediaId}_900.jpg`, detailKey: `expo/${canonicalMediaId}_1800.jpg` } },
  } }])) };
  const lifecycle = {
    denied: false, revision: 1,
    async verifyPublicPreviews({ items }) { return { schema: "photosbyelie.publicPreviewObservation.v1", readOnly: true,
      items: items.map((item) => ({ ...item, allowed: !this.denied })) }; },
    async assertAllowed(ids, context, expected) {
      if (this.denied) throw Object.assign(new Error("denied"), { status: 410, code: "asset_lifecycle_denied" });
      if (expected && expected.digest !== String(this.revision)) throw Object.assign(new Error("changed"), { status: 409, code: "lifecycle_fence_changed" });
      return { digest: String(this.revision) };
    },
  };
  const connectorAuth = createOwnerConnectorAuth({ credentials: { max: "test-connector-only" } });
  const catalogReader = { async read() { return { ...catalog, sha256: hash(JSON.stringify([...catalog.photos])), expiresAt: Date.now() + 30000 }; } };
  const dependencies = { database, bucket, catalog, catalogReader, lifecycle, connectorAuth, enabled: true,
    fixedLength: () => new TransformStream(), now: () => new Date("2026-09-27T10:01:00.000Z"), ...overrides };
  const host = createCampaignVideoHost(dependencies);
  const fetch = (url, init) => host.fetch(new Request(url, init));
  const reserve = (payload = binding, slugUrl = apiUrl) => fetch(slugUrl, {
    method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const upload = (receipt, bytes = videoBytes, headers = {}) => fetch(`${apiUrl}/content`, {
    method: "PUT", headers: { ...authHeaders, "content-type": "video/mp4", "content-length": String(binding.video.size),
      "x-pbe-binding-sha256": receipt.bindingSha256, "x-pbe-video-sha256": binding.video.sha256, ...headers }, body: bytes,
  });
  return { ...dependencies, fetch, reserve, upload };
}
