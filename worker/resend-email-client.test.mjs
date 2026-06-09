import assert from "node:assert/strict";
import test from "node:test";

import { createResendEmailClient } from "./resend-email-client.mjs";

test("Resend email client posts the expected message payload", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createResendEmailClient({
    apiKey: "re_test",
    from: "Photos By Elie <orders@photos-by-elie.com>",
    replyTo: "orders@photos-by-elie.com",
    apiBase: "https://resend.test/",
    fetchImpl,
  });

  const result = await client.send({
    to: "buyer@example.com",
    subject: "Downloads ready",
    html: "<p>Ready</p>",
    text: "Ready",
    idempotencyKey: "photosbyelie-order-ready-PBE-1",
  });

  assert.deepEqual(result, {
    provider: "resend",
    messageId: "email_123",
    idempotencyKey: "photosbyelie-order-ready-PBE-1",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://resend.test/emails");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.authorization, "Bearer re_test");
  assert.equal(requests[0].options.headers["content-type"], "application/json");
  assert.equal(requests[0].options.headers["idempotency-key"], "photosbyelie-order-ready-PBE-1");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    from: "Photos By Elie <orders@photos-by-elie.com>",
    to: ["buyer@example.com"],
    subject: "Downloads ready",
    html: "<p>Ready</p>",
    text: "Ready",
    reply_to: "orders@photos-by-elie.com",
  });
});

test("Resend email client surfaces provider failures", async () => {
  const client = createResendEmailClient({
    apiKey: "re_test",
    from: "Photos By Elie <orders@photos-by-elie.com>",
    fetchImpl: async () => new Response(JSON.stringify({
      name: "validation_error",
      message: "Domain is not verified.",
    }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    () => client.send({
      to: "buyer@example.com",
      subject: "Downloads ready",
      html: "<p>Ready</p>",
      text: "Ready",
    }),
    (error) => {
      assert.equal(error.code, "resend_email_failed");
      assert.equal(error.status, 502);
      assert.equal(error.details.resendStatus, 403);
      assert.equal(error.details.resendCode, "validation_error");
      assert.equal(error.message, "Domain is not verified.");
      return true;
    }
  );
});
