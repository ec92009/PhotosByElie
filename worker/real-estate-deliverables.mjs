const normalizeCredential = (value) => String(value || "").trim().toLowerCase();

const normalizeKeyPrefix = (value) => String(value || "")
  .trim()
  .replace(/^\/+|\/+$/g, "")
  .replace(/\/+/g, "/");

const safeKeySegment = (value, label) => {
  const segment = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(segment)) {
    throw Object.assign(new Error(`${label} is not valid for real-estate product storage.`), {
      status: 400,
      code: "invalid_real_estate_deliverable",
      details: { label },
    });
  }
  return segment;
};

const safeRecordId = (value) => {
  const id = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  if (!id) {
    throw Object.assign(new Error("Real-estate product id is required."), {
      status: 400,
      code: "invalid_real_estate_deliverable",
      details: { label: "id" },
    });
  }
  return id;
};

const galleryMapFor = (galleries) => {
  if (Array.isArray(galleries)) return new Map(galleries.map((gallery) => [gallery.key, gallery]));
  return new Map(Object.entries(galleries || {}).map(([key, gallery]) => [key, { key, ...gallery }]));
};

const cloneJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const objectText = async (object) => {
  if (!object) return "";
  if (typeof object.text === "function") return object.text();
  if (typeof object.arrayBuffer === "function") {
    return new TextDecoder().decode(await object.arrayBuffer());
  }
  if (object.body instanceof Uint8Array) return new TextDecoder().decode(object.body);
  if (typeof object.body === "string") return object.body;
  return "";
};

const objectJson = async (object) => {
  const text = await objectText(object);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const defaultGalleries = [{
  key: "corine-real-estate",
  username: "Corine",
  accessCode: "",
  privateMasterPrefix: "real-estate/corine-real-estate/masters",
}];

export const createRealEstateDeliverables = ({
  privateBucket,
  galleries = defaultGalleries,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  if (!privateBucket) throw new Error("createRealEstateDeliverables requires a privateBucket R2 binding.");

  const galleriesByKey = galleryMapFor(galleries);

  const galleryFor = (payload = {}) => {
    const galleryKey = String(payload.galleryKey || "").trim();
    const gallery = galleriesByKey.get(galleryKey);
    if (!gallery) {
      throw Object.assign(new Error("Real-estate gallery is not configured for cloud products."), {
        status: 404,
        code: "unknown_real_estate_gallery",
      });
    }
    return gallery;
  };

  const authorize = (gallery, payload) => {
    const expectedUsers = new Set([
      gallery.username,
      gallery.customer,
      gallery.email,
    ].map(normalizeCredential).filter(Boolean));
    const expectedCode = normalizeCredential(gallery.accessCode || "");
    const enteredUser = normalizeCredential(payload.username || payload.customer || "");
    const enteredCode = normalizeCredential(payload.accessCode || payload.password || "");
    if (!expectedUsers.size || !expectedCode || !expectedUsers.has(enteredUser) || enteredCode !== expectedCode) {
      throw Object.assign(new Error("Real-estate products require the client password."), {
        status: 403,
        code: "real_estate_auth_required",
      });
    }
  };

  const prefixFor = (gallery) => {
    const galleryKey = safeKeySegment(gallery.key, "galleryKey");
    return normalizeKeyPrefix(gallery.deliverablesPrefix || `real-estate/${galleryKey}/deliverables`);
  };

  const keyFor = (gallery, id) => `${prefixFor(gallery)}/${safeRecordId(id)}.json`;

  const normalizeRecord = (gallery, incoming = {}) => {
    const batch = cloneJson(incoming.batch || incoming.manifest || incoming.selection || null);
    const batchId = String(batch?.batchId || incoming.batchId || "").trim();
    if (!batchId) {
      throw Object.assign(new Error("Real-estate product manifest is missing its batch id."), {
        status: 400,
        code: "invalid_real_estate_deliverable",
        details: { label: "batch.batchId" },
      });
    }

    const typeRaw = String(incoming.type || incoming.format || incoming.kind || "file").toLowerCase();
    const type = typeRaw === "mp4" ? "video" : typeRaw;
    const createdAt = String(incoming.createdAt || batch?.createdAt || now().toISOString());
    const id = safeRecordId(incoming.id || incoming.deliverableId || `${type}-${batchId}-${randomUUID().replace(/-/g, "").slice(0, 10)}`);
    return {
      id,
      type,
      title: String(incoming.title || incoming.projectTitle || incoming.name || `${type === "pdf" ? "PDF" : type === "video" ? "Video" : "File"}: ${gallery.key}`),
      createdAt,
      updatedAt: now().toISOString(),
      status: "ready",
      bytes: Number(incoming.bytes || incoming.size || 0) || 0,
      filename: String(incoming.filename || incoming.fileName || ""),
      galleryKey: gallery.key,
      batch,
    };
  };

  const listDeliverables = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const limit = Math.max(1, Math.min(100, Number(payload.limit) || 50));
    const prefix = `${prefixFor(gallery)}/`;
    const objects = [];
    let cursor = undefined;
    do {
      const result = await privateBucket.list({
        prefix,
        limit: Math.min(1000, Math.max(1, 1000 - objects.length)),
        cursor,
      });
      objects.push(...(result?.objects || []));
      cursor = result?.truncated ? result.cursor : undefined;
    } while (cursor && objects.length < 1000);

    const records = (await Promise.all(objects.map(async (object) => {
      const body = await objectJson(await privateBucket.get(object.key));
      return body && typeof body === "object" ? body : null;
    }))).filter(Boolean);

    records.sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")));
    return {
      galleryKey: gallery.key,
      count: records.length,
      deliverables: records.slice(0, limit),
    };
  };

  const putDeliverable = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const record = normalizeRecord(gallery, payload.deliverable || {});
    const text = JSON.stringify(record, null, 2);
    if (text.length > 1_000_000) {
      throw Object.assign(new Error("Real-estate product manifest is too large to save."), {
        status: 413,
        code: "real_estate_deliverable_too_large",
      });
    }
    await privateBucket.put(keyFor(gallery, record.id), new TextEncoder().encode(text), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        galleryKey: gallery.key,
        deliverableId: record.id,
        type: record.type,
      },
    });
    return record;
  };

  return { listDeliverables, putDeliverable };
};
