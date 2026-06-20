window.photosByElieMediaConfig = {
  // Public R2 previews served through the custom Worker media route.
  publicBaseUrl: "https://download.photos-by-elie.com/media",
  publicMediaHostnames: ["ec92009.github.io", "photos-by-elie.com", "www.photos-by-elie.com"],
  // Checkout Worker. Use ?workerBase=http://localhost:8787 for local Worker testing.
  checkoutWorkerBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev",
  // Google-backed auth/session checks use the same Worker unless overridden.
  authWorkerBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev",
  // First-party commerce analytics post to the same Worker unless overridden.
  analyticsWorkerBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev",
};
