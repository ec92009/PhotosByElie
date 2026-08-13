import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createMemoryStore } from "./memory-store.mjs";
import { createRealEstateDeliverables } from "./real-estate-deliverables.mjs";

const localServerSource = fs.readFileSync(new URL("./local-server.mjs", import.meta.url), "utf8");

const localAdapter = () => {
  const start = localServerSource.indexOf("const createLocalRehearsalLifecycleGuard");
  const end = localServerSource.indexOf("\nconst delivery =", start);
  assert.ok(start >= 0 && end > start, "local Real Estate adapter must remain extractable for regression coverage");
  return Function(
    "createRealEstateDeliverables",
    `${localServerSource.slice(start, end)}\nreturn { createLocalRehearsalLifecycleGuard, createLocalRealEstateDeliverables };`,
  )(createRealEstateDeliverables);
};

const createMemoryR2 = () => {
  const objects = new Map();
  return {
    async put(key, body, metadata = {}) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, metadata });
      return { key, size: bytes.byteLength };
    },
    async get(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return {
        size: entry.bytes.byteLength,
        httpMetadata: entry.metadata.httpMetadata || {},
        customMetadata: entry.metadata.customMetadata || {},
        text: async () => new TextDecoder().decode(entry.bytes),
        arrayBuffer: async () => entry.bytes.buffer.slice(
          entry.bytes.byteOffset,
          entry.bytes.byteOffset + entry.bytes.byteLength,
        ),
      };
    },
    async list({ prefix = "" } = {}) {
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, entry]) => ({ key, size: entry.bytes.byteLength })),
        truncated: false,
      };
    },
  };
};

const readyPdf = {
  id: "local-ready-pdf",
  type: "pdf",
  status: "ready",
  title: "Local rehearsal delivery",
  filename: "local-rehearsal.pdf",
  outputs: {
    pdf: {
      key: "outputs/local-rehearsal.pdf",
      contentType: "application/pdf",
    },
  },
  batch: {
    batchId: "local-rehearsal-batch",
    projects: [{ items: [{ canonicalMediaId: "001-local-rehearsal" }] }],
  },
};

const gallery = { key: "local-real-estate", username: "Local Client" };
const session = { galleryKey: gallery.key, username: gallery.username };

const seedReadyPdf = async (deliverables, bucket) => {
  const record = await deliverables.putDeliverable({
    galleryKey: gallery.key,
    realEstateSession: session,
    deliverable: readyPdf,
  });
  await bucket.put(readyPdf.outputs.pdf.key, new TextEncoder().encode("%PDF-local-rehearsal"), {
    httpMetadata: { contentType: "application/pdf" },
  });
  return record;
};

test("local Real Estate rehearsal creates links with a deterministic guard while the base stays fail-closed", async () => {
  const { createLocalRehearsalLifecycleGuard, createLocalRealEstateDeliverables } = localAdapter();
  const guard = createLocalRehearsalLifecycleGuard();
  const firstFence = await guard(["001-b", "001-a", "001-b"], "first");
  const secondFence = await guard(["001-a", "001-b"], "second", firstFence);
  assert.deepEqual(secondFence, firstFence);

  const localBucket = createMemoryR2();
  const local = createLocalRealEstateDeliverables({
    privateBucket: localBucket,
    galleries: [gallery],
    store: createMemoryStore(),
  });
  const localRecord = await seedReadyPdf(local, localBucket);
  const delivery = await local.createDeliveryLinks({
    galleryKey: gallery.key,
    realEstateSession: session,
    deliverableIds: [localRecord.id],
  });
  assert.equal(delivery.links.length, 1);
  assert.match(delivery.links[0].url, /\/download\/relink_/);

  const unguardedBucket = createMemoryR2();
  const unguarded = createRealEstateDeliverables({
    privateBucket: unguardedBucket,
    galleries: [gallery],
    store: createMemoryStore(),
  });
  const unguardedRecord = await seedReadyPdf(unguarded, unguardedBucket);
  await assert.rejects(unguarded.createDeliveryLinks({
    galleryKey: gallery.key,
    realEstateSession: session,
    deliverableIds: [unguardedRecord.id],
  }), { code: "lifecycle_authority_unavailable" });
});
