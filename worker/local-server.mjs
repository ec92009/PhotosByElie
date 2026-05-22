import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalogTsv from "../scripts/catalog_tsv.cjs";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createLocalZipDelivery } from "./local-zip-delivery.mjs";
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

const worker = createPhotosByElieWorker({
  catalog: loadCatalog(),
  delivery,
  stripe,
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
});
