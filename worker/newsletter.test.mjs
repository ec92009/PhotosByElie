import assert from "node:assert/strict";
import test from "node:test";
import { createD1NewsletterStore, handleNewsletterRequest } from "./newsletter.mjs";
import { createOwnerConnectorAuth } from "./owner-connector-auth.mjs";
import deployedWorker from "./deployed-worker.mjs";

const createMemoryNewsletterDb = () => {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (/WHERE email = \?/i.test(sql)) {
            return rows.get(this.args[0]) || null;
          }
          if (/WHERE unsubscribe_token = \?/i.test(sql)) {
            for (const row of rows.values()) {
              if (row.unsubscribe_token === this.args[0]) return row;
            }
            return null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO newsletter_subscribers/i.test(sql)) {
            const [email, language, source, token, subscribedAt, updatedAt] = this.args;
            rows.set(email, {
              email,
              language,
              source,
              status: "active",
              unsubscribe_token: token,
              subscribed_at: subscribedAt,
              unsubscribed_at: null,
              welcome_sent_at: null,
              updated_at: updatedAt,
            });
            return { success: true };
          }
          if (/SET language = \?, source = \?, status = 'active'/i.test(sql)) {
            const [language, source, token, updatedAt, email] = this.args;
            const current = rows.get(email);
            if (current) {
              Object.assign(current, {
                language,
                source,
                status: "active",
                unsubscribe_token: token,
                unsubscribed_at: null,
                updated_at: updatedAt,
              });
            }
            return { success: true };
          }
          if (/SET welcome_sent_at = \?/i.test(sql)) {
            const [sentAt, updatedAt, email] = this.args;
            const current = rows.get(email);
            if (current) {
              current.welcome_sent_at = sentAt;
              current.updated_at = updatedAt;
            }
            return { success: true };
          }
          if (/SET status = 'unsubscribed'/i.test(sql)) {
            const [unsubscribedAt, updatedAt, token] = this.args;
            for (const row of rows.values()) {
              if (row.unsubscribe_token === token) {
                row.status = "unsubscribed";
                row.unsubscribed_at = unsubscribedAt;
                row.updated_at = updatedAt;
              }
            }
            return { success: true };
          }
          throw new Error(`Unexpected SQL in test fake: ${sql}`);
        },
        async all() {
          if (/GROUP BY status/i.test(sql)) {
            const counts = new Map();
            for (const row of rows.values()) {
              counts.set(row.status, (counts.get(row.status) || 0) + 1);
            }
            return {
              results: [...counts.entries()].map(([status, count]) => ({ status, count })),
            };
          }
          const allRows = [...rows.values()].sort((a, b) => b.subscribed_at.localeCompare(a.subscribed_at));
          if (/WHERE status = \?/i.test(sql)) {
            const [status, limit] = this.args;
            return { results: allRows.filter((row) => row.status === status).slice(0, Number(limit)) };
          }
          const [limit] = this.args;
          return { results: allRows.slice(0, Number(limit)) };
        },
      };
    },
  };
};

const createMemoryKv = () => {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { map.set(key, String(value)); },
  };
};

test("subscribe persists subscriber, sends localized welcome email, returns wallpaper pack, and enforces CORS", async () => {
  const db = createMemoryNewsletterDb();
  const store = createD1NewsletterStore({ database: db });
  const sent = [];
  const emailClient = {
    async send(message) {
      sent.push(message);
      return { provider: "resend", messageId: "msg_1" };
    },
  };

  const preflight = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "OPTIONS",
      headers: { origin: "https://photos-by-elie.com" },
    }),
    { store, emailClient },
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://photos-by-elie.com");

  const subscribeResponse = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: {
        origin: "https://photos-by-elie.com",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({
        email: "Collector@Example.com",
        language: "fr",
        source: "landing",
      }),
    }),
    { store, emailClient, rateLimitKv: createMemoryKv() },
  );
  assert.equal(subscribeResponse.status, 200);
  assert.equal(subscribeResponse.headers.get("access-control-allow-origin"), "https://photos-by-elie.com");
  const body = await subscribeResponse.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadySubscribed, false);
  assert.equal(body.emailSent, true);
  assert.equal(body.wallpapers.length, 3);
  assert.match(body.wallpapers[0].downloadUrl, /^https:\/\/photos-by-elie\.com\/landing-concept\/assets\//);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "collector@example.com");
  assert.match(sent[0].subject, /fonds d’écran/);
  assert.match(sent[0].html, /newsletter\/unsubscribe\?token=/);

  // Duplicate active subscription does not re-send welcome email.
  const duplicateResponse = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "collector@example.com", language: "fr" }),
    }),
    { store, emailClient },
  );
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicateResponse.headers.get("access-control-allow-origin"), null);
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateBody.alreadySubscribed, true);
  assert.equal(duplicateBody.emailSent, false);
  assert.equal(sent.length, 1);
});

test("honeypot, invalid email, rate limiting, and Resend hiccups behave safely", async () => {
  const db = createMemoryNewsletterDb();
  const store = createD1NewsletterStore({ database: db });
  const kv = createMemoryKv();
  let sendCalls = 0;
  const flakyEmailClient = {
    async send() {
      sendCalls += 1;
      throw new Error("Resend temporary 502");
    },
  };

  // Honeypot silently returns ok without persisting or emailing.
  const botResponse = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bot@spam.test", website: "https://spam.test" }),
    }),
    { store, emailClient: flakyEmailClient, rateLimitKv: kv },
  );
  assert.equal(botResponse.status, 200);
  assert.equal(db.rows.size, 0);
  assert.equal(sendCalls, 0);

  // Invalid email rejected with 400.
  const invalidResponse = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
    { store, emailClient: flakyEmailClient, rateLimitKv: kv },
  );
  assert.equal(invalidResponse.status, 400);

  // Valid signup succeeds and returns instant wallpapers even if Resend throws.
  const okResponse = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
      body: JSON.stringify({ email: "reader@example.com", language: "es" }),
    }),
    { store, emailClient: flakyEmailClient, rateLimitKv: kv, rateLimitMax: 1 },
  );
  assert.equal(okResponse.status, 200);
  const okBody = await okResponse.json();
  assert.equal(okBody.ok, true);
  assert.equal(okBody.emailSent, false);
  assert.equal(okBody.wallpapers.length, 3);
  assert.equal(db.rows.size, 1);

  // Second request from same IP exceeds rateLimitMax=1.
  const limitedResponse = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
      body: JSON.stringify({ email: "second@example.com", language: "en" }),
    }),
    { store, emailClient: flakyEmailClient, rateLimitKv: kv, rateLimitMax: 1 },
  );
  assert.equal(limitedResponse.status, 429);
});

test("one-click unsubscribe and owner-authenticated subscriber listing work end-to-end", async () => {
  const db = createMemoryNewsletterDb();
  const store = createD1NewsletterStore({ database: db });
  const connectorAuth = createOwnerConnectorAuth({ credentials: { backstage: "secret-owner-token" } });

  await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "fan@example.com", language: "es", source: "landing" }),
    }),
    { store },
  );

  // Unauthenticated admin list fails closed.
  const unauthList = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribers"),
    { store, connectorAuth },
  );
  assert.equal(unauthList.status, 401);

  // Authenticated JSON & CSV list succeeds.
  const authList = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribers", {
      headers: { authorization: "Bearer secret-owner-token" },
    }),
    { store, connectorAuth },
  );
  assert.equal(authList.status, 200);
  const listBody = await authList.json();
  assert.equal(listBody.active, 1);
  assert.equal(listBody.subscribers[0].email, "fan@example.com");

  const csvList = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribers?format=csv", {
      headers: { authorization: "Bearer secret-owner-token" },
    }),
    { store, connectorAuth },
  );
  assert.equal(csvList.status, 200);
  assert.match(csvList.headers.get("content-type"), /text\/csv/);
  assert.match(await csvList.text(), /fan@example\.com,es,landing,active/);

  // Unsubscribe via token renders Spanish confirmation page and updates status.
  const token = db.rows.get("fan@example.com").unsubscribe_token;
  const unsubResponse = await handleNewsletterRequest(
    new Request(`https://auth.photos-by-elie.com/newsletter/unsubscribe?token=${token}`),
    { store },
  );
  assert.equal(unsubResponse.status, 200);
  assert.match(await unsubResponse.text(), /Suscripción cancelada/);
  assert.equal(db.rows.get("fan@example.com").status, "unsubscribed");

  // Unknown token returns 404.
  const badUnsub = await handleNewsletterRequest(
    new Request("https://auth.photos-by-elie.com/newsletter/unsubscribe?token=deadbeef"),
    { store },
  );
  assert.equal(badUnsub.status, 404);
});

test("deployed worker dispatches /newsletter/* cleanly without checkout bindings", async () => {
  const db = createMemoryNewsletterDb();
  const response = await deployedWorker.fetch(
    new Request("https://auth.photos-by-elie.com/newsletter/subscribe", {
      method: "POST",
      headers: {
        origin: "http://localhost:8000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "live-test@example.com", language: "en" }),
    }),
    {
      ACCESS_DB: db,
      ORDERS_KV: createMemoryKv(),
      PUBLIC_SITE_URL: "https://photos-by-elie.com",
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8000");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.wallpapers.length, 3);
  assert.equal(db.rows.has("live-test@example.com"), true);
});
