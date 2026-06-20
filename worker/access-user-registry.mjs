const SCHEMA = "photosbyelie.accessUser.v1";
const VALID_TIERS = new Set(["user", "re_client", "owner"]);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

const normalizeTier = (value) => {
  const tier = String(value || "user").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return VALID_TIERS.has(tier) ? tier : "user";
};

const normalizeGalleryKeys = (value) => {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
};

export const normalizeAccessUserRecord = (record = {}, fallbackEmail = "") => {
  const email = normalizeEmail(record.email || fallbackEmail);
  if (!validEmail(email)) return null;
  const tier = normalizeTier(record.tier);
  const realEstateClients = normalizeGalleryKeys(
    record.realEstateClients || record.realEstateGalleries || record.galleryKeys || record.galleryKey
  );
  return {
    schema: SCHEMA,
    email,
    tier,
    realEstateClients,
    grantedBy: String(record.grantedBy || "").trim(),
    grantedAt: record.grantedAt || null,
    updatedAt: record.updatedAt || null,
  };
};

export const createMemoryAccessUserRegistry = (initialRecords = []) => {
  const users = new Map();
  initialRecords
    .map((record) => normalizeAccessUserRecord(record))
    .filter(Boolean)
    .forEach((record) => users.set(record.email, record));

  return {
    getUser: async (email) => clone(users.get(normalizeEmail(email))) || null,
    putUser: async (record) => {
      const normalized = normalizeAccessUserRecord(record);
      if (!normalized) throw new Error("Access user record requires a valid email address.");
      users.set(normalized.email, clone(normalized));
      return clone(normalized);
    },
    _debug: { users },
  };
};

export const createKvAccessUserRegistry = ({
  namespace,
  prefix = "pbe",
} = {}) => {
  if (!namespace) throw new Error("createKvAccessUserRegistry requires a KV namespace binding.");
  const keyFor = (email) => `${prefix}:access-users:${normalizeEmail(email)}`;

  return {
    getUser: async (email) => {
      const normalizedEmail = normalizeEmail(email);
      if (!validEmail(normalizedEmail)) return null;
      const value = await namespace.get(keyFor(normalizedEmail), { type: "json" });
      return normalizeAccessUserRecord(value || {}, normalizedEmail);
    },
    putUser: async (record) => {
      const normalized = normalizeAccessUserRecord(record);
      if (!normalized) throw new Error("Access user record requires a valid email address.");
      await namespace.put(keyFor(normalized.email), JSON.stringify(normalized));
      return clone(normalized);
    },
  };
};
