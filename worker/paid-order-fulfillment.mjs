const REVOCATION_CODES = new Set(["asset_lifecycle_denied", "lifecycle_fence_changed"]);

export const PAID_ORDER_FULFILLMENT_DEPENDENCIES = Object.freeze([
  "orderStore",
  "deliveryRenderer",
  "lifecycleFence",
  "email",
  "analytics",
  "time",
  "downloadPolicy",
  "applyDownloadPolicy",
  "mediaIdsForOrder",
]);

const requireFunction = (value, label) => {
  if (typeof value !== "function") {
    throw new TypeError(`createPaidOrderFulfillment requires ${label}.`);
  }
  return value;
};

const paidError = (message, status, code) => Object.assign(new Error(message), { status, code });

export const createPaidOrderFulfillment = ({
  orderStore,
  deliveryRenderer,
  lifecycleFence = {},
  email,
  analytics,
  time,
  downloadPolicy,
  applyDownloadPolicy,
  mediaIdsForOrder,
} = {}) => {
  const getOrder = requireFunction(orderStore?.getOrder?.bind(orderStore), "orderStore.getOrder");
  const putOrder = requireFunction(orderStore?.putOrder?.bind(orderStore), "orderStore.putOrder");
  const putDownload = requireFunction(orderStore?.putDownload?.bind(orderStore), "orderStore.putDownload");
  const createDelivery = requireFunction(deliveryRenderer?.createDelivery?.bind(deliveryRenderer), "deliveryRenderer.createDelivery");
  const sendReadyEmail = requireFunction(email?.sendReady, "email.sendReady");
  const recordAnalytics = requireFunction(analytics?.record, "analytics.record");
  const now = requireFunction(time?.now, "time.now");
  const policyForDownload = requireFunction(downloadPolicy, "downloadPolicy");
  const withDownloadPolicy = requireFunction(applyDownloadPolicy, "applyDownloadPolicy");
  const orderMediaIds = requireFunction(mediaIdsForOrder, "mediaIdsForOrder");

  const assertLifecycleAllowed = async (assetIds, context, expectedFence = null) => {
    if (!lifecycleFence?.assertAllowed) return true;
    return lifecycleFence.assertAllowed(assetIds, context, expectedFence);
  };

  const persistManualRefundReview = async (order, error) => {
    const updatedAt = now().toISOString();
    const blocked = {
      ...order,
      status: "manual_refund_review",
      delivery: null,
      deliveryError: {
        code: "paid_asset_revoked",
        message: "Payment was received after an asset became unavailable. Fulfillment is blocked pending manual refund review.",
        failedAt: updatedAt,
        lifecycleCode: error?.code || "asset_lifecycle_denied",
      },
      updatedAt,
    };
    await putOrder(blocked);
    return blocked;
  };

  const reconcileOrder = async (order, { throwOnRevocation = false } = {}) => {
    if (!order || !lifecycleFence?.fulfillmentFor) return order;
    const settlement = await lifecycleFence.fulfillmentFor(order.id);
    if (settlement?.state === "blocked_pending_lifecycle") {
      throw Object.assign(new Error("Paid fulfillment is held behind an armed lifecycle operation."), {
        status: 409,
        code: "paid_asset_lifecycle_pending",
        lifecycleOperationId: settlement.lifecycleOperationId || "",
      });
    }
    if (settlement?.state !== "manual_refund_review") return order;
    const error = Object.assign(new Error("Paid fulfillment was revoked and requires manual refund review."), {
      status: 409,
      code: "paid_asset_revoked",
      lifecycleOperationId: settlement.lifecycleOperationId || "",
    });
    const blocked = order.status === "manual_refund_review"
      ? order
      : await persistManualRefundReview(order, error);
    if (throwOnRevocation) throw error;
    return blocked;
  };

  const rejectRevokedOrder = async (order, error) => {
    await persistManualRefundReview(order, error);
    throw Object.assign(error, { status: 409, code: "paid_asset_revoked" });
  };

  const fulfillPaidSession = async (session) => {
    const orderId = session.metadata?.order_id || session.client_reference_id;
    if (!orderId) throw paidError("Stripe session did not include an order id.", 400, "missing_order_id");

    let order = await getOrder(orderId);
    if (!order) throw paidError(`No order exists for ${orderId}.`, 404, "unknown_order");
    if (order.checkoutSessionId !== session.id) {
      throw paidError("Stripe session does not match the stored order.", 409, "checkout_session_mismatch");
    }
    if (session.payment_status !== "paid") {
      throw paidError("Stripe session is not paid.", 409, "payment_not_paid");
    }
    if (Number(session.amount_total) !== Number(order.amountExpected) || String(session.currency).toLowerCase() !== order.currency) {
      throw paidError("Stripe paid amount/currency does not match the order.", 409, "amount_mismatch");
    }
    order = await reconcileOrder(order, { throwOnRevocation: true });

    let fulfillmentFence;
    try {
      fulfillmentFence = await assertLifecycleAllowed(orderMediaIds(order), "fulfillment:before-prepare");
    } catch (error) {
      return rejectRevokedOrder(order, error);
    }

    if (order.status === "ready") return sendReadyEmail(order);

    const paidAt = now().toISOString();
    const preparing = {
      ...order,
      status: "preparing",
      amountPaid: Number(session.amount_total),
      buyerEmail: String(session.customer_details?.email || order.buyerEmail).toLowerCase(),
      paymentIntentId: session.payment_intent || order.paymentIntentId,
      paidAt,
      updatedAt: paidAt,
    };
    await putOrder(preparing);

    let deliveryResult;
    try {
      deliveryResult = await createDelivery(preparing);
      await assertLifecycleAllowed(orderMediaIds(order), "fulfillment:after-render", fulfillmentFence);
    } catch (error) {
      if (REVOCATION_CODES.has(error?.code)) return rejectRevokedOrder(preparing, error);
      const failedAt = now().toISOString();
      await putOrder({
        ...preparing,
        status: "delivery_failed",
        deliveryError: {
          code: error?.code || "delivery_failed",
          message: error?.message || "Delivery could not be generated.",
          failedAt,
        },
        updatedAt: failedAt,
      });
      throw error;
    }

    const readyAt = now().toISOString();
    const policy = policyForDownload();
    const deliveryFiles = Array.isArray(deliveryResult.files)
      ? deliveryResult.files.map((file) => withDownloadPolicy(file, policy))
      : [];
    let ready = {
      ...preparing,
      status: "ready",
      deliveryError: undefined,
      lifecycleSettlementBound: Boolean(lifecycleFence?.commitFulfillmentReady),
      delivery: {
        zipKey: deliveryResult.zipKey,
        downloadUrl: deliveryResult.downloadUrl,
        readyAt: deliveryResult.readyAt || readyAt,
        files: deliveryFiles,
        items: deliveryResult.items || [],
      },
      updatedAt: readyAt,
    };

    try {
      await assertLifecycleAllowed(orderMediaIds(order), "fulfillment:before-ready-commit", fulfillmentFence);
      if (lifecycleFence?.commitFulfillmentReady) {
        await lifecycleFence.commitFulfillmentReady({
          orderId: order.id,
          mediaIds: orderMediaIds(order),
          fence: fulfillmentFence,
        });
      }
    } catch (error) {
      if (REVOCATION_CODES.has(error?.code)) return rejectRevokedOrder(preparing, error);
      throw error;
    }

    const readyProjection = ready;
    await putOrder(ready.lifecycleSettlementBound
      ? { ...ready, status: "preparing", delivery: null, updatedAt: readyAt }
      : ready);
    ready = await reconcileOrder(readyProjection, { throwOnRevocation: true });

    if (deliveryFiles.length) {
      for (const file of deliveryFiles) {
        await reconcileOrder(ready, { throwOnRevocation: true });
        if (ready.lifecycleSettlementBound && lifecycleFence?.authorizeDownloadCapability) {
          await lifecycleFence.authorizeDownloadCapability({ orderId: ready.id, token: file.token });
        }
        await putDownload({
          token: file.token,
          orderId: ready.id,
          bucket: file.bucket,
          objectKey: file.objectKey,
          filename: file.name,
          contentType: file.contentType,
          bytes: file.bytes || 0,
          photoId: file.photoId,
          productId: file.productId,
          canonicalMediaIds: [file.photoId],
          lifecycleSettlementBound: Boolean(ready.lifecycleSettlementBound && lifecycleFence?.authorizeDownloadCapability),
          createdAt: readyAt,
          expiresAt: file.expiresAt,
          downloadLimit: file.downloadLimit,
          downloadCount: 0,
        });
      }
    } else if (deliveryResult.token) {
      await reconcileOrder(ready, { throwOnRevocation: true });
      if (ready.lifecycleSettlementBound && lifecycleFence?.authorizeDownloadCapability) {
        await lifecycleFence.authorizeDownloadCapability({ orderId: ready.id, token: deliveryResult.token });
      }
      await putDownload({
        token: deliveryResult.token,
        orderId: ready.id,
        zipKey: deliveryResult.zipKey,
        canonicalMediaIds: orderMediaIds(ready),
        lifecycleSettlementBound: Boolean(ready.lifecycleSettlementBound && lifecycleFence?.authorizeDownloadCapability),
        createdAt: readyAt,
        expiresAt: policy.expiresAt,
        downloadLimit: policy.downloadLimit,
        downloadCount: 0,
      });
    }

    ready = await reconcileOrder(ready, { throwOnRevocation: true });
    await putOrder(ready);
    ready = await sendReadyEmail(ready);
    ready = await reconcileOrder(ready, { throwOnRevocation: true });
    await recordAnalytics({
      event: "payment_completed",
      checkoutMode: ready.checkoutMode,
      itemCount: ready.items.length,
      productCount: ready.items.reduce((sum, item) => sum + (item.products || []).length, 0),
      amountCents: ready.amountPaid,
      discountPresent: Boolean(ready.discountCode),
    });
    return ready;
  };

  return {
    fulfillPaidSession,
    reconcileOrder,
  };
};
