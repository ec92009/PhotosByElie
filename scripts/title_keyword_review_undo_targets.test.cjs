const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTitleReviewContinuityQueue,
  continuityStateWithBlockedItems,
  continuityStateWithoutBlockedItems,
  resolveTitleReviewUndoTargetIds,
  titleReviewContinuityBlockedFlag,
} = require("../title-keyword-review.js");

test("title review undo targets the active saved block when no fresh batch is recorded", () => {
  assert.deepEqual(resolveTitleReviewUndoTargetIds({
    lastBlockBatchPhotoIds: [],
    selectedPhotoIds: [],
    activePhotoId: "pbe-active-blocked",
    savedBlockedPhotoIds: ["pbe-active-blocked"],
  }), ["pbe-active-blocked"]);
});

test("title review undo prefers the recorded block batch", () => {
  assert.deepEqual(resolveTitleReviewUndoTargetIds({
    lastBlockBatchPhotoIds: ["pbe-b", "pbe-a", "pbe-b"],
    selectedPhotoIds: ["pbe-c"],
    activePhotoId: "pbe-c",
    savedBlockedPhotoIds: ["pbe-a", "pbe-b", "pbe-c"],
  }), ["pbe-b", "pbe-a"]);
});

test("title review undo falls back to selected saved blocked rows", () => {
  assert.deepEqual(resolveTitleReviewUndoTargetIds({
    lastBlockBatchPhotoIds: [],
    selectedPhotoIds: ["pbe-normal", "pbe-blocked"],
    activePhotoId: "pbe-other",
    savedBlockedPhotoIds: ["pbe-blocked"],
  }), ["pbe-blocked"]);
});

test("title review continuity keeps blocked rows in place and appends new candidates", () => {
  const now = Date.UTC(2026, 5, 14, 10, 0, 0);
  const blockedItem = { photo_id: "pbe-b", current: { title: "Blocked B" } };
  const savedState = continuityStateWithBlockedItems({
    state: {
      createdAt: now,
      updatedAt: now,
      order: ["pbe-a", "pbe-b", "pbe-c", "pbe-d"],
      blocked: {},
    },
    items: [blockedItem],
    now,
  });

  const result = buildTitleReviewContinuityQueue({
    currentItems: [
      { photo_id: "pbe-a" },
      { photo_id: "pbe-c" },
      { photo_id: "pbe-d" },
      { photo_id: "pbe-new" },
    ],
    savedState,
    now: now + 1000,
  });

  assert.deepEqual(result.items.map((item) => item.photo_id), ["pbe-a", "pbe-b", "pbe-c", "pbe-d", "pbe-new"]);
  assert.equal(result.items[1][titleReviewContinuityBlockedFlag], true);
  assert.deepEqual(result.appendedIds, ["pbe-new"]);
});

test("title review continuity preserves the saved queue order across refreshes", () => {
  const now = Date.UTC(2026, 5, 14, 10, 0, 0);
  const result = buildTitleReviewContinuityQueue({
    currentItems: [
      { photo_id: "pbe-c" },
      { photo_id: "pbe-a" },
      { photo_id: "pbe-d" },
      { photo_id: "pbe-b" },
    ],
    savedState: {
      createdAt: now,
      updatedAt: now,
      order: ["pbe-a", "pbe-b", "pbe-c"],
      blocked: {},
    },
    now: now + 1000,
  });

  assert.deepEqual(result.items.map((item) => item.photo_id), ["pbe-a", "pbe-b", "pbe-c", "pbe-d"]);
});

test("title review continuity removes blocked snapshots after unblock", () => {
  const now = Date.UTC(2026, 5, 14, 10, 0, 0);
  const blockedState = continuityStateWithBlockedItems({
    state: { createdAt: now, updatedAt: now, order: ["pbe-a", "pbe-b"], blocked: {} },
    items: [{ photo_id: "pbe-b" }],
    now,
  });
  const unblockedState = continuityStateWithoutBlockedItems({
    state: blockedState,
    photoIds: ["pbe-b"],
    now: now + 1000,
  });
  const result = buildTitleReviewContinuityQueue({
    currentItems: [{ photo_id: "pbe-a" }, { photo_id: "pbe-b" }],
    savedState: unblockedState,
    now: now + 2000,
  });

  assert.deepEqual(Object.keys(unblockedState.blocked), []);
  assert.equal(result.items[1][titleReviewContinuityBlockedFlag], undefined);
});
