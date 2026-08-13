import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_API_PREFIX,
  OWNER_API_VERSION,
  ownerApiV1Response,
  ownerApiV1RouteCount,
  resolveOwnerApiV1Route,
} from "./owner-api-v1.mjs";

test("Owner API v1 exposes explicit compatibility routes", () => {
  assert.equal(OWNER_API_PREFIX, "/api/v1");
  assert.equal(OWNER_API_VERSION, "1");
  assert.ok(ownerApiV1RouteCount >= 30);
  assert.equal(resolveOwnerApiV1Route("/api/v1/health"), "/api/health");
  assert.equal(resolveOwnerApiV1Route("/api/v1/auth/tokens"), "/api/owner/auth/tokens");
  assert.equal(resolveOwnerApiV1Route("/api/v1/auth/refresh"), "/api/owner/auth/refresh");
  assert.equal(resolveOwnerApiV1Route("/api/v1/devices"), "/api/owner/devices");
  assert.equal(resolveOwnerApiV1Route("/api/v1/pbe-owner/sessions"), "/api/owner/pbe-sessions");
  assert.equal(resolveOwnerApiV1Route("/api/v1/pbe-owner/session"), "/api/owner/pbe-session");
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/devices/max%20backstage/revoke"),
    "/api/owner/devices/max%20backstage/revoke"
  );
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/pbe-owner/sessions/session%201/close"),
    "/api/owner/pbe-sessions/session%201/close"
  );
  assert.equal(resolveOwnerApiV1Route("/api/v1/actions"), "/api/owner/actions");
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/actions/action%201/complete"),
    "/api/owner/actions/action%201/complete"
  );
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/actions/action%201/cancel"),
    "/api/owner/actions/action%201/cancel"
  );
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/connectors/actions/action-1/claim"),
    "/api/owner/connector/actions/action-1/claim"
  );
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/acs/people/person-1/disable"),
    "/api/access-console/people/person-1/disable"
  );
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/real-estate/originals/preflight"),
    "/api/real-estate/originals/preflight"
  );
  assert.equal(
    resolveOwnerApiV1Route("/api/v1/deliverables/output-1/download"),
    "/api/real-estate/deliverables/output-1/download"
  );
});

test("Owner API v1 distinguishes non-v1 and unknown v1 paths", () => {
  assert.equal(resolveOwnerApiV1Route("/api/owner/actions"), null);
  assert.equal(resolveOwnerApiV1Route("/api/v2/actions"), null);
  assert.equal(resolveOwnerApiV1Route("/api/v1/no-such-capability"), "");
});

test("Owner API v1 decorates a streaming response without consuming it", async () => {
  const source = new Response("stream me", {
    status: 202,
    headers: { "content-type": "text/plain", "x-existing": "yes" },
  });
  const response = ownerApiV1Response(source, "request-1");
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(response.headers.get("x-existing"), "yes");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-pbe-api-version"), "1");
  assert.equal(response.headers.get("x-pbe-request-id"), "request-1");
  assert.equal(await response.text(), "stream me");
});
