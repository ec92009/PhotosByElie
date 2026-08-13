const safeName = (value, fallback) => String(value || fallback)
  .replace(/[^A-Za-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 120) || fallback;

const extensionFor = (path) => {
  const match = String(path || "").match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "jpg";
};

const productSuffix = (productId) => {
  const match = String(productId || "").match(/^jpg-(\d+)mp$/);
  return match ? `${match[1]}mp` : safeName(productId, "product");
};

const renderedJpgKeys = (item, product) => [
  `renders/${safeName(item.photoId, "photo")}_${productSuffix(product.id)}.jpg`,
];

const isOriginalProduct = (product) => product?.id === "full" || product?.id === "video-original";

const masterKeysFor = (item) => [item.source?.privateMasterKey].filter(Boolean);

const objectBytes = (object, fallback = null) => {
  const size = Number(object?.size);
  if (Number.isFinite(size) && size >= 0) return size;
  const bodyLength = Number(object?.body?.length);
  if (Number.isFinite(bodyLength) && bodyLength >= 0) return bodyLength;
  const fallbackLength = Number(fallback?.length);
  return Number.isFinite(fallbackLength) && fallbackLength >= 0 ? fallbackLength : 0;
};

const objectMetadata = async (bucket, key) => {
  if (!key) return null;
  if (typeof bucket.head === "function") return bucket.head(key);
  return bucket.get(key);
};

const firstObjectMetadata = async (bucket, keys) => {
  for (const key of keys) {
    const object = await objectMetadata(bucket, key);
    if (object) return { key, object };
  }
  return null;
};

const firstObject = async (bucket, keys) => {
  for (const key of keys) {
    const object = await bucket.get(key);
    if (object) return { key, object };
  }
  return null;
};

const contentTypeFor = (path) => {
  const extension = extensionFor(path);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "png") return "image/png";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  return "application/octet-stream";
};

export const createR2ZipDelivery = ({
  privateBucket,
  deliveryBucket = privateBucket,
  renderer = null,
  assertAssetsAllowed = null,
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
    if (assertAssetsAllowed) await assertAssetsAllowed((order.items || []).map((item) => item.photoId), "delivery-validate");
    const missingGroups = await Promise.all((order.items || []).map(async (item) => {
      const itemMissing = [];
      await Promise.all((item.products || []).map(async (product) => {
        if (isOriginalProduct(product)) {
          const found = await firstObjectMetadata(privateBucket, masterKeysFor(item));
          if (!found) {
            itemMissing.push({
              photoId: item.photoId,
              productId: product.id,
              productLabel: product.label,
              code: "missing_private_master",
              objectKey: item.source.privateMasterKey,
              objectKeys: masterKeysFor(item),
            });
          }
          return;
        }

        const renderKeys = renderedJpgKeys(item, product);
        let cachedRender = null;
        for (const candidateRenderKey of renderKeys) {
          cachedRender = await objectMetadata(deliveryBucket, candidateRenderKey);
          if (cachedRender) break;
        }
        if (cachedRender) return;

        const canRender = renderer && typeof renderer.canRender === "function" && renderer.canRender(product.id, item, product);
        if (canRender) {
          const sourceObject = await firstObjectMetadata(privateBucket, masterKeysFor(item));
          if (!sourceObject) {
            itemMissing.push({
              photoId: item.photoId,
              productId: product.id,
              productLabel: product.label,
              code: "missing_private_master",
              objectKey: item.source.privateMasterKey,
              objectKeys: masterKeysFor(item),
            });
          }
          return;
        }

        itemMissing.push({
          photoId: item.photoId,
          productId: product.id,
          productLabel: product.label,
          code: "missing_private_render",
          objectKey: renderKeys[0],
        });
      }));
      return itemMissing;
    }));

    const missing = missingGroups.flat();
    if (missing.length) throw deliveryUnavailableError(missing);
    return { ok: true };
  };

  const createDelivery = async (order) => {
    if (assertAssetsAllowed) await assertAssetsAllowed((order.items || []).map((item) => item.photoId), "delivery-create");
    const files = [];

    const getOrCreateRenderedJpg = async ({ item, product, readSourceBytes }) => {
      const [renderKey] = renderedJpgKeys(item, product);
      for (const candidateRenderKey of [renderKey]) {
        if (assertAssetsAllowed) await assertAssetsAllowed([item.photoId], "delivery-cached-render");
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
      const canRender = renderer && typeof renderer.canRender === "function" && renderer.canRender(product.id, item, product);
      if (!canRender) {
        throw Object.assign(new Error(`Private render is missing: ${renderKey}. Generate and upload the unwatermarked ${product.id} deliverable before checkout can complete.`), {
          status: 409,
          code: "missing_private_render",
        });
      }

      const sourceBytes = await readSourceBytes();
      const data = await renderer.render({
        sourceBytes: sourceBytes.bytes,
        sourceKey: sourceBytes.key,
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
          sourceKey: sourceBytes.key,
          generatedAt: now().toISOString(),
          watermark: "none",
        },
      });
      if (assertAssetsAllowed) await assertAssetsAllowed([item.photoId], "delivery-render-complete");
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
        const found = await firstObject(privateBucket, masterKeysFor(item));
        if (!found) {
          throw Object.assign(new Error(`Private R2 master is missing: ${masterKeysFor(item).join(" or ")}`), {
            status: 409,
            code: "missing_private_master",
          });
        }
        sourceBytes = {
          key: found.key,
          bytes: new Uint8Array(await found.object.arrayBuffer()),
        };
        return sourceBytes;
      };

      for (const product of item.products) {
        const isOriginalDelivery = isOriginalProduct(product);
        const ext = isOriginalDelivery ? extensionFor(item.source.path) : "jpg";
        const name = `${safeName(item.photoId, "photo")}-${safeName(product.id, "product")}.${ext}`;
        const token = `dl_${randomUUID().replace(/-/g, "").slice(0, 28)}`;

        let file;
        if (isOriginalDelivery) {
          if (assertAssetsAllowed) await assertAssetsAllowed([item.photoId], "delivery-original-read");
          const found = await firstObject(privateBucket, masterKeysFor(item));
          if (!found) {
            throw Object.assign(new Error(`Private R2 master is missing: ${masterKeysFor(item).join(" or ")}`), {
              status: 409,
              code: "missing_private_master",
            });
          }
          file = {
            bucket: "private",
            objectKey: found.key,
            renderKey: "",
            cacheHit: false,
            bytes: objectBytes(found.object),
            contentType: found.object.httpMetadata?.contentType || contentTypeFor(item.source.path),
          };
        } else {
          file = await getOrCreateRenderedJpg({ item, product, readSourceBytes });
          file.bucket = "delivery";
        }

        files.push({
          token,
          photoId: item.photoId,
          title: item.title,
          keywords: item.keywords || [],
          productId: product.id,
          productLabel: product.label,
          sourceKey: file.renderKey ? item.source.privateMasterKey : file.objectKey,
          bucket: file.bucket,
          objectKey: file.objectKey,
          name,
          downloadUrl: `/download/${token}`,
          renderKey: file.renderKey || "",
          cacheHit: !isOriginalDelivery && file.cacheHit,
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
    const canonicalMediaIds = Array.isArray(downloadRecord.canonicalMediaIds)
      ? downloadRecord.canonicalMediaIds : [downloadRecord.photoId].filter(Boolean);
    if (assertAssetsAllowed) await assertAssetsAllowed(canonicalMediaIds, "delivery-token-read");
    const objectKey = downloadRecord.objectKey || downloadRecord.zipKey;
    const bucket = downloadRecord.bucket === "private" ? privateBucket : deliveryBucket;
    const object = await bucket.get(objectKey);
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
          "cache-control": "private, no-store, max-age=0",
          "cdn-cache-control": "no-store",
        },
      });
    }
    return new Response(object.body, {
      headers: {
        "access-control-allow-origin": "*",
        "content-type": downloadRecord.contentType || object.httpMetadata?.contentType || "application/octet-stream",
        "content-disposition": `attachment; filename="${downloadRecord.filename || objectKey.split("/").pop() || "photosbyelie-delivery-file"}"`,
        "cache-control": "private, no-store, max-age=0",
        "cdn-cache-control": "no-store",
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
