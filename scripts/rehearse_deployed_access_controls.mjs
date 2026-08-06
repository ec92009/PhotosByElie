#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_WORKER_URLS = [
  "https://photosbyelie-checkout-mock.ec92009.workers.dev",
  "https://download.photos-by-elie.com",
  "https://auth.photos-by-elie.com",
];

export const FORBIDDEN_PUBLIC_MARKERS = [
  "privateMasterKey",
  "sourceFiles",
  "sourceKey",
  "renderKey",
  "objectKey",
  "bucketKey",
  "localPath",
  "checkoutSessionId",
  "stripeSessionId",
  "paymentIntentId",
  "masters/",
  "renders/",
  "/Users/",
  "mock-r2://",
];

const EXPECTED_CODES = {
  owner_auth_missing: [401, "owner_auth_missing"],
  real_estate_login_required: [401, "real_estate_login_required"],
  unknown_order: [404, "unknown_order"],
  unknown_download: [404, "unknown_download"],
  order_email_required: [403, "order_email_required"],
};

const parseArgs = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [key, inlineValue] = item.slice(2).split("=", 2);
    const value = inlineValue ?? (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true");
    if (key === "worker-url") {
      const current = values.get(key) || [];
      current.push(value);
      values.set(key, current);
    } else {
      values.set(key, value);
    }
  }
  return values;
};

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const probe = async (fetchImpl, host, definition) => {
  const response = await fetchImpl(`${host}${definition.path}`, {
    method: definition.method || "GET",
    headers: definition.body ? { "content-type": "application/json" } : undefined,
    body: definition.body ? JSON.stringify(definition.body) : undefined,
    redirect: "manual",
  });
  const body = definition.binary ? null : await safeJson(response);
  const actualCode = typeof body?.code === "string"
    ? body.code
    : (typeof body?.error?.code === "string" ? body.error.code : null);
  const [expectedStatus, expectedCode] = definition.expected;
  const pass = response.status === expectedStatus
    && (expectedCode == null || actualCode === expectedCode)
    && (definition.validate ? definition.validate(body) : true);
  return {
    label: definition.label,
    method: definition.method || "GET",
    path: definition.publicPath || definition.path,
    expectedStatus,
    expectedCode: expectedCode || null,
    actualStatus: response.status,
    actualCode,
    pass,
  };
};

const anonymousDefinitions = (knownOrderId) => {
  const definitions = [
    {
      label: "Health is reachable",
      path: "/health",
      expected: [200, null],
      validate: (body) => body?.ok === true,
    },
    {
      label: "Anonymous account session remains signed out",
      path: "/auth/session",
      expected: [200, null],
      validate: (body) => body?.authenticated === false,
    },
    { label: "Anonymous Owner session is denied", path: "/owner/session", expected: EXPECTED_CODES.owner_auth_missing },
    { label: "Anonymous Owner actions are denied", path: "/owner/actions", expected: EXPECTED_CODES.owner_auth_missing },
    { label: "Anonymous Admin console is denied", path: "/access-console/state", expected: EXPECTED_CODES.owner_auth_missing },
    {
      label: "Anonymous Admin policy inspection is denied",
      path: "/access-console/gallery-access?galleryKind=event&galleryKey=pbe-rehearsal",
      expected: EXPECTED_CODES.owner_auth_missing,
    },
    { label: "Anonymous shared galleries are denied", path: "/shared-galleries", expected: EXPECTED_CODES.owner_auth_missing },
    {
      label: "Anonymous Real Estate session is denied",
      path: "/real-estate/session?galleryKey=corine-real-estate",
      expected: EXPECTED_CODES.real_estate_login_required,
    },
    {
      label: "Anonymous Real Estate original-session creation is denied",
      method: "POST",
      path: "/real-estate/originals/session",
      body: { galleryKey: "corine-real-estate", photoIds: [] },
      expected: EXPECTED_CODES.real_estate_login_required,
    },
    {
      label: "Guessed order number is non-enumerable",
      path: "/orders/PBE-19000101-DOESNOTEXIST?email=pbe-rehearsal%40example.invalid",
      publicPath: "/orders/<guessed-order>?email=<wrong-email>",
      expected: EXPECTED_CODES.unknown_order,
    },
    {
      label: "Guessed checkout session is non-enumerable",
      path: "/orders/by-session/cs_live_pbe_rehearsal_does_not_exist",
      publicPath: "/orders/by-session/<guessed-session>",
      expected: EXPECTED_CODES.unknown_order,
    },
    {
      label: "Guessed download token is non-enumerable",
      path: "/download/dl_pbe_rehearsal_does_not_exist",
      publicPath: "/download/<guessed-token>",
      expected: EXPECTED_CODES.unknown_download,
    },
    { label: "Guessed paid master path is absent", path: "/media/masters/pbe-rehearsal.jpg", expected: [404, null] },
    { label: "Guessed Real Estate master path is absent", path: "/media/real-estate/pbe-rehearsal/masters/photo.jpg", expected: [404, null] },
  ];
  if (knownOrderId) {
    definitions.push({
      label: "Known order rejects the wrong checkout email",
      path: `/orders/${encodeURIComponent(knownOrderId)}?email=pbe-rehearsal%40example.invalid`,
      publicPath: "/orders/<known-order>?email=<wrong-email>",
      expected: EXPECTED_CODES.order_email_required,
    });
  }
  return definitions;
};

const scanPublicCatalog = async (fetchImpl, siteUrl) => {
  const path = "/assets/catalog/photosbyelie.sqlite";
  const response = await fetchImpl(`${siteUrl}${path}`, { redirect: "manual" });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  const forbiddenMarkers = FORBIDDEN_PUBLIC_MARKERS.filter((marker) => text.includes(marker));
  return {
    label: "Public SQLite catalog contains no private storage markers",
    path,
    expectedStatus: 200,
    actualStatus: response.status,
    bytes: bytes.byteLength,
    forbiddenMarkers,
    pass: response.status === 200 && forbiddenMarkers.length === 0,
  };
};

export const runRehearsal = async ({
  fetchImpl = fetch,
  workerUrls = DEFAULT_WORKER_URLS,
  siteUrl = "https://photos-by-elie.com",
  knownOrderId = "",
  generatedAt = new Date().toISOString(),
} = {}) => {
  const hosts = [];
  for (const rawHost of workerUrls) {
    const host = normalizeBaseUrl(rawHost);
    if (!host) continue;
    const checks = [];
    for (const definition of anonymousDefinitions(String(knownOrderId || "").trim())) {
      try {
        checks.push(await probe(fetchImpl, host, definition));
      } catch (error) {
        checks.push({
          label: definition.label,
          method: definition.method || "GET",
          path: definition.publicPath || definition.path,
          pass: false,
          error: String(error?.message || error),
        });
      }
    }
    hosts.push({ host, pass: checks.every((check) => check.pass), checks });
  }

  let publicCatalog;
  try {
    publicCatalog = await scanPublicCatalog(fetchImpl, normalizeBaseUrl(siteUrl));
  } catch (error) {
    publicCatalog = {
      label: "Public SQLite catalog contains no private storage markers",
      path: "/assets/catalog/photosbyelie.sqlite",
      pass: false,
      error: String(error?.message || error),
    };
  }

  return {
    schemaVersion: 1,
    generatedAt,
    mode: "read-only-anonymous",
    knownOrderWrongEmailProbe: Boolean(String(knownOrderId || "").trim()),
    pass: hosts.length > 0 && hosts.every((host) => host.pass) && publicCatalog.pass,
    hosts,
    publicCatalog,
    manualGates: [
      "Authenticated deployed role checks require explicit signed-in Owner/Admin, buyer, family/event, and Real Estate test sessions.",
      "Expired and exhausted download checks require naturally expired/exhausted records or separately approved synthetic production fixtures.",
    ],
  };
};

const printHuman = (report) => {
  for (const host of report.hosts) {
    console.log(`${host.pass ? "OK" : "!!"} ${host.host}`);
    for (const check of host.checks) {
      const status = check.actualStatus == null ? "error" : `${check.actualStatus}${check.actualCode ? ` ${check.actualCode}` : ""}`;
      console.log(`  ${check.pass ? "OK" : "!!"} ${check.label} - ${status}`);
    }
  }
  console.log(`${report.publicCatalog.pass ? "OK" : "!!"} ${report.publicCatalog.label} - ${report.publicCatalog.actualStatus ?? "error"}`);
  console.log(`\n${report.pass ? "Deployed access-control rehearsal passed." : "Deployed access-control rehearsal needs attention."}`);
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const workerUrls = args.get("worker-url") || DEFAULT_WORKER_URLS;
  const report = await runRehearsal({
    workerUrls,
    siteUrl: args.get("site-url") || process.env.PBE_PUBLIC_SITE_URL || "https://photos-by-elie.com",
    knownOrderId: args.get("known-order-id") || process.env.PBE_REHEARSAL_ORDER_ID || "",
  });
  const outputPath = args.get("output");
  if (outputPath && outputPath !== "true") {
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.has("json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (!report.pass) process.exitCode = 1;
}
