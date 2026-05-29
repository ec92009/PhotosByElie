(() => {
  const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

  const toBytes = (input) => {
    if (input instanceof Uint8Array) return input;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input === "string") {
      const bytes = new Uint8Array(input.length);
      for (let index = 0; index < input.length; index += 1) bytes[index] = input.charCodeAt(index) & 0xff;
      return bytes;
    }
    throw new Error("Unsupported SQLite byte input.");
  };

  const decodeUtf8 = (bytes) => {
    if (!bytes || !bytes.length) return "";
    if (textDecoder) return textDecoder.decode(bytes);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    try {
      return decodeURIComponent(escape(binary));
    } catch {
      return binary;
    }
  };

  const roundMegapixels = (width, height) => Math.round((Number(width || 0) * Number(height || 0) / 1000000) * 10) / 10;
  const pad2 = (value) => String(value || 0).padStart(2, "0");
  const capturedDisplay = (value) => String(value || "").replace(/^(\d{4})-(\d{2})-(\d{2})T/, "$1:$2:$3 ");
  const capturedDate = (value) => String(value || "").slice(0, 10);
  const formatDisplay = (extension) => ({
    jpg: "JPEG",
    jpeg: "JPEG",
    tif: "TIFF",
    tiff: "TIFF",
    png: "PNG",
    heic: "HEIC",
    mp4: "MP4",
    mov: "MOV",
  }[String(extension || "").toLowerCase()] || String(extension || "").toUpperCase());
  const sourceType = (extension) => ({
    jpg: "JPG",
    jpeg: "JPG",
    tif: "TIFF",
    tiff: "TIFF",
    png: "PNG",
    heic: "HEIC",
    mp4: "MP4",
    mov: "MOV",
  }[String(extension || "").toLowerCase()] || String(extension || "").toUpperCase());

  class SQLiteCatalogReader {
    constructor(input) {
      this.bytes = toBytes(input);
      this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
      const header = decodeUtf8(this.bytes.subarray(0, 16));
      if (header !== "SQLite format 3\u0000") throw new Error("Catalog is not a SQLite 3 database.");
      this.pageSize = this.u16(16) || 65536;
      this.reservedBytes = this.bytes[20] || 0;
      this.usableSize = this.pageSize - this.reservedBytes;
    }

    u16(offset) {
      return this.view.getUint16(offset, false);
    }

    u32(offset) {
      return this.view.getUint32(offset, false);
    }

    pageOffset(pageNumber) {
      if (!Number.isFinite(pageNumber) || pageNumber < 1) throw new Error(`Invalid SQLite page ${pageNumber}.`);
      return (pageNumber - 1) * this.pageSize;
    }

    pageHeaderOffset(pageNumber) {
      return this.pageOffset(pageNumber) + (pageNumber === 1 ? 100 : 0);
    }

    readVarint(offset) {
      let value = 0;
      for (let index = 0; index < 9; index += 1) {
        const byte = this.bytes[offset + index];
        if (index === 8) return { value: value * 256 + byte, offset: offset + 9 };
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return { value, offset: offset + index + 1 };
      }
      return { value, offset: offset + 9 };
    }

    serialLength(serialType) {
      if (serialType === 0 || serialType === 8 || serialType === 9) return 0;
      if (serialType === 1) return 1;
      if (serialType === 2) return 2;
      if (serialType === 3) return 3;
      if (serialType === 4) return 4;
      if (serialType === 5) return 6;
      if (serialType === 6 || serialType === 7) return 8;
      if (serialType >= 12) return Math.floor((serialType - 12) / 2);
      throw new Error(`Unsupported SQLite serial type ${serialType}.`);
    }

    readInteger(offset, length) {
      let value = 0;
      for (let index = 0; index < length; index += 1) value = value * 256 + this.bytes[offset + index];
      const signBit = 2 ** ((length * 8) - 1);
      return value >= signBit ? value - (2 ** (length * 8)) : value;
    }

    readSerial(payload, offset, serialType) {
      const length = this.serialLength(serialType);
      if (serialType === 0) return null;
      if (serialType === 8) return 0;
      if (serialType === 9) return 1;
      if (offset + length > payload.length) return null;
      if ([1, 2, 3, 4, 5, 6].includes(serialType)) return this.readIntegerFromPayload(payload, offset, length);
      if (serialType === 7) {
        return new DataView(payload.buffer, payload.byteOffset + offset, 8).getFloat64(0, false);
      }
      if (serialType >= 12 && serialType % 2 === 0) return payload.subarray(offset, offset + length);
      if (serialType >= 13 && serialType % 2 === 1) return decodeUtf8(payload.subarray(offset, offset + length));
      return null;
    }

    readIntegerFromPayload(payload, offset, length) {
      let value = 0;
      for (let index = 0; index < length; index += 1) value = value * 256 + payload[offset + index];
      const signBit = 2 ** ((length * 8) - 1);
      return value >= signBit ? value - (2 ** (length * 8)) : value;
    }

    parseRecord(payload, maxColumns = Infinity) {
      const headerSizeVarint = this.readVarintFromPayload(payload, 0);
      const headerSize = headerSizeVarint.value;
      let serialOffset = headerSizeVarint.offset;
      const serialTypes = [];
      while (serialOffset < headerSize && serialOffset < payload.length) {
        const serial = this.readVarintFromPayload(payload, serialOffset);
        serialTypes.push(serial.value);
        serialOffset = serial.offset;
      }
      const values = [];
      let valueOffset = headerSize;
      for (const serialType of serialTypes) {
        if (values.length >= maxColumns) break;
        values.push(this.readSerial(payload, valueOffset, serialType));
        valueOffset += this.serialLength(serialType);
      }
      return values;
    }

    readVarintFromPayload(payload, offset) {
      let value = 0;
      for (let index = 0; index < 9; index += 1) {
        const byte = payload[offset + index];
        if (byte == null) return { value, offset: offset + index };
        if (index === 8) return { value: value * 256 + byte, offset: offset + 9 };
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return { value, offset: offset + index + 1 };
      }
      return { value, offset: offset + 9 };
    }

    localPayload(cellOffset, payloadSize, pageEnd) {
      const end = Math.min(cellOffset + payloadSize, pageEnd);
      return this.bytes.subarray(cellOffset, end);
    }

    readBtree(rootPage, mode, maxColumns = Infinity) {
      const rows = [];
      const visit = (pageNumber) => {
        const pageStart = this.pageOffset(pageNumber);
        const pageEnd = pageStart + this.usableSize;
        const header = this.pageHeaderOffset(pageNumber);
        const type = this.bytes[header];
        const cellCount = this.u16(header + 3);
        const isInterior = type === 0x02 || type === 0x05;
        const pointerStart = header + (isInterior ? 12 : 8);
        const cellPointers = [];
        for (let index = 0; index < cellCount; index += 1) cellPointers.push(this.u16(pointerStart + index * 2));

        if (mode === "table" && type === 0x0d) {
          for (const pointer of cellPointers) {
            let offset = pageStart + pointer;
            const payloadSize = this.readVarint(offset);
            offset = payloadSize.offset;
            const rowId = this.readVarint(offset);
            offset = rowId.offset;
            rows.push({ rowid: rowId.value, values: this.parseRecord(this.localPayload(offset, payloadSize.value, pageEnd), maxColumns) });
          }
          return;
        }
        if (mode === "table" && type === 0x05) {
          for (const pointer of cellPointers) visit(this.u32(pageStart + pointer));
          visit(this.u32(header + 8));
          return;
        }
        if (mode === "index" && type === 0x0a) {
          for (const pointer of cellPointers) {
            let offset = pageStart + pointer;
            const payloadSize = this.readVarint(offset);
            offset = payloadSize.offset;
            rows.push({ values: this.parseRecord(this.localPayload(offset, payloadSize.value, pageEnd), maxColumns) });
          }
          return;
        }
        if (mode === "index" && type === 0x02) {
          for (const pointer of cellPointers) {
            let offset = pageStart + pointer;
            const leftChild = this.u32(offset);
            offset += 4;
            visit(leftChild);
            const payloadSize = this.readVarint(offset);
            offset = payloadSize.offset;
            rows.push({ values: this.parseRecord(this.localPayload(offset, payloadSize.value, pageEnd), maxColumns) });
          }
          visit(this.u32(header + 8));
          return;
        }
        throw new Error(`Unsupported SQLite btree page type 0x${type.toString(16)} for ${mode}.`);
      };
      visit(rootPage);
      return rows;
    }

    rootPages() {
      const roots = new Map();
      for (const row of this.readBtree(1, "table", 4)) {
        const [type, name, tableName, rootPage] = row.values;
        if (type === "table" && name && tableName && rootPage) roots.set(String(name), Number(rootPage));
      }
      return roots;
    }

    table(rootPages, name, columns, mode = "table") {
      const rootPage = rootPages.get(name);
      if (!rootPage) return [];
      return this.readBtree(rootPage, mode).map((row) => {
        const record = {};
        columns.forEach((column, index) => {
          record[column] = row.values[index];
        });
        if (mode === "table" && columns[0] && record[columns[0]] == null) record[columns[0]] = row.rowid;
        return record;
      });
    }
  }

  const mapBy = (rows, key, valueKey) => {
    const map = new Map();
    for (const row of rows || []) map.set(Number(row[key]), valueKey ? row[valueKey] : row);
    return map;
  };

  const keywordsFor = (keywordIds, terms) => String(keywordIds || "")
    .split(",")
    .map((value) => terms.get(Number(value.trim())))
    .filter(Boolean);

  const centsToDollars = (value) => Math.round(Number(value || 0)) / 100;
  const nullableCentsToDollars = (value) => value == null ? null : centsToDollars(value);
  const jsonValue = (value, fallback = null) => {
    if (value == null || value === "") return fallback;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  };

  const mediaKey = (mediaId, assetCode, mediaType) => {
    if (assetCode === "still_900") return `expo/${mediaId}_900.jpg`;
    if (assetCode === "still_1800") return `expo/${mediaId}_1800.jpg`;
    if (assetCode === "short_5s_720p") return `expo/${mediaId}_short_5s_720p.mp4`;
    if (assetCode === "jpeg_1mp") return `renders/${mediaId}_1mp.jpg`;
    if (assetCode === "jpeg_3mp") return `renders/${mediaId}_3mp.jpg`;
    if (assetCode === "jpeg_6mp") return `renders/${mediaId}_6mp.jpg`;
    return mediaType === "video" ? `masters/${mediaId}.mp4` : `masters/${mediaId}`;
  };

  const metadataRows = (item, context) => {
    const rows = [];
    const add = (label, value) => {
      if (value != null && value !== "") rows.push({ label, value: String(value) });
    };
    const fullAsset = context.assets.full;
    const detailAsset = context.assets.still_1800 || context.assets.short_5s_720p || context.assets.still_900;
    const originalFormat = formatDisplay(context.originalFormat);
    add("Metadata title", item.title);
    add("Keywords", context.keywords.join(", "));
    add("Captured", capturedDisplay(item.captured_at));
    add("Camera", context.camera);
    add("Lens", context.lens);
    add("Exposure", item.exposure);
    add("Focal length", item.focal_length);
    const originalFile = String(context.sourceFile?.filename || "");
    add("Original file", originalFile);
    if (fullAsset) add("Original size", `${originalFormat} / ${fullAsset.width} x ${fullAsset.height} / ${roundMegapixels(fullAsset.width, fullAsset.height)} MP`);
    if (item.location) add("Location", item.location);
    if (detailAsset) {
      add(
        "Preview file",
        `${mediaKey(item.media_id, context.assetCodeById.get(Number(detailAsset.asset_type_id)), context.mediaType).split("/").pop()} / ${detailAsset.width} x ${detailAsset.height} / ${formatDisplay(context.formatById.get(Number(detailAsset.format_id)))}`,
      );
    } else if (fullAsset) {
      add("Preview file", `${item.media_id}_900.jpg / ${fullAsset.width} x ${fullAsset.height} / ${originalFormat}`);
    }
    return rows;
  };

  const decodeCatalog = (input) => {
    const reader = new SQLiteCatalogReader(input);
    const roots = reader.rootPages();
    const collections = reader.table(roots, "collections", ["collection_id", "slug", "title", "description", "scope", "sort_order", "created_at", "updated_at"]);
    const cameras = mapBy(reader.table(roots, "cameras", ["camera_id", "name", "maker", "model"]), "camera_id", "name");
    const lenses = mapBy(reader.table(roots, "lenses", ["lens_id", "name", "maker", "model"]), "lens_id", "name");
    const mediaTypes = mapBy(reader.table(roots, "media_types", ["media_type_id", "code"]), "media_type_id", "code");
    const sourceOrigins = mapBy(reader.table(roots, "source_origins", ["source_origin_id", "code"]), "source_origin_id", "code");
    const formats = mapBy(reader.table(roots, "formats", ["format_id", "extension"]), "format_id", "extension");
    const assetTypes = mapBy(reader.table(roots, "asset_types", ["asset_type_id", "code"]), "asset_type_id", "code");
    const keywordTerms = mapBy(reader.table(roots, "keyword_terms", ["keyword_id", "keyword"]), "keyword_id", "keyword");
    const sourceFolders = mapBy(reader.table(roots, "source_folders", ["source_folder_id", "source_folder"]), "source_folder_id");
    const sourceFiles = mapBy(reader.table(roots, "source_files", ["source_file_id", "source_folder_id", "filename", "format_id"]), "source_file_id");
    const priceTiers = reader.table(roots, "price_tiers", ["price_tier_id", "label", "sort_order"], "index");
    const products = reader.table(roots, "products", [
      "product_id",
      "product_type",
      "label",
      "detail",
      "dimensions_imperial",
      "dimensions_metric",
      "min_megapixels",
      "delivery_asset_type_id",
      "base_price_cents",
      "sort_order",
      "active",
    ], "index");
    const productPrices = reader.table(roots, "product_prices", ["product_id", "price_tier_id", "price_cents"], "index");
    const frameRows = reader.table(roots, "frame_options", ["frame_id", "label", "base_price_cents", "sort_order", "active"], "index");
    const framePrices = reader.table(roots, "frame_prices", ["frame_id", "product_id", "price_cents"], "index");
    const shippingHandlingRows = reader.table(roots, "shipping_handling_prices", ["product_id", "price_cents"], "index");
    const videoPriceTierRows = reader.table(roots, "video_price_tiers", [
      "video_price_tier_id",
      "label",
      "min_duration_seconds",
      "max_duration_seconds",
      "price_cents",
      "sort_order",
    ], "index");
    const podSettingRows = reader.table(roots, "pod_settings", ["setting_key", "setting_value"], "index");
    const podSupplierRows = reader.table(roots, "pod_suppliers", [
      "supplier_id",
      "label",
      "role",
      "automation_status",
      "api_base_url",
      "api_docs_url",
      "quote_support",
      "order_support",
      "webhook_support",
      "sandbox_support",
      "fulfillment_regions",
      "notes",
      "active",
      "sort_order",
    ], "index");
    const podQualityTierRows = reader.table(roots, "pod_quality_tiers", [
      "quality_tier_id",
      "label",
      "supplier_id",
      "buyer_label",
      "quality_position",
      "print_profile",
      "frame_profile",
      "price_position",
      "automation_status",
      "notes",
      "active",
      "sort_order",
    ], "index");
    const podOptionRows = reader.table(roots, "pod_options", [
      "pod_option_id",
      "supplier_id",
      "product_id",
      "frame_id",
      "market_region",
      "currency",
      "supplier_product_id",
      "supplier_variant_id",
      "supplier_sku",
      "supplier_size",
      "supplier_item_cost_cents",
      "supplier_shipping_cents",
      "supplier_total_cents",
      "quote_supported",
      "order_supported",
      "requires_account",
      "fulfillment_model",
      "api_quote_mode",
      "api_order_mode",
      "source_url",
      "notes",
      "active",
      "sort_order",
    ], "index");
    const mediaItems = reader.table(roots, "media_items", [
      "media_id",
      "collection_id",
      "sort_index",
      "media_type_id",
      "camera_id",
      "lens_id",
      "title",
      "description",
      "keyword_ids",
      "source_origin_id",
      "captured_at",
      "exposure",
      "focal_length",
      "source_file_id",
      "location",
      "caption_color",
      "gps_latitude",
      "gps_longitude",
      "created_at",
      "updated_at",
    ], "index");
    const mediaAssets = reader.table(roots, "media_assets", ["media_id", "asset_type_id", "width", "height", "duration_seconds", "bytes", "format_id"], "index");

    const collectionById = mapBy(collections, "collection_id");
    const productPricesByProductId = new Map();
    for (const row of productPrices) {
      const productId = String(row.product_id || "");
      if (!productPricesByProductId.has(productId)) productPricesByProductId.set(productId, {});
      productPricesByProductId.get(productId)[String(row.price_tier_id || "")] = centsToDollars(row.price_cents);
    }
    const framePricesByFrameId = new Map();
    for (const row of framePrices) {
      const frameId = String(row.frame_id || "");
      if (!framePricesByFrameId.has(frameId)) framePricesByFrameId.set(frameId, {});
      framePricesByFrameId.get(frameId)[String(row.product_id || "")] = centsToDollars(row.price_cents);
    }
    const productCatalog = {
      priceTiers: Object.fromEntries(
        [...priceTiers]
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
          .map((tier) => [String(tier.price_tier_id || ""), { label: tier.label || "" }])
      ),
      resolutions: [...products]
        .filter((product) => Number(product.active) !== 0)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((product) => {
          const option = {
            id: String(product.product_id || ""),
            type: String(product.product_type || ""),
            label: product.label || "",
            detail: product.detail || "",
            price: centsToDollars(product.base_price_cents),
          };
          if (product.dimensions_imperial || product.dimensions_metric) {
            option.dimensions = {};
            if (product.dimensions_imperial) option.dimensions.imperial = product.dimensions_imperial;
            if (product.dimensions_metric) option.dimensions.metric = product.dimensions_metric;
          }
          if (product.min_megapixels != null) option.minMegapixels = Number(product.min_megapixels);
          const prices = productPricesByProductId.get(option.id);
          if (prices && Object.keys(prices).length) option.prices = prices;
          return option;
        }),
      frameOptions: [...frameRows]
        .filter((frame) => Number(frame.active) !== 0)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((frame) => {
          const option = {
            id: String(frame.frame_id || ""),
            label: frame.label || "",
            price: centsToDollars(frame.base_price_cents),
          };
          const prices = framePricesByFrameId.get(option.id);
          if (prices && Object.keys(prices).length) option.prices = prices;
          return option;
        }),
      shippingHandlingPrices: Object.fromEntries(
        shippingHandlingRows.map((row) => [String(row.product_id || ""), centsToDollars(row.price_cents)])
      ),
      videoPriceTiers: Object.fromEntries(
        [...videoPriceTierRows]
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
          .map((tier) => [String(tier.video_price_tier_id || ""), {
            label: tier.label || "",
            price: centsToDollars(tier.price_cents),
            minDurationSeconds: Number(tier.min_duration_seconds || 0),
            maxDurationSeconds: tier.max_duration_seconds == null ? null : Number(tier.max_duration_seconds),
          }])
      ),
      podAutomation: Object.fromEntries(
        podSettingRows.map((row) => [String(row.setting_key || ""), jsonValue(row.setting_value)])
      ),
      podSuppliers: [...podSupplierRows]
        .filter((supplier) => Number(supplier.active) !== 0)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((supplier) => ({
          id: String(supplier.supplier_id || ""),
          label: supplier.label || "",
          role: supplier.role || "",
          automationStatus: supplier.automation_status || "",
          apiBaseUrl: supplier.api_base_url || "",
          apiDocsUrl: supplier.api_docs_url || "",
          quoteSupport: supplier.quote_support || "",
          orderSupport: supplier.order_support || "",
          webhookSupport: supplier.webhook_support || "",
          sandboxSupport: supplier.sandbox_support || "",
          fulfillmentRegions: jsonValue(supplier.fulfillment_regions, []),
          notes: supplier.notes || "",
        })),
      podQualityTiers: [...podQualityTierRows]
        .filter((tier) => Number(tier.active) !== 0)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((tier) => ({
          id: String(tier.quality_tier_id || ""),
          label: tier.label || "",
          supplierId: String(tier.supplier_id || ""),
          buyerLabel: tier.buyer_label || "",
          qualityPosition: tier.quality_position || "",
          printProfile: tier.print_profile || "",
          frameProfile: tier.frame_profile || "",
          pricePosition: tier.price_position || "",
          automationStatus: tier.automation_status || "",
          notes: tier.notes || "",
        })),
      podOptions: [...podOptionRows]
        .filter((option) => Number(option.active) !== 0)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((option) => ({
          id: String(option.pod_option_id || ""),
          supplierId: String(option.supplier_id || ""),
          productId: String(option.product_id || ""),
          frameId: String(option.frame_id || "none"),
          marketRegion: String(option.market_region || ""),
          currency: String(option.currency || ""),
          supplierProductId: option.supplier_product_id == null ? null : String(option.supplier_product_id),
          supplierVariantId: option.supplier_variant_id == null ? null : String(option.supplier_variant_id),
          supplierSku: option.supplier_sku || "",
          supplierSize: option.supplier_size || "",
          supplierItemCost: nullableCentsToDollars(option.supplier_item_cost_cents),
          supplierShippingCost: nullableCentsToDollars(option.supplier_shipping_cents),
          supplierTotalCost: nullableCentsToDollars(option.supplier_total_cents),
          quoteSupported: Number(option.quote_supported) === 1,
          orderSupported: Number(option.order_supported) === 1,
          requiresAccount: Number(option.requires_account) === 1,
          fulfillmentModel: option.fulfillment_model || "",
          apiQuoteMode: option.api_quote_mode || "",
          apiOrderMode: option.api_order_mode || "",
          sourceUrl: option.source_url || "",
          notes: option.notes || "",
        })),
    };
    const assetsByMediaId = new Map();
    for (const asset of mediaAssets) {
      const mediaId = String(asset.media_id || "");
      if (!assetsByMediaId.has(mediaId)) assetsByMediaId.set(mediaId, {});
      const code = assetTypes.get(Number(asset.asset_type_id));
      if (code) assetsByMediaId.get(mediaId)[code] = asset;
    }

    const data = {};
    const owner = {};
    for (const collection of [...collections].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
      const slug = String(collection.slug || "");
      if (!slug) continue;
      const target = String(collection.scope || "public") === "owner" ? owner : data;
      target[slug] = {
        number: pad2(collection.sort_order),
        title: collection.title || slug,
        description: collection.description || "",
        accent: `${slug}-gallery`,
        photos: [],
      };
    }

    const sortIndexByMediaId = new Map();
    for (const item of mediaItems) {
      const collection = collectionById.get(Number(item.collection_id));
      if (!collection) continue;
      const slug = String(collection.slug || "");
      const target = (String(collection.scope || "public") === "owner" ? owner : data)[slug];
      if (!target) continue;
      const mediaType = mediaTypes.get(Number(item.media_type_id)) || "photo";
      const sourceOrigin = sourceOrigins.get(Number(item.source_origin_id)) || "";
      const assets = assetsByMediaId.get(String(item.media_id || "")) || {};
      const sourceFile = sourceFiles.get(Number(item.source_file_id));
      const sourceFolder = sourceFolders.get(Number(sourceFile?.source_folder_id));
      const sourcePath = [String(sourceFolder?.source_folder || ""), String(sourceFile?.filename || "")].filter(Boolean).join("/");
      const fullAsset = assets.full;
      const originalFormat = formats.get(Number(fullAsset?.format_id || sourceFile?.format_id)) || "jpg";
      const keywordList = keywordsFor(item.keyword_ids, keywordTerms);
      const galleryAsset = assets.still_900;
      const detailAsset = mediaType === "video" ? assets.short_5s_720p : assets.still_1800;
      const sortIndex = Number(item.sort_index || 0);
      sortIndexByMediaId.set(String(item.media_id || ""), sortIndex);
      const location = String(item.location || "");
      const date = capturedDate(item.captured_at);
      const caption = [
        target.title,
        location && location !== target.title ? location : "",
        date,
      ].filter(Boolean).join(" / ");
      const publicPreview = {
        allowed: true,
        galleryKey: mediaKey(item.media_id, "still_900", mediaType),
        detailKey: mediaKey(item.media_id, mediaType === "video" ? "short_5s_720p" : "still_1800", mediaType),
      };
      const photo = {
        id: String(item.media_id || ""),
        className: `p${(sortIndex % 5) + 1}`,
        title: String(item.title || item.media_id || ""),
        caption,
        captionColor: String(item.caption_color || ""),
        full: `${sourceType(originalFormat)} master`,
        megapixels: roundMegapixels(fullAsset?.width, fullAsset?.height),
        sourceOrigin,
        pricingTier: sourceOrigin === "ai" ? "ai" : "original",
        gallerySrc: "",
        imageSrc: "",
        metadata: metadataRows(item, {
          assets,
          assetCodeById: assetTypes,
          camera: cameras.get(Number(item.camera_id)) || "",
          lens: lenses.get(Number(item.lens_id)) || "",
          mediaType,
          originalFormat,
          sourceFile,
          sourceFolder,
          formatById: formats,
          keywords: keywordList,
        }),
        media: {
          type: mediaType,
          sourcePolicy: "developed-master",
          publicPreview,
        },
        sourceFiles: [
          {
            path: sourcePath,
            type: sourceType(originalFormat),
            bytes: Number(fullAsset?.bytes || 0),
          },
        ].filter((source) => source.path),
        keywords: keywordList,
      };
      if (mediaType === "video") {
        photo.duration = Number(fullAsset?.duration_seconds || detailAsset?.duration_seconds || 0);
        photo.media.video = { duration: photo.duration };
      }
      if (!galleryAsset) photo.media.publicPreview.galleryMissing = true;
      if (!detailAsset) photo.media.publicPreview.detailMissing = true;
      target.photos.push(photo);
    }

    for (const collection of Object.values(data)) {
      collection.photos.sort((a, b) => {
        return Number(sortIndexByMediaId.get(a.id) || 0) - Number(sortIndexByMediaId.get(b.id) || 0);
      });
    }

    return {
      data,
      owner,
      productCatalog,
      counts: {
        collections: collections.length,
        mediaItems: mediaItems.length,
        mediaAssets: mediaAssets.length,
        products: products.length,
        priceTiers: priceTiers.length,
        podSuppliers: podSupplierRows.length,
        podQualityTiers: podQualityTierRows.length,
        podOptions: podOptionRows.length,
      },
    };
  };

  const api = { decodeCatalog, toBytes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.photosByElieCatalogSqlite = api;
})();
