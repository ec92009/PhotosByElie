const DEFAULT_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const DEFAULT_COOKIE_NAME = "pbe_google_session";
const DEFAULT_SCOPE = "openid email profile";
const DEFAULT_SESSION_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_STATE_SECONDS = 10 * 60;
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const b64urlEncode = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const b64urlDecode = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const textBytes = (value) => textEncoder.encode(String(value || ""));

const jsonFromB64url = (value) => JSON.parse(textDecoder.decode(b64urlDecode(value)));

const timingSafeEqual = (left, right) => {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
};

const hmacKey = async (secret) => crypto.subtle.importKey(
  "raw",
  textBytes(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);

const sign = async (secret, payload) => {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), textBytes(payload));
  return b64urlEncode(new Uint8Array(signature));
};

const encodeSignedJson = async (secret, payload) => {
  const encodedPayload = b64urlEncode(textBytes(JSON.stringify(payload)));
  return `${encodedPayload}.${await sign(secret, encodedPayload)}`;
};

const signedJsonError = (message = "Google login is required.") => Object.assign(new Error(message), {
  status: 401,
  code: "google_login_required",
});

const decodeSignedJson = async (secret, token) => {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw signedJsonError();
  if (!timingSafeEqual(await sign(secret, payload), signature)) throw signedJsonError("Google login signature did not verify.");
  try {
    return jsonFromB64url(payload);
  } catch {
    throw signedJsonError();
  }
};

const parseCookies = (request) => {
  const header = request.headers.get("cookie") || "";
  return new Map(header.split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [decodeURIComponent(name || ""), decodeURIComponent(rest.join("=") || "")];
  }).filter(([name]) => name));
};

const bearerTokenFromRequest = (request) => {
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return match ? match[1] : "";
};

const responseError = (status, code, message) => Object.assign(new Error(message), { status, code });

const positiveInt = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
};

const boundedSeconds = (value, fallback, maxSeconds) =>
  Math.max(60, Math.min(maxSeconds, positiveInt(value, fallback)));

const redirectUriFor = (request) => {
  const url = new URL(request.url);
  return `${url.origin}/auth/google/callback`;
};

const sessionFromPayload = (payload, now) => {
  const email = String(payload?.email || "").trim().toLowerCase();
  const expiresAt = String(payload?.expiresAt || "");
  if (!email || !expiresAt || Date.parse(expiresAt) <= now().getTime()) throw signedJsonError("Google login has expired.");
  return {
    email,
    provider: "google-oauth",
    expiresAt,
    sessionSeconds: Math.max(0, Math.floor((Date.parse(expiresAt) - now().getTime()) / 1000)),
  };
};

const importVerificationKey = (jwk) => crypto.subtle.importKey(
  "jwk",
  jwk,
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["verify"]
);

const claimAudienceMatches = (claim, expected) => {
  const audiences = Array.isArray(claim) ? claim : [claim].filter(Boolean);
  return audiences.includes(expected);
};

const defaultVerifyIdToken = async ({ idToken, clientId, certs, now }) => {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw responseError(401, "google_id_token_missing", "Google did not return a usable ID token.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = jsonFromB64url(encodedHeader);
  if (header.alg !== "RS256" || !header.kid) {
    throw responseError(401, "google_id_token_unsupported", "Google ID token is not supported.");
  }
  const jwk = (await certs()).find((key) => key.kid === header.kid);
  if (!jwk) throw responseError(401, "google_id_token_unknown_key", "Google ID token key was not recognized.");
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await importVerificationKey(jwk),
    b64urlDecode(encodedSignature),
    textBytes(`${encodedHeader}.${encodedPayload}`)
  );
  if (!verified) throw responseError(401, "google_id_token_bad_signature", "Google ID token signature did not verify.");

  const claims = jsonFromB64url(encodedPayload);
  const nowSeconds = Math.floor(now().getTime() / 1000);
  if (Number(claims.exp || 0) <= nowSeconds) throw responseError(401, "google_id_token_expired", "Google ID token has expired.");
  if (!["https://accounts.google.com", "accounts.google.com"].includes(String(claims.iss || ""))) {
    throw responseError(401, "google_id_token_bad_issuer", "Google ID token issuer did not match.");
  }
  if (!claimAudienceMatches(claims.aud, clientId)) {
    throw responseError(401, "google_id_token_bad_audience", "Google ID token audience did not match.");
  }
  const email = String(claims.email || "").trim().toLowerCase();
  if (!email || claims.email_verified !== true) {
    throw responseError(401, "google_email_unverified", "Google did not return a verified email address.");
  }
  return {
    email,
    provider: "google-oauth",
    expiresAt: new Date(Number(claims.exp) * 1000).toISOString(),
    sessionSeconds: Math.max(0, Number(claims.exp) - nowSeconds),
  };
};

export const createGoogleOAuthAuth = ({
  clientId = "",
  clientSecret = "",
  sessionSecret = "",
  sessionSeconds = DEFAULT_SESSION_SECONDS,
  stateSeconds = DEFAULT_STATE_SECONDS,
  authUrl = DEFAULT_AUTH_URL,
  tokenUrl = DEFAULT_TOKEN_URL,
  certsUrl = DEFAULT_CERTS_URL,
  fetcher = fetch,
  now = () => new Date(),
  cookieName = DEFAULT_COOKIE_NAME,
  verifyIdToken = null,
} = {}) => {
  const cleanClientId = String(clientId || "").trim();
  const cleanClientSecret = String(clientSecret || "").trim();
  const cleanSessionSecret = String(sessionSecret || "").trim();
  if (!cleanClientId || !cleanClientSecret || !cleanSessionSecret) {
    throw new Error("createGoogleOAuthAuth requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_SESSION_SECRET.");
  }
  const ttlSeconds = boundedSeconds(sessionSeconds, DEFAULT_SESSION_SECONDS, 30 * 24 * 60 * 60);
  const stateTtlSeconds = boundedSeconds(stateSeconds, DEFAULT_STATE_SECONDS, 60 * 60);
  let certsPromise = null;

  const certs = async () => {
    if (!certsPromise) {
      certsPromise = fetcher(certsUrl)
        .then(async (response) => {
          if (!response.ok) throw responseError(503, "google_certs_unavailable", "Google certificates are unavailable.");
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

  const buildState = async (request, { returnTo = "", intent = "" } = {}) => {
    const issuedAt = now();
    return encodeSignedJson(cleanSessionSecret, {
      returnTo: String(returnTo || new URL(request.url).origin),
      intent: String(intent || ""),
      redirectUri: redirectUriFor(request),
      iat: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(issuedAt.getTime() / 1000) + stateTtlSeconds,
    });
  };

  const decodeState = async (token, request) => {
    const state = await decodeSignedJson(cleanSessionSecret, token);
    const nowSeconds = Math.floor(now().getTime() / 1000);
    if (Number(state.exp || 0) <= nowSeconds) {
      throw responseError(401, "google_oauth_state_expired", "Google login expired before it completed.");
    }
    const expectedRedirectUri = redirectUriFor(request);
    if (state.redirectUri !== expectedRedirectUri) {
      throw responseError(401, "google_oauth_state_mismatch", "Google login callback did not match the original request.");
    }
    return state;
  };

  const loginUrlFor = async (request, { returnTo = "", intent = "", prompt = "select_account" } = {}) => {
    const url = new URL(authUrl);
    url.searchParams.set("client_id", cleanClientId);
    url.searchParams.set("redirect_uri", redirectUriFor(request));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DEFAULT_SCOPE);
    url.searchParams.set("state", await buildState(request, { returnTo, intent }));
    url.searchParams.set("prompt", prompt || "select_account");
    url.searchParams.set("access_type", "online");
    return url.href;
  };

  const exchangeCode = async (request, code) => {
    const body = new URLSearchParams();
    body.set("code", code);
    body.set("client_id", cleanClientId);
    body.set("client_secret", cleanClientSecret);
    body.set("redirect_uri", redirectUriFor(request));
    body.set("grant_type", "authorization_code");
    const response = await fetcher(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw responseError(response.status || 502, "google_token_exchange_failed", payload?.error_description || payload?.error || "Google token exchange failed.");
    }
    if (!payload.id_token) throw responseError(502, "google_id_token_missing", "Google token response did not include an ID token.");
    return payload;
  };

  const verifyToken = async (idToken) => {
    if (typeof verifyIdToken === "function") {
      return verifyIdToken(idToken, { clientId: cleanClientId, now, certs });
    }
    return defaultVerifyIdToken({ idToken, clientId: cleanClientId, certs, now });
  };

  const sessionCookieSecurity = (request) => {
    const url = new URL(request.url);
    return url.protocol === "https:" ? "; SameSite=None; Secure" : "; SameSite=Lax";
  };

  const sessionTokenFor = async (identity, tokenSeconds = ttlSeconds) => {
    const createdAt = now();
    const boundedTokenSeconds = boundedSeconds(tokenSeconds, ttlSeconds, 30 * 24 * 60 * 60);
    const expiresAt = new Date(createdAt.getTime() + boundedTokenSeconds * 1000).toISOString();
    const session = {
      email: String(identity?.email || "").trim().toLowerCase(),
      provider: "google-oauth",
      createdAt: createdAt.toISOString(),
      expiresAt,
    };
    return encodeSignedJson(cleanSessionSecret, session);
  };

  const cookieForToken = (token, request) =>
    `${cookieName}=${encodeURIComponent(token)}; Max-Age=${ttlSeconds}; Path=/; HttpOnly${sessionCookieSecurity(request)}`;

  const clearCookieFor = (request) => `${cookieName}=; Max-Age=0; Path=/; HttpOnly${request ? sessionCookieSecurity(request) : "; SameSite=Lax"}`;

  const optionalSession = async (request) => {
    const token = bearerTokenFromRequest(request) || parseCookies(request).get(cookieName);
    if (!token) return null;
    return sessionFromPayload(await decodeSignedJson(cleanSessionSecret, token), now);
  };

  const requireSession = async (request) => {
    const session = await optionalSession(request);
    if (!session) throw signedJsonError();
    return session;
  };

  const handleCallback = async (request) => {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) {
      throw responseError(401, "google_oauth_denied", url.searchParams.get("error_description") || "Google login was not completed.");
    }
    const code = url.searchParams.get("code") || "";
    const state = await decodeState(url.searchParams.get("state") || "", request);
    if (!code) throw responseError(400, "google_oauth_missing_code", "Google login callback did not include a code.");
    const tokenPayload = await exchangeCode(request, code);
    const identity = await verifyToken(tokenPayload.id_token);
    const sessionToken = await sessionTokenFor(identity);
    const cookie = cookieForToken(sessionToken, request);
    return {
      identity,
      cookie,
      sessionToken,
      returnTo: state.returnTo || new URL(request.url).origin,
    };
  };

  return {
    provider: "google-oauth",
    loginUrlFor,
    handleCallback,
    issueSessionToken: sessionTokenFor,
    optionalSession,
    requireSession,
    clearCookieFor,
  };
};
