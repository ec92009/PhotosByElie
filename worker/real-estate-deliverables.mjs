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

const contentTypeFor = (type, filename = "") => {
  const extension = String(filename || "").split(".").pop()?.toLowerCase();
  if (type === "pdf" || extension === "pdf") return "application/pdf";
  if (type === "video" || ["mp4", "m4v"].includes(extension)) return "video/mp4";
  if (extension === "webm") return "video/webm";
  return "application/octet-stream";
};

const filenameFor = (record, output = {}) => String(
  output.filename
  || record.filename
  || `${record.id}.${record.type === "pdf" ? "pdf" : record.type === "video" ? "mp4" : "bin"}`
).replace(/["\r\n]+/g, "").trim();

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
    const session = payload.realEstateSession;
    if (session?.galleryKey === gallery.key && normalizeCredential(session.username)) return;
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

  const outputPrefixFor = (gallery) => normalizeKeyPrefix(`${prefixFor(gallery)}/outputs`);

  const outputKeyFor = (gallery, id, type) => {
    const extension = type === "pdf" ? "pdf" : "mp4";
    return `${outputPrefixFor(gallery)}/${safeRecordId(id)}.${extension}`;
  };

  const relativeAssetUrl = (id, action) => `/real-estate/deliverables/${encodeURIComponent(safeRecordId(id))}/${action}`;

  const publicRecordFor = (record) => {
    const ready = String(record?.status || "").toLowerCase() === "ready";
    if (!ready) return record;
    const output = record.outputs?.[record.type] || record.output || {};
    return {
      ...record,
      viewUrl: record.viewUrl || output.viewUrl || relativeAssetUrl(record.id, "view"),
      downloadUrl: record.downloadUrl || output.downloadUrl || relativeAssetUrl(record.id, "download"),
    };
  };

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
    const status = String(incoming.status || "ready").toLowerCase();
    return publicRecordFor({
      id,
      type,
      title: String(incoming.title || incoming.projectTitle || incoming.name || `${type === "pdf" ? "PDF" : type === "video" ? "Video" : "File"}: ${gallery.key}`),
      createdAt,
      updatedAt: now().toISOString(),
      status: ["pending", "queued", "processing", "ready", "failed", "needs-attention", "needs_attention"].includes(status)
        ? status.replace("_", "-")
        : "ready",
      bytes: Number(incoming.bytes || incoming.size || 0) || 0,
      filename: String(incoming.filename || incoming.fileName || ""),
      galleryKey: gallery.key,
      failureReason: String(incoming.failureReason || incoming.error || ""),
      viewUrl: String(incoming.viewUrl || ""),
      downloadUrl: String(incoming.downloadUrl || ""),
      output: cloneJson(incoming.output || null),
      outputs: cloneJson(incoming.outputs || null),
      assemblyJob: cloneJson(incoming.assemblyJob || null),
      batch,
    });
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
      deliverables: records.slice(0, limit).map(publicRecordFor),
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
    return publicRecordFor(record);
  };

  const submitAssemblyJob = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const batch = cloneJson(payload.batch || payload.manifest || payload.selection || null);
    const batchId = String(batch?.batchId || "").trim();
    if (!batchId) {
      throw Object.assign(new Error("Real-estate assembly jobs require a saved selection manifest with batchId."), {
        status: 400,
        code: "invalid_real_estate_assembly_job",
      });
    }
    const formats = (Array.isArray(payload.formats) ? payload.formats : [payload.type || payload.format || "pdf", "video"])
      .map((format) => String(format || "").toLowerCase())
      .map((format) => format === "mp4" || format === "slideshow" ? "video" : format)
      .filter((format) => format === "pdf" || format === "video")
      .filter((format, index, items) => items.indexOf(format) === index);
    if (!formats.length) {
      throw Object.assign(new Error("Real-estate assembly jobs require pdf or video output format."), {
        status: 400,
        code: "invalid_real_estate_assembly_job",
      });
    }

    const createdAt = now().toISOString();
    const jobId = safeRecordId(payload.jobId || `assembly-${batchId}-${randomUUID().replace(/-/g, "").slice(0, 10)}`);
    const title = String(payload.title || payload.name || batch.projectTitle || "Real Estate product");
    const records = formats.map((format) => {
      const recordId = safeRecordId(`${jobId}-${format}`);
      const filename = String(payload.filename || `${gallery.key}-${batchId}-${format === "pdf" ? "project-pdfs.pdf" : "slideshow.mp4"}`);
      return publicRecordFor({
        id: recordId,
        type: format,
        title,
        createdAt,
        updatedAt: createdAt,
        status: "pending",
        bytes: 0,
        filename,
        galleryKey: gallery.key,
        failureReason: "",
        outputs: {
          [format]: {
            key: outputKeyFor(gallery, recordId, format),
            filename,
            contentType: contentTypeFor(format, filename),
          },
        },
        assemblyJob: {
          id: jobId,
          status: "pending",
          submittedAt: createdAt,
          inputManifestSchema: batch.schema || "",
          inputManifestBatchId: batchId,
          inputManifestStorage: "embedded-in-deliverable-record",
          sourceVideoAudioPolicy: "duck-under-generated-guitar-bed",
          sourceVideoAudioGainDb: Number(batch?.slideshowSettings?.audioPolicy?.sourceVideoAudioGainDb ?? -20),
          generatedMusicGainDb: Number(batch?.slideshowSettings?.audioPolicy?.musicGainDb ?? 0),
          formats,
          failureReason: "",
        },
        batch,
      });
    });

    await Promise.all(records.map(async (record) => {
      const text = JSON.stringify(record, null, 2);
      if (text.length > 1_000_000) {
        throw Object.assign(new Error("Real-estate assembly job manifest is too large to save."), {
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
          assemblyJobId: jobId,
          status: record.status,
        },
      });
    }));
    return {
      galleryKey: gallery.key,
      job: {
        id: jobId,
        status: "pending",
        submittedAt: createdAt,
        formats,
      },
      deliverables: records,
    };
  };

  const getDeliverableAsset = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const id = safeRecordId(payload.id || payload.deliverableId || "");
    const action = String(payload.action || "download").toLowerCase() === "view" ? "view" : "download";
    const record = await objectJson(await privateBucket.get(keyFor(gallery, id)));
    if (!record) {
      throw Object.assign(new Error("Real-estate product was not found."), {
        status: 404,
        code: "unknown_real_estate_deliverable",
      });
    }
    if (String(record.status || "").toLowerCase() !== "ready") {
      throw Object.assign(new Error(record.failureReason || "Real-estate product is not ready yet."), {
        status: 409,
        code: record.status === "needs-attention" || record.status === "failed" ? "real_estate_deliverable_needs_attention" : "real_estate_deliverable_pending",
        details: { status: record.status, failureReason: record.failureReason || "" },
      });
    }
    const output = record.outputs?.[record.type] || record.output || {};
    const key = String(output.key || record.outputKey || "").replace(/^\/+/, "");
    if (!key) {
      throw Object.assign(new Error("Real-estate product is ready but has no output key."), {
        status: 409,
        code: "real_estate_deliverable_needs_attention",
      });
    }
    const object = await privateBucket.get(key);
    if (!object) {
      throw Object.assign(new Error("Real-estate product output is missing from private storage."), {
        status: 404,
        code: "missing_real_estate_deliverable_asset",
        details: { key },
      });
    }
    const filename = filenameFor(record, output);
    return {
      record: publicRecordFor(record),
      object,
      headers: {
        "content-type": output.contentType || object.httpMetadata?.contentType || contentTypeFor(record.type, filename),
        "content-disposition": `${action === "view" ? "inline" : "attachment"}; filename="${filename}"`,
        "cache-control": "private, max-age=60",
      },
    };
  };

  const deleteDeliverable = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const id = safeRecordId(payload.id || payload.deliverableId || payload.deliverable?.id || "");
    const key = keyFor(gallery, id);
    const existing = await privateBucket.get(key);
    if (typeof privateBucket.delete !== "function") {
      throw Object.assign(new Error("Real-estate product storage cannot delete records."), {
        status: 503,
        code: "real_estate_deliverables_unavailable",
      });
    }
    await privateBucket.delete(key);
    return {
      galleryKey: gallery.key,
      id,
      deleted: Boolean(existing),
    };
  };

  return { listDeliverables, putDeliverable, submitAssemblyJob, getDeliverableAsset, deleteDeliverable };
};
