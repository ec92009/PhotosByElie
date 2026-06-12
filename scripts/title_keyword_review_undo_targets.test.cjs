const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveTitleReviewUndoTargetIds } = require("../title-keyword-review.js");

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
