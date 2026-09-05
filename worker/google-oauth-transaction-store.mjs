// Production consumption is one atomic D1 statement, never a KV read/delete pair.
export const createD1GoogleOAuthTransactionStore = ({ database }) => ({
  async put({ id, binding, expiresAt }) {
    await database.prepare("DELETE FROM google_oauth_transactions WHERE expires_at <= ?")
      .bind(Math.floor(Date.now() / 1000)).run();
    await database.prepare("INSERT INTO google_oauth_transactions (id, binding, expires_at) VALUES (?, ?, ?)")
      .bind(id, binding, expiresAt).run();
  },
  async cancel(binding) {
    await database.prepare("DELETE FROM google_oauth_transactions WHERE binding = ?").bind(binding).run();
  },
  async consume({ id, binding, nowSeconds }) {
    const result = await database.prepare("DELETE FROM google_oauth_transactions WHERE id = ? AND binding = ? AND expires_at > ?")
      .bind(id, binding, nowSeconds).run();
    return Number(result?.meta?.changes || 0) === 1;
  },
});

// Explicit test adapter; never selected as a production fallback.
export const createMemoryGoogleOAuthTransactionStore = () => {
  const records = new Map();
  return {
    async put(record) { records.set(record.id, record); },
    async cancel(binding) {
      for (const [id, record] of records) if (record.binding === binding) records.delete(id);
    },
    async consume({ id, binding, nowSeconds }) {
      const record = records.get(id);
      if (!record || record.binding !== binding || record.expiresAt <= nowSeconds) return false;
      records.delete(id);
      return true;
    },
  };
};
