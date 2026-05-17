const safeName = (value, fallback = "file") => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const normalizeCredential = (value) => String(value || "").trim().toLowerCase();

const normalizeKeyPrefix = (value) => String(value || "")
  .trim()
  .replace(/^\/+|\/+$/g, "")
  .replace(/\/+/g, "/");

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
  if (Array.isArray(galleries)) return new Map(galleries.map((gallery) => [gallery.key, gallery]));
  return new Map(Object.entries(galleries || {}).map(([key, gallery]) => [key, { key, ...gallery }]));
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
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  if (!privateBucket) throw new Error("createRealEstateOriginals requires a privateBucket R2 binding.");
  if (!store || typeof store.putDownload !== "function") throw new Error("createRealEstateOriginals requires a download store.");

  const galleriesByKey = galleryMapFor(galleries);

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
    const expectedUser = normalizeCredential(gallery.username || gallery.customer || "");
    const expectedCode = normalizeCredential(gallery.accessCode || "");
    const enteredUser = normalizeCredential(payload.username || payload.customer || "");
    const enteredCode = normalizeCredential(payload.accessCode || payload.password || "");
    if (!expectedUser || !expectedCode || enteredUser !== expectedUser || enteredCode !== expectedCode) {
      throw Object.assign(new Error("Real-estate originals require the client password."), {
        status: 403,
        code: "real_estate_auth_required",
      });
    }
  };

  const createSession = async (payload = {}) => {
    const galleryKey = String(payload.galleryKey || "").trim();
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

    return {
      galleryKey,
      sessionId,
      createdAt,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
      zipFilename: `${safeName(galleryKey, "real-estate")}-originals-${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.zip`,
      files,
    };
  };

  return { createSession };
};
