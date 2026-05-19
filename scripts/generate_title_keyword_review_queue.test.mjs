import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  codexModelConfig,
  invokeCodexProposalModel,
  parseModelProposalText,
  selectedGeneratorForRow,
} from "./generate_title_keyword_review_queue.mjs";

test("rework rows with missing provenance start at the first AI ladder level", () => {
  const selected = selectedGeneratorForRow({
    reworkPriority: true,
    previousGeneratorModelLevel: null,
    previousGeneratorModelMaxed: false,
  });
  assert.equal(selected.model, "codex-gpt-5.4-mini");
  assert.equal(selected.model_level, 1);
  assert.equal(selected.model_maxed, false);
});

test("rework rows after local rules escalate to the next model", () => {
  const selected = selectedGeneratorForRow({
    reworkPriority: true,
    previousGeneratorModelLevel: 0,
    previousGeneratorModelMaxed: false,
  });
  assert.equal(selected.model, "codex-gpt-5.4-mini");
  assert.equal(selected.model_level, 1);
});

test("maxed rejected rows are marked exhausted instead of cycling the same model", () => {
  const selected = selectedGeneratorForRow({
    reworkPriority: true,
    previousGeneratorModelLevel: 4,
    previousGeneratorModelMaxed: true,
  });
  assert.equal(selected.model, "codex-gpt-5.5-xhigh-vision");
  assert.equal(selected.model_maxed, true);
  assert.equal(selected.exhausted, true);
});

test("Codex ladder aliases map to real Codex CLI model settings", () => {
  assert.deepEqual(codexModelConfig({ model: "codex-gpt-5.5-xhigh-vision" }), {
    model: "gpt-5.5",
    reasoningEffort: "xhigh",
    vision: true,
  });
  assert.deepEqual(codexModelConfig({ model: "codex-gpt-5.4-mini" }), {
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    vision: false,
  });
});

test("model proposal text parser accepts fenced JSON", () => {
  const parsed = parseModelProposalText("```json\n{\"title\":\"Pisa Tower\",\"keywords\":[\"Pisa\"]}\n```");
  assert.equal(parsed.title, "Pisa Tower");
  assert.deepEqual(parsed.keywords, ["Pisa"]);
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
