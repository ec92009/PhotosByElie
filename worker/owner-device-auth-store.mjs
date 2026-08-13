const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const clean = (value) => String(value || "").trim();

const normalizeEmail = (value) => clean(value).toLowerCase();

const sha256Hex = async (value) => {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const randomSalt = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const credentialHash = async (credential, salt = "") =>
  sha256Hex(salt ? `${salt}\u0000${credential}` : credential);

const activeRecord = (record, now = () => new Date()) =>
  record
  && !record.revokedAt
  && (!record.expiresAt || Date.parse(record.expiresAt) > now().getTime());

export const createMemoryOwnerDeviceAuthStore = ({ now = () => new Date() } = {}) => {
  const devices = new Map();
  const pbeOwnerSessions = new Map();

  return {
    putDevice: async (device, credential) => {
      const id = clean(device?.id);
      const email = normalizeEmail(device?.email);
      if (!id || !email || !credential) throw new Error("Owner device requires id, email and credential.");
      const credentialSalt = randomSalt();
      const stored = {
        ...clone(device),
        id,
        email,
        credentialSalt,
        credentialHash: await credentialHash(credential, credentialSalt),
      };
      devices.set(id, stored);
      return clone(stored);
    },
    authenticateDevice: async ({ deviceId, credential }) => {
      const device = devices.get(clean(deviceId));
      if (!activeRecord(device, now)) return null;
      return device.credentialHash === await credentialHash(credential, device.credentialSalt) ? clone(device) : null;
    },
    getDevice: async (deviceId) => {
      const device = devices.get(clean(deviceId));
      return activeRecord(device, now) ? clone(device) : null;
    },
    listDevices: async (email) => [...devices.values()]
      .filter((device) => device.email === normalizeEmail(email))
      .map(clone),
    revokeDevice: async ({ email, deviceId, revokedAt }) => {
      const device = devices.get(clean(deviceId));
      if (!device || device.email !== normalizeEmail(email)) return null;
      const updated = { ...device, revokedAt: clean(revokedAt) || now().toISOString() };
      devices.set(updated.id, updated);
      return clone(updated);
    },
    putPBEOwnerSession: async (record) => {
      const id = clean(record?.id);
      if (!id || !clean(record?.deviceId) || !normalizeEmail(record?.email)) {
        throw new Error("PBE Owner session requires id, deviceId and email.");
      }
      const stored = { ...clone(record), id, deviceId: clean(record.deviceId), email: normalizeEmail(record.email) };
      pbeOwnerSessions.set(id, stored);
      return clone(stored);
    },
    getPBEOwnerSession: async (sessionId) => {
      const record = pbeOwnerSessions.get(clean(sessionId));
      return activeRecord(record, now) && !record.closedAt ? clone(record) : null;
    },
    closePBEOwnerSession: async ({ sessionId, deviceId, closedAt = now().toISOString() }) => {
      const id = clean(sessionId);
      const record = pbeOwnerSessions.get(id);
      if (!record || clean(record.deviceId) !== clean(deviceId)) return null;
      const updated = { ...record, closedAt: clean(closedAt) || now().toISOString() };
      pbeOwnerSessions.set(id, updated);
      return clone(updated);
    },
    _debug: { devices, pbeOwnerSessions },
  };
};

export const createKvOwnerDeviceAuthStore = ({
  namespace,
  prefix = "pbe",
  now = () => new Date(),
} = {}) => {
  if (!namespace) throw new Error("createKvOwnerDeviceAuthStore requires a KV namespace binding.");
  const devicePrefix = `${prefix}:owner-device:`;
  const deviceIndexPrefix = `${prefix}:owner-device-index:`;
  const pbeOwnerSessionPrefix = `${prefix}:pbe-owner-session:`;
  const deviceKey = (id) => `${devicePrefix}${clean(id)}`;
  const deviceIndexKey = async (email) => `${deviceIndexPrefix}${await sha256Hex(normalizeEmail(email))}`;
  const pbeOwnerSessionKey = (sessionId) => `${pbeOwnerSessionPrefix}${clean(sessionId)}`;

  const readDeviceIds = async (email) => {
    const index = await namespace.get(await deviceIndexKey(email), { type: "json" });
    return Array.isArray(index?.ids) ? index.ids.map(clean).filter(Boolean) : [];
  };

  return {
    putDevice: async (device, credential) => {
      const id = clean(device?.id);
      const email = normalizeEmail(device?.email);
      if (!id || !email || !credential) throw new Error("Owner device requires id, email and credential.");
      const credentialSalt = randomSalt();
      const stored = {
        ...clone(device),
        id,
        email,
        credentialSalt,
        credentialHash: await credentialHash(credential, credentialSalt),
      };
      await namespace.put(deviceKey(id), JSON.stringify(stored));
      const ids = await readDeviceIds(email);
      await namespace.put(await deviceIndexKey(email), JSON.stringify({
        ids: [id, ...ids.filter((item) => item !== id)].slice(0, 100),
      }));
      return clone(stored);
    },
    authenticateDevice: async ({ deviceId, credential }) => {
      const device = await namespace.get(deviceKey(deviceId), { type: "json" });
      if (!activeRecord(device, now)) return null;
      return device.credentialHash === await credentialHash(credential, device.credentialSalt) ? device : null;
    },
    getDevice: async (deviceId) => {
      const device = await namespace.get(deviceKey(deviceId), { type: "json" });
      return activeRecord(device, now) ? clone(device) : null;
    },
    listDevices: async (email) => {
      const devices = [];
      for (const id of await readDeviceIds(email)) {
        const device = await namespace.get(deviceKey(id), { type: "json" });
        if (device) devices.push(device);
      }
      return devices.map(clone);
    },
    revokeDevice: async ({ email, deviceId, revokedAt }) => {
      const device = await namespace.get(deviceKey(deviceId), { type: "json" });
      if (!device || normalizeEmail(device.email) !== normalizeEmail(email)) return null;
      const updated = { ...device, revokedAt: clean(revokedAt) || now().toISOString() };
      await namespace.put(deviceKey(deviceId), JSON.stringify(updated));
      return clone(updated);
    },
    putPBEOwnerSession: async (record) => {
      const id = clean(record?.id);
      const deviceId = clean(record?.deviceId);
      const email = normalizeEmail(record?.email);
      if (!id || !deviceId || !email) throw new Error("PBE Owner session requires id, deviceId and email.");
      const expiresAt = Date.parse(record.expiresAt || "");
      const expirationTtl = Number.isFinite(expiresAt)
        ? Math.max(60, Math.ceil((expiresAt - now().getTime()) / 1000))
        : 15 * 60;
      const stored = { ...clone(record), id, deviceId, email };
      await namespace.put(pbeOwnerSessionKey(id), JSON.stringify(stored), { expirationTtl });
      return clone(stored);
    },
    getPBEOwnerSession: async (sessionId) => {
      const record = await namespace.get(pbeOwnerSessionKey(sessionId), { type: "json" });
      return activeRecord(record, now) && !record.closedAt ? clone(record) : null;
    },
    closePBEOwnerSession: async ({ sessionId, deviceId, closedAt = now().toISOString() }) => {
      const key = pbeOwnerSessionKey(sessionId);
      const record = await namespace.get(key, { type: "json" });
      if (!record || clean(record.deviceId) !== clean(deviceId)) return null;
      const updated = { ...record, closedAt: clean(closedAt) || now().toISOString() };
      await namespace.put(key, JSON.stringify(updated), { expirationTtl: 24 * 60 * 60 });
      return clone(updated);
    },
  };
};
