const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

const encodeBasicAuth = (secretKey) => {
  const value = `${secretKey}:`;
  if (typeof btoa === "function") return btoa(value);
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  throw new Error("No base64 encoder is available for Stripe authentication.");
};

const appendParam = (params, key, value) => {
  if (value == null || value === "") return;
  params.append(key, String(value));
};

const appendLineItems = (params, lineItems = [], currency) => {
  lineItems.forEach((item, index) => {
    appendParam(params, `line_items[${index}][quantity]`, item.quantity || 1);
    appendParam(params, `line_items[${index}][price_data][currency]`, currency);
    appendParam(params, `line_items[${index}][price_data][unit_amount]`, item.unit_amount);
    appendParam(params, `line_items[${index}][price_data][product_data][name]`, item.name);
    appendParam(params, `line_items[${index}][price_data][product_data][metadata][photo_id]`, item.photoId);
  });
};

const utf8Bytes = (value) => new TextEncoder().encode(String(value));

const bytesToHex = (bytes) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const hmacSha256Hex = async (secret, payload, cryptoImpl = globalThis.crypto) => {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto is required for Stripe webhook verification.");
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    utf8Bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await cryptoImpl.subtle.sign("HMAC", key, utf8Bytes(payload));
  return bytesToHex(new Uint8Array(signature));
};

const parseSignatureHeader = (header) => {
  const parts = {};
  String(header || "").split(",").forEach((part) => {
    const [key, ...rest] = part.split("=");
    if (!key || !rest.length) return;
    const value = rest.join("=");
    parts[key] = parts[key] || [];
    parts[key].push(value);
  });
  return parts;
};

const timingSafeHexEqual = (left, right) => {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
};

export const createStripeWebhookSignature = async ({
  payload,
  secret,
  timestamp = Math.floor(Date.now() / 1000),
  cryptoImpl = globalThis.crypto,
} = {}) => {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = await hmacSha256Hex(secret, signedPayload, cryptoImpl);
  return `t=${timestamp},v1=${signature}`;
};

export const createStripeClient = ({
  secretKey,
  webhookSecret,
  apiVersion,
  apiBase = STRIPE_API_BASE,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  now = () => new Date(),
  webhookToleranceSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
} = {}) => {
  if (!secretKey) throw new Error("createStripeClient requires STRIPE_SECRET_KEY.");
  if (!webhookSecret) throw new Error("createStripeClient requires STRIPE_WEBHOOK_SECRET.");
  if (typeof fetchImpl !== "function") throw new Error("createStripeClient requires fetch.");

  const createCheckoutSession = async ({
    orderId,
    buyerEmail,
    amountTotal: _amountTotal,
    currency,
    lineItems,
    successUrl,
    cancelUrl,
    receiptDescription,
  }) => {
    const params = new URLSearchParams();
    appendParam(params, "mode", "payment");
    appendParam(params, "client_reference_id", orderId);
    appendParam(params, "customer_email", buyerEmail);
    appendParam(params, "success_url", successUrl);
    appendParam(params, "cancel_url", cancelUrl);
    appendParam(params, "metadata[order_id]", orderId);
    appendParam(params, "payment_intent_data[description]", receiptDescription);
    appendParam(params, "payment_intent_data[receipt_email]", buyerEmail);
    appendParam(params, "payment_intent_data[metadata][order_id]", orderId);
    appendLineItems(params, lineItems, currency);

    const headers = {
      "authorization": `Basic ${encodeBasicAuth(secretKey)}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `photosbyelie-checkout-${orderId}`,
    };
    if (apiVersion) headers["stripe-version"] = apiVersion;

    const response = await fetchImpl(`${apiBase}/checkout/sessions`, {
      method: "POST",
      headers,
      body: params.toString(),
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      throw Object.assign(new Error(body?.error?.message || `Stripe Checkout Session failed with HTTP ${response.status}.`), {
        status: 502,
        code: "stripe_checkout_failed",
        details: {
          stripeStatus: response.status,
          stripeCode: body?.error?.code || null,
          stripeType: body?.error?.type || null,
        },
      });
    }
    if (!body?.id || !body?.url) {
      throw Object.assign(new Error("Stripe did not return a Checkout Session URL."), {
        status: 502,
        code: "stripe_checkout_missing_url",
      });
    }
    return body;
  };

  const constructEvent = async (request) => {
    const signatureHeader = request.headers.get("stripe-signature");
    if (!signatureHeader) throw new Error("Missing Stripe-Signature header.");
    const payload = await request.text();
    const signatures = parseSignatureHeader(signatureHeader);
    const timestamp = Number(signatures.t?.[0] || 0);
    if (!timestamp) throw new Error("Missing Stripe webhook timestamp.");
    const age = Math.abs(Math.floor(now().getTime() / 1000) - timestamp);
    if (age > webhookToleranceSeconds) throw new Error("Stripe webhook timestamp is outside the allowed tolerance.");

    const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${payload}`, cryptoImpl);
    const matches = (signatures.v1 || []).some((candidate) => timingSafeHexEqual(expected, candidate));
    if (!matches) throw new Error("No matching Stripe webhook signature.");
    return JSON.parse(payload);
  };

  return {
    provider: "stripe",
    createCheckoutSession,
    constructEvent,
  };
};
