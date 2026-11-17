const unavailable = () => Object.assign(new Error("Paid refund settlement authority is unavailable."), {
  status: 503, code: "refund_authority_unavailable",
});
export const refundBlocked = () => Object.assign(new Error("Refund settlement excludes paid fulfillment."), {
  status: 409, code: "refund_blocks_fulfillment",
});
const conflict = () => Object.assign(new Error("Refund reservation lost to readiness or another refund; reconcile before retrying."), {
  status: 409, code: "refund_not_allowed",
});
const identity = (order) => {
  const values = [order?.id, order?.checkoutSessionId, order?.paymentIntentId, Number(order?.amountPaid), order?.currency];
  if (values.slice(0, 3).some((v) => typeof v !== "string" || !v) || !Number.isSafeInteger(values[3])
      || values[3] <= 0 || !/^[a-z]{3}$/.test(values[4] || "")) throw unavailable();
  return values;
};

/** All reads start at primary. SQL/constraint failures never mean absent authority. */
export function createPaidRefundSettlement({ database, assertReady, now }) {
  const primary = () => database.withSession ? database.withSession("first-primary") : database;
  const read = async (id) => {
    await assertReady();
    try {
      const row = await primary().prepare(`SELECT order_id,checkout_session_id,payment_intent_id,amount,currency,
        state,revision,order_json,created_at,updated_at FROM pbe_paid_order_settlements WHERE order_id = ?`).bind(id).first();
      if (row && !["preparing", "ready", "refund"].includes(row.state)) throw unavailable();
      return row;
    }
    catch { throw unavailable(); }
  };
  const refundOrderFor = async (id) => {
    const row = await read(id);
    if (!row || row.state !== "refund") return null;
    try {
      const order = JSON.parse(row.order_json);
      if (JSON.stringify(identity(order)) !== JSON.stringify([row.order_id, row.checkout_session_id,
        row.payment_intent_id, row.amount, row.currency]) || !order.refund?.status
        || !Number.isSafeInteger(row.revision) || row.revision < 1) throw unavailable();
      return { order, revision: row.revision };
    } catch { throw unavailable(); }
  };
  const run = async (statement) => {
    try { return await statement.run(); } catch { throw unavailable(); }
  };
  return {
    ensurePaidSettlementAuthority: async () => { await read(""); },
    refundOrderFor,
    async beginPaidFulfillment(order, fence) {
      await read(order.id); // Also verifies migration 0018 before any preparation write.
      const values = identity(order), timestamp = now().toISOString();
      await run(primary().prepare(`INSERT INTO pbe_paid_order_settlements
        (order_id,checkout_session_id,payment_intent_id,amount,currency,state,created_at,updated_at)
        SELECT ?,?,?,?,?,'preparing',?,? WHERE
          NOT EXISTS (SELECT 1 FROM pbe_lifecycle_fulfillments WHERE order_id=? AND state='ready')
          AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_download_capabilities WHERE order_id=?)
          AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_email_dispatches WHERE order_id=?)
        ON CONFLICT(order_id) DO NOTHING`).bind(...values, timestamp, timestamp, order.id, order.id, order.id));
      const row = await read(order.id);
      if (row?.state === "refund") throw refundBlocked();
      if (!row || JSON.stringify(values) !== JSON.stringify([
        row.order_id,row.checkout_session_id,row.payment_intent_id,row.amount,row.currency])) throw conflict();
      if (row.state === "ready") {
        // A failed projection write must not strand a committed settlement. Keep
        // the ready guard and require the same currently validated lifecycle fence.
        let ready;
        try {
          ready = await primary().prepare(`SELECT fence_digest FROM pbe_lifecycle_fulfillments
            WHERE order_id=? AND state='ready'`).bind(order.id).first();
        } catch { throw unavailable(); }
        if (!/^[a-f0-9]{64}$/.test(fence?.digest || "") || ready?.fence_digest !== fence.digest) throw conflict();
      }
    },
    async reservePaidRefund(order, expectedRevision = 0) {
      await read(order.id);
      const values = identity(order);
      const result = await run(primary().prepare(`UPDATE pbe_paid_order_settlements
        SET state='refund',revision=revision+1,order_json=?,updated_at=?
        WHERE order_id=? AND checkout_session_id=? AND payment_intent_id=? AND amount=? AND currency=?
          AND revision=? AND (
            (state='preparing' AND ?=1) OR (state='refund' AND (
              (json_extract(order_json,'$.refund.status') IN ('failed','canceled')
                AND ?=json_extract(order_json,'$.refund.attempt')+1)
              OR ((json_extract(order_json,'$.refund.status')='unknown'
                OR (json_extract(order_json,'$.refund.status')='pending'
                  AND json_extract(order_json,'$.refund.id') IS NULL
                  AND json_extract(order_json,'$.refund.updatedAt')<=?))
                AND ?=json_extract(order_json,'$.refund.attempt')
                AND ?=json_extract(order_json,'$.refund.idempotencyKey')
                AND ?=json_extract(order_json,'$.refund.requestedAt')
                AND ?=json_extract(order_json,'$.refund.reason')))))
          AND EXISTS (SELECT 1 FROM pbe_lifecycle_control WHERE control_id='global' AND state='ready' AND schema_version=4)
          AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_fulfillments WHERE order_id=? AND state='ready')
          AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_download_capabilities WHERE order_id=?)
          AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_email_dispatches WHERE order_id=?)`)
        .bind(JSON.stringify(order), now().toISOString(), ...values, expectedRevision,
          order.refund.attempt, order.refund.attempt, new Date(now().getTime() - 60_000).toISOString(),
          order.refund.attempt, order.refund.idempotencyKey, order.refund.requestedAt, order.refund.reason,
          order.id, order.id, order.id));
      if (Number(result?.meta?.changes) !== 1) throw conflict();
      return refundOrderFor(order.id);
    },
    /** CAS outcomes; only independently evidenced provider refunds can create a hold after readiness/legacy. */
    async savePaidRefund(order, expectedRevision, evidenced = false) {
      await read(order.id);
      const values = identity(order), timestamp = now().toISOString();
      const statement = expectedRevision === null && evidenced
        ? primary().prepare(`INSERT INTO pbe_paid_order_settlements
            (order_id,checkout_session_id,payment_intent_id,amount,currency,state,revision,order_json,created_at,updated_at)
            VALUES (?,?,?,?,?,'refund',1,?,?,?) ON CONFLICT(order_id) DO UPDATE SET
              state='refund',revision=revision+1,order_json=excluded.order_json,updated_at=excluded.updated_at
            WHERE pbe_paid_order_settlements.state != 'refund'
              AND checkout_session_id=excluded.checkout_session_id AND payment_intent_id=excluded.payment_intent_id
              AND amount=excluded.amount AND currency=excluded.currency`)
            .bind(...values, JSON.stringify(order), timestamp, timestamp)
        : primary().prepare(`UPDATE pbe_paid_order_settlements SET revision=revision+1,order_json=?,updated_at=?
            WHERE state='refund' AND order_id=? AND checkout_session_id=? AND payment_intent_id=? AND amount=? AND currency=? AND revision=?`)
            .bind(JSON.stringify(order), timestamp, ...values, expectedRevision ?? -1);
      let results;
      try { results = await primary().batch([statement, primary().prepare(`UPDATE pbe_lifecycle_fulfillments
        SET state='manual_refund_review',updated_at=? WHERE order_id=? AND EXISTS (
          SELECT 1 FROM pbe_paid_order_settlements WHERE order_id=? AND state='refund')`).bind(timestamp, order.id, order.id)]); }
      catch { throw unavailable(); }
      return Number(results?.[0]?.meta?.changes) === 1;
    },
  };
}
