import { launch } from "@cloudflare/playwright";
import { WorkerEntrypoint, WorkflowEntrypoint } from "cloudflare:workers";
import { waitForCloudRenderCompletion } from "./cloud-render-browser.mjs";
import { createKvStore } from "./kv-store.mjs";
import { createStripeClient } from "./stripe-client.mjs";
import { buildWstCommerceSnapshot } from "./wst-commerce-snapshot.mjs";
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
        url.searchParams.set("v", "141.0");
        url.hash = new URLSearchParams({
          cloudRenderJob: jobId,
          cloudRenderToken: access.renderToken,
        }).toString();
        const browser = await launch(this.env.BROWSER, { keep_alive: 10 * 60 * 1000 });
        try {
          const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const page = await context.newPage();
          await page.goto(url.href, { waitUntil: "networkidle", timeout: 60_000 });
          const result = await waitForCloudRenderCompletion(page);
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

export default class PhotosByElieWorker extends WorkerEntrypoint {
  fetch(request) {
    return worker.fetch(request, this.env);
  }

  wstCommerceSnapshot() {
    if (!this.env.STRIPE_SECRET_KEY || !this.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("Live Stripe is unavailable for the WST commerce snapshot.");
    }
    const store = createKvStore({
      namespace: this.env.ORDERS_KV,
      prefix: this.env.KV_PREFIX || "pbe",
    });
    const stripe = createStripeClient({
      secretKey: this.env.STRIPE_SECRET_KEY,
      webhookSecret: this.env.STRIPE_WEBHOOK_SECRET,
      apiVersion: this.env.STRIPE_API_VERSION,
    });
    return buildWstCommerceSnapshot({ store, stripe });
  }
}
