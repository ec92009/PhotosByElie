import { launch } from "@cloudflare/playwright";
import { WorkflowEntrypoint } from "cloudflare:workers";
import worker, {
  realEstateClientContextFor,
  realEstateDeliverablesFor,
  realEstateGalleriesFor,
} from "./deployed-worker.mjs";

export class RealEstateRenderWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const galleryKey = String(event.payload?.galleryKey || "").trim();
    const jobId = String(event.payload?.jobId || "").trim();
    if (!galleryKey || !jobId) throw new Error("Cloud render workflow requires galleryKey and jobId.");
    const deliverables = realEstateDeliverablesFor(this.env);
    const access = await step.do("prepare private render access", {
      timeout: "1 minute",
      retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
      sensitive: "output",
    }, async () => deliverables.beginCloudAssemblyRender({ galleryKey, jobId }));

    try {
      await step.do("render PDF and video in cloud browser", {
        timeout: "20 minutes",
        retries: { limit: 1, delay: "5 seconds", backoff: "constant" },
      }, async () => {
        const galleries = realEstateGalleriesFor(this.env);
        const gallery = galleries.find((candidate) => candidate.key === galleryKey) || { key: galleryKey };
        const url = new URL("/real-estate.html", String(this.env.PUBLIC_SITE_URL || "https://photos-by-elie.com"));
        url.searchParams.set("client", realEstateClientContextFor(gallery));
        url.searchParams.set("v", "140.25");
        url.hash = new URLSearchParams({
          cloudRenderJob: jobId,
          cloudRenderToken: access.renderToken,
        }).toString();
        const browser = await launch(this.env.BROWSER);
        try {
          const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const page = await context.newPage();
          await page.goto(url.href, { waitUntil: "networkidle", timeout: 60_000 });
          await page.waitForFunction(() => ["ready", "failed"].includes(document.documentElement.dataset.cloudRenderStatus || ""), null, { timeout: 18 * 60 * 1000 });
          const result = await page.evaluate(() => ({
            status: document.documentElement.dataset.cloudRenderStatus || "",
            detail: document.documentElement.dataset.cloudRenderDetail || "",
          }));
          if (result.status !== "ready") throw new Error(result.detail || "Cloud browser render failed.");
          return { status: result.status, detail: result.detail };
        } finally {
          await browser.close();
        }
      });
    } catch (error) {
      await step.do("record cloud render failure", { timeout: "1 minute", retries: { limit: 1, delay: "2 seconds" } }, async () => {
        const current = await deliverables.getCloudAssemblyRenderJob({ galleryKey, jobId, renderToken: access.renderToken });
        await Promise.all((current.job?.deliverables || [])
          .filter((record) => String(record.status || "").toLowerCase() !== "ready")
          .map((record) => deliverables.failCloudAssemblyRenderOutput({
            galleryKey,
            jobId,
            id: record.id,
            renderToken: access.renderToken,
            failureReason: error?.message || "Cloud browser render failed.",
          })));
        return { failed: true };
      });
      throw error;
    }
    return { galleryKey, jobId, status: "ready" };
  }
}

export default worker;
