const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const cleanId = (value) => String(value || "").trim();

export const createMemoryOwnerActionStore = () => {
  const actions = new Map();

  return {
    putAction: async (action) => {
      if (!cleanId(action?.id)) throw new Error("Owner action requires an id.");
      actions.set(action.id, clone(action));
      return clone(action);
    },
    getAction: async (id) => clone(actions.get(cleanId(id))) || null,
    _debug: { actions },
  };
};

export const createKvOwnerActionStore = ({
  namespace,
  prefix = "pbe",
} = {}) => {
  if (!namespace) throw new Error("createKvOwnerActionStore requires a KV namespace binding.");
  const keyFor = (id) => `${prefix}:owner-actions:${cleanId(id)}`;

  return {
    putAction: async (action) => {
      if (!cleanId(action?.id)) throw new Error("Owner action requires an id.");
      await namespace.put(keyFor(action.id), JSON.stringify(action));
      return clone(action);
    },
    getAction: async (id) => {
      const clean = cleanId(id);
      if (!clean) return null;
      return await namespace.get(keyFor(clean), { type: "json" });
    },
  };
};
