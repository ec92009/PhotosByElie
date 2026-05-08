window.photosByElieMediaConfig = {
  // Public R2 previews served through the checkout Worker until an R2 custom domain is attached.
  publicBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev/media",
  publicMediaHostnames: ["ec92009.github.io"],
  // Public mock checkout Worker. Use ?workerBase=http://localhost:8787 for local Worker testing.
  checkoutWorkerBaseUrl: "https://photosbyelie-checkout-mock.ec92009.workers.dev",
};
