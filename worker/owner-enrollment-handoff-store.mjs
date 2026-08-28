const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const clean = (value, limit = 256) => String(value || "").trim().slice(0, limit);

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const active = (record, now) => record && Date.parse(record.expiresAt || "") > now().getTime();

const publicRecord = (record) => record ? {
  id: record.id,
  binding: record.binding,
  name: record.name,
  platform: record.platform,
  state: record.state,
  email: record.email || "",
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  authorizedAt: record.authorizedAt || "",
  claimedAt: record.claimedAt || "",
  cancelledAt: record.cancelledAt || "",
} : null;

const normalizeInput = async (record, claimSecret) => {
  const normalized = {
    id: clean(record?.id, 96),
    binding: clean(record?.binding, 128),
    name: clean(record?.name, 120) || "PhotosByElie Backstage",
    platform: clean(record?.platform, 80) || "macOS",
    state: "pending",
    email: "",
    createdAt: clean(record?.createdAt, 80),
    expiresAt: clean(record?.expiresAt, 80),
    authorizedAt: "",
    claimedAt: "",
    cancelledAt: "",
    claimHash: await sha256Hex(claimSecret),
  };
  if (!normalized.id || !normalized.binding || !normalized.createdAt || !normalized.expiresAt || !claimSecret) {
    throw new Error("Owner enrollment handoff requires id, binding, timestamps and a claim secret.");
  }
  return normalized;
};

export const createMemoryOwnerEnrollmentHandoffStore = ({ now = () => new Date() } = {}) => {
  const handoffs = new Map();
  return {
    create: async (record, claimSecret) => {
      const stored = await normalizeInput(record, claimSecret);
      handoffs.set(stored.id, stored);
      return publicRecord(stored);
    },
    get: async (id) => publicRecord(handoffs.get(clean(id, 96))),
    authorize: async ({ id, email, authorizedAt }) => {
      const current = handoffs.get(clean(id, 96));
      if (!active(current, now) || current.state !== "pending") return null;
      const updated = { ...current, state: "authorized", email: clean(email, 320).toLowerCase(), authorizedAt: clean(authorizedAt, 80) };
      handoffs.set(updated.id, updated);
      return publicRecord(updated);
    },
    claim: async ({ id, binding, claimSecret, claimedAt }) => {
      const current = handoffs.get(clean(id, 96));
      if (!active(current, now)) return { outcome: "expired", handoff: publicRecord(current) };
      if (current.binding !== clean(binding, 128) || current.claimHash !== await sha256Hex(claimSecret)) {
        return { outcome: "rejected", handoff: null };
      }
      if (current.state === "pending") return { outcome: "pending", handoff: publicRecord(current) };
      if (current.state !== "authorized") return { outcome: current.state, handoff: publicRecord(current) };
      const updated = { ...current, state: "claimed", claimedAt: clean(claimedAt, 80) };
      handoffs.set(updated.id, updated);
      return { outcome: "accepted", handoff: publicRecord(updated) };
    },
    cancel: async ({ id, binding, claimSecret, cancelledAt }) => {
      const current = handoffs.get(clean(id, 96));
      if (!active(current, now)) return null;
      if (current.binding !== clean(binding, 128) || current.claimHash !== await sha256Hex(claimSecret)) return null;
      if (!["pending", "authorized"].includes(current.state)) return null;
      const updated = { ...current, state: "cancelled", cancelledAt: clean(cancelledAt, 80) };
      handoffs.set(updated.id, updated);
      return publicRecord(updated);
    },
    _debug: { handoffs },
  };
};

export const createD1OwnerEnrollmentHandoffStore = ({ database, now = () => new Date() } = {}) => {
  if (!database) throw new Error("createD1OwnerEnrollmentHandoffStore requires a D1 database binding.");
  const assertReady = () => database
    .prepare("SELECT 1 FROM pbe_owner_enrollment_handoffs LIMIT 1")
    .first();
  const fromRow = (row) => row ? {
    id: row.id,
    binding: row.binding,
    name: row.name,
    platform: row.platform,
    state: row.state,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    authorizedAt: row.authorized_at,
    claimedAt: row.claimed_at,
    cancelledAt: row.cancelled_at,
  } : null;
  const rowFor = async (id) => {
    await assertReady();
    return database.prepare("SELECT * FROM pbe_owner_enrollment_handoffs WHERE id = ?").bind(clean(id, 96)).first();
  };
  return {
    create: async (record, claimSecret) => {
      await assertReady();
      const stored = await normalizeInput(record, claimSecret);
      await database.prepare(`
        INSERT INTO pbe_owner_enrollment_handoffs (
          id, binding, name, platform, state, email, claim_hash, created_at, expires_at,
          authorized_at, claimed_at, cancelled_at
        ) VALUES (?, ?, ?, ?, 'pending', '', ?, ?, ?, '', '', '')
      `).bind(stored.id, stored.binding, stored.name, stored.platform, stored.claimHash, stored.createdAt, stored.expiresAt).run();
      return publicRecord(stored);
    },
    get: async (id) => fromRow(await rowFor(id)),
    authorize: async ({ id, email, authorizedAt }) => {
      await assertReady();
      const timestamp = clean(authorizedAt, 80) || now().toISOString();
      await database.prepare(`
        UPDATE pbe_owner_enrollment_handoffs
        SET state = 'authorized', email = ?, authorized_at = ?
        WHERE id = ? AND state = 'pending' AND expires_at > ?
      `).bind(clean(email, 320).toLowerCase(), timestamp, clean(id, 96), now().toISOString()).run();
      const row = await rowFor(id);
      return row?.state === "authorized" ? fromRow(row) : null;
    },
    claim: async ({ id, binding, claimSecret, claimedAt }) => {
      await assertReady();
      const key = clean(id, 96);
      const timestamp = clean(claimedAt, 80) || now().toISOString();
      const hash = await sha256Hex(claimSecret);
      const before = await rowFor(key);
      if (!before || Date.parse(before.expires_at || "") <= now().getTime()) return { outcome: "expired", handoff: fromRow(before) };
      if (before.binding !== clean(binding, 128) || before.claim_hash !== hash) return { outcome: "rejected", handoff: null };
      if (before.state === "pending") return { outcome: "pending", handoff: fromRow(before) };
      if (before.state !== "authorized") return { outcome: before.state, handoff: fromRow(before) };
      const result = await database.prepare(`
        UPDATE pbe_owner_enrollment_handoffs
        SET state = 'claimed', claimed_at = ?
        WHERE id = ? AND state = 'authorized' AND binding = ? AND claim_hash = ? AND expires_at > ?
      `).bind(timestamp, key, clean(binding, 128), hash, now().toISOString()).run();
      if (Number(result?.meta?.changes || 0) !== 1) {
        const after = await rowFor(key);
        return { outcome: after?.state || "rejected", handoff: fromRow(after) };
      }
      return { outcome: "accepted", handoff: fromRow(await rowFor(key)) };
    },
    cancel: async ({ id, binding, claimSecret, cancelledAt }) => {
      await assertReady();
      const hash = await sha256Hex(claimSecret);
      const result = await database.prepare(`
        UPDATE pbe_owner_enrollment_handoffs
        SET state = 'cancelled', cancelled_at = ?
        WHERE id = ? AND binding = ? AND claim_hash = ?
          AND state IN ('pending', 'authorized') AND expires_at > ?
      `).bind(clean(cancelledAt, 80) || now().toISOString(), clean(id, 96), clean(binding, 128), hash, now().toISOString()).run();
      return Number(result?.meta?.changes || 0) === 1 ? fromRow(await rowFor(id)) : null;
    },
    ensureSchema: assertReady,
  };
};
