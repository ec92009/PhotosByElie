import { canonicalRealEstateGalleryKey } from "./real-estate-gallery-key.mjs";

const safeName = (value, fallback = "file") => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const normalizeCredential = (value) => String(value || "").trim().toLowerCase();

const normalizeKeyPrefix = (value) => String(value || "")
  .trim()
  .replace(/^\/+|\/+$/g, "")
  .replace(/\/+/g, "/");

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const safeKeySegment = (value, label) => {
  const segment = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(segment)) {
    throw Object.assign(new Error(`${label} is not valid for real-estate originals delivery.`), {
      status: 400,
      code: "invalid_real_estate_item",
      details: { label },
    });
  }
  return segment;
};

const basename = (value) => String(value || "").split(/[\\/]/).pop();

const extensionFor = (value) => {
  const match = String(value || "").match(/\.([A-Za-z0-9]+)$/);
  const extension = match ? match[1].toLowerCase() : "jpg";
  if (extension === "jpg" || extension === "jpeg") return extension;
  if (extension === "jpe") return "jpg";
  if (!["mov", "mp4", "m4v"].includes(extension)) {
    throw Object.assign(new Error("Real-estate originals currently support JPG and video masters."), {
      status: 400,
      code: "unsupported_real_estate_original",
      details: { extension },
    });
  }
  return extension;
};

const contentTypeFor = (extension) => {
  if (["jpg", "jpeg"].includes(extension)) return "image/jpeg";
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  return "application/octet-stream";
};

const objectMetadata = async (bucket, key) => {
  if (!key) return null;
  if (typeof bucket.head === "function") return bucket.head(key);
  return bucket.get(key);
};

const objectBytes = (object) => {
  const size = Number(object?.size);
  if (Number.isFinite(size) && size >= 0) return size;
  const bodyLength = Number(object?.body?.length);
  return Number.isFinite(bodyLength) && bodyLength >= 0 ? bodyLength : 0;
};

const galleryMapFor = (galleries) => {
  const entries = Array.isArray(galleries)
    ? galleries.map((gallery) => [gallery.key, gallery])
    : Object.entries(galleries || {}).map(([key, gallery]) => [key, { key, ...gallery }]);
  return new Map(entries.map(([key, gallery]) => [canonicalRealEstateGalleryKey(key), gallery]));
};

const uniqueName = (name, usedNames) => {
  const clean = safeName(name, "real-estate-original.jpg");
  const normalized = clean.toLowerCase();
  if (!usedNames.has(normalized)) {
    usedNames.add(normalized);
    return clean;
  }
  const match = clean.match(/^(.*?)(\.[^.]+)?$/);
  const stem = match?.[1] || clean;
  const extension = match?.[2] || "";
  let counter = 2;
  while (usedNames.has(`${stem}-${counter}${extension}`.toLowerCase())) counter += 1;
  const next = `${stem}-${counter}${extension}`;
  usedNames.add(next.toLowerCase());
  return next;
};

const defaultGalleries = [{
  key: "corine-real-estate",
  username: "Corine",
  accessCode: "",
  privateMasterPrefix: "real-estate/corine-real-estate/masters",
  maxItems: 300,
}];

export const createRealEstateOriginals = ({
  privateBucket,
  store,
  galleries = defaultGalleries,
  emailClient = null,
  downloadBaseUrl = "",
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  if (!privateBucket) throw new Error("createRealEstateOriginals requires a privateBucket R2 binding.");
  if (!store || typeof store.putDownload !== "function") throw new Error("createRealEstateOriginals requires a download store.");

  const galleriesByKey = galleryMapFor(galleries);

  const absoluteUrl = (path) => {
    const value = String(path || "");
    if (/^https?:\/\//i.test(value)) return value;
    const base = String(downloadBaseUrl || "").replace(/\/+$/, "");
    return base ? `${base}${value.startsWith("/") ? "" : "/"}${value}` : value;
  };

  const propertyContextFor = (gallery, payload, files) => {
    const explicit = String(payload.propertyTitle || payload.property || gallery.propertyTitle || gallery.property || "").trim();
    if (explicit) return explicit;
    const firstTitle = String(payload.items?.[0]?.title || files?.[0]?.name || "").trim();
    return firstTitle.replace(/\s+-\s+.*$/, "").replace(/-\d{2,3}-.+$/, "").trim() || gallery.key;
  };

  const sendOriginalsEmail = async ({ gallery, payload, session, files }) => {
    const requestedAt = now().toISOString();
    const to = String(payload.email || payload.clientEmail || gallery.email || "").trim();
    if (!emailClient || typeof emailClient.send !== "function") {
      return {
        status: "not_configured",
        decision: "send_originals_links",
        requestedAt,
        reason: "email_client_unavailable",
      };
    }
    if (!to) {
      return {
        status: "not_sent",
        decision: "send_originals_links",
        requestedAt,
        reason: "client_email_unavailable",
      };
    }
    const client = String(gallery.customer || gallery.username || payload.username || "Real Estate client").trim();
    const property = propertyContextFor(gallery, payload, files);
    const links = files.map((file) => ({
      ...file,
      href: absoluteUrl(file.downloadUrl),
    }));
    const textLines = [
      `Hello ${client},`,
      "",
      `Your Photos By Elie original files for ${property} are ready.`,
      "",
      "Download links:",
      ...links.map((file) => `- ${file.name}: ${file.href}`),
      "",
      "These links open the selected original files directly. If a link is unavailable, reply with this session id so support can check it:",
      session.sessionId,
    ];
    const html = [
      `<p>Hello ${escapeHtml(client)},</p>`,
      `<p>Your Photos By Elie original files for <strong>${escapeHtml(property)}</strong> are ready.</p>`,
      "<ul>",
      ...links.map((file) => `<li><a href="${escapeHtml(file.href)}">${escapeHtml(file.name)}</a></li>`),
      "</ul>",
      `<p>These links open the selected original files directly. If a link is unavailable, reply with this session id so support can check it: <strong>${escapeHtml(session.sessionId)}</strong></p>`,
    ].join("");
    const idempotencyKey = `photosbyelie-real-estate-originals-${session.sessionId}`;
    try {
      const result = await emailClient.send({
        to,
        subject: `Photos By Elie originals ready - ${property}`,
        text: textLines.join("\n"),
        html,
        idempotencyKey,
      });
      return {
        status: "sent",
        decision: "send_originals_links",
        provider: result.provider || emailClient.provider || "email",
        messageId: result.messageId || null,
        idempotencyKey: result.idempotencyKey || idempotencyKey,
        directLinkCount: links.length,
        sentAt: now().toISOString(),
      };
    } catch (error) {
      return {
        status: "failed",
        decision: "send_originals_links",
        provider: emailClient.provider || "email",
        idempotencyKey,
        directLinkCount: links.length,
        failedAt: now().toISOString(),
        error: {
          code: error?.code || "delivery_email_failed",
          message: error?.message || "Delivery email could not be sent.",
        },
      };
    }
  };

  const originalKeyFor = (gallery, item) => {
    const albumSlug = safeKeySegment(item.albumSlug, "albumSlug");
    const photoId = safeKeySegment(item.photoId, "photoId");
    const extension = extensionFor(item.sourceFile || item.full || item.originalFile || photoId);
    const prefix = normalizeKeyPrefix(gallery.privateMasterPrefix || `real-estate/${gallery.key}/masters`);
    return {
      key: `${prefix}/${albumSlug}/${photoId}.${extension}`,
      extension,
    };
  };

  const authorize = (gallery, payload) => {
    const session = payload.realEstateSession;
    if (
      canonicalRealEstateGalleryKey(session?.galleryKey) === canonicalRealEstateGalleryKey(gallery.key)
      && normalizeCredential(session?.username)
    ) return;
    const expectedUsers = new Set([
      gallery.username,
      gallery.customer,
      gallery.email,
    ].map(normalizeCredential).filter(Boolean));
    const expectedCode = normalizeCredential(gallery.accessCode || "");
    const enteredUser = normalizeCredential(payload.username || payload.customer || "");
    const enteredCode = normalizeCredential(payload.accessCode || payload.password || "");
    if (!expectedUsers.size || !expectedCode || !expectedUsers.has(enteredUser) || enteredCode !== expectedCode) {
      throw Object.assign(new Error("Real-estate originals require the client password."), {
        status: 403,
        code: "real_estate_auth_required",
      });
    }
  };

  const createSession = async (payload = {}) => {
    const galleryKey = canonicalRealEstateGalleryKey(payload.galleryKey);
    const gallery = galleriesByKey.get(galleryKey);
    if (!gallery) {
      throw Object.assign(new Error("Real-estate gallery is not configured for originals delivery."), {
        status: 404,
        code: "unknown_real_estate_gallery",
      });
    }
    authorize(gallery, payload);

    const incomingItems = Array.isArray(payload.items) ? payload.items : [];
    const maxItems = Number(gallery.maxItems) || 300;
    if (!incomingItems.length || incomingItems.length > maxItems) {
      throw Object.assign(new Error(`Choose between 1 and ${maxItems} real-estate originals.`), {
        status: 400,
        code: "invalid_real_estate_original_count",
      });
    }

    const seenIds = new Set();
    const usedNames = new Set();
    const requested = incomingItems.map((item, index) => {
      const photoId = safeKeySegment(item.photoId, "photoId");
      if (seenIds.has(photoId)) return null;
      seenIds.add(photoId);
      const { key, extension } = originalKeyFor(gallery, item);
      const sourceBase = basename(item.sourceFile || item.full || `${photoId}.${extension}`);
      const paddedIndex = String(Number(item.sortIndex) || index + 1).padStart(3, "0");
      const title = safeName(item.title || photoId, photoId);
      const filename = uniqueName(`${paddedIndex}-${title}-${sourceBase}`, usedNames);
      return {
        photoId,
        objectKey: key,
        name: filename,
        contentType: contentTypeFor(extension),
      };
    }).filter(Boolean);

    const metadata = await Promise.all(requested.map(async (item) => ({
      item,
      object: await objectMetadata(privateBucket, item.objectKey),
    })));
    const missing = metadata
      .filter(({ object }) => !object)
      .map(({ item }) => ({
        photoId: item.photoId,
        objectKey: item.objectKey,
        code: "missing_real_estate_original",
      }));
    if (missing.length) {
      throw Object.assign(new Error("Some real-estate originals are not ready in private storage."), {
        status: 409,
        code: "real_estate_originals_unavailable",
        details: { missing },
      });
    }

    const createdAt = now().toISOString();
    const sessionId = `RE-${createdAt.slice(0, 10).replace(/-/g, "")}-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const files = await Promise.all(metadata.map(async ({ item, object }) => {
      const token = `re_${randomUUID().replace(/-/g, "").slice(0, 28)}`;
      const bytes = objectBytes(object);
      await store.putDownload({
        token,
        orderId: sessionId,
        bucket: "private",
        objectKey: item.objectKey,
        filename: item.name,
        contentType: item.contentType,
        bytes,
        photoId: item.photoId,
        productId: "real-estate-original",
        createdAt,
        downloadCount: 0,
      });
      return {
        photoId: item.photoId,
        name: item.name,
        bytes,
        contentType: item.contentType,
        downloadUrl: `/download/${token}`,
      };
    }));

    const session = {
      galleryKey,
      sessionId,
      createdAt,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
      zipFilename: `${safeName(galleryKey, "real-estate")}-originals-${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.zip`,
      files,
    };
    const deliveryEmail = await sendOriginalsEmail({ gallery, payload, session, files });
    const withEmail = { ...session, deliveryEmail };
    if (typeof store.putOrder === "function") {
      await store.putOrder({
        id: sessionId,
        type: "real_estate_originals",
        status: "ready",
        galleryKey,
        client: String(gallery.customer || gallery.username || payload.username || "").trim(),
        property: propertyContextFor(gallery, payload, files),
        createdAt,
        updatedAt: deliveryEmail.sentAt || deliveryEmail.failedAt || deliveryEmail.requestedAt || createdAt,
        delivery: {
          files,
          fileCount: files.length,
          totalBytes: withEmail.totalBytes,
        },
        deliveryEmail,
      });
    }
    return withEmail;
  };

  return { createSession };
};
