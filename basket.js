((async () => {
await window.photosByElieCatalogReady;
const formatMoney = (value) => {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
};
const CHECKOUT_MINIMUM_CENTS = 50;
const centsFor = (value) => Math.round((Number(value) || 0) * 100);
const dollarsForCents = (value) => Number(value || 0) / 100;
const checkoutMinimumAdjustment = (total) => {
  const subtotalCents = centsFor(total);
  return subtotalCents > 0 && subtotalCents < CHECKOUT_MINIMUM_CENTS
    ? dollarsForCents(CHECKOUT_MINIMUM_CENTS - subtotalCents)
    : 0;
};
const allCollections = window.photosByElieData || {};
window.photosByElieProductSettings?.applyPriceOverrides?.();
const resolutionOptions = window.photosByElieResolutions || [];
const basketStore = window.photosByElieBasket;

const photoForItem = (item) => {
  const entry = Object.values(allCollections).find((collection) =>
    collection.photos.some((photo) => photo.id === item.photoId)
  );
  const photo = entry?.photos.find((candidate) => candidate.id === item.photoId);
  return { collection: entry, photo };
};

const basketRoot = document.querySelector("[data-basket-root]");
const emptyState = document.querySelector("[data-empty-basket]");
const basketTotal = document.querySelector("[data-basket-total]");
const status = document.querySelector("[data-basket-status]");
const orderIntent = document.querySelector("[data-order-intent]");
const orderSummary = document.querySelector("[data-order-summary]");
const orderEmail = document.querySelector("[data-order-email]");
const orderEmailDraft = document.querySelector("[data-order-email-draft]");
const checkoutEmail = document.querySelector("[data-checkout-email]");
const discountCodeInput = document.querySelector("[data-discount-code]");
const checkoutGuest = document.querySelector("[data-checkout-guest]");
const mockPay = document.querySelector("[data-mock-pay]");
const checkoutResult = document.querySelector("[data-checkout-result]");
const embeddedWarning = document.querySelector("[data-embedded-browser-warning]");
const openBrowserLink = document.querySelector("[data-open-browser-link]");
const copyBrowserLink = document.querySelector("[data-copy-browser-link]");
const orderIdKey = "photosbyelie-order-id";
const checkoutStateKey = "photosbyelie-mock-checkout";
const workerBaseKey = "photosbyelie-worker-base";
const siteVersion = document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "71.13";
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
let checkoutHashScrollDone = false;
const pageSize = 24;
let visibleLimit = pageSize;
let moreButton = null;
let showAllButton = null;
let deliveryManifest = null;
let deliveryAvailabilityLoaded = false;
let deliveryAvailabilityPromise = null;
let discardedPhotoIds = new Set();

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
  const params = new URLSearchParams(window.location.search);
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

const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const ensureMoreButton = () => {
  if (moreButton || !basketRoot) return;
  const controls = document.createElement("div");
  controls.className = "gallery-pagination-controls";
  moreButton = document.createElement("button");
  moreButton.className = "btn secondary gallery-more-button";
  moreButton.type = "button";
  moreButton.dataset.basketMore = "";
  moreButton.dataset.i18n = "home.show_more";
  moreButton.textContent = t("home.show_more");
  moreButton.hidden = true;
  showAllButton = document.createElement("button");
  showAllButton.className = "btn secondary gallery-more-button";
  showAllButton.type = "button";
  showAllButton.dataset.basketShowAll = "";
  showAllButton.dataset.i18n = "home.show_all";
  showAllButton.textContent = t("home.show_all");
  showAllButton.hidden = true;
  controls.append(moreButton, showAllButton);
  basketRoot.after(controls);
  moreButton.addEventListener("click", () => {
    visibleLimit += pageSize;
    renderBasket();
  });
  showAllButton.addEventListener("click", () => {
    visibleLimit = basketStore.read().length;
    renderBasket();
  });
};

const productTypeLabel = (option) => ({
  digital: t("product.digital"),
  print: t("product.print"),
  frame: t("product.frame")
}[option?.type] || t("product.product"));

const productDetail = (photo, option) => {
  const detailKeyById = {
    "jpg-6mp": "product.jpg_6_detail",
    "jpg-3mp": "product.jpg_3_detail",
    "jpg-1mp": "product.jpg_1_detail",
  };
  if (detailKeyById[option?.id]) return t(detailKeyById[option.id]);
  if (option?.type === "print") return t("product.print_detail");
  const source = photo ? window.photosByElieOriginalSize?.(photo) || "" : "";
  if (source) return t("product.original", { source });
  return t("product.full_detail");
};
const productLabel = (option) => {
  if (option?.type === "print") return window.photosByElieProductLabel?.(option) || option?.label || t("product.print");
  const keyById = {
    full: "product.full",
    "jpg-6mp": "product.jpg_6",
    "jpg-3mp": "product.jpg_3",
    "jpg-1mp": "product.jpg_1",
  };
  return t(keyById[option?.id] || "", {}) || window.photosByElieProductLabel?.(option) || option.label;
};
const frameOptions = () => window.photosByElieFrameOptions || [];
const frameFor = (frameId) => frameOptions().find((frame) => frame.id === frameId) || frameOptions()[0] || { id: "none", label: "No frame", price: 0 };
const frameLabel = (frame) => ({
  none: t("product.no_frame"),
  white: t("product.white_frame"),
  black: t("product.black_frame"),
}[frame?.id] || frame?.label || "");
const framePriceFor = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;
const optionQuantity = (option) => window.photosByElieOptionQuantity?.(option) || 1;
const optionTotal = (option) => window.photosByElieOptionTotal?.(option) || Number(option.price) || 0;
const optionShippingHandlingTotal = (option) => window.photosByElieOptionShippingHandlingTotal?.(option) || 0;

const versionedFetchPath = (path) => window.photosByElieVersionedHref?.(path) || path;

const loadDeliveryAvailability = async () => {
  try {
    const [deliveryResponse, discardedResponse] = await Promise.all([
      fetch(versionedFetchPath("./assets/private-delivery-manifest.json"), { cache: "no-store" }),
      fetch(versionedFetchPath("./assets/discarded/discarded-photo-ids.json"), { cache: "no-store" }),
    ]);
    deliveryManifest = deliveryResponse.ok ? await deliveryResponse.json() : null;
    const discarded = discardedResponse.ok ? await discardedResponse.json() : {};
    discardedPhotoIds = new Set([
      ...(Array.isArray(discarded.photo_ids) ? discarded.photo_ids : []),
      ...(Array.isArray(discarded.discardedPhotoIds) ? discarded.discardedPhotoIds : []),
      ...(Array.isArray(discarded.photos) ? discarded.photos.map((photo) => photo?.id) : []),
    ].filter(Boolean).map(String));
  } catch {
    deliveryManifest = null;
    discardedPhotoIds = new Set();
  } finally {
    deliveryAvailabilityLoaded = true;
    renderBasket();
  }
};

const ensureDeliveryAvailabilityLoaded = async () => {
  if (deliveryAvailabilityLoaded) return;
  if (!deliveryAvailabilityPromise) deliveryAvailabilityPromise = loadDeliveryAvailability();
  await deliveryAvailabilityPromise;
};

const deliveryRecordFor = (photoId) => deliveryManifest?.records?.[photoId] || null;

const deliveryAvailabilityFor = (photoId, option) => {
  if (!option || option.type === "print") return { available: true, reason: "" };
  if (discardedPhotoIds.has(String(photoId))) {
    return { available: false, reason: "This photo is in the Waste Basket tombstones and is not for sale." };
  }
  if (!deliveryAvailabilityLoaded || !deliveryManifest) return { available: true, reason: "" };
  const record = deliveryRecordFor(photoId);
  if (!record) return { available: false, reason: "Private delivery coverage is not recorded for this photo." };
  if (option.id === "full") {
    return record.privateMaster?.present === true
      ? { available: true, reason: "" }
      : { available: false, reason: "Full resolution master is missing from private storage." };
  }
  if (option.id === "jpg-6mp" || option.id === "jpg-3mp" || option.id === "jpg-1mp") {
    return record.privateRenders?.[option.id]?.present === true || record.privateMaster?.present === true
      ? { available: true, reason: "" }
      : { available: false, reason: `${productLabel(option)} needs a private master or cached delivery file.` };
  }
  return { available: true, reason: "" };
};

const availableSelectedOptionIds = (item) => new Set((item.options || [])
  .filter((option) => deliveryAvailabilityFor(item.photoId, option).available)
  .map((option) => option.id));

const pruneUnavailableBasketSelections = (items) => {
  if (!deliveryAvailabilityLoaded) return items;
  let changed = false;
  const nextItems = items.map((item, index) => {
    const nextOptions = (item.options || []).filter((option) => deliveryAvailabilityFor(item.photoId, option).available);
    if (nextOptions.length !== (item.options || []).length) {
      changed = true;
      basketStore.updateOptions(index, nextOptions.map((option) => ({ id: option.id, quantity: option.quantity, frameId: option.frame?.id || option.frameId })));
      return { ...item, options: nextOptions };
    }
    return item;
  });
  if (changed) {
    clearCheckoutState();
    status.textContent = "Unavailable delivery choices were removed from the basket.";
    return basketStore.write(basketStore.read());
  }
  return nextItems;
};

const removeMissingDeliverySelections = (missing = []) => {
  const missingByPhoto = new Map();
  missing.forEach((entry) => {
    if (!entry?.photoId || !entry?.productId) return;
    const set = missingByPhoto.get(entry.photoId) || new Set();
    set.add(entry.productId);
    missingByPhoto.set(entry.photoId, set);
  });
  if (!missingByPhoto.size) return 0;
  let removed = 0;
  const nextItems = basketStore.read().map((item) => {
    const missingProducts = missingByPhoto.get(item.photoId);
    if (!missingProducts) return item;
    const options = (item.options || []).filter((option) => {
      const keep = !missingProducts.has(option.id);
      if (!keep) removed += 1;
      return keep;
    });
    return { ...item, options };
  }).filter((item) => (item.options || []).length);
  if (removed) {
    basketStore.write(nextItems);
    clearCheckoutState();
  }
  return removed;
};

const basketUsesWideRows = () => window.matchMedia?.("(min-width: 761px)")?.matches ?? true;

const syncBasketPreviewHeights = () => {
  document.querySelectorAll(".basket-item").forEach((item) => {
    const thumb = item.querySelector(".basket-thumb");
    const main = item.querySelector(".basket-item-main");
    if (!thumb || !main) return;
    if (!basketUsesWideRows()) {
      thumb.style.removeProperty("--basket-thumb-height");
      return;
    }
    const mainHeight = Math.ceil(main.getBoundingClientRect().height);
    if (mainHeight > 0) {
      thumb.style.setProperty("--basket-thumb-height", `${mainHeight}px`);
    }
  });
};

const fallbackGuid = () => [
  Date.now().toString(16),
  Math.random().toString(16).slice(2, 10),
  Math.random().toString(16).slice(2, 10),
].join("-");

const currentOrderId = (items = []) => {
  if (!items.length) {
    localStorage.removeItem(orderIdKey);
    return "";
  }
  const existing = localStorage.getItem(orderIdKey);
  if (existing) return existing;
  const nextId = window.crypto?.randomUUID?.() || fallbackGuid();
  localStorage.setItem(orderIdKey, nextId);
  return nextId;
};

const photoReviewUrl = (photoId) => {
  const href = window.photosByElieVersionedHref?.(`./photo.html?id=${encodeURIComponent(photoId)}`)
    || `./photo.html?id=${encodeURIComponent(photoId)}`;
  return new URL(href, window.location.href).href;
};

const sourceFileLabel = (photo) => {
  const source = Array.isArray(photo?.sourceFiles) ? photo.sourceFiles[0] : null;
  if (source?.path) return `${source.path}${source.type ? ` (${source.type})` : ""}`;
  return (photo?.metadata || []).find((item) => item.label === "Original file")?.value || "Source file unverified";
};

const syncOrderIntent = (items, assetCount, total, shippingHandlingTotal) => {
  if (!orderIntent || !orderSummary) return;
  orderIntent.hidden = items.length === 0;
  if (!items.length) return;
  const minimumAdjustment = checkoutMinimumAdjustment(total);
  const payableTotal = total + minimumAdjustment;

  const collectionCounts = items.reduce((counts, item) => {
    const key = item.collection || "Collection";
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  const collectionText = Array.from(collectionCounts.entries())
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
  const orderId = currentOrderId(items);
  const zipName = `photosbyelie-order-${orderId}.zip`;

  orderSummary.innerHTML = `
    <div><dt>${t("basket.order_id")}</dt><dd>${escapeText(orderId)}</dd></div>
    <div><dt>${t("basket.photos")}</dt><dd>${items.length}</dd></div>
    <div><dt>${t("basket.assets")}</dt><dd>${assetCount}</dd></div>
    ${shippingHandlingTotal ? `<div><dt>S&H</dt><dd>+${formatMoney(shippingHandlingTotal)}</dd></div>` : ""}
    ${shippingHandlingTotal ? `<div><dt>Limited-time discount</dt><dd>-${formatMoney(shippingHandlingTotal)}</dd></div>` : ""}
    <div><dt>${t("basket.draft_total")}</dt><dd>${formatMoney(total)}</dd></div>
    <div><dt>${t("basket.minimum_charge")}</dt><dd>${formatMoney(dollarsForCents(CHECKOUT_MINIMUM_CENTS))}</dd></div>
    ${minimumAdjustment ? `<div><dt>${t("basket.minimum_adjustment")}</dt><dd>+${formatMoney(minimumAdjustment)}</dd></div>` : ""}
    <div><dt>${t("basket.payable_total")}</dt><dd>${formatMoney(payableTotal)}</dd></div>
    <div><dt>${t("basket.collections")}</dt><dd>${escapeText(collectionText)}</dd></div>
  `;

  const lines = [
    "Photos By Elie order intent",
    "",
    `Order ID: ${orderId}`,
    `Delivery ZIP: ${zipName}`,
    `Photos: ${items.length}`,
    `Assets: ${assetCount}`,
    ...(shippingHandlingTotal ? [
      `Physical S&H: ${formatMoney(shippingHandlingTotal)}`,
      `Limited-time S&H discount: -${formatMoney(shippingHandlingTotal)}`,
    ] : []),
    `Draft total: ${formatMoney(total)}`,
    `Stripe minimum charge: ${formatMoney(dollarsForCents(CHECKOUT_MINIMUM_CENTS))}`,
    ...(minimumAdjustment ? [`Minimum charge adjustment: +${formatMoney(minimumAdjustment)}`] : []),
    `Payable total: ${formatMoney(payableTotal)}`,
    "",
    ...items.flatMap((item, index) => {
      const { photo } = photoForItem(item);
      const subtotal = (item.options || []).reduce((sum, option) => sum + optionTotal(option), 0);
      return [
        `${index + 1}. ${item.title}`,
        `Photo ID: ${item.photoId}`,
        `Collection: ${item.collection}`,
        `Review page: ${photoReviewUrl(item.photoId)}`,
        `Original: ${photo ? sourceFileLabel(photo) : "Photo no longer in public catalog"}`,
        `Source: ${photo ? window.photosByElieOriginalSize?.(photo) || "Source file unverified" : "Photo no longer in public catalog"}`,
        "Selected assets:",
        ...item.options.map((option) => {
          const unitPrice = window.photosByElieOptionUnitPrice?.(option) || Number(option.price) || 0;
          const quantity = optionQuantity(option);
          const frameText = option.type === "print" ? `; frame: ${frameLabel(option.frame)}` : "";
          const shippingHandling = optionShippingHandlingTotal(option);
          const shippingText = option.type === "print"
            ? `; S&H ${formatMoney(shippingHandling)}; limited-time discount -${formatMoney(shippingHandling)}`
            : "; S&H free";
          return `- [${productTypeLabel(option)}] ${productLabel(option)} x ${quantity}: ${formatMoney(optionTotal(option))} (${formatMoney(unitPrice)} each${frameText}${shippingText}${productDetail(photo, option) ? `; ${productDetail(photo, option)}` : ""})`;
        }),
        `Photo subtotal: ${formatMoney(subtotal)}`,
        ""
      ];
    }),
    "License note: personal print and web use of delivered digital files are included by default. Commercial, resale, and AI-training use are confirmed manually before fulfillment."
  ];
  const subject = `Photos By Elie order ${orderId}`;
  const body = lines.join("\n");
  if (orderEmail) {
    orderEmail.dataset.orderEmailSubject = subject;
    orderEmail.dataset.orderEmailBody = body;
    orderEmail.setAttribute("href", `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  }
  if (orderEmailDraft) {
    orderEmailDraft.value = "";
    orderEmailDraft.hidden = true;
  }
};

const showOrderEmailDraft = (draft) => {
  if (!orderEmailDraft) return;
  orderEmailDraft.value = draft;
  orderEmailDraft.hidden = false;
  window.requestAnimationFrame(() => {
    orderEmailDraft.focus();
    orderEmailDraft.select();
  });
};

const checkoutState = () => {
  try {
    return JSON.parse(localStorage.getItem(checkoutStateKey) || "{}");
  } catch {
    return {};
  }
};

const setCheckoutState = (state) => {
  localStorage.setItem(checkoutStateKey, JSON.stringify(state || {}));
};

const clearCheckoutState = () => {
  localStorage.removeItem(checkoutStateKey);
  if (checkoutResult) {
    checkoutResult.hidden = true;
    checkoutResult.innerHTML = "";
  }
  if (mockPay) mockPay.hidden = true;
};

const digitalCheckoutItems = () => basketStore.read()
  .map((item) => ({
    photoId: item.photoId,
    options: (item.options || []).filter((option) => option.type === "digital").map((option) => ({ id: option.id })),
  }))
  .filter((item) => item.options.length);

const basketDigitalSubtotalCents = () => centsFor(basketStore.read()
  .flatMap((item) => item.options || [])
  .filter((option) => option.type === "digital")
  .reduce((sum, option) => sum + optionTotal(option), 0));

const checkoutFetch = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  const response = await fetch(`${workerBaseUrl()}${path}`, {
    ...options,
    signal: controller.signal,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  }).catch((error) => {
    if (error?.name === "AbortError") {
      throw new Error("Checkout is taking too long. Please try again; no payment has started yet.");
    }
    throw new Error("Checkout could not reach the payment server. Please refresh this page and try again; no payment has started yet.");
  }).finally(() => {
    window.clearTimeout(timeout);
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Worker request failed with HTTP ${response.status}.`;
    const missing = body?.error?.details?.missing || [];
    const suffix = missing.length
      ? ` ${missing.length} selected file${missing.length === 1 ? "" : "s"} are not ready for delivery: ${missing.map((item) => `${item.photoId || "photo"} ${item.productLabel || item.productId || "file"} (${item.objectKey || item.code || "missing"})`).join("; ")}.`
      : "";
    const error = new Error(`${message}${suffix}`);
    error.details = body?.error?.details || null;
    throw error;
  }
  return body;
};

const moneyFromCents = (value, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(Number(value || 0) / 100);

const orderPageHref = (orderId, email) => {
  const url = new URL("./order.html", window.location.href);
  url.searchParams.set("id", orderId);
  url.searchParams.set("email", email);
  url.searchParams.set("v", siteVersion);
  return url.href;
};

const renderCheckoutResult = (body, mode = "checkout") => {
  if (!checkoutResult) return;
  const order = body?.order;
  if (!order) {
    checkoutResult.hidden = true;
    checkoutResult.innerHTML = "";
    return;
  }
  const delivery = order.delivery;
  const discountCode = order.discountCode || "";
  const discountAmount = Number(order.discountAmount || 0);
  checkoutResult.hidden = false;
  const provider = body.checkout?.provider || "stripe";
  const mockMode = provider === "mock-stripe";
  const title = mode === "paid"
    ? (mockMode ? "Mock payment complete" : "Payment complete")
    : (mockMode ? "Mock Checkout Session ready" : "Stripe Checkout ready");
  const checkoutLinkText = mockMode ? "Open mock Checkout Session" : "Open Stripe Checkout";
  const checkoutAction = body.checkout?.url
    ? (mockMode
      ? `<button type="button" data-mock-checkout-pay>${checkoutLinkText}</button>`
      : `<a href="${escapeText(body.checkout.url)}" target="_blank" rel="noreferrer">${checkoutLinkText}</a>`)
    : "";
  checkoutResult.innerHTML = `
    <strong>${title}</strong>
    <span>Order ${escapeText(order.id)} · ${escapeText(order.status)} · ${moneyFromCents(order.amountExpected, order.currency)}</span>
    ${discountCode ? `<span>${escapeText(t("basket.discount_code"))}: ${escapeText(discountCode)} · -${moneyFromCents(discountAmount, order.currency)}</span>` : ""}
    ${checkoutAction}
    ${delivery?.downloadUrl ? `<a href="${escapeText(workerBaseUrl() + delivery.downloadUrl)}" target="_blank" rel="noreferrer">Open download token</a>` : ""}
    ${delivery?.zipKey ? `<code>${escapeText(delivery.zipKey)}</code>` : ""}
  `;
};

const setBasketStatus = (message, { checkout = false, title = t("order.checkout") } = {}) => {
  if (status) status.textContent = message;
  if (!checkout || !checkoutResult) return;
  checkoutResult.hidden = false;
  checkoutResult.innerHTML = `
    <strong>${escapeText(title)}</strong>
    <span>${escapeText(message)}</span>
  `;
};

const syncEmbeddedBrowserWarning = () => {
  const embedded = window.photosByElieEmbeddedBrowser;
  if (!embeddedWarning || !embedded?.detected) return;
  embeddedWarning.hidden = false;
  if (openBrowserLink) openBrowserLink.href = embedded.externalUrl;
};

copyBrowserLink?.addEventListener("click", async () => {
  const embedded = window.photosByElieEmbeddedBrowser;
  const copied = await embedded?.copyText?.(embedded.externalUrl);
  setBasketStatus(copied ? t("browser_warning.copied") : t("browser_warning.copy_failed"));
});

const syncCheckoutControls = () => {
  const state = checkoutState();
  const provider = state.provider || state.lastResponse?.checkout?.provider || "stripe";
  if (mockPay) mockPay.hidden = !(isLocalPage() && state.checkoutSessionId && provider === "mock-stripe");
  if (checkoutEmail && state.email && !checkoutEmail.value) checkoutEmail.value = state.email;
  if (discountCodeInput && state.discountCode && !discountCodeInput.value) discountCodeInput.value = state.discountCode;
  if (state.lastResponse) renderCheckoutResult(state.lastResponse, state.mode);
};

checkoutGuest?.addEventListener("click", async () => {
  checkoutGuest.disabled = true;
  try {
    const email = String(checkoutEmail?.value || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setBasketStatus(t("basket.enter_email"), { checkout: true });
      checkoutEmail?.focus();
      return;
    }
    const discountCode = String(discountCodeInput?.value || "").trim();
    if (!deliveryAvailabilityLoaded) {
      setBasketStatus(t("basket.checking_delivery"), { checkout: true });
      await ensureDeliveryAvailabilityLoaded();
    }
    const beforeAvailabilityPrune = JSON.stringify(basketStore.read());
    const prunedItems = pruneUnavailableBasketSelections(basketStore.write(basketStore.read()));
    if (beforeAvailabilityPrune !== JSON.stringify(prunedItems)) {
      renderBasket();
      setBasketStatus(t("basket.unavailable_removed_review"), { checkout: true });
      return;
    }
    const items = digitalCheckoutItems();
    if (!items.length) {
      setBasketStatus(t("basket.checkout_needs_asset"), { checkout: true });
      return;
    }
    setBasketStatus(t("basket.creating_checkout"), { checkout: true });
    const body = await checkoutFetch("/checkout/guest", {
      method: "POST",
      body: JSON.stringify({
        email,
        items,
        expectedSubtotalAmount: basketDigitalSubtotalCents(),
        ...(discountCode ? { discountCode } : {}),
      }),
    });
    setCheckoutState({
      email,
      discountCode,
      orderId: body.order.id,
      checkoutSessionId: body.checkout.sessionId,
      provider: body.checkout.provider,
      checkoutUrl: body.checkout.url,
      lastResponse: body,
      mode: "checkout",
    });
    renderCheckoutResult(body, "checkout");
    syncCheckoutControls();
    if (body.checkout?.provider === "stripe" && body.checkout?.url) {
      setBasketStatus(t("basket.opening_stripe"));
      window.location.assign(body.checkout.url);
      return;
    }
    setBasketStatus(t("basket.mock_ready"));
  } catch (error) {
    const removed = removeMissingDeliverySelections(error?.details?.missing || []);
    if (removed) {
      renderBasket();
      setBasketStatus(t("basket.unavailable_removed_review"), { checkout: true });
      return;
    }
    setBasketStatus(error?.message || "Checkout could not start.", { checkout: true });
  } finally {
    checkoutGuest.disabled = false;
  }
});

const simulateMockPayment = async () => {
  const state = checkoutState();
  if (!state.checkoutSessionId) return;
  if (mockPay) mockPay.disabled = true;
  const inlineButton = checkoutResult?.querySelector("[data-mock-checkout-pay]");
  if (inlineButton) inlineButton.disabled = true;
  setBasketStatus(t("basket.simulating_payment"));
  try {
    const body = await checkoutFetch("/mock-stripe/pay", {
      method: "POST",
      body: JSON.stringify({ checkoutSessionId: state.checkoutSessionId }),
    });
    setCheckoutState({
      ...state,
      lastResponse: body,
      mode: "paid",
      checkoutSessionId: "",
      orderId: body.order.id,
    });
    renderCheckoutResult(body, "paid");
    syncCheckoutControls();
    setBasketStatus(t("basket.mock_complete"));
    window.location.href = orderPageHref(body.order.id, body.order.buyerEmail || state.email);
  } catch (error) {
    setBasketStatus(error?.message || "Mock payment could not complete.", { checkout: true });
  } finally {
    if (mockPay) mockPay.disabled = false;
    if (inlineButton) inlineButton.disabled = false;
  }
};

mockPay?.addEventListener("click", async () => {
  await simulateMockPayment();
});

discountCodeInput?.addEventListener("input", () => {
  clearCheckoutState();
});

checkoutResult?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-mock-checkout-pay]");
  if (!button) return;
  event.preventDefault();
  await simulateMockPayment();
});

orderEmail?.addEventListener("click", async (event) => {
  event.preventDefault();
  const subject = orderEmail.dataset.orderEmailSubject || "Photos By Elie order intent";
  const body = orderEmail.dataset.orderEmailBody || "";
  const draft = `Subject: ${subject}\n\n${body}`;
  if (!body) {
    status.textContent = "No order email is ready yet.";
    return;
  }
  showOrderEmailDraft(draft);
  try {
    await navigator.clipboard.writeText(draft);
    status.textContent = "Order email copied. The draft is selected below too.";
  } catch {
    status.textContent = "Order email is ready below. Press Command-C to copy the selected draft.";
  }
});

const renderBasket = () => {
  const items = pruneUnavailableBasketSelections(basketStore.write(basketStore.read()));
  const visibleItems = items.slice(0, visibleLimit);
  const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const assetCount = items.reduce((sum, item) => sum + (item.options || []).reduce((count, option) => count + optionQuantity(option), 0), 0);
  const shippingHandlingTotal = items.reduce((sum, item) => sum + (item.options || []).reduce((shipping, option) => shipping + optionShippingHandlingTotal(option), 0), 0);

  basketTotal.textContent = t("basket.assets_total", {
    count: assetCount,
    assetWord: t(assetCount === 1 ? "basket.asset_singular" : "basket.asset_plural"),
    total: formatMoney(total),
  });
  emptyState.hidden = items.length !== 0;
  syncOrderIntent(items, assetCount, total, shippingHandlingTotal);
  ensureMoreButton();
  syncEmbeddedBrowserWarning();

  basketRoot.innerHTML = visibleItems.map((item, index) => {
    const { collection, photo } = photoForItem(item);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const panoClass = window.photosByEliePhotoIsPanorama?.(photo) ? "is-pano" : "";
    const thumbStyle = window.photosByEliePhotoAspectStyle?.(photo) || "";
    const imageSrc = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    const selectedIds = availableSelectedOptionIds(item);
    const selectedOptionById = new Map((item.options || []).map((option) => [option.id, option]));
    const availableOptions = photo && window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
      : resolutionOptions;
    const resolutionDetail = (option) => {
      if (!photo || !window.photosByElieProductDetail) return "";
      return `<small>${productDetail(photo, option)}</small>`;
    };
    const printConfigMarkup = (option) => {
      if (option.type !== "print") return "";
      const selected = selectedOptionById.get(option.id) || {};
      const selectedFrameId = selected.frame?.id || "none";
      return `
        <div class="print-config">
          <label class="print-quantity">
            <span>${t("detail.count")}</span>
            <span class="quantity-stepper">
              <button type="button" data-basket-print-step="${index}" data-option-id="${option.id}" data-step="-1" aria-label="${t("product.decrease_count", { label: productLabel(option) })}">-</button>
              <input type="number" min="1" max="99" step="1" data-basket-print-quantity="${index}" data-option-id="${option.id}" value="${optionQuantity(selected)}"/>
              <button type="button" data-basket-print-step="${index}" data-option-id="${option.id}" data-step="1" aria-label="${t("product.increase_count", { label: productLabel(option) })}">+</button>
            </span>
          </label>
          <fieldset class="frame-options">
            <legend>${t("detail.frame")}</legend>
            ${frameOptions().map((frame) => `
              <label>
                <input type="radio" name="basket-frame-${index}-${option.id}" data-basket-print-frame="${index}" data-option-id="${option.id}" value="${frame.id}" ${frame.id === selectedFrameId ? "checked" : ""}/>
                <span>${frameLabel(frame)}${framePriceFor(frame, option) ? ` +${formatMoney(framePriceFor(frame, option))}` : ""}</span>
              </label>
            `).join("")}
          </fieldset>
        </div>
      `;
    };
    return `
    <article class="basket-item">
      <a class="basket-thumb mock-photo ${thumbClasses} ${panoClass} ${imageSrc ? "has-image" : ""}" href="./photo.html?id=${item.photoId}" aria-label="Open ${item.title}"${thumbStyle}>
        ${imageSrc ? `<img src="${imageSrc}" alt="${item.title}"/>` : ""}
        <span>${item.title}</span>
      </a>
      <div class="basket-item-main">
        <p class="eyebrow">${item.collection || "Collection"}</p>
        <h3>${item.title}</h3>
        <div class="basket-resolution-grid" aria-label="Resolution options for ${item.title}">
          ${availableOptions.map((option) => {
            const availability = deliveryAvailabilityFor(item.photoId, option);
            return `
            <div class="basket-product-row ${availability.available ? "" : "is-unavailable"}">
            <label class="product-choice">
              <input type="checkbox" data-basket-resolution="${index}" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""} ${availability.available ? "" : "disabled"}/>
              <span><strong>${productLabel(option)}</strong>${resolutionDetail(option)}${availability.available ? "" : `<small class="basket-delivery-warning">${escapeText(availability.reason)}</small>`}</span>
              <b>${formatMoney(option.price)}</b>
            </label>
            ${printConfigMarkup(option)}
            </div>
          `}).join("")}
        </div>
      </div>
      <div class="basket-item-actions">
        <strong>${formatMoney(Number(item.total) || 0)}</strong>
        <button class="btn secondary" type="button" data-remove-item="${index}">${t("basket.remove")}</button>
      </div>
    </article>
  `}).join("");
  if (moreButton) {
    const hasMore = items.length > visibleItems.length;
    moreButton.hidden = !hasMore;
    moreButton.textContent = t("home.show_more");
  }
  if (showAllButton) {
    showAllButton.hidden = items.length <= visibleItems.length;
    showAllButton.textContent = t("home.show_all");
  }

  window.requestAnimationFrame(syncBasketPreviewHeights);
  if (!checkoutHashScrollDone && window.location.hash === "#checkout" && !orderIntent.hidden) {
    checkoutHashScrollDone = true;
    window.requestAnimationFrame(() => orderIntent.scrollIntoView({ block: "end", behavior: "smooth" }));
  }

  document.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      basketStore.remove(Number(button.dataset.removeItem));
      clearCheckoutState();
      status.textContent = t("basket.item_removed");
      renderBasket();
    });
  });

  const selectedOptionsFor = (itemIndex) => {
    const item = basketStore.read()[itemIndex];
    const { photo } = photoForItem(item || {});
    const availableOptions = photo && window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
      : resolutionOptions;
    return Array.from(document.querySelectorAll(`[data-basket-resolution="${itemIndex}"]:checked`))
      .map((checkbox) => {
        const option = availableOptions.find((candidate) => candidate.id === checkbox.value);
        if (!option) return null;
        const selected = { id: option.id };
        if (option.type === "print") {
          selected.quantity = document.querySelector(`[data-basket-print-quantity="${itemIndex}"][data-option-id="${option.id}"]`)?.value || 1;
          selected.frameId = document.querySelector(`[data-basket-print-frame="${itemIndex}"][data-option-id="${option.id}"]:checked`)?.value || "none";
        }
        return selected;
      })
      .filter(Boolean);
  };

  const syncItemOptions = (itemIndex) => {
    const item = basketStore.read()[itemIndex];
    if (!item) return;
    const selectedOptions = selectedOptionsFor(itemIndex);
    basketStore.updateOptions(itemIndex, selectedOptions);
    clearCheckoutState();
    status.textContent = selectedOptions.length
        ? t("basket.choices_updated", { title: item.title })
        : t("basket.no_assets_selected", { title: item.title });
    renderBasket();
  };

  const selectPrintProduct = (itemIndex, optionId) => {
    const checkbox = document.querySelector(`[data-basket-resolution="${itemIndex}"][value="${optionId}"]`);
    if (checkbox) checkbox.checked = true;
  };

  document.querySelectorAll("[data-basket-resolution]").forEach((input) => {
    input.addEventListener("change", () => {
      syncItemOptions(Number(input.dataset.basketResolution));
    });
  });
  document.querySelectorAll("[data-basket-print-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemIndex = Number(button.dataset.basketPrintStep);
      const optionId = button.dataset.optionId;
      const input = document.querySelector(`[data-basket-print-quantity="${itemIndex}"][data-option-id="${optionId}"]`);
      if (!input) return;
      input.value = Math.max(1, Math.min(99, (Number(input.value) || 1) + Number(button.dataset.step || 0)));
      selectPrintProduct(itemIndex, optionId);
      syncItemOptions(itemIndex);
    });
  });
  document.querySelectorAll("[data-basket-print-quantity]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemIndex = Number(input.dataset.basketPrintQuantity);
      selectPrintProduct(itemIndex, input.dataset.optionId);
      syncItemOptions(itemIndex);
    });
    input.addEventListener("input", () => {
      const itemIndex = Number(input.dataset.basketPrintQuantity);
      selectPrintProduct(itemIndex, input.dataset.optionId);
      syncItemOptions(itemIndex);
    });
  });
  document.querySelectorAll("[data-basket-print-frame]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemIndex = Number(input.dataset.basketPrintFrame);
      selectPrintProduct(itemIndex, input.dataset.optionId);
      syncItemOptions(itemIndex);
    });
  });
};

renderBasket();
syncCheckoutControls();
deliveryAvailabilityPromise = loadDeliveryAvailability();
window.addEventListener("resize", syncBasketPreviewHeights);
window.addEventListener("load", syncBasketPreviewHeights);
window.addEventListener("photosbyelie:languagechange", () => {
  renderBasket();
  syncCheckoutControls();
});
})().catch((error) => {
  const status = document.querySelector("[data-basket-status]");
  if (status) status.textContent = error?.message || "Could not load basket.";
}));
