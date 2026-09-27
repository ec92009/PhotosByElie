import browserCatalog from "../catalog-sqlite.js";
import { videoError } from "./campaign-video-contract.mjs";

export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const invalid = () => { throw videoError(503, "campaign_video_catalog_invalid"); };
const requireValid = (condition) => { if (!condition) invalid(); };

/** Read-only bounded variant of the existing browser decoder, not a SQL engine.
 * The existing scalar decoder is reused; strict traversal also handles overflow.
 * Format: https://www.sqlite.org/fileformat.html#b_tree_pages
 */
class StrictCatalogReader extends browserCatalog.SQLiteCatalogReader {
  constructor(bytes) {
    requireValid(bytes instanceof Uint8Array && bytes.length >= 512 && bytes.length <= MAX_CATALOG_BYTES);
    super(bytes);
    if (this.pageSize === 1) this.pageSize = 65536;
    this.usableSize = this.pageSize;
    requireValid(this.pageSize >= 512 && this.pageSize <= 65536 && (this.pageSize & (this.pageSize - 1)) === 0
      && bytes.length % this.pageSize === 0 && this.reservedBytes === 0
      && bytes[18] === 1 && bytes[19] === 1 && bytes[20] === 0
      && bytes[21] === 64 && bytes[22] === 32 && bytes[23] === 32
      && this.u32(28) === bytes.length / this.pageSize && this.u32(44) === 4 && this.u32(56) === 1
      && this.u32(24) === this.u32(92)); // Complete rollback-journal artifact, never a WAL snapshot.
    this.visited = new Set();
    this.totalRows = 0;
  }

  claimPage(page) {
    requireValid(Number.isSafeInteger(page) && page >= 1 && page <= this.bytes.length / this.pageSize
      && !this.visited.has(page));
    this.visited.add(page);
    return (page - 1) * this.pageSize;
  }

  readVarintFromPayload(payload, offset) {
    let value = 0;
    for (let i = 0; i < 9; i++) {
      requireValid(offset + i < payload.length);
      const byte = payload[offset + i];
      value = value * (i === 8 ? 256 : 128) + (i === 8 ? byte : byte & 127);
      requireValid(Number.isSafeInteger(value));
      if (i === 8 || byte < 128) return { value, offset: offset + i + 1 };
    }
    invalid();
  }

  parseRecord(payload, selectedColumns) {
    const header = this.readVarintFromPayload(payload, 0);
    requireValid(header.value >= header.offset && header.value <= payload.length);
    const serials = [];
    let offset = header.offset;
    while (offset < header.value) {
      const serial = this.readVarintFromPayload(payload, offset);
      requireValid(serial.offset <= header.value && serial.value !== 10 && serial.value !== 11 && serials.length < 64);
      serials.push(serial.value); offset = serial.offset;
    }
    offset = header.value;
    const result = serials.map((serial, index) => {
      const length = this.serialLength(serial);
      requireValid(offset + length <= payload.length);
      // Do not materialize descriptions, source paths or other unused metadata.
      const value = selectedColumns && !selectedColumns.has(index) ? undefined
        : serial >= 13 && serial % 2 === 1
          ? new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(offset, offset + length))
          : this.readSerial(payload, offset, serial);
      offset += length;
      return value;
    });
    requireValid(offset === payload.length);
    return result;
  }

  payload(page, offset, length, type) {
    requireValid(length > 0 && length <= 256 * 1024);
    const maximum = type === 13 ? this.pageSize - 35 : Math.floor((this.pageSize - 12) * 64 / 255) - 23;
    const minimum = Math.floor((this.pageSize - 12) * 32 / 255) - 23;
    const candidate = minimum + (length - minimum) % (this.pageSize - 4);
    const local = length <= maximum ? length : (candidate <= maximum ? candidate : minimum);
    requireValid(offset + local + (local < length ? 4 : 0) <= page.length);
    if (local === length) return page.subarray(offset, offset + length);
    const bytes = new Uint8Array(length);
    bytes.set(page.subarray(offset, offset + local));
    let filled = local;
    let next = new DataView(page.buffer, page.byteOffset, page.byteLength).getUint32(offset + local);
    while (filled < length) {
      const start = this.claimPage(next);
      next = this.u32(start);
      const count = Math.min(length - filled, this.pageSize - 4);
      bytes.set(this.bytes.subarray(start + 4, start + 4 + count), filled);
      filled += count;
    }
    requireValid(next === 0);
    return bytes;
  }

  readBtree(rootPage, mode, selectedColumns) {
    const rows = [];
    const visit = (number, depth = 0) => {
      requireValid(depth <= 32);
      const start = this.claimPage(number);
      const page = this.bytes.subarray(start, start + this.pageSize);
      const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
      const header = number === 1 ? 100 : 0;
      const type = page[header];
      requireValid((mode === "table" ? [5, 13] : [2, 10]).includes(type));
      const interior = type === 2 || type === 5;
      const count = view.getUint16(header + 3);
      const pointers = header + (interior ? 12 : 8);
      const cellStart = view.getUint16(header + 5) || 65536;
      requireValid(pointers + count * 2 <= cellStart && cellStart <= page.length);
      const seenCells = new Set();
      for (let i = 0; i < count; i++) {
        let offset = view.getUint16(pointers + i * 2);
        requireValid(offset >= cellStart && offset < page.length && !seenCells.has(offset));
        seenCells.add(offset);
        if (interior) { requireValid(offset + 4 <= page.length); visit(view.getUint32(offset), depth + 1); offset += 4; }
        if (type === 5) { this.readVarintFromPayload(page, offset); continue; }
        const size = this.readVarintFromPayload(page, offset); offset = size.offset;
        let rowid;
        if (type === 13) { const row = this.readVarintFromPayload(page, offset); rowid = row.value; offset = row.offset; }
        requireValid(++this.totalRows <= 100000);
        rows.push({ rowid, values: this.parseRecord(this.payload(page, offset, size.value, type), selectedColumns) });
      }
      if (interior) visit(view.getUint32(header + 8), depth + 1);
    };
    visit(rootPage);
    return rows;
  }
}

const TABLES = {
  collections: ["table", "collection_id:INTEGER slug:TEXT title:TEXT description:TEXT scope:TEXT"],
  media_types: ["table", "media_type_id:INTEGER code:TEXT"],
  source_origins: ["table", "source_origin_id:INTEGER code:TEXT"],
  formats: ["table", "format_id:INTEGER extension:TEXT"],
  asset_types: ["table", "asset_type_id:INTEGER code:TEXT"],
  media_items: ["index", "media_id:TEXT collection_id:INTEGER sort_index:INTEGER media_type_id:INTEGER camera_id:INTEGER lens_id:INTEGER title:TEXT description:TEXT keyword_ids:TEXT source_origin_id:INTEGER"],
  media_assets: ["index", "media_id:TEXT asset_type_id:INTEGER width:INTEGER height:INTEGER duration_seconds:REAL bytes:INTEGER format_id:INTEGER"],
};

/** Require the actual public artifact's column ordering and table representation. */
function readTables(reader) {
  const schema = reader.readBtree(1, "table").map((row) => row.values);
  const result = {};
  for (const [name, [mode, fields]] of Object.entries(TABLES)) {
    const matches = schema.filter((row) => row[0] === "table" && row[1] === name && row[2] === name);
    requireValid(matches.length === 1);
    const [, , , root, sql] = matches[0];
    requireValid(typeof sql === "string" && /^CREATE TABLE /i.test(sql)
      && /\bWITHOUT\s+ROWID\s*$/i.test(sql) === (mode === "index"));
    const columns = [...sql.matchAll(/(?:\(|,)\s*([a-z_]+)\s+(INTEGER|TEXT|REAL|BLOB)\b/gi)]
      .map((match) => `${match[1]}:${match[2].toUpperCase()}`);
    const expected = fields.split(" ");
    requireValid(expected.every((field, i) => columns[i] === field));
    const names = expected.map((field) => field.split(":")[0]);
    const selected = new Set(name === "media_items" ? [0, 1, 3, 9]
      : name === "media_assets" ? [0, 1, 2, 3, 6] : name === "collections" ? [0, 1, 4] : [0, 1]);
    result[name] = reader.readBtree(root, mode, selected).map(({ rowid, values }) => {
      const record = Object.fromEntries([...selected].map((i) => [names[i], values[i]]));
      if (mode === "table" && record[names[0]] == null) record[names[0]] = rowid;
      return record;
    });
  }
  return result;
}

const uniqueMap = (rows, key, value = null) => {
  const map = new Map();
  for (const row of rows) {
    requireValid(!map.has(row[key])); map.set(row[key], value ? row[value] : row);
  }
  return map;
};

/** Select requested current public camera stills; never return catalog metadata/originals. */
export function readPublicCatalogStills(bytes, mediaIds) {
  try {
    const tables = readTables(new StrictCatalogReader(bytes));
    const collections = uniqueMap(tables.collections, "collection_id");
    const types = uniqueMap(tables.media_types, "media_type_id", "code");
    const origins = uniqueMap(tables.source_origins, "source_origin_id", "code");
    const formats = uniqueMap(tables.formats, "format_id", "extension");
    const assetTypes = uniqueMap(tables.asset_types, "asset_type_id", "code");
    const media = uniqueMap(tables.media_items, "media_id");
    const assets = uniqueMap(tables.media_assets.map((row) => ({ ...row, key: `${row.media_id}/${row.asset_type_id}` })), "key");
    const photos = new Map();
    for (const id of mediaIds) {
      const item = media.get(id);
      const collection = collections.get(item?.collection_id);
      const previews = [...assets.values()].filter((row) => row.media_id === id
        && ["still_900", "still_1800"].includes(assetTypes.get(row.asset_type_id)));
      if (!item || collection?.scope !== "public" || !collection.slug || collection.slug === "ai"
          || types.get(item.media_type_id) !== "photo" || origins.get(item.source_origin_id) !== "camera"
          || previews.length !== 2 || new Set(previews.map((row) => assetTypes.get(row.asset_type_id))).size !== 2
          || previews.some((row) => formats.get(row.format_id) !== "jpg" || !Number.isSafeInteger(row.width)
            || row.width <= 0 || !Number.isSafeInteger(row.height) || row.height <= 0)) continue;
      photos.set(id, { photo: { media: { type: "photo", publicPreview: { allowed: true,
        galleryKey: `expo/${id}_900.jpg`, detailKey: `expo/${id}_1800.jpg` } } } });
    }
    return { photos };
  } catch { throw videoError(503, "campaign_video_catalog_invalid"); }
}
