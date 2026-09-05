import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import catalogTsv from "../scripts/catalog_tsv.cjs";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createLocalZipDelivery } from "./local-zip-delivery.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createRealEstateAuth } from "./real-estate-auth.mjs";
import { createRealEstateDeliverables } from "./real-estate-deliverables.mjs";
import { createStripeClient } from "./stripe-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PBE_WORKER_PORT || 8787);

const loadCatalog = () => {
  const catalogWindow = catalogTsv.loadCatalogWindow(repoRoot);
  return createCatalogIndex({
    collections: catalogWindow.photosByElieData,
    resolutions: catalogWindow.photosByElieResolutions,
    frameOptions: catalogWindow.photosByElieFrameOptions,
    videoPriceTiers: catalogWindow.photosByElieVideoPriceTiers,
  });
};

const sourceRoots = (process.env.PBE_DELIVERY_SOURCE_ROOTS || process.env.PBE_DELIVERY_SOURCE_ROOT || "")
  .split(path.delimiter)
  .map((value) => value.trim())
  .filter(Boolean);

const normalizeKeyPrefix = (value) => String(value || "")
  .trim()
  .replace(/^\/+|\/+$/g, "")
  .replace(/\/+/g, "/");

const cleanRealEstateGallery = (gallery = {}) => {
  const key = String(gallery.key || gallery.galleryKey || "").trim();
  if (!key) return null;
  return {
    key,
    username: String(gallery.username || gallery.customer || "").trim(),
    accessCode: String(gallery.accessCode || gallery.password || "").trim(),
    accessCodeHash: String(gallery.accessCodeHash || "").trim().toLowerCase(),
    accessCodeSalt: String(gallery.accessCodeSalt || "").trim(),
    privateMasterPrefix: normalizeKeyPrefix(gallery.privateMasterPrefix || gallery.privateKeyPrefix || `real-estate/${key}/masters`),
    deliverablesPrefix: normalizeKeyPrefix(gallery.deliverablesPrefix || `real-estate/${key}/deliverables`),
    email: String(gallery.email || gallery.clientEmail || "").trim(),
    customer: String(gallery.customer || gallery.username || "").trim(),
    propertyTitle: String(gallery.propertyTitle || gallery.property || "").trim(),
    maxItems: Number(gallery.maxItems || 300) || 300,
  };
};

const realEstateGalleriesFromJson = (rawJson) => {
  const raw = String(rawJson || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.galleries) ? parsed.galleries : [];
    return source
      .map(cleanRealEstateGallery)
      .filter((gallery) => gallery?.username && (gallery?.accessCode || (gallery?.accessCodeHash && gallery?.accessCodeSalt)));
  } catch {
    return [];
  }
};

const loadLocalRealEstateGalleries = () => {
  const envGalleries = realEstateGalleriesFromJson(process.env.REAL_ESTATE_GALLERIES_JSON);
  if (envGalleries.length) return envGalleries;
  const configPath = path.resolve(repoRoot, "assets/owner-actions/real-estate-clients.local.json");
  if (!fs.existsSync(configPath)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const clients = Array.isArray(payload.clients) ? payload.clients : [];
    return clients
      .map(cleanRealEstateGallery)
      .filter((gallery) => gallery?.username && (gallery?.accessCode || (gallery?.accessCodeHash && gallery?.accessCodeSalt)));
  } catch {
    return [];
  }
};

const metadataPathFor = (filePath) => `${filePath}.metadata.json`;

const keyPathSegments = (key) => {
  const clean = normalizeKeyPrefix(key);
  if (!clean || clean.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid local R2 key.");
  }
  return clean.split("/").map((segment) => encodeURIComponent(segment));
};

const keyForLocalPath = (rootDir, filePath) => path.relative(rootDir, filePath)
  .split(path.sep)
  .filter(Boolean)
  .map((segment) => decodeURIComponent(segment))
  .join("/");

const bodyBytes = async (body) => {
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (body && typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
  return Buffer.from(String(body ?? ""));
};

const localR2Object = (body, metadata = {}, range = null) => {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const start = Number.isInteger(range?.offset) ? Math.max(0, range.offset) : 0;
  const end = Number.isInteger(range?.length) ? Math.min(bytes.length, start + range.length) : bytes.length;
  const ranged = bytes.subarray(start, end);
  return {
    httpMetadata: metadata.httpMetadata || {},
    customMetadata: metadata.customMetadata || {},
    size: bytes.length,
    arrayBuffer: async () => ranged.buffer.slice(ranged.byteOffset, ranged.byteOffset + ranged.byteLength),
    text: async () => ranged.toString("utf8"),
    body: ranged,
  };
};

const createLocalR2Bucket = (rootDir) => {
  fs.mkdirSync(rootDir, { recursive: true });
  const filePathFor = (key) => path.join(rootDir, ...keyPathSegments(key));
  const metadataFor = (filePath) => {
    try {
      return JSON.parse(fs.readFileSync(metadataPathFor(filePath), "utf8"));
    } catch {
      return {};
    }
  };
  return {
    head: async (key) => {
      const filePath = filePathFor(key);
      if (!fs.existsSync(filePath)) return null;
      const metadata = metadataFor(filePath);
      return {
        httpMetadata: metadata.httpMetadata || {},
        customMetadata: metadata.customMetadata || {},
        size: fs.statSync(filePath).size,
      };
    },
    get: async (key, options = {}) => {
      const filePath = filePathFor(key);
      if (!fs.existsSync(filePath)) return null;
      return localR2Object(fs.readFileSync(filePath), metadataFor(filePath), options.range || null);
    },
    put: async (key, body, options = {}) => {
      const filePath = filePathFor(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, await bodyBytes(body));
      fs.writeFileSync(metadataPathFor(filePath), JSON.stringify({
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      }, null, 2));
    },
    delete: async (key) => {
      const filePath = filePathFor(key);
      fs.rmSync(filePath, { force: true });
      fs.rmSync(metadataPathFor(filePath), { force: true });
    },
    list: async ({ prefix = "", limit = 1000 } = {}) => {
      const cleanPrefix = normalizeKeyPrefix(prefix);
      const files = [];
      const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (!entry.name.endsWith(".metadata.json")) {
            const key = keyForLocalPath(rootDir, fullPath);
            if (!cleanPrefix || key.startsWith(cleanPrefix)) {
              files.push({
                key,
                size: fs.statSync(fullPath).size,
                ...metadataFor(fullPath),
              });
            }
          }
        }
      };
      walk(rootDir);
      return {
        objects: files.sort((left, right) => left.key.localeCompare(right.key)).slice(0, limit),
        truncated: false,
      };
    },
  };
};

const escapePdfText = (value) => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\(/g, "\\(")
  .replace(/\)/g, "\\)")
  .replace(/[\r\n\t]+/g, " ")
  .slice(0, 180);

const titleLinesForRecord = (record = {}) => {
  const lines = ["Photos By Elie Real Estate Rehearsal", record.title || record.filename || record.id];
  for (const project of record.batch?.projects || []) {
    if (project?.projectTitle) lines.push(project.projectTitle);
    for (const item of project?.items || []) {
      if (item?.title) lines.push(item.title);
    }
  }
  return [...new Set(lines.map((line) => String(line || "").trim()).filter(Boolean))].slice(0, 24);
};

const pdfBytesForRecord = (record) => {
  const lines = titleLinesForRecord(record);
  const stream = [
    "BT",
    "/F1 18 Tf",
    "72 760 Td",
    ...lines.flatMap((line, index) => [
      index ? "0 -28 Td" : "",
      `(${escapePdfText(line)}) Tj`,
    ]).filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
};

const videoBytesForRecord = (record) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-re-video-"));
  const outputPath = path.join(tempDir, "rehearsal.mp4");
  const title = titleLinesForRecord(record).join(" | ").slice(0, 400) || "Photos By Elie Real Estate Rehearsal";
  const result = spawnSync("ffmpeg", [
    "-y",
    "-v", "error",
    "-f", "lavfi",
    "-i", "color=c=0x18212b:s=1280x720:d=2",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-metadata", `title=${title}`,
    "-metadata", `comment=${title}`,
    "-movflags", "+faststart",
    outputPath,
  ], { encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Local Real Estate video rehearsal render failed: ${result.stderr || result.stdout || "ffmpeg failed"}`);
  }
  const bytes = fs.readFileSync(outputPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return bytes;
};

const deliverableKeyFor = (gallery, id) => `${normalizeKeyPrefix(gallery.deliverablesPrefix || `real-estate/${gallery.key}/deliverables`)}/${id}.json`;

const assetUrlFor = (id, action) => `/real-estate/deliverables/${encodeURIComponent(id)}/${action}`;

const createLocalRehearsalLifecycleGuard = () => async (mediaIds, _context, expectedFence = null) => {
  const canonicalMediaIds = [...new Set((Array.isArray(mediaIds) ? mediaIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))].sort();
  const fence = {
    digest: `local-rehearsal:${canonicalMediaIds.map(encodeURIComponent).join(",")}`,
    mediaIds: canonicalMediaIds,
  };
  if (expectedFence?.digest && expectedFence.digest !== fence.digest) {
    throw Object.assign(new Error("Local rehearsal lifecycle state changed during the protected operation."), {
      status: 409,
      code: "lifecycle_fence_changed",
    });
  }
  return fence;
};

const createLocalRealEstateDeliverables = ({ privateBucket, galleries, store }) => {
  const base = createRealEstateDeliverables({
    privateBucket,
    store,
    galleries,
    publicSiteUrl: "http://localhost:8000",
    assertAssetsAllowed: createLocalRehearsalLifecycleGuard(),
  });
  const galleriesByKey = new Map(galleries.map((gallery) => [gallery.key, gallery]));
  return {
    ...base,
    submitAssemblyJob: async (payload = {}) => {
      const result = await base.submitAssemblyJob(payload);
      const now = new Date().toISOString();
      const readyDeliverables = [];
      for (const record of result.deliverables || []) {
        const output = record.outputs?.[record.type] || record.output || {};
        const key = String(output.key || "").replace(/^\/+/, "");
        const gallery = galleriesByKey.get(record.galleryKey);
        if (!key || !gallery) {
          readyDeliverables.push(record);
          continue;
        }
        const bytes = record.type === "pdf" ? pdfBytesForRecord(record) : videoBytesForRecord(record);
        const readyRecord = await base.completeAssemblyOutput({
          ...payload,
          id: record.id,
          filename: record.filename,
          contentType: output.contentType || (record.type === "pdf" ? "application/pdf" : "video/mp4"),
          contentLength: bytes.byteLength,
          body: bytes,
          assembler: "local-rehearsal",
        });
        readyDeliverables.push(readyRecord);
      }
      return {
        ...result,
        job: {
          ...(result.job || {}),
          status: readyDeliverables.length ? "ready" : result.job?.status,
          completedAt: readyDeliverables.length ? now : undefined,
          localRehearsal: true,
        },
        deliverables: readyDeliverables,
      };
    },
  };
};

const delivery = createLocalZipDelivery({
  repoRoot,
  sourceRoots,
  outputDir: path.resolve(repoRoot, process.env.PBE_DELIVERY_OUTPUT_DIR || "deliveries"),
});

const stripe = process.env.STRIPE_SECRET_KEY
  ? createStripeClient({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    statementDescriptorSuffix: process.env.STRIPE_STATEMENT_DESCRIPTOR_SUFFIX || "DOWNLOAD",
    apiVersion: process.env.STRIPE_API_VERSION,
  })
  : undefined;

const realEstateGalleries = loadLocalRealEstateGalleries();
const store = createMemoryStore();
const realEstatePrivateBucket = realEstateGalleries.length
  ? createLocalR2Bucket(path.resolve(repoRoot, process.env.PBE_REAL_ESTATE_LOCAL_BUCKET_DIR || "tmp/real-estate-worker-r2"))
  : null;
const realEstateAuth = realEstateGalleries.length
  ? createRealEstateAuth({
    galleries: realEstateGalleries,
    sessionSecret: process.env.REAL_ESTATE_SESSION_SECRET || process.env.PBE_REAL_ESTATE_SESSION_SECRET || "local-real-estate-session-secret",
    sessionSeconds: Number(process.env.REAL_ESTATE_SESSION_SECONDS || process.env.PBE_REAL_ESTATE_SESSION_SECONDS || 2 * 60 * 60),
  })
  : null;
const realEstateDeliverables = realEstatePrivateBucket
  ? createLocalRealEstateDeliverables({
    privateBucket: realEstatePrivateBucket,
    galleries: realEstateGalleries,
    store,
  })
  : null;

const worker = createPhotosByElieWorker({
  catalog: loadCatalog(),
  store,
  delivery,
  stripe,
  realEstateAuth,
  realEstateDeliverables,
  ordersUrl: `http://localhost:${port}/orders`,
  successUrl: `http://localhost:8000/order.html?id={ORDER_ID}&session_id={CHECKOUT_SESSION_ID}&checkout=success`,
  cancelUrl: "http://localhost:8000/basket.html?checkout=cancelled",
  mockStripeEnabled: !stripe,
});

const toWebRequest = (req, body) => new Request(`http://localhost:${port}${req.url}`, {
  method: req.method,
  headers: req.headers,
  body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : body,
  duplex: "half",
});

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const serveLocalDownload = async (req, res) => {
  const pathname = new URL(req.url, `http://localhost:${port}`).pathname;
  if (!["GET", "HEAD"].includes(req.method || "GET")) return false;
  const orderMatch = pathname.match(/^\/download-order\/([^/]+)$/);
  if (orderMatch) {
    const orderId = decodeURIComponent(orderMatch[1]);
    const zipPath = path.join(repoRoot, "deliveries", `photosbyelie-order-${orderId}.zip`);
    if (!fs.existsSync(zipPath)) return false;
    const filename = path.basename(zipPath);
    res.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "content-length": fs.statSync(zipPath).size,
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(zipPath).pipe(res);
    return true;
  }

  const match = pathname.match(/^\/download\/([^/]+)$/);
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  const download = await worker.store.getDownload(token);
  if (!download || !path.isAbsolute(download.zipKey)) return false;
  if (!fs.existsSync(download.zipKey)) return false;

  await worker.store.recordDownload(token, new Date().toISOString());
  const filename = path.basename(download.zipKey);
  res.writeHead(200, {
    "access-control-allow-origin": "*",
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    "content-length": fs.statSync(download.zipKey).size,
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(download.zipKey).pipe(res);
  return true;
};

const server = http.createServer(async (req, res) => {
  try {
    if (await serveLocalDownload(req, res)) return;
    const body = await readBody(req);
    const response = await worker.fetch(toWebRequest(req, body.length ? body : undefined));
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ error: { code: "local_worker_failed", message: error.message } }, null, 2));
  }
});

server.listen(port, () => {
  console.log(`PhotosByElie local ${stripe ? "Stripe" : "mock"} Worker listening on http://localhost:${port}`);
  console.log(`Delivery ZIPs will be written under ${path.resolve(repoRoot, process.env.PBE_DELIVERY_OUTPUT_DIR || "deliveries")}`);
  if (realEstateGalleries.length) {
    console.log(`Real Estate local Worker enabled for ${realEstateGalleries.length} gallery/galleries using ${path.resolve(repoRoot, process.env.PBE_REAL_ESTATE_LOCAL_BUCKET_DIR || "tmp/real-estate-worker-r2")}`);
  }
});
