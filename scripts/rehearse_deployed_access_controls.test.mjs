import assert from "node:assert/strict";
import test from "node:test";

import { runRehearsal } from "./rehearse_deployed_access_controls.mjs";

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const errorResponse = (status, code) => jsonResponse(status, { error: { code, message: "Rehearsal error." } });

const expectedFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.pathname === "/assets/catalog/photosbyelie.sqlite") {
    return new Response(new Uint8Array([83, 81, 76, 105, 116, 101]), { status: 200 });
  }
  if (parsed.pathname === "/health") return jsonResponse(200, { ok: true });
  if (parsed.pathname === "/auth/session") return jsonResponse(200, { authenticated: false });
  if (["/owner/session", "/owner/actions", "/access-console/state", "/access-console/gallery-access", "/shared-galleries"].includes(parsed.pathname)) {
    return errorResponse(401, "owner_auth_missing");
  }
  if (["/real-estate/session", "/real-estate/originals/preflight", "/real-estate/originals/session"].includes(parsed.pathname)) {
    return errorResponse(401, "real_estate_login_required");
  }
  if (parsed.pathname === "/orders/PBE-20260802-EXAMPLE") return errorResponse(403, "order_email_required");
  if (parsed.pathname.startsWith("/orders/")) return errorResponse(404, "unknown_order");
  if (parsed.pathname.startsWith("/download/")) return errorResponse(404, "unknown_download");
  return jsonResponse(404, { code: "not_found" });
};

test("deployed access rehearsal records only sanitized anonymous evidence", async () => {
  const report = await runRehearsal({
    fetchImpl: expectedFetch,
    workerUrls: ["https://worker.test"],
    siteUrl: "https://site.test",
    knownOrderId: "PBE-20260802-EXAMPLE",
    generatedAt: "2026-08-06T00:00:00.000Z",
  });

  assert.equal(report.pass, true);
  assert.equal(report.hosts[0].checks.every((check) => check.pass), true);
  assert.equal(report.publicCatalog.pass, true);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("PBE-20260802-EXAMPLE"), false);
  assert.equal(serialized.includes("pbe-rehearsal@example.invalid"), false);
  assert.equal(serialized.includes("dl_pbe_rehearsal_does_not_exist"), false);
});

test("deployed access rehearsal fails when the public catalog contains a private marker", async () => {
  const leakingFetch = async (url, options) => {
    if (new URL(url).pathname === "/assets/catalog/photosbyelie.sqlite") {
      return new Response("SQLite privateMasterKey masters/", { status: 200 });
    }
    return expectedFetch(url, options);
  };
  const report = await runRehearsal({
    fetchImpl: leakingFetch,
    workerUrls: ["https://worker.test"],
    siteUrl: "https://site.test",
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.publicCatalog.forbiddenMarkers, ["privateMasterKey", "masters/"]);
});
