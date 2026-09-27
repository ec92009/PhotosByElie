import { bindingDigest, canonicalJson, validateVideoBinding, videoError } from "./campaign-video-contract.mjs";

/** Private immutable declarations, never Owner/catalog mutations or R2 metadata blobs. */
export function createCampaignVideoStore(database) {
  if (!database?.prepare) throw videoError(503, "campaign_video_store_unavailable");
  // Every request begins at the primary, not a potentially stale replica.
  const db = database.withSession ? database.withSession("first-primary") : database;
  const read = async (slug) => {
    const row = await db.prepare("SELECT * FROM pbe_campaign_videos WHERE slug = ?").bind(slug).first();
    if (!row) return null;
    let binding;
    try { binding = validateVideoBinding(JSON.parse(row.binding_json)); }
    catch { throw videoError(503, "campaign_video_record_invalid"); }
    if (row.binding_sha256 !== await bindingDigest(binding) || row.queue_id !== binding.queueId
        || !row.actor_id || !Number.isFinite(Date.parse(row.created_at))) {
      throw videoError(503, "campaign_video_record_invalid");
    }
    return { slug, binding, bindingSha256: row.binding_sha256, createdAt: row.created_at };
  };
  return {
    read,
    async reserve(slug, binding, actorId, createdAt) {
      const digest = await bindingDigest(binding);
      await db.prepare(`INSERT INTO pbe_campaign_videos
        (slug, queue_id, binding_sha256, binding_json, actor_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(slug, binding.queueId, digest, canonicalJson(binding), actorId, createdAt).run();
      const record = await read(slug);
      if (!record || record.bindingSha256 !== digest) throw videoError(409, "campaign_video_binding_conflict");
      return record;
    },
  };
}
