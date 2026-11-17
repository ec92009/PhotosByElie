/** A primary-read publication fence, not an approval source or catalog copy. */
export const AUTHORITY_SCHEMA = "photosbyelie.publicCatalogAuthority.v1";
export const TRANSITION_SCHEMA = "photosbyelie.publicCatalogTransition.v1";
const HASH = /^[a-f0-9]{64}$/;
const PHASES = new Set(["prepare", "commit"]);
export const authorityError = (status, code) => Object.assign(new Error(code), { status, code });
const unavailable = () => authorityError(503, "public_catalog_authority_unavailable");
const conflict = () => authorityError(409, "public_catalog_authority_conflict");
const integer = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;

export async function catalogOperationId(revision, sha256) {
  const bytes = new TextEncoder().encode(`public-catalog\n${revision}\n${sha256}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Strict wire contract; neither a URL nor arbitrary metadata can be submitted. */
export async function validateCatalogTransition(value) {
  const keys = ["schema", "phase", "operationId", "expectedGeneration", "projectionRevision", "sha256"];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
      || value.schema !== TRANSITION_SCHEMA || !PHASES.has(value.phase)
      || !integer(value.expectedGeneration, value.phase === "commit" ? 1 : 0)
      || !integer(value.projectionRevision, 1) || typeof value.sha256 !== "string" || !HASH.test(value.sha256)
      || typeof value.operationId !== "string" || !HASH.test(value.operationId)
      || value.operationId !== await catalogOperationId(value.projectionRevision, value.sha256)) {
    throw authorityError(400, "public_catalog_transition_invalid");
  }
  return value;
}

async function validateRow(row) {
  if (!row) return null;
  if (!integer(row.generation, 1) || !integer(row.projection_revision, 1)
      || !["pending", "verified"].includes(row.state) || typeof row.operation_id !== "string" || !HASH.test(row.operation_id)
      || typeof row.catalog_sha256 !== "string" || !HASH.test(row.catalog_sha256)
      || typeof row.publisher_id !== "string" || !row.publisher_id
      || !Number.isFinite(Date.parse(row.updated_at))
      || row.operation_id !== await catalogOperationId(row.projection_revision, row.catalog_sha256)) throw unavailable();
  return { generation: row.generation, state: row.state, operationId: row.operation_id,
    projectionRevision: row.projection_revision, sha256: row.catalog_sha256,
    publisherId: row.publisher_id, updatedAt: row.updated_at };
}

/** Every read opens first-primary: an older session/replica cannot hide a new fence. */
export function createPublicCatalogAuthority(database, { now = () => new Date() } = {}) {
  const primary = () => {
    if (!database?.prepare) throw unavailable();
    return database.withSession ? database.withSession("first-primary") : database;
  };
  const read = async () => {
    try {
      return await validateRow(await primary().prepare(
        "SELECT * FROM pbe_public_catalog_authority WHERE authority_id = 'public-catalog'",
      ).first());
    } catch { throw unavailable(); }
  };
  const same = (record, value, publisherId) => record?.operationId === value.operationId
    && record.projectionRevision === value.projectionRevision && record.sha256 === value.sha256
    && record.publisherId === publisherId;
  const assertPublisher = (record, publisherId) => {
    if (typeof publisherId !== "string" || !publisherId || (record && record.publisherId !== publisherId)) {
      throw authorityError(403, "public_catalog_publisher_mismatch");
    }
  };
  const receipt = (record) => ({ schema: AUTHORITY_SCHEMA, ok: true, ...record, checkedAt: now().toISOString() });

  return {
    read,
    receipt,
    async prepare(value, publisherId) {
      await validateCatalogTransition(value);
      if (value.phase !== "prepare") throw conflict();
      const current = await read();
      assertPublisher(current, publisherId);
      if (same(current, value, publisherId)
          && [current.generation, current.generation - 1].includes(value.expectedGeneration)) return current;
      if (current ? current.state !== "verified" || current.generation !== value.expectedGeneration
        || value.projectionRevision <= current.projectionRevision : value.expectedGeneration !== 0) throw conflict();
      if (!integer(value.expectedGeneration + 1, 1)) throw conflict();
      const timestamp = now().toISOString();
      try {
        if (current) {
          await primary().prepare(`UPDATE pbe_public_catalog_authority SET generation = ?, state = 'pending',
            operation_id = ?, projection_revision = ?, catalog_sha256 = ?, updated_at = ?
            WHERE authority_id = 'public-catalog' AND generation = ? AND state = 'verified' AND publisher_id = ?`)
            .bind(current.generation + 1, value.operationId, value.projectionRevision, value.sha256, timestamp,
              current.generation, publisherId).run();
        } else {
          await primary().prepare(`INSERT INTO pbe_public_catalog_authority
            (authority_id, generation, state, operation_id, projection_revision, catalog_sha256, publisher_id, updated_at)
            VALUES ('public-catalog', 1, 'pending', ?, ?, ?, ?, ?) ON CONFLICT(authority_id) DO NOTHING`)
            .bind(value.operationId, value.projectionRevision, value.sha256, publisherId, timestamp).run();
        }
      } catch { throw unavailable(); }
      const recorded = await read();
      if (!same(recorded, value, publisherId) || recorded.generation !== value.expectedGeneration + 1) throw conflict();
      return recorded;
    },
    async commit(value, publisherId, verifyPublished) {
      await validateCatalogTransition(value);
      if (value.phase !== "commit") throw conflict();
      const current = await read();
      assertPublisher(current, publisherId);
      if (!same(current, value, publisherId) || current.generation !== value.expectedGeneration) throw conflict();
      // Replays still check public parity; connectivity is never inferred from a durable receipt.
      await verifyPublished(current.sha256);
      const fresh = await read();
      if (!same(fresh, value, publisherId) || fresh.generation !== current.generation) throw conflict();
      if (fresh.state === "verified") return fresh;
      try {
        await primary().prepare(`UPDATE pbe_public_catalog_authority SET state = 'verified', updated_at = ?
          WHERE authority_id = 'public-catalog' AND generation = ? AND state = 'pending'
          AND operation_id = ? AND catalog_sha256 = ? AND publisher_id = ?`)
          .bind(now().toISOString(), current.generation, value.operationId, value.sha256, publisherId).run();
      } catch { throw unavailable(); }
      const result = await read();
      if (!same(result, value, publisherId) || result.generation !== current.generation || result.state !== "verified") throw conflict();
      return result;
    },
  };
}
