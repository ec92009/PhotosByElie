export const NEWSLETTER_PATH_PREFIX = "/newsletter";

const SUPPORTED_LANGUAGES = new Set(["en", "fr", "es"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UNSUBSCRIBE_TOKEN_PATTERN = /^[a-f0-9]{32,128}$/i;
const DEFAULT_RATE_LIMIT_MAX = 8;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 3600;

export const isNewsletterRequest = (pathname = "") =>
  pathname === NEWSLETTER_PATH_PREFIX || pathname.startsWith(`${NEWSLETTER_PATH_PREFIX}/`);

const normalizeBaseUrl = (value, fallback) => {
  const candidate = String(value || fallback || "").trim();
  return candidate.replace(/\/+$/, "");
};

export const normalizeEmail = (value) => {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return "";
  return email;
};

export const normalizeLanguage = (value) => {
  const lang = String(value || "").trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.has(lang) ? lang : "en";
};

const normalizeSource = (value) => {
  const cleaned = String(value || "landing")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "landing";
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const randomHexToken = (byteLength = 24) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const WALLPAPER_COPY = {
  en: {
    items: [
      {
        id: "nerja-cove",
        title: "Nerja Cove in Full Light",
        location: "Andalusia, Spain",
        dimensions: "3400 × 1327 · Ultrawide",
        assetPath: "landing-concept/assets/pano-nerja.jpg",
        galleryPath: "gallery--spain.html",
      },
      {
        id: "san-gimignano",
        title: "San Gimignano Towers",
        location: "Tuscany, Italy",
        dimensions: "2200 × 1650 · Desktop & Tablet",
        assetPath: "landing-concept/assets/san-gimignano.jpg",
        galleryPath: "gallery--italy.html",
      },
      {
        id: "musee-dorsay",
        title: "Musée d’Orsay Panorama",
        location: "Paris, France",
        dimensions: "3400 × 1457 · Ultrawide",
        assetPath: "landing-concept/assets/pano-orsay.jpg",
        galleryPath: "gallery--france.html",
      },
    ],
    emailSubject: "Your free travel wallpaper pack from Photos By Elie",
    emailPreheader: "Three high-resolution travel wallpapers from Spain, Italy, and France — ready to download.",
    emailHeading: "Welcome to the Collector’s Note",
    emailIntro: "Thank you for joining Photos By Elie. Here is your complimentary set of three high-resolution travel wallpapers for your desktop, tablet, or screen.",
    emailNote: "I send occasional notes when a new country series, panorama, or seasonal gallery goes live — never spam, and you can unsubscribe in one click at any time.",
    downloadLabel: "Download wallpaper",
    galleryLabel: "Explore series",
    exploreAllLabel: "Browse the full collection",
    personalUseNote: "Included for personal screen and wallpaper use. Print-ready files and fine-art downloads start at USD 8 on photos-by-elie.com.",
    unsubscribeLabel: "Unsubscribe in one click",
    unsubscribedTitle: "You’re unsubscribed",
    unsubscribedBody: "Your email has been removed from the Photos By Elie Collector’s Note. You won’t receive future notes unless you choose to sign up again.",
    unsubscribeNotFoundTitle: "Unsubscribe link not found",
    unsubscribeNotFoundBody: "This unsubscribe link is no longer valid or has already been cleared. If you still need help, email ec92009@gmail.com.",
    backToSite: "Return to Photos By Elie",
  },
  fr: {
    items: [
      {
        id: "nerja-cove",
        title: "Crique de Nerja en pleine lumière",
        location: "Andalousie, Espagne",
        dimensions: "3400 × 1327 · Panoramique",
        assetPath: "landing-concept/assets/pano-nerja.jpg",
        galleryPath: "gallery--spain.html",
      },
      {
        id: "san-gimignano",
        title: "Les tours de San Gimignano",
        location: "Toscane, Italie",
        dimensions: "2200 × 1650 · Ordinateur & Tablette",
        assetPath: "landing-concept/assets/san-gimignano.jpg",
        galleryPath: "gallery--italy.html",
      },
      {
        id: "musee-dorsay",
        title: "Panorama du musée d’Orsay",
        location: "Paris, France",
        dimensions: "3400 × 1457 · Panoramique",
        assetPath: "landing-concept/assets/pano-orsay.jpg",
        galleryPath: "gallery--france.html",
      },
    ],
    emailSubject: "Votre pack gratuit de fonds d’écran — Photos By Elie",
    emailPreheader: "Trois fonds d’écran de voyage haute définition d’Espagne, d’Italie et de France prêts à télécharger.",
    emailHeading: "Bienvenue dans la Note du collectionneur",
    emailIntro: "Merci d’avoir rejoint Photos By Elie. Voici votre pack offert de trois photographies de voyage en haute définition pour vos écrans.",
    emailNote: "J’envoie des nouvelles occasionnelles lorsqu’une nouvelle série, un panorama ou une galerie saisonnière est publiée — jamais de spam, et désinscription en un clic à tout moment.",
    downloadLabel: "Télécharger le fond d’écran",
    galleryLabel: "Voir la série",
    exploreAllLabel: "Explorer toute la collection",
    personalUseNote: "Inclus pour un usage personnel sur écran. Les fichiers prêts à imprimer commencent à 8 USD sur photos-by-elie.com.",
    unsubscribeLabel: "Se désinscrire en un clic",
    unsubscribedTitle: "Vous êtes désinscrit(e)",
    unsubscribedBody: "Votre adresse e-mail a été retirée de la Note du collectionneur Photos By Elie. Vous ne recevrez plus de messages sauf nouvelle inscription.",
    unsubscribeNotFoundTitle: "Lien de désinscription introuvable",
    unsubscribeNotFoundBody: "Ce lien de désinscription n’est plus valide ou a déjà été utilisé. En cas de besoin, écrivez à ec92009@gmail.com.",
    backToSite: "Retourner sur Photos By Elie",
  },
  es: {
    items: [
      {
        id: "nerja-cove",
        title: "Cala de Nerja a plena luz",
        location: "Andalucía, España",
        dimensions: "3400 × 1327 · Panorámica",
        assetPath: "landing-concept/assets/pano-nerja.jpg",
        galleryPath: "gallery--spain.html",
      },
      {
        id: "san-gimignano",
        title: "Torres de San Gimignano",
        location: "Toscana, Italia",
        dimensions: "2200 × 1650 · Escritorio y Tableta",
        assetPath: "landing-concept/assets/san-gimignano.jpg",
        galleryPath: "gallery--italy.html",
      },
      {
        id: "musee-dorsay",
        title: "Panorámica del Museo de Orsay",
        location: "París, Francia",
        dimensions: "3400 × 1457 · Panorámica",
        assetPath: "landing-concept/assets/pano-orsay.jpg",
        galleryPath: "gallery--france.html",
      },
    ],
    emailSubject: "Tu pack gratuito de fondos de pantalla — Photos By Elie",
    emailPreheader: "Tres fondos de pantalla de viajes en alta resolución de España, Italia y Francia listos para descargar.",
    emailHeading: "Bienvenido a la Nota del coleccionista",
    emailIntro: "Gracias por unirte a Photos By Elie. Aquí tienes tu pack gratuito de tres fotografías de viajes en alta resolución para tu ordenador o tableta.",
    emailNote: "Envío notas ocasionales cuando publico una nueva serie de país, panorámica o galería — nunca spam, y puedes darte de baja en un solo clic en cualquier momento.",
    downloadLabel: "Descargar fondo",
    galleryLabel: "Explorar serie",
    exploreAllLabel: "Explorar toda la colección",
    personalUseNote: "Incluido para uso personal en pantalla. Los archivos listos para imprimir comienzan en 8 USD en photos-by-elie.com.",
    unsubscribeLabel: "Darse de baja en un clic",
    unsubscribedTitle: "Suscripción cancelada",
    unsubscribedBody: "Tu correo electrónico ha sido eliminado de la Nota del coleccionista de Photos By Elie. No recibirás más envíos salvo que vuelvas a suscribirte.",
    unsubscribeNotFoundTitle: "Enlace de baja no encontrado",
    unsubscribeNotFoundBody: "Este enlace de baja ya no es válido o fue procesado anteriormente. Si necesitas ayuda, escribe a ec92009@gmail.com.",
    backToSite: "Volver a Photos By Elie",
  },
};

export const wallpaperPackFor = ({ publicSiteUrl = "https://photos-by-elie.com", language = "en" } = {}) => {
  const siteBase = normalizeBaseUrl(publicSiteUrl, "https://photos-by-elie.com");
  const lang = normalizeLanguage(language);
  const pack = WALLPAPER_COPY[lang] || WALLPAPER_COPY.en;
  return pack.items.map((item) => ({
    id: item.id,
    title: item.title,
    location: item.location,
    dimensions: item.dimensions,
    downloadUrl: `${siteBase}/${item.assetPath}`,
    galleryUrl: `${siteBase}/${item.galleryPath}`,
  }));
};

export const buildWelcomeEmail = ({
  language = "en",
  publicSiteUrl = "https://photos-by-elie.com",
  unsubscribeUrl = "",
} = {}) => {
  const siteBase = normalizeBaseUrl(publicSiteUrl, "https://photos-by-elie.com");
  const lang = normalizeLanguage(language);
  const copy = WALLPAPER_COPY[lang] || WALLPAPER_COPY.en;
  const wallpapers = wallpaperPackFor({ publicSiteUrl: siteBase, language: lang });

  const itemCardsHtml = wallpapers.map((item) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #2c2b26;">
        <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 19px; color: #f7f3eb; margin-bottom: 4px;">${escapeHtml(item.title)}</div>
        <div style="font-size: 13px; color: #c4bfb2; margin-bottom: 10px;">${escapeHtml(item.location)} · ${escapeHtml(item.dimensions)}</div>
        <a href="${escapeHtml(item.downloadUrl)}" style="display: inline-block; padding: 9px 16px; border-radius: 999px; background: #f7f3eb; color: #11110f; text-decoration: none; font-size: 13px; font-weight: 700; margin-right: 10px;">${escapeHtml(copy.downloadLabel)}</a>
        <a href="${escapeHtml(item.galleryUrl)}" style="display: inline-block; padding: 9px 12px; color: #e2c792; text-decoration: underline; font-size: 13px;">${escapeHtml(copy.galleryLabel)}</a>
      </td>
    </tr>`).join("");

  const html = `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${escapeHtml(copy.emailSubject)}</title></head>
<body style="margin:0; padding:0; background:#11110f; color:#f7f3eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(copy.emailPreheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#11110f; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px; background:#191916; border:1px solid #2f2e28; border-radius:8px; padding:32px;">
          <tr>
            <td>
              <p style="margin:0 0 8px; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#d8bf8c; font-weight:700;">Photos By Elie</p>
              <h1 style="margin:0 0 16px; font-family: Georgia, 'Times New Roman', serif; font-size:28px; font-weight:500; line-height:1.2; color:#f7f3eb;">${escapeHtml(copy.emailHeading)}</h1>
              <p style="margin:0 0 14px; font-size:15px; line-height:1.6; color:#dcd7cb;">${escapeHtml(copy.emailIntro)}</p>
              <p style="margin:0 0 22px; font-size:14px; line-height:1.6; color:#b8b3a6;">${escapeHtml(copy.emailNote)}</p>
            </td>
          </tr>
          ${itemCardsHtml}
          <tr>
            <td style="padding-top:24px;">
              <a href="${escapeHtml(`${siteBase}/gallery.html?gallery=selection`)}" style="display:inline-block; padding:11px 20px; border:1px solid #d8bf8c; border-radius:999px; color:#f7f3eb; text-decoration:none; font-size:13px; font-weight:700;">${escapeHtml(copy.exploreAllLabel)}</a>
              <p style="margin:20px 0 0; font-size:12px; line-height:1.55; color:#9d988c;">${escapeHtml(copy.personalUseNote)}</p>
              ${unsubscribeUrl ? `<p style="margin:14px 0 0; font-size:12px; color:#9d988c;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#c4bfb2; text-decoration:underline;">${escapeHtml(copy.unsubscribeLabel)}</a></p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    copy.emailHeading,
    "",
    copy.emailIntro,
    "",
    ...wallpapers.flatMap((item) => [
      `${item.title} (${item.location} · ${item.dimensions})`,
      `${copy.downloadLabel}: ${item.downloadUrl}`,
      `${copy.galleryLabel}: ${item.galleryUrl}`,
      "",
    ]),
    copy.emailNote,
    "",
    `${copy.exploreAllLabel}: ${siteBase}/gallery.html?gallery=selection`,
    "",
    copy.personalUseNote,
    ...(unsubscribeUrl ? ["", `${copy.unsubscribeLabel}: ${unsubscribeUrl}`] : []),
  ];

  return {
    subject: copy.emailSubject,
    html,
    text: textLines.join("\n"),
  };
};

const renderUnsubscribePage = ({ language = "en", found = true, publicSiteUrl = "https://photos-by-elie.com" } = {}) => {
  const lang = normalizeLanguage(language);
  const copy = WALLPAPER_COPY[lang] || WALLPAPER_COPY.en;
  const siteBase = normalizeBaseUrl(publicSiteUrl, "https://photos-by-elie.com");
  const title = found ? copy.unsubscribedTitle : copy.unsubscribeNotFoundTitle;
  const body = found ? copy.unsubscribedBody : copy.unsubscribeNotFoundBody;
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)} | Photos By Elie</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #11110f; color: #f7f3eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 480px; padding: 32px; border: 1px solid rgba(255,255,255,0.16); border-radius: 10px; background: #191916; }
    p.eyebrow { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #d8bf8c; font-weight: 700; }
    h1 { margin: 0 0 14px; font-family: Georgia, "Times New Roman", serif; font-weight: 500; font-size: 30px; line-height: 1.15; }
    p { margin: 0 0 22px; color: #cbc6b9; line-height: 1.6; }
    a { display: inline-block; padding: 11px 18px; border-radius: 999px; background: #f7f3eb; color: #11110f; text-decoration: none; font-weight: 700; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Photos By Elie</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    <a href="${escapeHtml(`${siteBase}/`)}">${escapeHtml(copy.backToSite)}</a>
  </main>
</body>
</html>`;
};

export const createD1NewsletterStore = ({ database } = {}) => {
  if (!database || typeof database.prepare !== "function") {
    throw new Error("createD1NewsletterStore requires a D1 database binding.");
  }

  const upsertSubscriber = async ({ email, language = "en", source = "landing", now = new Date() } = {}) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error("Invalid subscriber email.");
    const lang = normalizeLanguage(language);
    const cleanSource = normalizeSource(source);
    const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();

    const existing = await database.prepare(
      `SELECT email, language, source, status, unsubscribe_token, subscribed_at, unsubscribed_at, welcome_sent_at, updated_at
       FROM newsletter_subscribers
       WHERE email = ?`,
    ).bind(normalizedEmail).first();

    if (!existing) {
      const token = randomHexToken(24);
      await database.prepare(
        `INSERT INTO newsletter_subscribers (
          email, language, source, status, unsubscribe_token, subscribed_at, unsubscribed_at, welcome_sent_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL, ?)`,
      ).bind(normalizedEmail, lang, cleanSource, token, timestamp, timestamp).run();

      return {
        created: true,
        reactivated: false,
        alreadyActive: false,
        subscriber: {
          email: normalizedEmail,
          language: lang,
          source: cleanSource,
          status: "active",
          unsubscribeToken: token,
          subscribedAt: timestamp,
          unsubscribedAt: null,
          welcomeSentAt: null,
          updatedAt: timestamp,
        },
      };
    }

    const wasUnsubscribed = existing.status !== "active";
    const token = existing.unsubscribe_token || randomHexToken(24);
    await database.prepare(
      `UPDATE newsletter_subscribers
       SET language = ?, source = ?, status = 'active', unsubscribe_token = ?, unsubscribed_at = NULL, updated_at = ?
       WHERE email = ?`,
    ).bind(lang, cleanSource, token, timestamp, normalizedEmail).run();

    return {
      created: false,
      reactivated: wasUnsubscribed,
      alreadyActive: !wasUnsubscribed,
      subscriber: {
        email: normalizedEmail,
        language: lang,
        source: cleanSource,
        status: "active",
        unsubscribeToken: token,
        subscribedAt: existing.subscribed_at,
        unsubscribedAt: null,
        welcomeSentAt: existing.welcome_sent_at || null,
        updatedAt: timestamp,
      },
    };
  };

  const markWelcomeSent = async ({ email, sentAt = new Date() } = {}) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;
    const timestamp = (sentAt instanceof Date ? sentAt : new Date(sentAt)).toISOString();
    await database.prepare(
      `UPDATE newsletter_subscribers SET welcome_sent_at = ?, updated_at = ? WHERE email = ?`,
    ).bind(timestamp, timestamp, normalizedEmail).run();
  };

  const unsubscribeByToken = async ({ token, now = new Date() } = {}) => {
    const cleanToken = String(token || "").trim();
    if (!UNSUBSCRIBE_TOKEN_PATTERN.test(cleanToken)) {
      return { found: false, alreadyUnsubscribed: false, language: "en" };
    }
    const existing = await database.prepare(
      `SELECT email, language, status FROM newsletter_subscribers WHERE unsubscribe_token = ?`,
    ).bind(cleanToken).first();
    if (!existing) {
      return { found: false, alreadyUnsubscribed: false, language: "en" };
    }
    const alreadyUnsubscribed = existing.status === "unsubscribed";
    if (!alreadyUnsubscribed) {
      const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
      await database.prepare(
        `UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ? WHERE unsubscribe_token = ?`,
      ).bind(timestamp, timestamp, cleanToken).run();
    }
    return {
      found: true,
      alreadyUnsubscribed,
      email: existing.email,
      language: normalizeLanguage(existing.language),
    };
  };

  const listSubscribers = async ({ status = "active", limit = 500 } = {}) => {
    const cappedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    const normalizedStatus = ["active", "unsubscribed", "all"].includes(status) ? status : "active";
    const countRows = await database.prepare(
      `SELECT status, COUNT(*) AS count FROM newsletter_subscribers GROUP BY status`,
    ).all();
    const counts = { active: 0, unsubscribed: 0 };
    for (const row of countRows?.results || []) {
      if (row.status === "active") counts.active = Number(row.count || 0);
      if (row.status === "unsubscribed") counts.unsubscribed = Number(row.count || 0);
    }

    const listQuery = normalizedStatus === "all"
      ? database.prepare(
        `SELECT email, language, source, status, subscribed_at, unsubscribed_at, welcome_sent_at, updated_at
         FROM newsletter_subscribers
         ORDER BY subscribed_at DESC
         LIMIT ?`,
      ).bind(cappedLimit)
      : database.prepare(
        `SELECT email, language, source, status, subscribed_at, unsubscribed_at, welcome_sent_at, updated_at
         FROM newsletter_subscribers
         WHERE status = ?
         ORDER BY subscribed_at DESC
         LIMIT ?`,
      ).bind(normalizedStatus, cappedLimit);
    const listResult = await listQuery.all();
    return {
      total: counts.active + counts.unsubscribed,
      active: counts.active,
      unsubscribed: counts.unsubscribed,
      subscribers: (listResult?.results || []).map((row) => ({
        email: row.email,
        language: row.language,
        source: row.source,
        status: row.status,
        subscribedAt: row.subscribed_at,
        unsubscribedAt: row.unsubscribed_at || null,
        welcomeSentAt: row.welcome_sent_at || null,
        updatedAt: row.updated_at,
      })),
    };
  };

  return {
    upsertSubscriber,
    markWelcomeSent,
    unsubscribeByToken,
    listSubscribers,
  };
};

const isAllowedCorsOrigin = (origin, allowedOrigins = []) => {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
      return true;
    }
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
};

const corsHeadersFor = (request, allowedOrigins) => {
  const origin = request.headers.get("origin") || "";
  const headers = {
    vary: "Origin",
    "cache-control": "no-store",
  };
  if (isAllowedCorsOrigin(origin, allowedOrigins)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type, authorization";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
};

const jsonResponse = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  },
});

const checkRateLimit = async ({ rateLimitKv, request, kvPrefix = "pbe", max = DEFAULT_RATE_LIMIT_MAX, windowSeconds = DEFAULT_RATE_LIMIT_WINDOW_SECONDS }) => {
  if (!rateLimitKv || typeof rateLimitKv.get !== "function" || typeof rateLimitKv.put !== "function") {
    return { allowed: true };
  }
  const clientIp = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!clientIp) return { allowed: true };
  const ipHash = (await sha256Hex(`newsletter:${clientIp}`)).slice(0, 24);
  const key = `${kvPrefix}:newsletter:rl:${ipHash}`;
  const current = Number(await rateLimitKv.get(key) || "0") || 0;
  if (current >= max) {
    return { allowed: false };
  }
  await rateLimitKv.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return { allowed: true };
};

const requireAdminAuthorization = async ({ request, connectorAuth, ownerAuth }) => {
  const hasBearer = /^Bearer\s+.+/i.test(String(request.headers.get("authorization") || "").trim());
  if (hasBearer && connectorAuth?.requireConnector) {
    return connectorAuth.requireConnector(request);
  }
  if (ownerAuth?.requireSession) {
    return ownerAuth.requireSession(request);
  }
  if (connectorAuth?.requireConnector) {
    return connectorAuth.requireConnector(request);
  }
  throw Object.assign(new Error("Owner authentication is not configured."), {
    status: 503,
    code: "owner_auth_unavailable",
  });
};

const csvCell = (value) => {
  const raw = String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};

export const handleNewsletterRequest = async (request, {
  store = null,
  emailClient = null,
  rateLimitKv = null,
  kvPrefix = "pbe",
  publicSiteUrl = "https://photos-by-elie.com",
  workerPublicUrl = "",
  ownerAuth = null,
  connectorAuth = null,
  rateLimitMax = DEFAULT_RATE_LIMIT_MAX,
  now = () => new Date(),
} = {}) => {
  const url = new URL(request.url);
  const siteBase = normalizeBaseUrl(publicSiteUrl, "https://photos-by-elie.com");
  const workerBase = normalizeBaseUrl(workerPublicUrl, url.origin);
  const allowedOrigins = [...new Set([
    "https://photos-by-elie.com",
    "https://www.photos-by-elie.com",
    (() => { try { return new URL(siteBase).origin; } catch { return ""; } })(),
  ].filter(Boolean))];
  const corsHeaders = corsHeadersFor(request, allowedOrigins);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!store) {
    return jsonResponse(
      { ok: false, error: "newsletter_store_unavailable", message: "Newsletter storage is temporarily unavailable." },
      { status: 503, headers: corsHeaders },
    );
  }

  if (url.pathname === `${NEWSLETTER_PATH_PREFIX}/subscribe`) {
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
    }
    let payload = {};
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400, headers: corsHeaders });
    }

    const language = normalizeLanguage(payload?.language);
    const wallpapers = wallpaperPackFor({ publicSiteUrl: siteBase, language });

    // Honeypot field: silently absorb spam bots without touching D1 or Resend.
    if (String(payload?.website || "").trim()) {
      return jsonResponse({
        ok: true,
        alreadySubscribed: false,
        emailSent: false,
        wallpapers,
      }, { status: 200, headers: corsHeaders });
    }

    const email = normalizeEmail(payload?.email);
    if (!email) {
      return jsonResponse({
        ok: false,
        error: "invalid_email",
        message: "Please enter a valid email address.",
      }, { status: 400, headers: corsHeaders });
    }

    const rateCheck = await checkRateLimit({
      rateLimitKv,
      request,
      kvPrefix,
      max: rateLimitMax,
    });
    if (!rateCheck.allowed) {
      return jsonResponse({
        ok: false,
        error: "rate_limited",
        message: "Too many signup attempts. Please try again later.",
      }, { status: 429, headers: corsHeaders });
    }

    const currentNow = now();
    const result = await store.upsertSubscriber({
      email,
      language,
      source: payload?.source || "landing",
      now: currentNow,
    });

    let emailSent = false;
    const shouldSendWelcome = Boolean(emailClient) && (
      result.created || result.reactivated || !result.subscriber.welcomeSentAt
    );
    if (shouldSendWelcome) {
      const unsubscribeUrl = `${workerBase}${NEWSLETTER_PATH_PREFIX}/unsubscribe?token=${encodeURIComponent(result.subscriber.unsubscribeToken)}`;
      const emailMessage = buildWelcomeEmail({
        language,
        publicSiteUrl: siteBase,
        unsubscribeUrl,
      });
      const idempotencyScope = result.reactivated
        ? `reactivated-${currentNow.toISOString().slice(0, 10)}`
        : "welcome";
      try {
        await emailClient.send({
          to: email,
          subject: emailMessage.subject,
          html: emailMessage.html,
          text: emailMessage.text,
          idempotencyKey: `newsletter-${idempotencyScope}-${result.subscriber.unsubscribeToken.slice(0, 20)}`,
        });
        emailSent = true;
        await store.markWelcomeSent({ email, sentAt: currentNow });
      } catch {
        // Subscription is persisted and instant wallpaper links are returned on screen even if email delivery hiccups.
        emailSent = false;
      }
    }

    return jsonResponse({
      ok: true,
      alreadySubscribed: result.alreadyActive,
      emailSent,
      wallpapers,
    }, { status: 200, headers: corsHeaders });
  }

  if (url.pathname === `${NEWSLETTER_PATH_PREFIX}/unsubscribe`) {
    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
    }
    let token = url.searchParams.get("token") || "";
    if (!token && request.method === "POST") {
      const contentType = String(request.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const body = await request.json().catch(() => ({}));
        token = String(body?.token || "");
      } else {
        const bodyText = await request.text().catch(() => "");
        token = new URLSearchParams(bodyText).get("token") || "";
      }
    }
    const outcome = await store.unsubscribeByToken({ token, now: now() });
    const accept = String(request.headers.get("accept") || "").toLowerCase();
    if (accept.includes("application/json") && !accept.includes("text/html")) {
      return jsonResponse({
        ok: outcome.found,
        unsubscribed: outcome.found,
        alreadyUnsubscribed: outcome.alreadyUnsubscribed,
      }, { status: outcome.found ? 200 : 404, headers: corsHeaders });
    }
    const html = renderUnsubscribePage({
      language: outcome.language,
      found: outcome.found,
      publicSiteUrl: siteBase,
    });
    return new Response(html, {
      status: outcome.found ? 200 : 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  if (url.pathname === `${NEWSLETTER_PATH_PREFIX}/subscribers`) {
    if (request.method !== "GET") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
    }
    try {
      await requireAdminAuthorization({ request, connectorAuth, ownerAuth });
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error?.code || "unauthorized", message: error?.message || "Unauthorized." },
        { status: Number(error?.status) || 401, headers: corsHeaders },
      );
    }

    const statusFilter = url.searchParams.get("status") || "active";
    const limit = url.searchParams.get("limit") || "500";
    const format = (url.searchParams.get("format") || "json").toLowerCase();
    const listing = await store.listSubscribers({ status: statusFilter, limit });

    if (format === "csv") {
      const header = "email,language,source,status,subscribed_at,unsubscribed_at,welcome_sent_at";
      const rows = listing.subscribers.map((row) => [
        row.email,
        row.language,
        row.source,
        row.status,
        row.subscribedAt,
        row.unsubscribedAt || "",
        row.welcomeSentAt || "",
      ].map(csvCell).join(","));
      return new Response([header, ...rows].join("\n"), {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="photosbyelie-subscribers.csv"',
        },
      });
    }

    return jsonResponse({ ok: true, ...listing }, { status: 200, headers: corsHeaders });
  }

  return jsonResponse({ ok: false, error: "not_found" }, { status: 404, headers: corsHeaders });
};
