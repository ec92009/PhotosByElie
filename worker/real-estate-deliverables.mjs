import { canonicalRealEstateGalleryKey } from "./real-estate-gallery-key.mjs";

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
  if (extension === "webm") return "video/webm";
  if (type === "video" || ["mp4", "m4v"].includes(extension)) return "video/mp4";
  return "application/octet-stream";
};

const safeFilename = (value, fallback = "output.bin") => {
  const filename = String(value || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/["\r\n\0]+/g, "")
    .trim();
  return (filename || fallback).slice(0, 220);
};

const filenameFor = (record, output = {}) => String(
  output.filename
  || record.filename
  || `${record.id}.${record.type === "pdf" ? "pdf" : record.type === "video" ? "mp4" : "bin"}`
).replace(/["\r\n]+/g, "").trim();

const galleryMapFor = (galleries) => {
  const entries = Array.isArray(galleries)
    ? galleries.map((gallery) => [gallery.key, gallery])
    : Object.entries(galleries || {}).map(([key, gallery]) => [key, { key, ...gallery }]);
  return new Map(entries.map(([key, gallery]) => [canonicalRealEstateGalleryKey(key), gallery]));
};

const cloneJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const textBytes = (value) => new TextEncoder().encode(String(value || ""));

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

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
  emailClient = null,
  publicSiteUrl = "",
  assemblyDispatcher = null,
  videoTranscoder = null,
  renderTokenTtlSeconds = 20 * 60,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  if (!privateBucket) throw new Error("createRealEstateDeliverables requires a privateBucket R2 binding.");

  const galleriesByKey = galleryMapFor(galleries);

  const workspaceUrlFor = (gallery) => {
    const base = String(publicSiteUrl || "").replace(/\/+$/, "");
    const path = `/real-estate.html?client=${encodeURIComponent(gallery.key)}`;
    return base ? `${base}${path}` : path;
  };

  const propertyContextFor = (gallery, record) => {
    const explicit = String(record?.batch?.projects?.[0]?.projectTitle || record?.propertyTitle || gallery.propertyTitle || gallery.property || "").trim();
    if (explicit) return explicit;
    return String(record?.title || gallery.key || "Real Estate project").replace(/^(PDF|Video|File):\s*/i, "").trim();
  };

  const emailDecisionFor = (record) => {
    const type = String(record?.type || "").toLowerCase();
    const status = String(record?.status || "").toLowerCase();
    if (type === "selection") {
      return {
        status: "not_sent",
        decision: "shelf_only",
        reason: "saved_selection_is_resumable_from_real_estate_shelf",
        decidedAt: now().toISOString(),
      };
    }
    if ((type === "pdf" || type === "video") && status === "ready") {
      return null;
    }
    if (record?.assemblyJob) {
      return {
        status: "not_sent",
        decision: "email_when_ready_asset_available",
        reason: "pending_cloud_assembly_is_tracked_on_real_estate_shelf",
        decidedAt: now().toISOString(),
      };
    }
    return {
      status: "not_sent",
      decision: "shelf_only",
      reason: "client_can_review_status_on_real_estate_shelf",
      decidedAt: now().toISOString(),
    };
  };

  const sendReadyDeliverableEmail = async (gallery, record) => {
    const requestedAt = now().toISOString();
    const decision = emailDecisionFor(record);
    if (decision) return decision;
    const to = String(gallery.email || record?.clientEmail || "").trim();
    if (!emailClient || typeof emailClient.send !== "function") {
      return {
        status: "not_configured",
        decision: "send_ready_deliverable_notice",
        requestedAt,
        reason: "email_client_unavailable",
      };
    }
    if (!to) {
      return {
        status: "not_sent",
        decision: "send_ready_deliverable_notice",
        requestedAt,
        reason: "client_email_unavailable",
      };
    }
    const client = String(gallery.customer || gallery.username || "Real Estate client").trim();
    const property = propertyContextFor(gallery, record);
    const typeLabel = record.type === "pdf" ? "PDF" : "video";
    const shelfUrl = workspaceUrlFor(gallery);
    const text = [
      `Hello ${client},`,
      "",
      `Your Photos By Elie ${typeLabel} for ${property} is ready.`,
      "",
      `Open your Real Estate shelf to view or download it: ${shelfUrl}`,
      "",
      "Sign in with your client password if asked. If the link is unavailable, reply with this product id so support can check it:",
      record.id,
    ].join("\n");
    const html = [
      `<p>Hello ${escapeHtml(client)},</p>`,
      `<p>Your Photos By Elie ${escapeHtml(typeLabel)} for <strong>${escapeHtml(property)}</strong> is ready.</p>`,
      `<p><a href="${escapeHtml(shelfUrl)}">Open your Real Estate shelf</a> to view or download it.</p>`,
      `<p>Sign in with your client password if asked. If the link is unavailable, reply with this product id so support can check it: <strong>${escapeHtml(record.id)}</strong></p>`,
    ].join("");
    const idempotencyKey = `photosbyelie-real-estate-deliverable-${record.id}`;
    try {
      const result = await emailClient.send({
        to,
        subject: `Photos By Elie ${typeLabel} ready - ${property}`,
        text,
        html,
        idempotencyKey,
      });
      return {
        status: "sent",
        decision: "send_ready_deliverable_notice",
        provider: result.provider || emailClient.provider || "email",
        messageId: result.messageId || null,
        idempotencyKey: result.idempotencyKey || idempotencyKey,
        shelfUrl,
        sentAt: now().toISOString(),
      };
    } catch (error) {
      return {
        status: "failed",
        decision: "send_ready_deliverable_notice",
        provider: emailClient.provider || "email",
        idempotencyKey,
        shelfUrl,
        failedAt: now().toISOString(),
        error: {
          code: error?.code || "delivery_email_failed",
          message: error?.message || "Delivery email could not be sent.",
        },
      };
    }
  };

  const galleryFor = (payload = {}) => {
    const galleryKey = canonicalRealEstateGalleryKey(payload.galleryKey);
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

  const jobKeyFor = (gallery, id) => `${prefixFor(gallery)}/jobs/${safeRecordId(id)}.json`;

  const outputPrefixFor = (gallery) => normalizeKeyPrefix(`${prefixFor(gallery)}/outputs`);

  const outputKeyFor = (gallery, id, type, filename = "", contentType = "") => {
    const normalizedContentType = String(contentType || "").split(";")[0].trim().toLowerCase();
    const extension = type === "pdf"
      ? "pdf"
      : normalizedContentType === "video/webm" || /\.webm$/i.test(filename)
        ? "webm"
        : "mp4";
    return `${outputPrefixFor(gallery)}/${safeRecordId(id)}.${extension}`;
  };

  const relativeAssetUrl = (id, action) => `/real-estate/deliverables/${encodeURIComponent(safeRecordId(id))}/${action}`;

  const publicRecordFor = (record) => {
    const ready = String(record?.status || "").toLowerCase() === "ready";
    const type = String(record?.type || "").toLowerCase();
    if (!ready || !["pdf", "video"].includes(type)) return record;
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

  const jobStatusFor = (records = []) => {
    const statuses = records.map((record) => String(record?.status || "").toLowerCase().replace("_", "-"));
    if (!statuses.length) return "pending";
    if (statuses.some((status) => status === "failed" || status === "needs-attention")) return "needs-attention";
    if (statuses.every((status) => status === "ready" || status === "complete" || status === "completed")) return "ready";
    if (statuses.some((status) => status === "processing")) return "processing";
    if (statuses.some((status) => status === "queued")) return "queued";
    return "pending";
  };

  const jobFailureReasonFor = (records = []) =>
    records.map((record) => String(record?.failureReason || record?.assemblyJob?.failureReason || "").trim()).find(Boolean) || "";

  const readDeliverableRecords = async (gallery, ids = []) => {
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
    return (await Promise.all(uniqueIds.map(async (id) => {
      const record = await objectJson(await privateBucket.get(keyFor(gallery, id)));
      return record && typeof record === "object" ? publicRecordFor(record) : null;
    }))).filter(Boolean);
  };

  const publicJobFor = async (gallery, jobRecord = {}) => {
    const { renderAccess: _renderAccess, ...safeJobRecord } = jobRecord || {};
    const records = await readDeliverableRecords(gallery, jobRecord.deliverableIds || []);
    const status = jobStatusFor(records);
    const failureReason = jobFailureReasonFor(records) || String(jobRecord.failureReason || "");
    return {
      ...safeJobRecord,
      status,
      failureReason,
      updatedAt: now().toISOString(),
      deliverables: records,
    };
  };

  const putDeliverable = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const record = normalizeRecord(gallery, payload.deliverable || {});
    const recordWithEmail = {
      ...record,
      deliveryEmail: await sendReadyDeliverableEmail(gallery, record),
    };
    const text = JSON.stringify(recordWithEmail, null, 2);
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
        deliverableId: recordWithEmail.id,
        type: recordWithEmail.type,
      },
    });
    return publicRecordFor(recordWithEmail);
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
      const record = {
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
          deliveryEmailDecision: "email_when_ready_asset_available",
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
      };
      return publicRecordFor({
        ...record,
        deliveryEmail: emailDecisionFor(record),
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
    const jobRecord = {
      id: jobId,
      galleryKey: gallery.key,
      title,
      status: "pending",
      submittedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      formats,
      deliverableIds: records.map((record) => record.id),
      failureReason: "",
      inputManifest: batch,
      inputManifestSchema: batch.schema || "",
      inputManifestBatchId: batchId,
      inputManifestStorage: "embedded-in-job-record",
      outputStorage: "real-estate-deliverable-r2-records",
      sourceVideoAudioPolicy: "duck-under-generated-guitar-bed",
      sourceVideoAudioGainDb: Number(batch?.slideshowSettings?.audioPolicy?.sourceVideoAudioGainDb ?? -20),
      generatedMusicGainDb: Number(batch?.slideshowSettings?.audioPolicy?.musicGainDb ?? 0),
      progress: {
        phase: "queued",
        percent: 1,
        current: 0,
        total: formats.length,
        detail: "",
        updatedAt: createdAt,
      },
    };
    const jobText = JSON.stringify(jobRecord, null, 2);
    if (jobText.length > 1_000_000) {
      throw Object.assign(new Error("Real-estate assembly job manifest is too large to save."), {
        status: 413,
        code: "real_estate_deliverable_too_large",
      });
    }
    await privateBucket.put(jobKeyFor(gallery, jobId), new TextEncoder().encode(jobText), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        galleryKey: gallery.key,
        assemblyJobId: jobId,
        status: jobRecord.status,
      },
    });
    if (assemblyDispatcher && typeof assemblyDispatcher.dispatch === "function") {
      try {
        await assemblyDispatcher.dispatch({ galleryKey: gallery.key, jobId });
      } catch (error) {
        const failureReason = `Cloud assembly could not be dispatched: ${error?.message || "unknown dispatcher error"}`.slice(0, 500);
        const failedAt = now().toISOString();
        await Promise.all(records.map(async (record) => {
          const failedRecord = {
            ...record,
            status: "needs-attention",
            updatedAt: failedAt,
            failureReason,
            assemblyJob: {
              ...(record.assemblyJob || {}),
              status: "needs-attention",
              assembler: "cloud-browser-workflow",
              failedAt,
              failureReason,
            },
          };
          await privateBucket.put(keyFor(gallery, record.id), textBytes(JSON.stringify(failedRecord, null, 2)), {
            httpMetadata: { contentType: "application/json; charset=utf-8" },
            customMetadata: {
              galleryKey: gallery.key,
              deliverableId: record.id,
              type: record.type,
              assemblyJobId: jobId,
              status: "needs-attention",
            },
          });
        }));
        await privateBucket.put(jobKeyFor(gallery, jobId), textBytes(JSON.stringify({
          ...jobRecord,
          status: "needs-attention",
          updatedAt: failedAt,
          failureReason,
        }, null, 2)), {
          httpMetadata: { contentType: "application/json; charset=utf-8" },
          customMetadata: { galleryKey: gallery.key, assemblyJobId: jobId, status: "needs-attention" },
        });
        throw Object.assign(new Error(failureReason), {
          status: 503,
          code: "real_estate_assembly_dispatch_failed",
        });
      }
    }
    const publicJob = await publicJobFor(gallery, jobRecord);
    return {
      galleryKey: gallery.key,
      job: publicJob,
      deliverables: records,
    };
  };

  const getAssemblyJob = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const jobId = safeRecordId(payload.jobId || payload.id || "");
    const jobRecord = await objectJson(await privateBucket.get(jobKeyFor(gallery, jobId)));
    if (!jobRecord) {
      throw Object.assign(new Error("Real-estate assembly job was not found."), {
        status: 404,
        code: "unknown_real_estate_assembly_job",
      });
    }
    return {
      galleryKey: gallery.key,
      job: await publicJobFor(gallery, jobRecord),
    };
  };

  const completeAssemblyOutput = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const id = safeRecordId(payload.id || payload.deliverableId || "");
    const recordKey = keyFor(gallery, id);
    const record = await objectJson(await privateBucket.get(recordKey));
    if (!record) {
      throw Object.assign(new Error("Real-estate product was not found."), {
        status: 404,
        code: "unknown_real_estate_deliverable",
      });
    }
    const type = String(record.type || "").toLowerCase();
    if (!["pdf", "video"].includes(type)) {
      throw Object.assign(new Error("Only PDF and video products can receive assembled output."), {
        status: 409,
        code: "invalid_real_estate_assembly_output",
      });
    }
    if (!payload.body) {
      throw Object.assign(new Error("The assembled output file is empty."), {
        status: 400,
        code: "missing_real_estate_assembly_output",
      });
    }
    const contentLength = Number(payload.contentLength || 0) || 0;
    const maxBytes = 95 * 1024 * 1024;
    if (contentLength > maxBytes) {
      throw Object.assign(new Error("The assembled output exceeds the 95 MB browser-upload limit."), {
        status: 413,
        code: "real_estate_assembly_output_too_large",
        details: { maxBytes },
      });
    }
    const fallbackFilename = `${gallery.key}-${record.batch?.batchId || record.id}-${type === "pdf" ? "project.pdf" : "slideshow.mp4"}`;
    const filename = safeFilename(payload.filename, fallbackFilename);
    let contentType = String(payload.contentType || contentTypeFor(type, filename)).split(";")[0].trim().toLowerCase();
    const validContentType = type === "pdf"
      ? contentType === "application/pdf"
      : contentType.startsWith("video/");
    if (!validContentType) {
      throw Object.assign(new Error(`The uploaded ${type} has an invalid content type.`), {
        status: 415,
        code: "invalid_real_estate_assembly_content_type",
        details: { expected: type === "pdf" ? "application/pdf" : "video/*", received: contentType },
      });
    }

    let outputBody = payload.body;
    let outputFilename = filename;
    if (type === "video" && contentType !== "video/mp4" && videoTranscoder && typeof videoTranscoder.toMp4 === "function") {
      const transformed = await videoTranscoder.toMp4({ body: outputBody, contentType, filename: outputFilename });
      outputBody = transformed?.body || outputBody;
      contentType = String(transformed?.contentType || "video/mp4").split(";")[0].trim().toLowerCase();
      outputFilename = safeFilename(transformed?.filename || outputFilename.replace(/\.[^.]+$/i, ".mp4"), `${record.id}.mp4`);
    }
    const outputKey = outputKeyFor(gallery, id, type, outputFilename, contentType);
    const stored = await privateBucket.put(outputKey, outputBody, {
      httpMetadata: { contentType },
      customMetadata: {
        galleryKey: gallery.key,
        deliverableId: id,
        type,
        assemblyJobId: String(record.assemblyJob?.id || ""),
      },
    });
    const completedAt = now().toISOString();
    const bytes = Number(stored?.size || contentLength || payload.bytes || 0) || 0;
    const readyRecord = publicRecordFor({
      ...record,
      updatedAt: completedAt,
      status: "ready",
      bytes,
      filename: outputFilename,
      failureReason: "",
      outputs: {
        ...(record.outputs || {}),
        [type]: {
          ...(record.outputs?.[type] || {}),
          key: outputKey,
          filename: outputFilename,
          contentType,
        },
      },
      assemblyJob: {
        ...(record.assemblyJob || {}),
        status: "ready",
        assembler: String(payload.assembler || "browser-upload"),
        completedAt,
        failureReason: "",
      },
      deliveryEmail: {
        status: "not_sent",
        decision: "owner_review_before_client_notification",
        reason: `${String(payload.assembler || "browser-upload").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_output_waits_for_owner_review_on_shelf`,
        decidedAt: completedAt,
      },
    });
    await privateBucket.put(recordKey, new TextEncoder().encode(JSON.stringify(readyRecord, null, 2)), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        galleryKey: gallery.key,
        deliverableId: id,
        type,
        assemblyJobId: String(readyRecord.assemblyJob?.id || ""),
        status: "ready",
      },
    });
    return readyRecord;
  };

  const failAssemblyOutput = async (payload = {}) => {
    const gallery = galleryFor(payload);
    authorize(gallery, payload);
    const id = safeRecordId(payload.id || payload.deliverableId || "");
    const recordKey = keyFor(gallery, id);
    const record = await objectJson(await privateBucket.get(recordKey));
    if (!record) {
      throw Object.assign(new Error("Real-estate product was not found."), {
        status: 404,
        code: "unknown_real_estate_deliverable",
      });
    }
    const failedAt = now().toISOString();
    const failureReason = String(payload.failureReason || payload.error || "Browser output preparation failed.")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 500);
    const failedRecord = {
      ...record,
      updatedAt: failedAt,
      status: "needs-attention",
      failureReason,
      assemblyJob: {
        ...(record.assemblyJob || {}),
        status: "needs-attention",
        assembler: String(payload.assembler || "browser-upload"),
        failedAt,
        failureReason,
      },
      deliveryEmail: {
        status: "not_sent",
        decision: "owner_review_required",
        reason: `${String(payload.assembler || "browser-upload").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_assembly_failed`,
        decidedAt: failedAt,
      },
    };
    await privateBucket.put(recordKey, new TextEncoder().encode(JSON.stringify(failedRecord, null, 2)), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        galleryKey: gallery.key,
        deliverableId: id,
        type: String(record.type || ""),
        assemblyJobId: String(record.assemblyJob?.id || ""),
        status: "needs-attention",
      },
    });
    return failedRecord;
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

  const requireCloudRenderAccess = async (payload = {}) => {
    const gallery = galleryFor(payload);
    const jobId = safeRecordId(payload.jobId || payload.id || "");
    const token = String(payload.renderToken || payload.token || "").trim();
    const jobRecord = await objectJson(await privateBucket.get(jobKeyFor(gallery, jobId)));
    const expiresAt = Date.parse(jobRecord?.renderAccess?.expiresAt || "");
    const tokenHash = String(jobRecord?.renderAccess?.tokenHash || "");
    if (!jobRecord || !token || !tokenHash || !Number.isFinite(expiresAt) || expiresAt <= now().getTime()) {
      throw Object.assign(new Error("Cloud render access has expired or is unavailable."), {
        status: 403,
        code: "real_estate_cloud_render_forbidden",
      });
    }
    if (!timingSafeEqual(await sha256Hex(token), tokenHash)) {
      throw Object.assign(new Error("Cloud render access token is invalid."), {
        status: 403,
        code: "real_estate_cloud_render_forbidden",
      });
    }
    return { gallery, jobId, jobRecord };
  };

  const beginCloudAssemblyRender = async (payload = {}) => {
    const gallery = galleryFor(payload);
    const jobId = safeRecordId(payload.jobId || payload.id || "");
    const jobKey = jobKeyFor(gallery, jobId);
    const jobRecord = await objectJson(await privateBucket.get(jobKey));
    if (!jobRecord) {
      throw Object.assign(new Error("Real-estate assembly job was not found."), {
        status: 404,
        code: "unknown_real_estate_assembly_job",
      });
    }
    const renderToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const startedAt = now().toISOString();
    const expiresAt = new Date(now().getTime() + (Math.max(60, Number(renderTokenTtlSeconds) || 1200) * 1000)).toISOString();
    const processingRecords = await readDeliverableRecords(gallery, jobRecord.deliverableIds || []);
    await Promise.all(processingRecords.map(async (record) => {
      if (String(record.status || "").toLowerCase() === "ready") return;
      const processing = {
        ...record,
        status: "processing",
        updatedAt: startedAt,
        failureReason: "",
        assemblyJob: {
          ...(record.assemblyJob || {}),
          status: "processing",
          assembler: "cloud-browser-workflow",
          startedAt,
          failureReason: "",
        },
      };
      await privateBucket.put(keyFor(gallery, record.id), textBytes(JSON.stringify(processing, null, 2)), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          galleryKey: gallery.key,
          deliverableId: record.id,
          type: record.type,
          assemblyJobId: jobId,
          status: "processing",
        },
      });
    }));
    const processingJob = {
      ...jobRecord,
      status: "processing",
      updatedAt: startedAt,
      failureReason: "",
      progress: {
        phase: "starting",
        percent: Math.max(2, Number(jobRecord?.progress?.percent) || 0),
        current: 0,
        total: processingRecords.length,
        detail: "",
        updatedAt: startedAt,
      },
      renderAccess: {
        tokenHash: await sha256Hex(renderToken),
        createdAt: startedAt,
        expiresAt,
      },
    };
    await privateBucket.put(jobKey, textBytes(JSON.stringify(processingJob, null, 2)), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { galleryKey: gallery.key, assemblyJobId: jobId, status: "processing" },
    });
    return { galleryKey: gallery.key, jobId, renderToken, expiresAt };
  };

  const getCloudAssemblyRenderJob = async (payload = {}) => {
    const { gallery, jobRecord } = await requireCloudRenderAccess(payload);
    return {
      galleryKey: gallery.key,
      job: await publicJobFor(gallery, jobRecord),
    };
  };

  const updateCloudAssemblyRenderProgress = async (payload = {}) => {
    const { gallery, jobId, jobRecord } = await requireCloudRenderAccess(payload);
    const percent = Math.max(0, Math.min(99, Math.round(Number(payload.percent) || 0)));
    const phase = String(payload.phase || "processing").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64) || "processing";
    const detail = String(payload.detail || "").trim().slice(0, 240);
    const updatedAt = now().toISOString();
    const progress = {
      phase,
      percent,
      current: Math.max(0, Math.round(Number(payload.current) || 0)),
      total: Math.max(0, Math.round(Number(payload.total) || 0)),
      detail,
      updatedAt,
    };
    const updatedJob = {
      ...jobRecord,
      status: "processing",
      updatedAt,
      progress,
    };
    await privateBucket.put(jobKeyFor(gallery, jobId), textBytes(JSON.stringify(updatedJob, null, 2)), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { galleryKey: gallery.key, assemblyJobId: jobId, status: "processing", phase, percent: String(percent) },
    });
    return { galleryKey: gallery.key, jobId, progress };
  };

  const completeCloudAssemblyRenderOutput = async (payload = {}) => {
    const { gallery, jobId } = await requireCloudRenderAccess(payload);
    return completeAssemblyOutput({
      ...payload,
      galleryKey: gallery.key,
      realEstateSession: { galleryKey: gallery.key, username: "cloud-renderer" },
      assembler: "cloud-browser-workflow",
      jobId,
    });
  };

  const failCloudAssemblyRenderOutput = async (payload = {}) => {
    const { gallery, jobId } = await requireCloudRenderAccess(payload);
    return failAssemblyOutput({
      ...payload,
      galleryKey: gallery.key,
      realEstateSession: { galleryKey: gallery.key, username: "cloud-renderer" },
      assembler: "cloud-browser-workflow",
      jobId,
    });
  };

  return {
    listDeliverables,
    putDeliverable,
    submitAssemblyJob,
    getAssemblyJob,
    completeAssemblyOutput,
    failAssemblyOutput,
    getDeliverableAsset,
    deleteDeliverable,
    beginCloudAssemblyRender,
    getCloudAssemblyRenderJob,
    updateCloudAssemblyRenderProgress,
    completeCloudAssemblyRenderOutput,
    failCloudAssemblyRenderOutput,
  };
};
