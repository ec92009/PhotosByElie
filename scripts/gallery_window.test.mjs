import test from "node:test";
import assert from "node:assert/strict";

import {
  GALLERY_PAGE_SIZE,
  MAX_RENDERED_GALLERY_PHOTOS,
  checkpointMatchesExplicitFilter,
  moveGalleryWindow,
  normalizeGalleryWindow,
} from "../gallery-window.mjs";

test("gallery window accumulates to 192 before forward moves evict old cards", () => {
  let window = { start: 0, end: GALLERY_PAGE_SIZE };
  window = moveGalleryWindow({ ...window, total: 1_649, direction: "forward", count: 24 });
  assert.deepEqual(window, { start: 0, end: 48 });
  window = moveGalleryWindow({ ...window, total: 1_649, direction: "forward", count: 48 });
  assert.deepEqual(window, { start: 0, end: 96 });
  window = moveGalleryWindow({ ...window, total: 1_649, direction: "forward", count: 96 });
  assert.deepEqual(window, { start: 0, end: 192 });
  window = moveGalleryWindow({ ...window, total: 1_649, direction: "forward", count: 24 });
  assert.deepEqual(window, { start: 24, end: 216 });
});

test("backward 24, 48, and 96 moves restore old cards and evict newest cards", () => {
  assert.deepEqual(
    moveGalleryWindow({ start: 96, end: 288, total: 1_649, direction: "backward", count: 24 }),
    { start: 72, end: 264 },
  );
  assert.deepEqual(
    moveGalleryWindow({ start: 96, end: 288, total: 1_649, direction: "backward", count: 48 }),
    { start: 48, end: 240 },
  );
  assert.deepEqual(
    moveGalleryWindow({ start: 96, end: 288, total: 1_649, direction: "backward", count: 96 }),
    { start: 0, end: 192 },
  );
});

test("Spain-sized traversal never renders more than 192 cards", () => {
  let window = { start: 0, end: GALLERY_PAGE_SIZE };
  const steps = [24, 48, 96];
  for (let index = 0; index < 80; index += 1) {
    window = moveGalleryWindow({
      ...window,
      total: 1_649,
      direction: "forward",
      count: steps[index % steps.length],
    });
    assert.ok(window.end - window.start <= MAX_RENDERED_GALLERY_PHOTOS);
  }
  assert.deepEqual(normalizeGalleryWindow({ start: 0, end: 1_649, total: 1_649 }), { start: 1_457, end: 1_649 });
});

test("matching explicit URL filters preserve a durable checkpoint while conflicting links override it", () => {
  const checkpointFilter = {
    query: "Paris",
    dateFrom: "2011-11-02",
    dateTo: "2026-06-23",
  };
  assert.equal(checkpointMatchesExplicitFilter({ checkpointFilter }), true);
  assert.equal(checkpointMatchesExplicitFilter({
    checkpointFilter,
    explicitFilter: { dateFrom: "2011-11-02", dateTo: "2026-06-23" },
    explicitKeys: ["dateFrom", "dateTo"],
  }), true);
  assert.equal(checkpointMatchesExplicitFilter({
    checkpointFilter,
    explicitFilter: { query: "Lyon" },
    explicitKeys: ["query"],
  }), false);
});
