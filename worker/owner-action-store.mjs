const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const cleanId = (value) => String(value || "").trim();

const sha256Hex = async (value) => {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const actionTime = (action) => {
  const timestamp = Date.parse(action?.createdAt || action?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const byNewestAction = (left, right) => actionTime(right) - actionTime(left);

const isPendingAction = (action) => ["queued", "claimed"].includes(String(action?.state || ""));

export const createMemoryOwnerActionStore = () => {
  const actions = new Map();
  const connectors = new Map();
  const idempotency = new Map();
  const interactiveLeases = new Map();

  return {
    putAction: async (action) => {
      if (!cleanId(action?.id)) throw new Error("Owner action requires an id.");
      actions.set(action.id, clone(action));
      return clone(action);
    },
    getAction: async (id) => clone(actions.get(cleanId(id))) || null,
    getIdempotentAction: async (key) => {
      const actionId = idempotency.get(await sha256Hex(key));
      return actionId ? clone(actions.get(actionId)) || null : null;
    },
    putIdempotentAction: async (key, actionId) => {
      const cleanActionId = cleanId(actionId);
      if (!cleanActionId) throw new Error("Idempotent Owner action requires an action id.");
      idempotency.set(await sha256Hex(key), cleanActionId);
      return clone(actions.get(cleanActionId)) || null;
    },
    listActions: async ({ limit = 25 } = {}) => [...actions.values()]
      .map(clone)
      .sort(byNewestAction)
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 25))),
    listPendingActions: async ({ limit = 100 } = {}) => [...actions.values()]
      .filter(isPendingAction)
      .map(clone)
      .sort(byNewestAction)
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 100))),
    putConnector: async (connector) => {
      if (!cleanId(connector?.id)) throw new Error("Owner connector requires an id.");
      connectors.set(connector.id, clone(connector));
      return clone(connector);
    },
    listConnectors: async () => [...connectors.values()].map(clone).sort((left, right) =>
      String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || ""))
    ),
    putInteractiveLease: async (connectorId, lease) => {
      const id = cleanId(connectorId);
      if (!id) throw new Error("Interactive Owner lease requires a connector id.");
      interactiveLeases.set(id, clone(lease));
      return clone(lease);
    },
    getInteractiveLease: async (connectorId) => clone(interactiveLeases.get(cleanId(connectorId))) || null,
    _debug: { actions, connectors, idempotency, interactiveLeases },
  };
};

export const createKvOwnerActionStore = ({
  namespace,
  prefix = "pbe",
  connectorHeartbeatWriteIntervalSeconds = 5 * 60,
  interactiveLeaseMinimumRemainingSeconds = 2 * 60,
  interactiveLeaseTtlSeconds = 10 * 60,
} = {}) => {
  if (!namespace) throw new Error("createKvOwnerActionStore requires a KV namespace binding.");
  const actionPrefix = `${prefix}:owner-actions:`;
  const indexPrefix = `${prefix}:owner-action-index:`;
  const headKey = `${prefix}:owner-action-head`;
  const pendingIndexPrefix = `${prefix}:owner-action-pending:`;
  const pendingIndexReadyKey = `${prefix}:owner-action-pending-ready`;
  const connectorPrefix = `${prefix}:owner-connectors:`;
  const connectorHeadKey = `${prefix}:owner-connector-head`;
  const idempotencyPrefix = `${prefix}:owner-action-idempotency:`;
  const interactiveLeasePrefix = `${prefix}:owner-interactive:`;
  const keyFor = (id) => `${actionPrefix}${cleanId(id)}`;
  const indexKeyFor = (action) => {
    const timestamp = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, actionTime(action)));
    const reverseTime = String(Number.MAX_SAFE_INTEGER - timestamp).padStart(16, "0");
    return `${indexPrefix}${reverseTime}:${cleanId(action?.id)}`;
  };
  const idFromIndexKey = (name) => String(name || "").slice(indexPrefix.length).split(":").pop() || "";
  const readHeadIds = async () => {
    const head = await namespace.get(headKey, { type: "json" });
    if (Array.isArray(head?.ids)) return head.ids.map(cleanId).filter(Boolean);
    if (Array.isArray(head)) return head.map(cleanId).filter(Boolean);
    return [];
  };
  const pendingKeyFor = (id) => `${pendingIndexPrefix}${cleanId(id)}`;
  const connectorFingerprint = (connector = {}) => JSON.stringify({
    state: String(connector.state || ""),
    hostname: String(connector.hostname || ""),
    platform: String(connector.platform || ""),
    version: String(connector.version || ""),
    capabilities: Array.isArray(connector.capabilities) ? connector.capabilities.map(String) : [],
  });

  return {
    putAction: async (action) => {
      if (!cleanId(action?.id)) throw new Error("Owner action requires an id.");
      await namespace.put(keyFor(action.id), JSON.stringify(action));
      await namespace.put(indexKeyFor(action), JSON.stringify({ id: cleanId(action.id) }));
      const headIds = await readHeadIds();
      const nextHeadIds = [cleanId(action.id), ...headIds.filter((id) => id !== cleanId(action.id))].slice(0, 100);
      await namespace.put(headKey, JSON.stringify({ ids: nextHeadIds }));
      if (isPendingAction(action)) {
        await namespace.put(pendingKeyFor(action.id), JSON.stringify({ id: cleanId(action.id) }));
      } else if (typeof namespace.delete === "function") {
        await namespace.delete(pendingKeyFor(action.id));
      }
      return clone(action);
    },
    getAction: async (id) => {
      const clean = cleanId(id);
      if (!clean) return null;
      return await namespace.get(keyFor(clean), { type: "json" });
    },
    getIdempotentAction: async (key) => {
      const mappingKey = `${idempotencyPrefix}${await sha256Hex(key)}`;
      const mapping = await namespace.get(mappingKey, { type: "json" });
      const actionId = cleanId(mapping?.actionId);
      if (!actionId) return null;
      const action = await namespace.get(keyFor(actionId), { type: "json" });
      if (!action && typeof namespace.delete === "function") {
        await namespace.delete(mappingKey);
      }
      return action || null;
    },
    putIdempotentAction: async (key, actionId, { expirationTtl = 24 * 60 * 60 } = {}) => {
      const cleanActionId = cleanId(actionId);
      if (!cleanActionId) throw new Error("Idempotent Owner action requires an action id.");
      await namespace.put(
        `${idempotencyPrefix}${await sha256Hex(key)}`,
        JSON.stringify({ actionId: cleanActionId }),
        { expirationTtl: Math.max(60, Number(expirationTtl) || 24 * 60 * 60) }
      );
      return await namespace.get(keyFor(cleanActionId), { type: "json" });
    },
    listActions: async ({ limit = 25 } = {}) => {
      if (typeof namespace.list !== "function") return [];
      const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 25));
      const actionsById = new Map();
      const addAction = async (id) => {
        const clean = cleanId(id);
        if (!clean || actionsById.has(clean)) return;
        const action = await namespace.get(keyFor(clean), { type: "json" });
        if (action) actionsById.set(clean, action);
      };

      for (const id of await readHeadIds()) {
        await addAction(id);
      }

      const indexPage = await namespace.list({ prefix: indexPrefix, limit: Math.min(1000, boundedLimit * 4) });
      for (const key of indexPage.keys || []) {
        await addAction(idFromIndexKey(key.name));
      }

      const fallbackPage = await namespace.list({ prefix: actionPrefix, limit: Math.min(1000, boundedLimit * 8) });
      for (const key of fallbackPage.keys || []) {
        await addAction(String(key.name || "").slice(actionPrefix.length));
      }

      return [...actionsById.values()].sort(byNewestAction).slice(0, boundedLimit).map(clone);
    },
    listPendingActions: async ({ limit = 100 } = {}) => {
      const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
      const pendingIndexReady = await namespace.get(pendingIndexReadyKey);
      if (!pendingIndexReady) {
        const legacyActions = await createKvOwnerActionStore({ namespace, prefix }).listActions({ limit: 100 });
        const pendingActions = legacyActions.filter(isPendingAction).slice(0, 100);
        for (const action of pendingActions) {
          await namespace.put(pendingKeyFor(action.id), JSON.stringify({ id: cleanId(action.id) }));
        }
        await namespace.put(pendingIndexReadyKey, "1");
        return pendingActions.slice(0, boundedLimit).map(clone);
      }
      const page = await namespace.list({ prefix: pendingIndexPrefix, limit: 100 });
      const pendingActions = [];
      for (const key of page.keys || []) {
        const id = String(key.name || "").slice(pendingIndexPrefix.length);
        const action = await namespace.get(keyFor(id), { type: "json" });
        if (action && isPendingAction(action)) {
          pendingActions.push(action);
        } else if (typeof namespace.delete === "function") {
          await namespace.delete(pendingKeyFor(id));
        }
      }
      return pendingActions.sort(byNewestAction).slice(0, boundedLimit).map(clone);
    },
    putConnector: async (connector) => {
      const id = cleanId(connector?.id);
      if (!id) throw new Error("Owner connector requires an id.");
      const connectorKey = `${connectorPrefix}${id}`;
      const current = await namespace.get(connectorKey, { type: "json" });
      const currentAt = Date.parse(current?.lastSeenAt || "");
      const nextAt = Date.parse(connector?.lastSeenAt || "");
      const minimumGapMs = Math.max(0, Number(connectorHeartbeatWriteIntervalSeconds) || 0) * 1000;
      const unchanged = current && connectorFingerprint(current) === connectorFingerprint(connector);
      const heartbeatIsFresh = unchanged
        && Number.isFinite(currentAt)
        && Number.isFinite(nextAt)
        && nextAt >= currentAt
        && nextAt - currentAt < minimumGapMs;
      if (heartbeatIsFresh) return clone(connector);

      await namespace.put(connectorKey, JSON.stringify(connector), { expirationTtl: 24 * 60 * 60 });
      const head = await namespace.get(connectorHeadKey, { type: "json" });
      const ids = Array.isArray(head?.ids) ? head.ids.map(cleanId).filter(Boolean) : [];
      const nextIds = [id, ...ids.filter((item) => item !== id)].slice(0, 25);
      if (JSON.stringify(ids) !== JSON.stringify(nextIds)) {
        await namespace.put(connectorHeadKey, JSON.stringify({ ids: nextIds }));
      }
      return clone(connector);
    },
    listConnectors: async () => {
      const head = await namespace.get(connectorHeadKey, { type: "json" });
      const ids = Array.isArray(head?.ids) ? head.ids.map(cleanId).filter(Boolean) : [];
      const connectors = [];
      for (const id of ids) {
        const connector = await namespace.get(`${connectorPrefix}${id}`, { type: "json" });
        if (connector) connectors.push(connector);
      }
      return connectors.sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || ""))).map(clone);
    },
    putInteractiveLease: async (connectorId, lease) => {
      const id = cleanId(connectorId);
      if (!id) throw new Error("Interactive Owner lease requires a connector id.");
      const leaseKey = `${interactiveLeasePrefix}${id}`;
      const current = await namespace.get(leaseKey, { type: "json" });
      const currentUntil = Date.parse(current?.activeUntil || "");
      const nextAt = Date.parse(lease?.updatedAt || "");
      const minimumRemainingMs = Math.max(0, Number(interactiveLeaseMinimumRemainingSeconds) || 0) * 1000;
      const sameSurface = current && String(current.surface || "") === String(lease?.surface || "");
      if (sameSurface && Number.isFinite(currentUntil) && Number.isFinite(nextAt) && currentUntil - nextAt > minimumRemainingMs) {
        return clone(lease);
      }
      await namespace.put(leaseKey, JSON.stringify(lease), {
        expirationTtl: Math.max(60, Number(interactiveLeaseTtlSeconds) || 10 * 60),
      });
      return clone(lease);
    },
    getInteractiveLease: async (connectorId) => {
      const id = cleanId(connectorId);
      if (!id) return null;
      return await namespace.get(`${interactiveLeasePrefix}${id}`, { type: "json" });
    },
  };
};
