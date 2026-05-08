import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createLocalZipDelivery } from "./local-zip-delivery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PBE_WORKER_PORT || 8787);

const loadCatalog = () => {
  const sandbox = { window: {}, console, Intl };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "photos-data.js"), "utf8"), sandbox);
  return createCatalogIndex({
    collections: sandbox.window.photosByElieData,
    resolutions: sandbox.window.photosByElieResolutions,
    frameOptions: sandbox.window.photosByElieFrameOptions,
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

const worker = createPhotosByElieWorker({
  catalog: loadCatalog(),
  delivery,
  ordersUrl: `http://localhost:${port}/orders`,
  successUrl: `http://localhost:8000/order.html?id={ORDER_ID}&checkout=success`,
  cancelUrl: "http://localhost:8000/basket.html?checkout=cancelled",
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

const server = http.createServer(async (req, res) => {
  try {
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
  console.log(`PhotosByElie local mock Worker listening on http://localhost:${port}`);
  console.log(`Delivery ZIPs will be written under ${path.resolve(repoRoot, process.env.PBE_DELIVERY_OUTPUT_DIR || "deliveries")}`);
});
