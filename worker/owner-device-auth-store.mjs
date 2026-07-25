const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const clean = (value) => String(value || "").trim();

const normalizeEmail = (value) => clean(value).toLowerCase();

const sha256Hex = async (value) => {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const activeRecord = (record, now = () => new Date()) =>
  record
  && !record.revokedAt
  && (!record.expiresAt || Date.parse(record.expiresAt) > now().getTime());

export const createMemoryOwnerDeviceAuthStore = ({ now = () => new Date() } = {}) => {
  const devices = new Map();
  const refreshTokens = new Map();

  return {
    putDevice: async (device, credential) => {
      const id = clean(device?.id);
      const email = normalizeEmail(device?.email);
      if (!id || !email || !credential) throw new Error("Owner device requires id, email and credential.");
      const stored = { ...clone(device), id, email, credentialHash: await sha256Hex(credential) };
      devices.set(id, stored);
      return clone(stored);
    },
    authenticateDevice: async ({ deviceId, credential }) => {
      const device = devices.get(clean(deviceId));
      if (!activeRecord(device, now)) return null;
      return device.credentialHash === await sha256Hex(credential) ? clone(device) : null;
    },
    listDevices: async (email) => [...devices.values()]
      .filter((device) => device.email === normalizeEmail(email))
      .map(clone),
    revokeDevice: async ({ email, deviceId, revokedAt }) => {
      const device = devices.get(clean(deviceId));
      if (!device || device.email !== normalizeEmail(email)) return null;
      const updated = { ...device, revokedAt: clean(revokedAt) || now().toISOString() };
      devices.set(updated.id, updated);
      for (const [tokenHash, token] of refreshTokens.entries()) {
        if (token.deviceId === updated.id && !token.revokedAt) {
          refreshTokens.set(tokenHash, { ...token, revokedAt: updated.revokedAt });
        }
      }
      return clone(updated);
    },
    putRefreshToken: async (record, token) => {
      if (!token || !normalizeEmail(record?.email)) throw new Error("Owner refresh token requires token and email.");
      const stored = { ...clone(record), email: normalizeEmail(record.email) };
      refreshTokens.set(await sha256Hex(token), stored);
      return clone(stored);
    },
    getRefreshToken: async (token) => {
      const record = refreshTokens.get(await sha256Hex(token));
      return activeRecord(record, now) ? clone(record) : null;
    },
    revokeRefreshToken: async (token, revokedAt = now().toISOString()) => {
      const tokenHash = await sha256Hex(token);
      const record = refreshTokens.get(tokenHash);
      if (!record) return null;
      const updated = { ...record, revokedAt };
      refreshTokens.set(tokenHash, updated);
      return clone(updated);
    },
    _debug: { devices, refreshTokens },
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
  const refreshPrefix = `${prefix}:owner-refresh:`;
  const deviceRefreshIndexPrefix = `${prefix}:owner-device-refresh-index:`;
  const deviceKey = (id) => `${devicePrefix}${clean(id)}`;
  const deviceIndexKey = async (email) => `${deviceIndexPrefix}${await sha256Hex(normalizeEmail(email))}`;
  const refreshKey = async (token) => `${refreshPrefix}${await sha256Hex(token)}`;
  const deviceRefreshIndexKey = (deviceId) => `${deviceRefreshIndexPrefix}${clean(deviceId)}`;

  const readDeviceIds = async (email) => {
    const index = await namespace.get(await deviceIndexKey(email), { type: "json" });
    return Array.isArray(index?.ids) ? index.ids.map(clean).filter(Boolean) : [];
  };

  return {
    putDevice: async (device, credential) => {
      const id = clean(device?.id);
      const email = normalizeEmail(device?.email);
      if (!id || !email || !credential) throw new Error("Owner device requires id, email and credential.");
      const stored = { ...clone(device), id, email, credentialHash: await sha256Hex(credential) };
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
      return device.credentialHash === await sha256Hex(credential) ? device : null;
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
      const refreshIndex = await namespace.get(deviceRefreshIndexKey(deviceId), { type: "json" });
      for (const key of Array.isArray(refreshIndex?.keys) ? refreshIndex.keys : []) {
        const record = await namespace.get(key, { type: "json" });
        if (record && !record.revokedAt) {
          await namespace.put(key, JSON.stringify({ ...record, revokedAt: updated.revokedAt }), {
            expirationTtl: 24 * 60 * 60,
          });
        }
      }
      return clone(updated);
    },
    putRefreshToken: async (record, token) => {
      if (!token || !normalizeEmail(record?.email)) throw new Error("Owner refresh token requires token and email.");
      const expiresAt = Date.parse(record.expiresAt || "");
      const expirationTtl = Number.isFinite(expiresAt)
        ? Math.max(60, Math.ceil((expiresAt - now().getTime()) / 1000))
        : 30 * 24 * 60 * 60;
      const stored = { ...clone(record), email: normalizeEmail(record.email) };
      const key = await refreshKey(token);
      await namespace.put(key, JSON.stringify(stored), { expirationTtl });
      if (stored.deviceId) {
        const indexKey = deviceRefreshIndexKey(stored.deviceId);
        const index = await namespace.get(indexKey, { type: "json" });
        const keys = Array.isArray(index?.keys) ? index.keys : [];
        await namespace.put(indexKey, JSON.stringify({
          keys: [key, ...keys.filter((item) => item !== key)].slice(0, 100),
        }), { expirationTtl });
      }
      return clone(stored);
    },
    getRefreshToken: async (token) => {
      const record = await namespace.get(await refreshKey(token), { type: "json" });
      return activeRecord(record, now) ? record : null;
    },
    revokeRefreshToken: async (token, revokedAt = now().toISOString()) => {
      const key = await refreshKey(token);
      const record = await namespace.get(key, { type: "json" });
      if (!record) return null;
      const updated = { ...record, revokedAt };
      await namespace.put(key, JSON.stringify(updated), { expirationTtl: 24 * 60 * 60 });
      return clone(updated);
    },
  };
};
