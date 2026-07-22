import assert from "node:assert/strict";
import test from "node:test";

import { waitForCloudRenderCompletion } from "./cloud-render-browser.mjs";

const pageWithStatuses = (statuses, onWait = () => {}) => ({
  evaluate: async () => statuses.shift() || { status: "processing", detail: "" },
  waitForTimeout: async (delayMs) => onWait(delayMs),
});

test("cloud render completion polls until the page reports ready", async () => {
  let clock = 0;
  const waits = [];
  const page = pageWithStatuses([
    { status: "processing", detail: "Rendering video" },
    { status: "processing", detail: "Finalizing video" },
    { status: "ready", detail: "Video ready" },
  ], (delayMs) => {
    waits.push(delayMs);
    clock += delayMs;
  });

  const result = await waitForCloudRenderCompletion(page, {
    timeoutMs: 60_000,
    pollIntervalMs: 5_000,
    now: () => clock,
  });

  assert.deepEqual(result, { status: "ready", detail: "Video ready" });
  assert.deepEqual(waits, [5_000, 5_000]);
});

test("cloud render completion returns a page-reported failure", async () => {
  const page = pageWithStatuses([{ status: "failed", detail: "Recorder failed" }]);
  const result = await waitForCloudRenderCompletion(page);
  assert.deepEqual(result, { status: "failed", detail: "Recorder failed" });
});

test("cloud render completion reports a closed render page clearly", async () => {
  const page = {
    evaluate: async () => {
      throw new Error("Target page, context or browser has been closed");
    },
    waitForTimeout: async () => {},
  };

  await assert.rejects(
    waitForCloudRenderCompletion(page),
    /Cloud render page closed before completion: Target page, context or browser has been closed/,
  );
});

test("cloud render completion enforces its overall timeout", async () => {
  let clock = 0;
  const page = pageWithStatuses([], (delayMs) => {
    clock += delayMs;
  });

  await assert.rejects(
    waitForCloudRenderCompletion(page, {
      timeoutMs: 12_000,
      pollIntervalMs: 5_000,
      now: () => clock,
    }),
    /timed out after 12 seconds/,
  );
});
