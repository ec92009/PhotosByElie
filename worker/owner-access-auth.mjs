const DEFAULT_PROVIDER = "cloudflare-access";

const textEncoder = new TextEncoder();

const cleanList = (value) => {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return source.map((item) => String(item || "").trim()).filter(Boolean);
};

const cleanEmailList = (value) => cleanList(value)
  .map((email) => email.toLowerCase())
  .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

const base64UrlToBytes = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const base64UrlJson = (value) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));

const accessDomainFor = (teamNameOrDomain) => {
  const value = String(teamNameOrDomain || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!value) return "";
  return value.endsWith(".cloudflareaccess.com") ? value : `${value}.cloudflareaccess.com`;
};

const tokenFromCookie = (cookieHeader) => {
  const cookies = String(cookieHeader || "").split(/;\s*/);
  const match = cookies.find((cookie) => cookie.startsWith("CF_Authorization="));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
};

const tokenFromRequest = (request) =>
  request.headers.get("cf-access-jwt-assertion")
  || request.headers.get("Cf-Access-Jwt-Assertion")
  || tokenFromCookie(request.headers.get("cookie"));

const responseError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

const assertConfigured = ({ accessDomain, audience }) => {
  if (!accessDomain || !audience) {
    throw responseError(503, "owner_auth_unavailable", "Owner cloud auth is not configured.");
  }
};

const importVerificationKey = (jwk) =>
  crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

const audienceMatches = (claim, expected) => {
  const audiences = Array.isArray(claim) ? claim : [claim].filter(Boolean);
  return audiences.includes(expected);
};

const assertClaims = ({ claims, accessDomain, audience, allowedEmails, now }) => {
  const nowSeconds = Math.floor(now().getTime() / 1000);
  if (Number(claims.exp || 0) <= nowSeconds) {
    throw responseError(401, "owner_auth_expired", "Owner cloud auth has expired.");
  }
  if (claims.nbf && Number(claims.nbf) > nowSeconds) {
    throw responseError(401, "owner_auth_not_active", "Owner cloud auth is not active yet.");
  }
  const expectedIssuer = `https://${accessDomain}`;
  if (claims.iss && claims.iss !== expectedIssuer) {
    throw responseError(401, "owner_auth_bad_issuer", "Owner cloud auth issuer did not match.");
  }
  if (!audienceMatches(claims.aud, audience)) {
    throw responseError(401, "owner_auth_bad_audience", "Owner cloud auth audience did not match.");
  }
  const email = String(claims.email || claims.common_name || "").trim().toLowerCase();
  if (!email) {
    throw responseError(401, "owner_auth_missing_email", "Owner cloud auth did not include an email.");
  }
  if (allowedEmails.length && !allowedEmails.includes(email)) {
    throw responseError(403, "owner_auth_forbidden", "This Google account is not authorized for Owner work.");
  }
  return {
    email,
    provider: DEFAULT_PROVIDER,
    expiresAt: new Date(Number(claims.exp) * 1000).toISOString(),
    sessionSeconds: Math.max(0, Number(claims.exp) - nowSeconds),
  };
};

export const createOwnerAccessAuth = ({
  teamName = "",
  audience = "",
  allowedEmails = "",
  certsUrl = "",
  fetcher = fetch,
  now = () => new Date(),
} = {}) => {
  const accessDomain = accessDomainFor(teamName);
  const normalizedAudience = String(audience || "").trim();
  const normalizedAllowedEmails = cleanEmailList(allowedEmails);
  const normalizedCertsUrl = String(certsUrl || `https://${accessDomain}/cdn-cgi/access/certs`).trim();
  let certsPromise = null;

  const certs = async () => {
    assertConfigured({ accessDomain, audience: normalizedAudience });
    if (!certsPromise) {
      certsPromise = fetcher(normalizedCertsUrl)
        .then(async (response) => {
          if (!response.ok) throw responseError(503, "owner_auth_certs_unavailable", "Cloudflare Access certificates are unavailable.");
          const payload = await response.json();
          return Array.isArray(payload?.keys) ? payload.keys : [];
        })
        .catch((error) => {
          certsPromise = null;
          throw error;
        });
    }
    return certsPromise;
  };

  const verifyToken = async (token) => {
    assertConfigured({ accessDomain, audience: normalizedAudience });
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw responseError(401, "owner_auth_missing", "Owner cloud auth is required.");

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = base64UrlJson(encodedHeader);
    if (header.alg !== "RS256" || !header.kid) {
      throw responseError(401, "owner_auth_bad_token", "Owner cloud auth token is not supported.");
    }

    const jwk = (await certs()).find((key) => key.kid === header.kid);
    if (!jwk) throw responseError(401, "owner_auth_unknown_key", "Owner cloud auth key was not recognized.");

    const key = await importVerificationKey(jwk);
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlToBytes(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    if (!verified) throw responseError(401, "owner_auth_bad_signature", "Owner cloud auth signature did not verify.");

    return assertClaims({
      claims: base64UrlJson(encodedPayload),
      accessDomain,
      audience: normalizedAudience,
      allowedEmails: normalizedAllowedEmails,
      now,
    });
  };

  return {
    provider: DEFAULT_PROVIDER,
    logoutUrlFor: (baseUrl) => {
      try {
        return new URL("/cdn-cgi/access/logout", baseUrl).href;
      } catch {
        return `https://${accessDomain}/cdn-cgi/access/logout`;
      }
    },
    optionalSession: (request) => {
      const token = tokenFromRequest(request);
      return token ? verifyToken(token) : null;
    },
    requireSession: (request) => verifyToken(tokenFromRequest(request)),
  };
};
