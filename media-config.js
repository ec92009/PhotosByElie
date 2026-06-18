window.photosByElieMediaConfig = {
  // Public R2 previews served directly from the public media bucket.
  publicBaseUrl: "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev",
  publicMediaHostnames: ["ec92009.github.io"],
  // Checkout Worker. Use ?workerBase=http://localhost:8787 for local Worker testing.
  checkoutWorkerBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev",
  // First-party commerce analytics post to the same Worker unless overridden.
  analyticsWorkerBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev",
};
