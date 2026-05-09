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
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;

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
  pending_payment: t("order.waiting_payment"),
  preparing: t("order.building_zip"),
  delivery_failed: t("order.delivery_blocked"),
  ready: t("order.ready_download"),
};

const phaseCopy = (order) => {
  const deliveryError = order.deliveryError?.message || "";
  if (order.status === "ready") {
    return {
      step: t("order.phase_3"),
      heading: t("order.ready_download"),
      message: t("order.ready_message"),
      current: "ready",
    };
  }
  if (order.status === "delivery_failed") {
    return {
      step: t("order.blocked_phase_2"),
      heading: t("order.delivery_attention"),
      message: deliveryError || t("order.delivery_failed"),
      current: "preparing",
      failed: true,
    };
  }
  if (order.status === "preparing") {
    return {
      step: t("order.phase_2"),
      heading: t("order.building_zip"),
      message: t("order.building_message"),
      current: "preparing",
    };
  }
  return {
    step: t("order.payment_not_confirmed"),
    heading: t("order.payment_not_confirmed"),
    message: t("order.payment_message"),
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
    <div><dt>${t("basket.order_id")}</dt><dd>${escapeText(order.id)}</dd></div>
    <div><dt>${t("order.status")}</dt><dd>${escapeText(order.status)}</dd></div>
    <div><dt>${t("order.email")}</dt><dd>${escapeText(order.buyerEmail)}</dd></div>
    <div><dt>${t("order.total")}</dt><dd>${moneyFromCents(order.amountExpected, order.currency)}</dd></div>
    <div><dt>${t("order.paid")}</dt><dd>${moneyFromCents(order.amountPaid, order.currency)}</dd></div>
    <div><dt>${t("order.mode")}</dt><dd>${escapeText(order.checkoutMode)}</dd></div>
    ${order.deliveryError?.message ? `<div class="order-local-path"><dt>${t("order.delivery_note")}</dt><dd>${escapeText(order.deliveryError.message)}</dd></div>` : ""}
    ${order.delivery?.zipKey ? `<div class="order-local-path"><dt>${isLocalWorker() ? t("order.local_zip") : t("order.delivery_zip")}</dt><dd>${escapeText(order.delivery.zipKey)}</dd></div>` : ""}
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
    heading.textContent = t("order.details_needed");
    message.textContent = t("order.details_message");
    setProgress("");
    return;
  }

  status.textContent = t("order.refreshing");
  try {
    const response = await fetch(`${workerBaseUrl()}/orders/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `Order lookup failed with HTTP ${response.status}.`);
    renderOrder(body.order);
    status.textContent = t("order.refreshed");
  } catch (error) {
    const cachedOrder = checkoutState().lastResponse?.order;
    if (cachedOrder?.id === id) {
      renderOrder(cachedOrder);
      status.textContent = t("order.cached");
      return;
    }
    heading.textContent = t("order.unavailable");
    message.textContent = error.message;
    setProgress("");
    downloadZip.hidden = true;
    status.textContent = t("order.could_not_load");
  }
};

refreshButton?.addEventListener("click", loadOrder);
downloadZip?.addEventListener("click", () => {
  status.textContent = isLocalWorker()
    ? t("order.download_requested_local")
    : t("order.download_requested_worker");
});
copyZipPath?.addEventListener("click", async () => {
  if (!currentZipPath) return;
  try {
    await navigator.clipboard.writeText(currentZipPath);
    status.textContent = t("order.local_path_copied");
  } catch {
    status.textContent = currentZipPath;
  }
});
loadOrder();
window.addEventListener("photosbyelie:languagechange", loadOrder);
