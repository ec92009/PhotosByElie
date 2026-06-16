const DEFAULT_SESSION_SECONDS = 2 * 60 * 60;
const SESSION_COOKIE_NAME = "pbe_re_session";

const normalizeCredential = (value) => String(value || "").trim().toLowerCase();

const b64urlEncode = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

const b64urlDecode = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const textBytes = (value) => new TextEncoder().encode(String(value || ""));

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

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const hmacKey = async (secret) => crypto.subtle.importKey(
  "raw",
  textBytes(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);

const sign = async (secret, payload) => {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textBytes(payload));
  return b64urlEncode(new Uint8Array(signature));
};

const parseCookies = (request) => {
  const header = request.headers.get("cookie") || "";
  return new Map(header.split(";").map((part) => {
    const [name, ...rest] = part.trim().split("=");
    return [decodeURIComponent(name || ""), decodeURIComponent(rest.join("=") || "")];
  }).filter(([name]) => name));
};

const galleryMapFor = (galleries) => {
  if (Array.isArray(galleries)) return new Map(galleries.map((gallery) => [gallery.key, gallery]));
  return new Map(Object.entries(galleries || {}).map(([key, gallery]) => [key, { key, ...gallery }]));
};

const publicSessionFor = (session) => ({
  galleryKey: session.galleryKey,
  username: session.username,
  expiresAt: session.expiresAt,
  sessionSeconds: Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000)),
});

const sessionError = (message = "Real-estate login is required.") => Object.assign(new Error(message), {
  status: 401,
  code: "real_estate_login_required",
});

export const realEstateCredentialHash = async (accessCode, salt) => {
  const cleanSalt = String(salt || "").trim();
  const cleanCode = normalizeCredential(accessCode);
  return cleanSalt && cleanCode ? sha256Hex(`${cleanSalt}:${cleanCode}`) : "";
};

export const createRealEstateAuth = ({
  galleries = [],
  sessionSecret = "",
  sessionSeconds = DEFAULT_SESSION_SECONDS,
  now = () => new Date(),
  cookieName = SESSION_COOKIE_NAME,
} = {}) => {
  const secret = String(sessionSecret || "").trim();
  if (!secret) throw new Error("createRealEstateAuth requires REAL_ESTATE_SESSION_SECRET.");

  const galleriesByKey = galleryMapFor(galleries);
  const ttlSeconds = Math.max(60, Math.min(24 * 60 * 60, Number(sessionSeconds) || DEFAULT_SESSION_SECONDS));

  const galleryFor = (galleryKey) => {
    const key = String(galleryKey || "").trim();
    const gallery = galleriesByKey.get(key);
    if (!gallery) {
      throw Object.assign(new Error("Real-estate gallery is not configured for client login."), {
        status: 404,
        code: "unknown_real_estate_gallery",
      });
    }
    return gallery;
  };

  const usernameMatches = (gallery, username) => {
    const expectedUsers = new Set([
      gallery.username,
      gallery.customer,
      gallery.email,
    ].map(normalizeCredential).filter(Boolean));
    return expectedUsers.size > 0 && expectedUsers.has(normalizeCredential(username));
  };

  const passwordMatches = async (gallery, accessCode) => {
    const enteredCode = normalizeCredential(accessCode);
    if (!enteredCode) return false;
    const hash = String(gallery.accessCodeHash || "").trim().toLowerCase();
    const salt = String(gallery.accessCodeSalt || "").trim();
    if (hash && salt) {
      return timingSafeEqual(await realEstateCredentialHash(enteredCode, salt), hash);
    }
    const expectedCode = normalizeCredential(gallery.accessCode || gallery.password || "");
    return Boolean(expectedCode) && timingSafeEqual(enteredCode, expectedCode);
  };

  const encodeSession = async (session) => {
    const payload = b64urlEncode(textBytes(JSON.stringify(session)));
    return `${payload}.${await sign(secret, payload)}`;
  };

  const decodeSession = async (token) => {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) throw sessionError();
    if (!timingSafeEqual(await sign(secret, payload), signature)) throw sessionError();
    let session;
    try {
      session = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    } catch {
      throw sessionError();
    }
    if (!session?.galleryKey || !session?.username || !session?.expiresAt) throw sessionError();
    if (Date.parse(session.expiresAt) <= now().getTime()) throw sessionError("Real-estate login has expired.");
    const gallery = galleryFor(session.galleryKey);
    if (!usernameMatches(gallery, session.username)) throw sessionError();
    return session;
  };

  const cookieFor = async (session, request) => {
    const url = new URL(request.url);
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return `${cookieName}=${encodeURIComponent(await encodeSession(session))}; Max-Age=${ttlSeconds}; Path=/real-estate; HttpOnly; SameSite=Lax${secure}`;
  };

  const clearCookieFor = () => `${cookieName}=; Max-Age=0; Path=/real-estate; HttpOnly; SameSite=Lax`;

  const login = async (payload = {}, request) => {
    const gallery = galleryFor(payload.galleryKey);
    if (!usernameMatches(gallery, payload.username || payload.customer || "")) {
      throw Object.assign(new Error("Credentials do not match this review."), {
        status: 403,
        code: "real_estate_auth_required",
      });
    }
    if (!await passwordMatches(gallery, payload.accessCode || payload.password || "")) {
      throw Object.assign(new Error("Credentials do not match this review."), {
        status: 403,
        code: "real_estate_auth_required",
      });
    }
    const createdAt = now();
    const session = {
      galleryKey: gallery.key,
      username: String(gallery.username || payload.username || payload.customer || "").trim(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString(),
    };
    return {
      session: publicSessionFor(session),
      cookie: await cookieFor(session, request),
    };
  };

  const sessionFromRequest = async (request) => decodeSession(parseCookies(request).get(cookieName));

  const requireSession = async (request, galleryKey = "") => {
    const session = await sessionFromRequest(request);
    if (galleryKey && session.galleryKey !== String(galleryKey || "").trim()) throw sessionError();
    return session;
  };

  return {
    login,
    requireSession,
    clearCookieFor,
    publicSessionFor,
  };
};
