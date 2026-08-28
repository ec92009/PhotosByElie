export const OWNER_API_PREFIX = "/api/v1";
export const OWNER_API_VERSION = "1";

const exactRoutes = new Map([
  ["/health", "/api/health"],
  ["/auth/session", "/api/auth/session"],
  ["/auth/login", "/api/auth/login"],
  ["/auth/google/login", "/api/auth/google/login"],
  ["/auth/google/callback", "/api/auth/google/callback"],
  ["/auth/tokens", "/api/owner/auth/tokens"],
  ["/auth/logout", "/api/owner/auth/logout"],
  ["/devices", "/api/owner/devices"],
  ["/enrollment-handoffs", "/api/owner/enrollment-handoffs"],
  ["/pbe-owner/sessions", "/api/owner/pbe-sessions"],
  ["/pbe-owner/session", "/api/owner/pbe-session"],
  ["/owner/session", "/api/owner/session"],
  ["/owner/connectors", "/api/owner/connectors"],
  ["/owner/interactive", "/api/owner/interactive"],
  ["/owner/connector/download/mac", "/api/owner/connector/download/mac"],
  ["/actions", "/api/owner/actions"],
  ["/connectors", "/api/owner/connectors"],
  ["/connectors/heartbeat", "/api/owner/connector/heartbeat"],
  ["/connectors/interactive", "/api/owner/connector/interactive"],
  ["/connectors/actions", "/api/owner/connector/actions"],
  ["/sidecar/decisions/query", "/api/owner/sidecar/decisions/query"],
  ["/sidecar/decisions/apply", "/api/owner/sidecar/decisions/apply"],
  ["/sidecar/decisions/apply-batch", "/api/owner/sidecar/decisions/apply-batch"],
  ["/sidecar/decisions/upsert", "/api/owner/sidecar/decisions/upsert"],
  ["/lifecycle/seed", "/api/owner/lifecycle/seed"],
  ["/lifecycle/activate", "/api/owner/lifecycle/activate"],
  ["/lifecycle/reconcile", "/api/owner/lifecycle/reconcile"],
  ["/lifecycle/arm", "/api/owner/lifecycle/arm"],
  ["/lifecycle/local-commit", "/api/owner/lifecycle/local-commit"],
  ["/lifecycle/apply", "/api/owner/lifecycle/apply"],
  ["/lifecycle/ack", "/api/owner/lifecycle/ack"],
  ["/lifecycle/abort", "/api/owner/lifecycle/abort"],
  ["/acs/state", "/api/access-console/state"],
  ["/acs/gallery-access", "/api/access-console/gallery-access"],
  ["/acs/people", "/api/access-console/people"],
  ["/acs/groups", "/api/access-console/groups"],
  ["/fixtures/seed", "/api/access-console/fixtures/seed"],
  ["/real-estate/access-login", "/api/real-estate/access-login"],
  ["/real-estate/login", "/api/real-estate/login"],
  ["/real-estate/session", "/api/real-estate/session"],
  ["/real-estate/logout", "/api/real-estate/logout"],
  ["/real-estate/originals/preflight", "/api/real-estate/originals/preflight"],
  ["/real-estate/originals/session", "/api/real-estate/originals/session"],
  ["/deliverables", "/api/real-estate/deliverables"],
  ["/deliverables/list", "/api/real-estate/deliverables/list"],
  ["/deliverables/delete", "/api/real-estate/deliverables/delete"],
  ["/delivery-links", "/api/real-estate/deliverables/delivery-links"],
  ["/jobs", "/api/real-estate/deliverables/jobs"],
]);

const dynamicRoutes = [
  {
    pattern: /^\/actions\/([^/]+)(?:\/(claim|complete|fail|cancel))?$/,
    destination: (match) => `/api/owner/actions/${match[1]}${match[2] ? `/${match[2]}` : ""}`,
  },
  {
    pattern: /^\/devices\/([^/]+)\/revoke$/,
    destination: (match) => `/api/owner/devices/${match[1]}/revoke`,
  },
  {
    pattern: /^\/enrollment-handoffs\/([^/]+)\/(claim|cancel)$/,
    destination: (match) => `/api/owner/enrollment-handoffs/${match[1]}/${match[2]}`,
  },
  {
    pattern: /^\/pbe-owner\/sessions\/([^/]+)\/close$/,
    destination: (match) => `/api/owner/pbe-sessions/${match[1]}/close`,
  },
  {
    pattern: /^\/connectors\/actions\/([^/]+)(?:\/(claim|complete|fail))?$/,
    destination: (match) => `/api/owner/connector/actions/${match[1]}${match[2] ? `/${match[2]}` : ""}`,
  },
  {
    pattern: /^\/acs\/people\/([^/]+)\/disable$/,
    destination: (match) => `/api/access-console/people/${match[1]}/disable`,
  },
  {
    pattern: /^\/acs\/groups\/([^/]+)\/archive$/,
    destination: (match) => `/api/access-console/groups/${match[1]}/archive`,
  },
  {
    pattern: /^\/acs\/audit\/([^/]+)\/undo$/,
    destination: (match) => `/api/access-console/audit/${match[1]}/undo`,
  },
  {
    pattern: /^\/jobs\/([^/]+)$/,
    destination: (match) => `/api/real-estate/deliverables/jobs/${match[1]}`,
  },
  {
    pattern: /^\/deliverables\/([^/]+)\/(complete|fail|view|download)$/,
    destination: (match) => `/api/real-estate/deliverables/${match[1]}/${match[2]}`,
  },
];

const decodeApiPath = (pathname) => {
  if (!pathname.startsWith(OWNER_API_PREFIX)) return null;
  const suffix = pathname.slice(OWNER_API_PREFIX.length) || "/";
  return suffix.startsWith("/") ? suffix : `/${suffix}`;
};

export const resolveOwnerApiV1Route = (pathname) => {
  const suffix = decodeApiPath(pathname);
  if (suffix === null) return null;
  if (exactRoutes.has(suffix)) return exactRoutes.get(suffix);
  for (const route of dynamicRoutes) {
    const match = suffix.match(route.pattern);
    if (match) return route.destination(match);
  }
  return "";
};

export const ownerApiV1Response = (response, requestId = crypto.randomUUID()) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-pbe-api-version", OWNER_API_VERSION);
  headers.set("x-pbe-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const ownerApiV1RouteCount = exactRoutes.size + dynamicRoutes.length;
