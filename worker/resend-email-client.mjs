const RESEND_API_BASE = "https://api.resend.com";

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export const createResendEmailClient = ({
  apiKey,
  from,
  replyTo = "",
  apiBase = RESEND_API_BASE,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!apiKey) throw new Error("createResendEmailClient requires RESEND_API_KEY.");
  if (!from) throw new Error("createResendEmailClient requires ORDER_EMAIL_FROM.");
  if (typeof fetchImpl !== "function") throw new Error("createResendEmailClient requires fetch.");

  const send = async ({ to, subject, html, text, idempotencyKey }) => {
    const payload = {
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    };
    const headers = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    };
    const response = await fetchImpl(`${apiBase.replace(/\/+$/, "")}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
      const message = body?.message || body?.error?.message || `Resend email failed with HTTP ${response.status}.`;
      throw Object.assign(new Error(message), {
        status: 502,
        code: "resend_email_failed",
        details: {
          resendStatus: response.status,
          resendCode: body?.name || body?.error?.code || null,
        },
      });
    }
    return {
      provider: "resend",
      messageId: body?.id || null,
      idempotencyKey: idempotencyKey || null,
    };
  };

  return {
    provider: "resend",
    send,
  };
};
