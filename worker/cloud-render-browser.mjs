const DEFAULT_RENDER_TIMEOUT_MS = 18 * 60 * 1000;
const DEFAULT_RENDER_POLL_INTERVAL_MS = 10 * 1000;

const readRenderStatus = async (page) => page.evaluate(() => ({
  status: document.documentElement.dataset.cloudRenderStatus || "",
  detail: document.documentElement.dataset.cloudRenderDetail || "",
}));

/**
 * Poll the render page instead of leaving one long-running protocol command idle.
 * Each poll keeps Cloudflare Browser Rendering active while the page records video.
 */
export const waitForCloudRenderCompletion = async (page, {
  timeoutMs = DEFAULT_RENDER_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_RENDER_POLL_INTERVAL_MS,
  now = Date.now,
} = {}) => {
  const startedAt = now();
  while (true) {
    let result;
    try {
      result = await readRenderStatus(page);
    } catch (error) {
      throw new Error(`Cloud render page closed before completion: ${error?.message || String(error)}`);
    }
    if (["ready", "failed"].includes(result.status)) return result;

    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= timeoutMs) {
      throw new Error(`Cloud browser render timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    const delayMs = Math.max(1, Math.min(pollIntervalMs, timeoutMs - elapsedMs));
    try {
      await page.waitForTimeout(delayMs);
    } catch (error) {
      throw new Error(`Cloud render page closed before completion: ${error?.message || String(error)}`);
    }
  }
};
