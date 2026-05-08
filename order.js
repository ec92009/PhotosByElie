const workerBaseKey = "photosbyelie-worker-base";
const checkoutStateKey = "photosbyelie-mock-checkout";
const params = new URLSearchParams(window.location.search);

const heading = document.querySelector("[data-order-heading]");
const phase = document.querySelector("[data-order-phase]");
const message = document.querySelector("[data-order-message]");
const details = document.querySelector("[data-order-details]");
const itemsRoot = document.querySelector("[data-order-items]");
const status = document.querySelector("[data-order-status]");
const downloadZip = document.querySelector("[data-download-zip]");
const copyZipPath = document.querySelector("[data-copy-zip-path]");
const refreshButton = document.querySelector("[data-order-refresh]");
let currentZipPath = "";

const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const checkoutState = () => {
  try {
    return JSON.parse(localStorage.getItem(checkoutStateKey) || "{}");
  } catch {
    return {};
  }
};

const workerBaseUrl = () => {
  const fromQuery = params.get("workerBase");
  if (fromQuery) {
    localStorage.setItem(workerBaseKey, fromQuery.replace(/\/+$/, ""));
    return fromQuery.replace(/\/+$/, "");
  }
  const configured = window.photosByElieMediaConfig?.checkoutWorkerBaseUrl || "";
  return (localStorage.getItem(workerBaseKey) || configured || "http://localhost:8787").replace(/\/+$/, "");
};

const orderId = () => params.get("id") || checkoutState().orderId || "";
const buyerEmail = () => params.get("email") || checkoutState().email || "";
const moneyFromCents = (value, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(Number(value || 0) / 100);

const isLocalWorker = () => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(workerBaseUrl());

const statusText = {
  pending_payment: "Waiting for payment",
  preparing: "Building delivery ZIP",
  delivery_failed: "Delivery blocked",
  ready: "Ready to download",
};

const phaseCopy = (order) => {
  const deliveryError = order.deliveryError?.message || "";
  if (order.status === "ready") {
    return {
      step: "Phase 3 of 3",
      heading: "Ready to download",
      message: "Payment is complete and the ZIP has been generated from private storage.",
      current: "ready",
    };
  }
  if (order.status === "delivery_failed") {
    return {
      step: "Blocked after Phase 2",
      heading: "Delivery needs attention",
      message: deliveryError || "Payment is complete, but the Worker could not generate the delivery ZIP.",
      current: "preparing",
      failed: true,
    };
  }
  if (order.status === "preparing") {
    return {
      step: "Phase 2 of 3",
      heading: "Building delivery ZIP",
      message: "Payment is complete. The Worker is reading private R2 masters and writing the ZIP.",
      current: "preparing",
    };
  }
  return {
    step: "Payment not confirmed",
    heading: "Payment not confirmed",
    message: "This page normally opens after checkout. If payment was just completed, refresh; otherwise return to checkout and finish payment before delivery starts.",
    current: "pending_payment",
  };
};

const setProgress = (state) => {
  document.querySelectorAll("[data-state-step]").forEach((step) => {
    const stepState = step.dataset.stateStep;
    const isFailed = state === "delivery_failed";
    const activeState = isFailed ? "preparing" : state;
    step.classList.toggle("is-active", stepState === activeState);
    step.classList.toggle("is-failed", isFailed && stepState === "preparing");
    step.classList.toggle("is-complete", state === "ready" || ((state === "preparing" || isFailed) && stepState === "pending_payment"));
  });
};

const renderOrder = (order) => {
  const copy = phaseCopy(order);
  heading.textContent = copy.heading || statusText[order.status] || order.status;
  if (phase) {
    phase.textContent = copy.step;
    phase.classList.toggle("is-failed", Boolean(copy.failed));
  }
  message.textContent = copy.message;
  setProgress(order.status);

  details.innerHTML = `
    <div><dt>Order ID</dt><dd>${escapeText(order.id)}</dd></div>
    <div><dt>Status</dt><dd>${escapeText(order.status)}</dd></div>
    <div><dt>Email</dt><dd>${escapeText(order.buyerEmail)}</dd></div>
    <div><dt>Total</dt><dd>${moneyFromCents(order.amountExpected, order.currency)}</dd></div>
    <div><dt>Paid</dt><dd>${moneyFromCents(order.amountPaid, order.currency)}</dd></div>
    <div><dt>Mode</dt><dd>${escapeText(order.checkoutMode)}</dd></div>
    ${order.deliveryError?.message ? `<div class="order-local-path"><dt>Delivery note</dt><dd>${escapeText(order.deliveryError.message)}</dd></div>` : ""}
    ${order.delivery?.zipKey ? `<div class="order-local-path"><dt>${isLocalWorker() ? "Local ZIP" : "Delivery ZIP"}</dt><dd>${escapeText(order.delivery.zipKey)}</dd></div>` : ""}
  `;

  itemsRoot.innerHTML = (order.items || []).map((item) => `
    <article class="order-line">
      <div>
        <p class="eyebrow">${escapeText(item.collection)}</p>
        <h3>${escapeText(item.title)}</h3>
        <p>${escapeText(item.photoId)}</p>
      </div>
      <ul>
        ${(item.products || []).map((product) => `<li>${escapeText(product.label)} · ${moneyFromCents(product.amount, order.currency)}</li>`).join("")}
      </ul>
    </article>
  `).join("");

  if (order.delivery?.downloadUrl) {
    currentZipPath = order.delivery.zipKey || "";
    downloadZip.hidden = false;
    downloadZip.href = isLocalWorker()
      ? `${workerBaseUrl()}/download-order/${encodeURIComponent(order.id)}`
      : `${workerBaseUrl()}${order.delivery.downloadUrl}`;
    downloadZip.setAttribute("download", "");
    if (copyZipPath) copyZipPath.hidden = !currentZipPath || !isLocalWorker();
  } else {
    currentZipPath = "";
    downloadZip.hidden = true;
    downloadZip.removeAttribute("href");
    if (copyZipPath) copyZipPath.hidden = true;
  }
};

const loadOrder = async () => {
  const id = orderId();
  const email = buyerEmail();
  if (!id || !email) {
    heading.textContent = "Order details needed";
    message.textContent = "Open this page from checkout so the order number and buyer email are available.";
    setProgress("");
    return;
  }

  status.textContent = "Refreshing order...";
  try {
    const response = await fetch(`${workerBaseUrl()}/orders/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `Order lookup failed with HTTP ${response.status}.`);
    renderOrder(body.order);
    status.textContent = "Order refreshed.";
  } catch (error) {
    const cachedOrder = checkoutState().lastResponse?.order;
    if (cachedOrder?.id === id) {
      renderOrder(cachedOrder);
      status.textContent = "Showing cached local order. Download uses the generated ZIP file on disk.";
      return;
    }
    heading.textContent = "Order unavailable";
    message.textContent = error.message;
    setProgress("");
    downloadZip.hidden = true;
    status.textContent = "Could not load order from the local Worker.";
  }
};

refreshButton?.addEventListener("click", loadOrder);
downloadZip?.addEventListener("click", () => {
  status.textContent = isLocalWorker()
    ? "Download requested. If the in-app browser does not show a download, use the Local ZIP path below."
    : "Download requested from the checkout Worker.";
});
copyZipPath?.addEventListener("click", async () => {
  if (!currentZipPath) return;
  try {
    await navigator.clipboard.writeText(currentZipPath);
    status.textContent = "Local ZIP path copied.";
  } catch {
    status.textContent = currentZipPath;
  }
});
loadOrder();
