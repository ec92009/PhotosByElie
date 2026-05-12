const safeName = (value, fallback) => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const extensionFor = (path) => {
  const match = String(path || "").match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "jpg";
};

const basename = (path) => String(path || "").split(/[\\/]/).pop();

const photoBaseName = (item) => {
  const sourceExt = extensionFor(item.source?.path);
  const idStem = String(item.photoId || "").replace(/-[a-f0-9]{10}$/i, "");
  return `${idStem || basename(item.source?.path).replace(/\.[A-Za-z0-9]+$/, "")}.${sourceExt}`;
};

const renderedJpgKeys = (item, product) => {
  const folder = safeName(item.photoId, "photo");
  const productName = safeName(product.id, "product");
  return Array.from(new Set([
    `renders/${folder}/${safeName(basename(item.source.path), "source")}-${productName}.jpg`,
    `renders/${folder}/${safeName(photoBaseName(item), "source")}-${productName}.jpg`,
  ]));
};

const objectBytes = (object, fallback = null) => {
  const size = Number(object?.size);
  if (Number.isFinite(size) && size >= 0) return size;
  const bodyLength = Number(object?.body?.length);
  if (Number.isFinite(bodyLength) && bodyLength >= 0) return bodyLength;
  const fallbackLength = Number(fallback?.length);
  return Number.isFinite(fallbackLength) && fallbackLength >= 0 ? fallbackLength : 0;
};

const contentTypeFor = (path) => {
  const extension = extensionFor(path);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "png") return "image/png";
  return "application/octet-stream";
};

export const createR2ZipDelivery = ({
  privateBucket,
  deliveryBucket = privateBucket,
  renderer = null,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  if (!privateBucket) throw new Error("createR2ZipDelivery requires a privateBucket R2 binding.");
  if (!deliveryBucket) throw new Error("createR2ZipDelivery requires a deliveryBucket R2 binding.");

  const deliveryUnavailableError = (missing) => Object.assign(
    new Error(`Checkout is blocked because ${missing.length} delivery file${missing.length === 1 ? " is" : "s are"} not ready in private storage.`),
    {
      status: 409,
      code: "delivery_assets_unavailable",
      details: { missing },
    },
  );

  const validateOrder = async (order) => {
    const missing = [];

    for (const item of order.items) {
      for (const product of item.products) {
        if (product.id === "full") {
          const object = await privateBucket.get(item.source.privateMasterKey);
          if (!object) {
            missing.push({
              photoId: item.photoId,
              productId: product.id,
              productLabel: product.label,
              code: "missing_private_master",
              objectKey: item.source.privateMasterKey,
            });
          }
          continue;
        }

        const renderKeys = renderedJpgKeys(item, product);
        let cachedRender = null;
        for (const candidateRenderKey of renderKeys) {
          cachedRender = await deliveryBucket.get(candidateRenderKey);
          if (cachedRender) break;
        }
        if (cachedRender) continue;

        const canRender = renderer && typeof renderer.canRender === "function" && renderer.canRender(product.id);
        if (canRender) {
          const sourceObject = await privateBucket.get(item.source.privateMasterKey);
          if (!sourceObject) {
            missing.push({
              photoId: item.photoId,
              productId: product.id,
              productLabel: product.label,
              code: "missing_private_master",
              objectKey: item.source.privateMasterKey,
            });
          }
          continue;
        }

        missing.push({
          photoId: item.photoId,
          productId: product.id,
          productLabel: product.label,
          code: "missing_private_render",
          objectKey: renderKeys[0],
        });
      }
    }

    if (missing.length) throw deliveryUnavailableError(missing);
    return { ok: true };
  };

  const createDelivery = async (order) => {
    const files = [];

    const getOrCreateRenderedJpg = async ({ item, product, readSourceBytes }) => {
      const [renderKey, ...fallbackRenderKeys] = renderedJpgKeys(item, product);
      for (const candidateRenderKey of [renderKey, ...fallbackRenderKeys]) {
        const cached = await deliveryBucket.get(candidateRenderKey);
        if (cached) {
          return {
            objectKey: candidateRenderKey,
            renderKey: candidateRenderKey,
            cacheHit: true,
            bytes: objectBytes(cached),
            contentType: cached.httpMetadata?.contentType || "image/jpeg",
          };
        }
      }
      const canRender = renderer && typeof renderer.canRender === "function" && renderer.canRender(product.id);
      if (!canRender) {
        throw Object.assign(new Error(`Private render is missing: ${renderKey}. Generate and upload the unwatermarked ${product.id} deliverable before checkout can complete.`), {
          status: 409,
          code: "missing_private_render",
        });
      }

      const sourceBytes = await readSourceBytes();
      const data = await renderer.render({
        sourceBytes,
        sourceKey: item.source.privateMasterKey,
        product,
        item,
      });
      await deliveryBucket.put(renderKey, data, {
        httpMetadata: {
          contentType: "image/jpeg",
          contentDisposition: `attachment; filename="${safeName(item.photoId, "photo")}-${safeName(product.id, "product")}.jpg"`,
        },
        customMetadata: {
          photoId: item.photoId,
          productId: product.id,
          title: item.title || "",
          keywords: (item.keywords || []).join(", "),
          sourceKey: item.source.privateMasterKey,
          generatedAt: now().toISOString(),
          watermark: "none",
        },
      });
      return {
        objectKey: renderKey,
        renderKey,
        cacheHit: false,
        bytes: objectBytes(null, data),
        contentType: "image/jpeg",
      };
    };

    for (const item of order.items) {
      let sourceBytes = null;
      const readSourceBytes = async () => {
        if (sourceBytes) return sourceBytes;
        const object = await privateBucket.get(item.source.privateMasterKey);
        if (!object) {
          throw Object.assign(new Error(`Private R2 master is missing: ${item.source.privateMasterKey}`), {
            status: 409,
            code: "missing_private_master",
          });
        }
        sourceBytes = new Uint8Array(await object.arrayBuffer());
        return sourceBytes;
      };

      for (const product of item.products) {
        const isFullResolution = product.id === "full";
        const ext = isFullResolution ? extensionFor(item.source.path) : "jpg";
        const name = `${safeName(item.photoId, "photo")}-${safeName(product.id, "product")}.${ext}`;
        const token = `dl_${randomUUID().replace(/-/g, "").slice(0, 28)}`;

        let file;
        if (isFullResolution) {
          const object = await privateBucket.get(item.source.privateMasterKey);
          if (!object) {
            throw Object.assign(new Error(`Private R2 master is missing: ${item.source.privateMasterKey}`), {
              status: 409,
              code: "missing_private_master",
            });
          }
          file = {
            objectKey: item.source.privateMasterKey,
            renderKey: "",
            cacheHit: false,
            bytes: objectBytes(object),
            contentType: object.httpMetadata?.contentType || contentTypeFor(item.source.path),
          };
        } else {
          file = await getOrCreateRenderedJpg({ item, product, readSourceBytes });
        }

        files.push({
          token,
          photoId: item.photoId,
          title: item.title,
          keywords: item.keywords || [],
          productId: product.id,
          productLabel: product.label,
          sourceKey: item.source.privateMasterKey,
          objectKey: file.objectKey,
          name,
          downloadUrl: `/download/${token}`,
          renderKey: file.renderKey || "",
          cacheHit: !isFullResolution && file.cacheHit,
          bytes: file.bytes,
          contentType: file.contentType,
        });
      }
    }

    return {
      readyAt: now().toISOString(),
      files,
      items: files.map((entry) => ({
        photoId: entry.photoId,
        products: [entry.productId],
        sourceKey: entry.sourceKey,
        objectKey: entry.objectKey,
        output: entry.name,
        downloadUrl: entry.downloadUrl,
        bytes: entry.bytes,
        renderKey: entry.renderKey || undefined,
        cacheHit: entry.renderKey ? entry.cacheHit : undefined,
      })),
    };
  };

  const getDownloadResponse = async (downloadRecord) => {
    const objectKey = downloadRecord.objectKey || downloadRecord.zipKey;
    const object = await deliveryBucket.get(objectKey);
    if (!object) {
      return new Response(JSON.stringify({
        error: {
          code: "missing_delivery_file",
          message: "The delivery file was not found in private storage.",
        },
      }, null, 2), {
        status: 404,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      });
    }
    return new Response(object.body, {
      headers: {
        "access-control-allow-origin": "*",
        "content-type": downloadRecord.contentType || object.httpMetadata?.contentType || "application/octet-stream",
        "content-disposition": `attachment; filename="${downloadRecord.filename || objectKey.split("/").pop() || "photosbyelie-delivery-file"}"`,
        ...(downloadRecord.bytes ? { "content-length": String(downloadRecord.bytes) } : {}),
      },
    });
  };

  return {
    validateOrder,
    createDelivery,
    getDownloadResponse,
  };
};
