const workerBaseKey = "photosbyelie-worker-base";
const checkoutStateKey = "photosbyelie-mock-checkout";
const params = new URLSearchParams(window.location.search);

const heading = document.querySelector("[data-order-heading]");
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
  return (localStorage.getItem(workerBaseKey) || "http://localhost:8787").replace(/\/+$/, "");
};

const orderId = () => params.get("id") || checkoutState().orderId || "";
const buyerEmail = () => params.get("email") || checkoutState().email || "";
const moneyFromCents = (value, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(Number(value || 0) / 100);

const statusText = {
  pending_payment: "Waiting for payment",
  preparing: "Preparing delivery",
  ready: "Ready to download",
};

const setProgress = (state) => {
  document.querySelectorAll("[data-state-step]").forEach((step) => {
    const stepState = step.dataset.stateStep;
    step.classList.toggle("is-active", stepState === state);
    step.classList.toggle("is-complete", state === "ready" || (state === "preparing" && stepState === "pending_payment"));
  });
};

const renderOrder = (order) => {
  const label = statusText[order.status] || order.status;
  heading.textContent = label;
  message.textContent = order.status === "ready"
    ? "Your mock delivery ZIP is ready."
    : "The order exists, but the mock delivery is not ready yet.";
  setProgress(order.status);

  details.innerHTML = `
    <div><dt>Order ID</dt><dd>${escapeText(order.id)}</dd></div>
    <div><dt>Status</dt><dd>${escapeText(order.status)}</dd></div>
    <div><dt>Email</dt><dd>${escapeText(order.buyerEmail)}</dd></div>
    <div><dt>Total</dt><dd>${moneyFromCents(order.amountExpected, order.currency)}</dd></div>
    <div><dt>Paid</dt><dd>${moneyFromCents(order.amountPaid, order.currency)}</dd></div>
    <div><dt>Mode</dt><dd>${escapeText(order.checkoutMode)}</dd></div>
    ${order.delivery?.zipKey ? `<div class="order-local-path"><dt>Local ZIP</dt><dd>${escapeText(order.delivery.zipKey)}</dd></div>` : ""}
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
    downloadZip.href = `${workerBaseUrl()}/download-order/${encodeURIComponent(order.id)}`;
    downloadZip.setAttribute("download", "");
    if (copyZipPath) copyZipPath.hidden = !currentZipPath;
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
    message.textContent = "Open this page from the mock checkout flow so the order number and buyer email are available.";
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
  status.textContent = "Download requested. If the in-app browser does not show a download, use the Local ZIP path below.";
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
