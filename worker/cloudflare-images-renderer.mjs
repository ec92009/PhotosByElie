const PRODUCT_MEGAPIXELS = new Map([
  ["jpg-6mp", 6],
  ["jpg-3mp", 3],
  ["jpg-1mp", 1],
]);

const SUPPORTED_SOURCE_TYPES = new Set(["JPG", "JPEG", "PNG", "WEBP"]);

const sourceTypeFor = (item = {}) => String(item.source?.type || "").toUpperCase();

const targetLongEdge = (dimensions = {}, megapixels) => {
  const width = Number(dimensions.width || 0);
  const height = Number(dimensions.height || 0);
  if (!width || !height) return 0;
  const sourcePixels = width * height;
  const targetPixels = megapixels * 1_000_000;
  if (targetPixels >= sourcePixels) return Math.max(width, height);
  return Math.max(1, Math.round(Math.max(width, height) * Math.sqrt(targetPixels / sourcePixels)));
};

const streamForBytes = (bytes) => new Response(bytes).body;

export const createCloudflareImagesRenderer = ({
  images,
  quality = 90,
} = {}) => {
  if (!images || typeof images.input !== "function") return null;

  return {
    canRender: (productId, item = {}) => {
      if (!PRODUCT_MEGAPIXELS.has(productId)) return false;
      const sourceType = sourceTypeFor(item);
      return !sourceType || SUPPORTED_SOURCE_TYPES.has(sourceType);
    },
    render: async ({ sourceBytes, product, item }) => {
      const productId = product?.id;
      const megapixels = PRODUCT_MEGAPIXELS.get(productId);
      if (!megapixels) {
        throw Object.assign(new Error(`Cloudflare Images renderer cannot render product ${productId}.`), {
          status: 409,
          code: "unsupported_render_product",
        });
      }

      const sourceType = sourceTypeFor(item);
      if (sourceType && !SUPPORTED_SOURCE_TYPES.has(sourceType)) {
        throw Object.assign(new Error(`Cloudflare Images renderer does not support source type ${sourceType}.`), {
          status: 409,
          code: "unsupported_render_source_type",
        });
      }

      let dimensions = item?.source?.dimensions || {};
      if (!Number(dimensions.width || 0) || !Number(dimensions.height || 0)) {
        const info = await images.info(streamForBytes(sourceBytes));
        dimensions = { width: Number(info?.width || 0), height: Number(info?.height || 0) };
      }
      const longEdge = targetLongEdge(dimensions, megapixels);
      if (!longEdge) {
        throw Object.assign(new Error(`Cannot determine source dimensions for ${item?.photoId || "photo"}.`), {
          status: 409,
          code: "missing_source_dimensions",
        });
      }

      const output = await images
        .input(streamForBytes(sourceBytes))
        .transform({
          width: longEdge,
          height: longEdge,
          fit: "scale-down",
          metadata: "none",
        })
        .output({
          format: "image/jpeg",
          quality,
        });
      const response = await output.response();

      if (!response.ok) {
        throw Object.assign(new Error(`Cloudflare Images render failed with HTTP ${response.status}.`), {
          status: 502,
          code: "cloudflare_images_render_failed",
        });
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
};
