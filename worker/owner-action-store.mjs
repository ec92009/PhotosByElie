const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const cleanId = (value) => String(value || "").trim();

const actionTime = (action) => {
  const timestamp = Date.parse(action?.createdAt || action?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const byNewestAction = (left, right) => actionTime(right) - actionTime(left);

export const createMemoryOwnerActionStore = () => {
  const actions = new Map();

  return {
    putAction: async (action) => {
      if (!cleanId(action?.id)) throw new Error("Owner action requires an id.");
      actions.set(action.id, clone(action));
      return clone(action);
    },
    getAction: async (id) => clone(actions.get(cleanId(id))) || null,
    listActions: async ({ limit = 25 } = {}) => [...actions.values()]
      .map(clone)
      .sort(byNewestAction)
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 25))),
    _debug: { actions },
  };
};

export const createKvOwnerActionStore = ({
  namespace,
  prefix = "pbe",
} = {}) => {
  if (!namespace) throw new Error("createKvOwnerActionStore requires a KV namespace binding.");
  const actionPrefix = `${prefix}:owner-actions:`;
  const indexPrefix = `${prefix}:owner-action-index:`;
  const headKey = `${prefix}:owner-action-head`;
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

  return {
    putAction: async (action) => {
      if (!cleanId(action?.id)) throw new Error("Owner action requires an id.");
      await namespace.put(keyFor(action.id), JSON.stringify(action));
      await namespace.put(indexKeyFor(action), JSON.stringify({ id: cleanId(action.id) }));
      const headIds = await readHeadIds();
      const nextHeadIds = [cleanId(action.id), ...headIds.filter((id) => id !== cleanId(action.id))].slice(0, 100);
      await namespace.put(headKey, JSON.stringify({ ids: nextHeadIds }));
      return clone(action);
    },
    getAction: async (id) => {
      const clean = cleanId(id);
      if (!clean) return null;
      return await namespace.get(keyFor(clean), { type: "json" });
    },
    listActions: async ({ limit = 25 } = {}) => {
      if (typeof namespace.list !== "function") return [];
      const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 25));
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
  };
};
