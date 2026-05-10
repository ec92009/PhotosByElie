import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DIGITAL_MEGAPIXELS = new Map([
  ["jpg-6mp", 6],
  ["jpg-3mp", 3],
  ["jpg-1mp", 1],
]);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

const createStoredZip = (entries, now = new Date()) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime(now);

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ""), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(localHeader, data);
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const safeName = (value, fallback) => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const exists = async (filePath) => {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
  });
});

const sipsDimensions = async (filePath) => {
  const output = await new Promise((resolve, reject) => {
    const child = spawn("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim())));
  });
  const width = Number(String(output).match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(String(output).match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not read image dimensions for ${filePath}`);
  return { width, height };
};

const longEdgeForMegapixels = ({ width, height }, megapixels) => {
  const targetPixels = megapixels * 1_000_000;
  const sourcePixels = width * height;
  if (targetPixels >= sourcePixels) return Math.max(width, height);
  return Math.max(1, Math.round(Math.max(width, height) * Math.sqrt(targetPixels / sourcePixels)));
};

export const createLocalZipDelivery = ({
  repoRoot = process.cwd(),
  sourceRoots = [],
  outputDir = path.join(repoRoot, "deliveries"),
  now = () => new Date(),
} = {}) => {
  const roots = sourceRoots.map((root) => path.resolve(root));
  const reserveRoot = path.join(repoRoot, "assets", "reserve");

  const resolveSource = async (item) => {
    const sourcePath = item.source?.path || "";
    if (path.isAbsolute(sourcePath) && await exists(sourcePath)) return { filePath: sourcePath, kind: "master" };
    for (const root of roots) {
      const candidate = path.join(root, sourcePath);
      if (await exists(candidate)) return { filePath: candidate, kind: "master" };
    }
    const previewKey = item.publicPreview?.detailKey || item.publicPreview?.galleryKey || "";
    const previewPath = previewKey.replace(/^expo\//, "");
    const previewName = path.basename(previewPath);
    const candidates = [
      path.join(reserveRoot, previewPath),
      path.join(reserveRoot, item.collectionKey || "", previewName),
    ];
    for (const candidate of candidates) {
      if (previewPath && await exists(candidate)) return { filePath: candidate, kind: "preview-fallback" };
    }
    throw new Error(`No local source or preview fallback for ${item.photoId}`);
  };

  const renderProduct = async ({ item, product, source, stagingDir }) => {
    const productId = product.id;
    const outputName = `${safeName(item.photoId, "photo")}-${safeName(productId, "product")}.jpg`;
    const outputPath = path.join(stagingDir, outputName);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const sipsArgs = ["-s", "format", "jpeg", "-s", "formatOptions", "90"];
    const megapixels = DIGITAL_MEGAPIXELS.get(productId);
    if (megapixels) {
      const dimensions = await sipsDimensions(source.filePath);
      sipsArgs.push("-Z", String(longEdgeForMegapixels(dimensions, megapixels)));
    }
    sipsArgs.push(source.filePath, "--out", outputPath);
    await run("sips", sipsArgs);
    return {
      name: path.relative(stagingDir, outputPath),
      outputPath,
      sourceKind: source.kind,
    };
  };

  const writeOrderManifest = async ({ order, rendered, stagingDir }) => {
    const lines = [
      "Photos By Elie mock digital delivery",
      "",
      `Order ID: ${order.id}`,
      `Status: ${order.status}`,
      `Buyer email: ${order.buyerEmail}`,
      `Amount paid: ${order.currency.toUpperCase()} ${(Number(order.amountPaid || order.amountExpected) / 100).toFixed(2)}`,
      "",
      ...rendered.flatMap((entry) => [
        `Photo ID: ${entry.item.photoId}`,
        `Title: ${entry.item.title}`,
        ...(entry.item.keywords?.length ? [`Keywords: ${entry.item.keywords.join(", ")}`] : []),
        `Product: ${entry.product.label}`,
        `Delivered file: ${entry.name}`,
        `Source mode: ${entry.sourceKind}`,
        "",
      ]),
      "Mock checkout note: generated locally for test fulfillment. Production delivery will read private R2 masters.",
      "",
    ];
    await fs.writeFile(path.join(stagingDir, "ORDER.txt"), lines.join("\n"));
  };

  return {
    createDelivery: async (order) => {
      const zipBase = `photosbyelie-order-${order.id}`;
      const stagingDir = path.join(outputDir, zipBase);
      const zipPath = path.join(outputDir, `${zipBase}.zip`);
      await fs.rm(stagingDir, { recursive: true, force: true });
      await fs.rm(zipPath, { force: true });
      await fs.mkdir(stagingDir, { recursive: true });

      const rendered = [];
      for (const item of order.items) {
        const source = await resolveSource(item);
        for (const product of item.products) {
          const result = await renderProduct({ item, product, source, stagingDir });
          rendered.push({ ...result, item, product });
        }
      }
      await writeOrderManifest({ order, rendered, stagingDir });

      const files = [];
      const collect = async (dir) => {
        for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
          const filePath = path.join(dir, dirent.name);
          if (dirent.isDirectory()) await collect(filePath);
          else if (dirent.isFile()) files.push({ name: path.relative(stagingDir, filePath), data: await fs.readFile(filePath) });
        }
      };
      await collect(stagingDir);
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(zipPath, createStoredZip(files, now()));

      const token = `dl_${crypto.randomUUID().replace(/-/g, "").slice(0, 28)}`;
      return {
        zipKey: zipPath,
        token,
        downloadUrl: `/download/${token}`,
        readyAt: now().toISOString(),
        items: rendered.map((entry) => ({
          photoId: entry.item.photoId,
          products: [entry.product.id],
          sourceKey: entry.item.source.privateMasterKey,
          output: entry.name,
          sourceKind: entry.sourceKind,
        })),
      };
    },
  };
};
