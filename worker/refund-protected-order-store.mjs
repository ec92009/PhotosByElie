const protectedStore = Symbol("refund-protected-order-store");
export const refundAuthorityUnavailable = () => Object.assign(new Error("Paid refund settlement authority is unavailable."), {
  status: 503, code: "refund_authority_unavailable",
});

/** D1 owns the refund projection. KV is a repairable cache, never an exclusion lock. */
export function refundProtectedOrderStore(store, authority, { allowUnsettledMock = false } = {}) {
  if (store[protectedStore] && store[protectedStore].authority === authority
    && store[protectedStore].allowUnsettledMock === allowUnsettledMock) return store;
  const read = async (id) => {
    if (authority?.refundOrderFor) return authority.refundOrderFor(id);
    if (allowUnsettledMock) return null;
    throw refundAuthorityUnavailable();
  };
  const overlay = async (order) => order?.id ? (await read(order.id))?.order || order : order;
  return {
    ...store,
    [protectedStore]: { authority, allowUnsettledMock },
    getOrder: async (id) => {
      const order = await store.getOrder(id);
      return (await read(id))?.order || order;
    },
    getOrderByCheckoutSessionId: store.getOrderByCheckoutSessionId
      ? async (id) => overlay(await store.getOrderByCheckoutSessionId(id)) : undefined,
    listOrders: store.listOrders ? async () => Promise.all((await store.listOrders()).map(overlay)) : undefined,
    async putOrder(order) {
      let result = await store.putOrder(await overlay(order));
      // A reservation/outcome may win during the awaited KV write. Mirror the
      // current primary projection, checking revision after each repair. Even
      // under sustained contention, D1 remains the read/download authority.
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await read(order.id);
        if (!current) return result;
        result = await store.putOrder(current.order);
        const after = await read(order.id);
        if (after?.revision === current.revision) return after.order;
      }
      throw refundAuthorityUnavailable();
    },
  };
}
