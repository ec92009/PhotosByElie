import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  batchModelOutputSchema,
  benchmarkBatchPlan,
  codexModelConfig,
  groupOrdinaryCandidates,
  invokeCodexProposalModel,
  modelBatchPromptForRows,
  normalizeBatchModelResults,
  normalizeModelLadder,
  parseModelProposalText,
  proposalForPhoto,
  selectedGeneratorForRow,
} from "./generate_title_keyword_review_queue.mjs";

const batchTestInput = (photoId, capture = "2026-06-14T10:00:00") => ({
  row: {
    id: photoId,
    galleryKey: "spain",
    galleryLabel: "Spain",
    capture: { raw: capture.replaceAll("-", ":").replace("T", " "), sort: capture, date: capture.slice(0, 10) },
    captureSort: capture,
    proposalAttempt: 1,
  },
  photo: {
    id: photoId,
    sourceFiles: [{ path: "apple-photos-import/20260614T100000Z-shoot/" + photoId + ".jpg" }],
  },
  galleryLabel: "Spain",
  currentKeywords: [],
  localProposal: { title: "", keywords: [], status: "needs_owner_context", reason: "" },
  blacklist: [],
  sourceFile: { path: "apple-photos-import/20260614T100000Z-shoot/" + photoId + ".jpg" },
  meta: { original_file: photoId + ".jpg" },
  previewPath: "",
  requestedGenerator: {
    model: "codex-gpt-5.6-luna-max-vision",
    model_level: 1,
    model_ladder: ["codex-gpt-5.4-mini", "codex-gpt-5.6-luna-max-vision"],
    resolved_model: "gpt-5.6-luna",
    reasoning_effort: "max",
    vision: true,
  },
});

const validBatchResult = (photoId, title = "Spanish courtyard") => ({
  photo_id: photoId,
  title,
  keywords: ["Spain", "Travel", "Architecture", "Courtyard", "Historic", "Europe", "Photography", "Culture", "Urban", "Light"],
  confidence: "medium",
  status: "model_context",
  reason: "The image and source context support this proposal.",
  needs_owner_context: false,
});

test("same-shoot grouping is deterministic and bounded by capture windows", () => {
  const rows = [
    { ...batchTestInput("a", "2026-06-14T10:00:00").row, photo: batchTestInput("a").photo },
    { ...batchTestInput("b", "2026-06-14T10:30:00").row, photo: batchTestInput("b").photo },
    { ...batchTestInput("c", "2026-06-14T13:01:00").row, photo: batchTestInput("c").photo },
  ];
  const groups = groupOrdinaryCandidates(rows);
  assert.deepEqual(groups.map((group) => group.rows.length), [1, 2]);
  assert.equal(groups[1].rows.map((row) => row.id).sort().join(","), "a,b");
  const benchmark = benchmarkBatchPlan({ rows, maxImages: 2 });
  assert.equal(benchmark.baseline.model_invocations, 3);
  assert.equal(benchmark.bounded_image_count_plan.model_invocations, 2);
  assert.equal(benchmark.invocation_reduction_ratio, 1 / 3);
  assert.equal(benchmark.throughput_multiplier, 1.5);
});

test("batch prompt requires every photo_id and preserves attachment identity", () => {
  const inputs = [batchTestInput("photo-a"), batchTestInput("photo-b")];
  const prompt = modelBatchPromptForRows({
    inputs,
    requestedGenerator: inputs[0].requestedGenerator,
    batchId: "batch-test",
    chunkId: "chunk-test",
  });
  assert.match(prompt, /Every input photo_id must appear exactly once/);
  assert.match(prompt, /photo-a/);
  assert.match(prompt, /photo-b/);
  assert.deepEqual(batchModelOutputSchema().properties.results.items.required, [
    "photo_id",
    "title",
    "keywords",
    "confidence",
    "status",
    "reason",
    "needs_owner_context",
  ]);
  assert.equal(batchModelOutputSchema().properties.results.items.additionalProperties, false);
});

test("batch validation isolates duplicate and missing photo IDs", () => {
  const inputs = [batchTestInput("photo-a"), batchTestInput("photo-b")];
  const result = normalizeBatchModelResults({
    inputs,
    blacklist: [],
    payload: {
      results: [
        validBatchResult("photo-a"),
        validBatchResult("photo-a", "Duplicate answer"),
      ],
    },
  });
  assert.equal(result.successes.length, 0);
  assert.deepEqual(
    result.failures.map((failure) => [failure.input.photo.id, failure.kind]).sort(),
    [["photo-a", "duplicate_photo_id"], ["photo-b", "missing_photo_id"]],
  );
});

test("batch validation keeps valid results when one item is malformed", () => {
  const inputs = [batchTestInput("photo-a"), batchTestInput("photo-b")];
  const result = normalizeBatchModelResults({
    inputs,
    blacklist: [],
    payload: {
      results: [
        validBatchResult("photo-a"),
        { photo_id: "photo-b", title: "", keywords: [] },
      ],
    },
  });
  assert.deepEqual(result.successes.map((success) => success.input.photo.id), ["photo-a"]);
  assert.equal(result.failures[0].input.photo.id, "photo-b");
});

test("rework rows with missing provenance start at the first AI ladder level", () => {
  const selected = selectedGeneratorForRow({
    reworkPriority: true,
    previousGeneratorModelLevel: null,
    previousGeneratorModelMaxed: false,
  });
  assert.equal(selected.model, "codex-gpt-5.4-mini");
  assert.equal(selected.model_level, 0);
  assert.equal(selected.model_maxed, false);
});

test("legacy local provenance restarts on the first supported OpenAI rung", () => {
  const selected = selectedGeneratorForRow({
    reworkPriority: true,
    previousGeneratorModelLevel: 0,
    previousGeneratorModelMaxed: false,
  });
  assert.equal(selected.model, "codex-gpt-5.4-mini");
  assert.equal(selected.model_level, 0);
});

test("maxed rejected rows are marked exhausted instead of cycling the same model", () => {
  const selected = selectedGeneratorForRow({
    reworkPriority: true,
    previousGeneratorModel: "codex-gpt-5.6-sol-high-vision",
    previousGeneratorModelLevel: 2,
    previousGeneratorModelMaxed: true,
  });
  assert.equal(selected.model, "codex-gpt-5.6-sol-high-vision");
  assert.equal(selected.model_maxed, true);
  assert.equal(selected.exhausted, true);
});

test("new proposals use the exact default Free to Luna to Sol ladder", () => {
  const selected = selectedGeneratorForRow({ reworkPriority: false });
  assert.deepEqual(selected.model_ladder, [
    "codex-gpt-5.4-mini",
    "codex-gpt-5.6-luna-max-vision",
    "codex-gpt-5.6-sol-high-vision",
  ]);
  assert.equal(selected.label, "Free");
});

test("Codex ladder aliases map to real Codex CLI model settings", () => {
  assert.deepEqual(codexModelConfig({ model: "codex-gpt-5.6-luna-max-vision" }), {
    model: "gpt-5.6-luna",
    reasoningEffort: "max",
    vision: true,
  });
  assert.deepEqual(codexModelConfig({ model: "codex-gpt-5.6-sol-high-vision" }), {
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    vision: true,
  });
});

test("model ladder validation excludes local and Ollama choices", () => {
  assert.throws(() => normalizeModelLadder(["local-metadata-rules-v1"]), /out of scope/);
  assert.throws(() => normalizeModelLadder(["ollama-llama"]), /out of scope/);
  assert.deepEqual(normalizeModelLadder([
    "codex-gpt-5.6-sol-high-vision",
    "codex-gpt-5.4-mini",
  ]), [
    "codex-gpt-5.6-sol-high-vision",
    "codex-gpt-5.4-mini",
  ]);
});

test("model proposal text parser accepts fenced JSON", () => {
  const parsed = parseModelProposalText("```json\n{\"title\":\"Pisa Tower\",\"keywords\":[\"Pisa\"]}\n```");
  assert.equal(parsed.title, "Pisa Tower");
  assert.deepEqual(parsed.keywords, ["Pisa"]);
});

test("local rules clean internal markers and still meet the keyword floor", () => {
  const proposal = proposalForPhoto({
    photo: {
      id: "20110106-0633-16316",
      sourceOrigin: "camera",
      metadata: [{ label: "Original size", value: "1800 x 1200" }],
    },
    galleryLabel: "France",
    currentTitle: "Family 4+, NotMyPhoto",
    currentKeywords: ["Family 4+", "France", "NotMyPhoto"],
    currentKeywordsRaw: "Family 4+, France, NotMyPhoto",
    blacklist: [],
    sourceFile: { path: "2010-2014/20110106 0633 16316.jpg" },
    capture: { raw: "2011:01:06 06:33:21", sort: "2011-01-06T06:33:21" },
  });
  assert.equal(proposal.title, "Family Travel in France");
  assert.equal(proposal.keywords.includes("NotMyPhoto"), false);
  assert.ok(proposal.keywords.length >= 10);
  assert.ok(proposal.keywords.includes("Family travel"));
  assert.ok(proposal.keywordTargetMet);
});

test("Apple Photos album context can title imported filename photos", () => {
  const proposal = proposalForPhoto({
    photo: {
      id: "img-4401-test",
      sourceOrigin: "camera",
      metadata: [{ label: "Original size", value: "4032 x 3024" }],
    },
    galleryLabel: "Spain",
    currentTitle: "IMG_4401",
    currentKeywords: [],
    currentKeywordsRaw: "",
    blacklist: [],
    sourceFile: {
      path: "apple-photos-import/20260622T140000Z-batch/0001-IMG_4401.jpg",
      apple_photos_album: { title: "2023 Nerja" },
      gps: { latitude: 36.746, longitude: -3.879 },
    },
    capture: { raw: "2023:06:04 12:00:00", sort: "2023-06-04T12:00:00" },
  });
  assert.equal(proposal.title, "Nerja");
  assert.ok(proposal.keywords.includes("Nerja"));
  assert.ok(proposal.keywords.includes("Spain"));
  assert.notEqual(proposal.status, "needs_owner_context");
});

test("Codex model invocation uses the configured CLI and output file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-title-keyword-test-"));
  const fakeCodex = path.join(tempDir, "codex");
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex < 0) process.exit(11);
const outputPath = args[outputIndex + 1];
const prompt = fs.readFileSync(0, "utf8");
if (!prompt.includes("Owner reject comment")) process.exit(12);
fs.writeFileSync(outputPath, JSON.stringify({
  title: "Leaning Tower of Pisa",
  keywords: ["Pisa", "Leaning Tower", "Italy", "Tuscany", "Architecture", "Landmark", "Travel", "Historic city", "Tower", "European travel"],
  confidence: "medium",
  status: "model_rework",
  reason: "Uses the Owner reject comment and keyword hints.",
  needs_owner_context: false
}));
`);
  fs.chmodSync(fakeCodex, 0o755);
  const previous = process.env.PBE_TITLE_KEYWORD_CODEX_BIN;
  process.env.PBE_TITLE_KEYWORD_CODEX_BIN = fakeCodex;
  try {
    const payload = invokeCodexProposalModel({
      modelInfo: { model: "codex-gpt-5.4-mini" },
      prompt: "Owner reject comment: use the hints in the keywords to provide a decent title",
    });
    assert.equal(payload.title, "Leaning Tower of Pisa");
    assert.equal(payload.keywords.length, 10);
  } finally {
    if (previous == null) delete process.env.PBE_TITLE_KEYWORD_CODEX_BIN;
    else process.env.PBE_TITLE_KEYWORD_CODEX_BIN = previous;
  }
});
