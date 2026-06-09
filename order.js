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
const zipCopyField = document.querySelector("[data-zip-copy-field]");
const zipLocation = document.querySelector("[data-zip-location]");
const refreshButton = document.querySelector("[data-order-refresh]");
const embeddedWarning = document.querySelector("[data-embedded-browser-warning]");
const openBrowserLink = document.querySelector("[data-open-browser-link]");
const copyBrowserLink = document.querySelector("[data-copy-browser-link]");
const orderLookup = document.querySelector("[data-order-lookup]");
const orderLookupId = document.querySelector("[data-order-lookup-id]");
const orderLookupEmail = document.querySelector("[data-order-lookup-email]");
const orderSupportLinks = document.querySelectorAll("[data-order-support-link]");
let currentZipPath = "";
let currentDownloadHref = "";
let refreshTimer = null;
let currentDeliveryFiles = [];
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

const normalizedWorkerBase = (value) => String(value || "").replace(/\/+$/, "");
const isLocalPage = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const isUnsafePublicWorkerBase = (value) => {
  if (!value || isLocalPage()) return false;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol !== "https:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  } catch {
    return true;
  }
};

const workerBaseUrl = () => {
  const fromQuery = normalizedWorkerBase(params.get("workerBase"));
  if (fromQuery) {
    if (isUnsafePublicWorkerBase(fromQuery)) {
      localStorage.removeItem(workerBaseKey);
    } else {
      localStorage.setItem(workerBaseKey, fromQuery);
      return fromQuery;
    }
  }
  const configured = normalizedWorkerBase(window.photosByElieMediaConfig?.checkoutWorkerBaseUrl || "");
  if (!isLocalPage()) {
    localStorage.removeItem(workerBaseKey);
    return configured || "http://localhost:8787";
  }
  const stored = normalizedWorkerBase(localStorage.getItem(workerBaseKey));
  if (stored && !isUnsafePublicWorkerBase(stored)) return stored;
  if (stored) localStorage.removeItem(workerBaseKey);
  return configured || "http://localhost:8787";
};

const currentParams = () => new URLSearchParams(window.location.search);
const orderId = () => currentParams().get("id") || checkoutState().orderId || "";
const buyerEmail = () => currentParams().get("email") || checkoutState().email || "";
const checkoutSessionId = () => currentParams().get("session_id") || checkoutState().checkoutSessionId || "";
const supportHrefFor = (order = {}) => {
  const url = new URL("./support.html", window.location.href);
  const id = order.id || orderId();
  const email = order.buyerEmail || buyerEmail();
  const sessionId = order.checkoutSessionId || checkoutSessionId();
  if (id) url.searchParams.set("id", id);
  if (email) url.searchParams.set("email", email);
  if (sessionId) url.searchParams.set("session_id", sessionId);
  return url.href;
};
const syncOrderSupportLinks = (order = {}) => {
  orderSupportLinks.forEach((link) => link.setAttribute("href", supportHrefFor(order)));
};
const moneyFromCents = (value, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(Number(value || 0) / 100);

const bytesLabel = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
};

const dateTimeLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const isLocalWorker = () => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(workerBaseUrl());

const downloadHrefFor = (order) => {
  if (!order.delivery?.downloadUrl) return "";
  return isLocalWorker()
    ? `${workerBaseUrl()}/download-order/${encodeURIComponent(order.id)}`
    : `${workerBaseUrl()}${order.delivery.downloadUrl}`;
};

const deliveryFileHref = (file) => file?.downloadUrl ? `${workerBaseUrl()}${file.downloadUrl}` : "";

const deliveryRowsFor = (order) => {
  const readyFiles = order.delivery?.files || [];
  const readyByKey = new Map(readyFiles.map((file) => [`${file.photoId}::${file.productId}`, file]));
  const rows = [];
  for (const item of order.items || []) {
    for (const product of item.products || []) {
      const readyFile = readyByKey.get(`${item.photoId}::${product.id}`);
      rows.push({
        photoId: item.photoId,
        title: item.title,
        collection: item.collection,
        productId: product.id,
        productLabel: product.label,
        amount: product.amount,
        name: readyFile?.name || `${item.photoId}-${product.id}`,
        downloadUrl: readyFile?.downloadUrl || "",
        bytes: readyFile?.bytes || 0,
        contentType: readyFile?.contentType || "application/octet-stream",
        expiresAt: readyFile?.expiresAt || "",
        downloadLimit: readyFile?.downloadLimit || null,
        ready: Boolean(readyFile?.downloadUrl),
      });
    }
  }
  return rows;
};

const syncZipLocationField = () => {
  if (!zipCopyField || !zipLocation) return;
  const lines = [
    currentZipPath,
    currentDownloadHref ? `Download URL: ${currentDownloadHref}` : "",
  ].filter(Boolean);
  zipCopyField.hidden = lines.length === 0;
  zipLocation.value = lines.join("\n");
};

const selectZipLocation = () => {
  if (!zipLocation || zipLocation.hidden) return;
  zipLocation.focus();
  zipLocation.select();
};

const copyText = async (value) => {
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the selectable-field copy path below.
    }
  }
  selectZipLocation();
  try {
    return document.execCommand?.("copy") || false;
  } catch {
    return false;
  }
};

const isEmbeddedBrowser = () => Boolean(window.photosByElieEmbeddedBrowser?.detected);

const syncEmbeddedBrowserWarning = () => {
  const embedded = window.photosByElieEmbeddedBrowser;
  if (!embeddedWarning || !embedded?.detected) return;
  embeddedWarning.hidden = false;
  if (openBrowserLink) openBrowserLink.href = embedded.externalUrl;
};

const syncOrderLookup = (visible) => {
  if (!orderLookup) return;
  orderLookup.hidden = !visible;
  if (!visible) return;
  if (orderLookupId && !orderLookupId.value) orderLookupId.value = orderId();
  if (orderLookupEmail && !orderLookupEmail.value) orderLookupEmail.value = buyerEmail();
};

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
    const isProcessing = state === "pending_payment" || state === "preparing";
    step.classList.toggle("is-active", stepState === activeState);
    step.classList.toggle("is-processing", isProcessing && stepState === activeState);
    step.classList.toggle("is-failed", isFailed && stepState === "preparing");
    step.classList.toggle("is-complete", state === "ready" || ((state === "preparing" || isFailed) && stepState === "pending_payment"));
  });
};

const scheduleOrderRefresh = (order) => {
  window.clearTimeout(refreshTimer);
  refreshTimer = null;
  if (!["pending_payment", "preparing"].includes(order?.status)) return;
  refreshTimer = window.setTimeout(loadOrder, order.status === "preparing" ? 5000 : 2500);
};

const renderOrder = (order) => {
  syncEmbeddedBrowserWarning();
  syncOrderSupportLinks(order);
  syncOrderLookup(false);
  currentDeliveryFiles = deliveryRowsFor(order);
  const copy = phaseCopy(order);
  heading.textContent = copy.heading || statusText[order.status] || order.status;
  if (phase) {
    phase.textContent = copy.step;
    phase.classList.toggle("is-failed", Boolean(copy.failed));
    phase.classList.toggle("is-processing", ["pending_payment", "preparing"].includes(order.status));
  }
  message.textContent = copy.message;
  setProgress(order.status);

  details.innerHTML = `
    <div><dt>${t("basket.order_id")}</dt><dd>${escapeText(order.id)}</dd></div>
    <div><dt>${t("order.status")}</dt><dd>${escapeText(order.status)}</dd></div>
    <div><dt>${t("order.email")}</dt><dd>${escapeText(order.buyerEmail)}</dd></div>
    ${order.minimumChargeAdjustment ? `<div><dt>${t("basket.draft_total")}</dt><dd>${moneyFromCents(order.subtotalAmount, order.currency)}</dd></div>` : ""}
    ${order.minimumChargeAdjustment ? `<div><dt>${t("basket.minimum_adjustment")}</dt><dd>+${moneyFromCents(order.minimumChargeAdjustment, order.currency)}</dd></div>` : ""}
    <div><dt>${t("order.total")}</dt><dd>${moneyFromCents(order.amountExpected, order.currency)}</dd></div>
    <div><dt>${t("order.paid")}</dt><dd>${moneyFromCents(order.amountPaid, order.currency)}</dd></div>
    <div><dt>${t("order.mode")}</dt><dd>${escapeText(order.checkoutMode)}</dd></div>
    ${order.deliveryError?.message ? `<div class="order-local-path"><dt>${t("order.delivery_note")}</dt><dd>${escapeText(order.deliveryError.message)}</dd></div>` : ""}
    ${order.delivery?.zipKey ? `<div class="order-local-path"><dt>${isLocalWorker() ? t("order.local_zip") : t("order.delivery_zip")}</dt><dd>${escapeText(order.delivery.zipKey)}</dd></div>` : ""}
  `;

  const hasActualDeliveryFiles = Boolean(order.delivery?.files?.length);
  const showDeliveryStack = currentDeliveryFiles.length && (
    order.status === "preparing" ||
    order.status === "delivery_failed" ||
    hasActualDeliveryFiles
  );
  const readyFileCount = currentDeliveryFiles.filter((file) => file.ready).length;
  const showEmailNotice = order.status === "ready";
  const deliveryEmailWasSent = order.deliveryEmail?.status === "sent";
  const deliveryEmailNotice = showEmailNotice ? `
    <aside class="order-email-notice is-attention" aria-label="${escapeText(t("order.email_notice_title"))}">
      <div>
        <p class="eyebrow">${escapeText(deliveryEmailWasSent ? t("order.email_notice_title") : t("order.email_notice_fallback_title"))}</p>
        <strong>${escapeText(order.buyerEmail || "")}</strong>
      </div>
      <p>${escapeText(deliveryEmailWasSent ? t("order.email_notice_body") : t("order.email_notice_fallback_body"))}</p>
    </aside>
  ` : "";
  const deliveryFilesMarkup = showDeliveryStack ? `
    <section class="order-file-downloads" aria-label="${escapeText(t("order.delivery_files"))}">
      <div class="order-file-downloads-header">
        <div>
          <p class="eyebrow">${escapeText(t("order.delivery_files"))}</p>
          <h3>${escapeText(order.status === "ready" ? t("order.files_ready") : t("order.files_preparing"))}</h3>
          <p>${escapeText(t("order.files_ready_count", { ready: readyFileCount, total: currentDeliveryFiles.length }))}</p>
        </div>
        <button class="btn primary" type="button" data-download-all-files${readyFileCount && !isEmbeddedBrowser() ? "" : " disabled"}>${escapeText(isEmbeddedBrowser() ? t("order.open_browser_to_download") : t("order.download_all_files"))}</button>
      </div>
      ${isEmbeddedBrowser() ? `<p class="embedded-download-note">${escapeText(t("browser_warning.download"))}</p>` : ""}
      <ol>
        ${currentDeliveryFiles.map((file, index) => `
          <li class="${file.ready ? "is-ready" : "is-pending"}" data-file-row="${index}">
            <div>
              <strong>${escapeText(file.name)}</strong>
              <small>${escapeText(file.collection || "")}${file.collection ? " · " : ""}${escapeText(file.title || file.photoId || "")}</small>
              <small>${escapeText(file.productLabel || file.productId || "")}${file.bytes ? ` · ${escapeText(bytesLabel(file.bytes))}` : ""}</small>
              ${file.expiresAt ? `<small>${escapeText(t("order.download_available_until", { date: dateTimeLabel(file.expiresAt) }))}</small>` : ""}
              <progress value="0" max="100" data-file-progress="${index}"></progress>
            </div>
            <output data-file-status="${index}">${escapeText(file.ready ? t("order.file_ready") : (order.status === "delivery_failed" ? t("order.file_needs_attention") : t("order.file_preparing")))}</output>
            <button class="btn secondary" type="button" data-download-file="${index}"${file.ready ? "" : " disabled"}>${escapeText(t("order.download_file"))}</button>
          </li>
        `).join("")}
      </ol>
    </section>
  ` : "";

  const orderLinesMarkup = (order.items || []).map((item) => `
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
  itemsRoot.innerHTML = `${deliveryEmailNotice}${showDeliveryStack ? deliveryFilesMarkup : orderLinesMarkup}`;

  if (order.delivery?.downloadUrl && !hasActualDeliveryFiles) {
    currentZipPath = order.delivery.zipKey || "";
    currentDownloadHref = downloadHrefFor(order);
    downloadZip.hidden = false;
    downloadZip.href = currentDownloadHref;
    downloadZip.setAttribute("download", "");
    if (copyZipPath) copyZipPath.hidden = !currentZipPath || !isLocalWorker();
  } else {
    currentZipPath = "";
    currentDownloadHref = "";
    downloadZip.hidden = true;
    downloadZip.removeAttribute("href");
    if (copyZipPath) copyZipPath.hidden = true;
  }
  syncZipLocationField();
  scheduleOrderRefresh(order);
};

const triggerBlobDownload = (blob, filename) => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename || "photosbyelie-delivery-file";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const setFileProgress = (index, percent, text) => {
  const progress = itemsRoot.querySelector(`[data-file-progress="${index}"]`);
  const output = itemsRoot.querySelector(`[data-file-status="${index}"]`);
  if (progress) progress.value = Math.max(0, Math.min(100, percent));
  if (output) output.textContent = text;
};

const downloadDeliveryFile = async (file, index) => {
  const button = itemsRoot.querySelector(`[data-download-file="${index}"]`);
  const href = deliveryFileHref(file);
  if (!href) return;
  button?.setAttribute("disabled", "");
  setFileProgress(index, 2, t("order.file_downloading"));
  try {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || Number(file.bytes || 0);
    if (!response.body?.getReader) {
      const blob = await response.blob();
      triggerBlobDownload(blob, file.name);
      setFileProgress(index, 100, t("order.file_downloaded"));
      return;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const percent = total ? Math.round((received / total) * 100) : 50;
      setFileProgress(index, percent, total ? `${bytesLabel(received)} / ${bytesLabel(total)}` : bytesLabel(received));
    }
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || file.contentType || "application/octet-stream" });
    triggerBlobDownload(blob, file.name);
    setFileProgress(index, 100, t("order.file_downloaded"));
  } catch (error) {
    setFileProgress(index, 0, `${t("order.file_failed")} ${error.message}`);
  } finally {
    button?.removeAttribute("disabled");
  }
};

const loadOrder = async () => {
  window.clearTimeout(refreshTimer);
  refreshTimer = null;
  const id = orderId();
  const email = buyerEmail();
  const sessionId = checkoutSessionId();
  syncOrderSupportLinks();
  if (sessionId) {
    status.textContent = t("order.refreshing");
    try {
      const response = await fetch(`${workerBaseUrl()}/orders/by-session/${encodeURIComponent(sessionId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || `Order lookup failed with HTTP ${response.status}.`);
      renderOrder(body.order);
      status.textContent = t("order.refreshed");
      return;
    } catch (error) {
      syncOrderLookup(true);
      heading.textContent = t("order.unavailable");
      message.textContent = error.message;
      setProgress("");
      currentZipPath = "";
      currentDownloadHref = "";
      downloadZip.hidden = true;
      syncZipLocationField();
      status.textContent = t("order.could_not_load");
      return;
    }
  }
  if (!id || !email) {
    syncOrderLookup(true);
    heading.textContent = t("order.details_needed");
    message.textContent = t("order.details_message");
    setProgress("");
    currentZipPath = "";
    currentDownloadHref = "";
    syncZipLocationField();
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
    syncOrderLookup(true);
    heading.textContent = t("order.unavailable");
    message.textContent = error.message;
    setProgress("");
    currentZipPath = "";
    currentDownloadHref = "";
    downloadZip.hidden = true;
    syncZipLocationField();
    status.textContent = t("order.could_not_load");
  }
};

refreshButton?.addEventListener("click", loadOrder);
orderLookup?.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = String(orderLookupId?.value || "").trim();
  const email = String(orderLookupEmail?.value || "").trim();
  if (!id || !email) {
    status.textContent = t("order.lookup_required");
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("id", id);
  url.searchParams.set("email", email);
  url.searchParams.delete("session_id");
  window.location.href = url.href;
});
copyBrowserLink?.addEventListener("click", async () => {
  const embedded = window.photosByElieEmbeddedBrowser;
  const copied = await embedded?.copyText?.(embedded.externalUrl);
  status.textContent = copied ? t("browser_warning.copied") : t("browser_warning.copy_failed");
});
itemsRoot?.addEventListener("click", async (event) => {
  const fileButton = event.target.closest("[data-download-file]");
  if (fileButton) {
    const index = Number(fileButton.dataset.downloadFile);
    const file = currentDeliveryFiles[index];
    if (file) await downloadDeliveryFile(file, index);
    return;
  }
  const allButton = event.target.closest("[data-download-all-files]");
  if (allButton) {
    allButton.setAttribute("disabled", "");
    for (let index = 0; index < currentDeliveryFiles.length; index += 1) {
      if (!currentDeliveryFiles[index]?.ready) continue;
      await downloadDeliveryFile(currentDeliveryFiles[index], index);
    }
    allButton.removeAttribute("disabled");
  }
});
downloadZip?.addEventListener("click", () => {
  status.textContent = isLocalWorker()
    ? t("order.download_requested_local")
    : t("order.download_requested_worker");
});
copyZipPath?.addEventListener("click", async () => {
  if (!currentZipPath) return;
  selectZipLocation();
  const copied = await copyText(currentZipPath);
  status.textContent = copied
    ? t("order.local_path_copied")
    : t("order.copy_failed_select");
});
syncEmbeddedBrowserWarning();
loadOrder();
window.addEventListener("photosbyelie:languagechange", loadOrder);
