const formatMoney = (value) => `$${value}`;
const allCollections = window.photosByElieData || {};
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
const checkoutGuest = document.querySelector("[data-checkout-guest]");
const mockPay = document.querySelector("[data-mock-pay]");
const checkoutResult = document.querySelector("[data-checkout-result]");
const orderIdKey = "photosbyelie-order-id";
const checkoutStateKey = "photosbyelie-mock-checkout";
const workerBaseKey = "photosbyelie-worker-base";
const siteVersion = document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "67.18";

const workerBaseUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("workerBase");
  if (fromQuery) {
    localStorage.setItem(workerBaseKey, fromQuery.replace(/\/+$/, ""));
    return fromQuery.replace(/\/+$/, "");
  }
  const configured = window.photosByElieMediaConfig?.checkoutWorkerBaseUrl || "";
  return (localStorage.getItem(workerBaseKey) || configured || "http://localhost:8787").replace(/\/+$/, "");
};

const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const productTypeLabel = (option) => ({
  digital: "Digital asset",
  print: "Print",
  frame: "Frame"
}[option?.type] || "Product");

const productDetail = (photo, option) => {
  if (!photo || !window.photosByElieProductDetail) return option.detail || "";
  return window.photosByElieProductDetail(photo, option) || option.detail || "";
};
const productLabel = (option) => window.photosByElieProductLabel?.(option) || option.label;
const frameOptions = () => window.photosByElieFrameOptions || [];
const frameFor = (frameId) => frameOptions().find((frame) => frame.id === frameId) || frameOptions()[0] || { id: "none", label: "No frame", price: 0 };
const framePriceFor = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;
const optionQuantity = (option) => window.photosByElieOptionQuantity?.(option) || 1;
const optionTotal = (option) => window.photosByElieOptionTotal?.(option) || Number(option.price) || 0;
const optionShippingHandlingTotal = (option) => window.photosByElieOptionShippingHandlingTotal?.(option) || 0;

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
    <div><dt>Order ID</dt><dd>${escapeText(orderId)}</dd></div>
    <div><dt>Photos</dt><dd>${items.length}</dd></div>
    <div><dt>Assets</dt><dd>${assetCount}</dd></div>
    ${shippingHandlingTotal ? `<div><dt>S&H</dt><dd>+${formatMoney(shippingHandlingTotal)}</dd></div>` : ""}
    ${shippingHandlingTotal ? `<div><dt>Limited-time discount</dt><dd>-${formatMoney(shippingHandlingTotal)}</dd></div>` : ""}
    <div><dt>Draft total</dt><dd>${formatMoney(total)}</dd></div>
    <div><dt>Collections</dt><dd>${escapeText(collectionText)}</dd></div>
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
          const frameText = option.type === "print" ? `; frame: ${option.frame?.label || "No frame"}` : "";
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

const digitalCheckoutItems = () => basketStore.read()
  .map((item) => ({
    photoId: item.photoId,
    options: (item.options || []).filter((option) => option.type === "digital").map((option) => ({ id: option.id })),
  }))
  .filter((item) => item.options.length);

const checkoutFetch = async (path, options = {}) => {
  const response = await fetch(`${workerBaseUrl()}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Worker request failed with HTTP ${response.status}.`;
    throw new Error(message);
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
  checkoutResult.hidden = false;
  checkoutResult.innerHTML = `
    <strong>${mode === "paid" ? "Mock payment complete" : "Mock Checkout Session ready"}</strong>
    <span>Order ${escapeText(order.id)} · ${escapeText(order.status)} · ${moneyFromCents(order.amountExpected, order.currency)}</span>
    ${body.checkout?.url ? `<a href="${escapeText(body.checkout.url)}" target="_blank" rel="noreferrer">${escapeText(body.checkout.sessionId)}</a>` : ""}
    ${delivery?.downloadUrl ? `<a href="${escapeText(workerBaseUrl() + delivery.downloadUrl)}" target="_blank" rel="noreferrer">Open download token</a>` : ""}
    ${delivery?.zipKey ? `<code>${escapeText(delivery.zipKey)}</code>` : ""}
  `;
};

const syncCheckoutControls = () => {
  const state = checkoutState();
  if (mockPay) mockPay.hidden = !state.checkoutSessionId;
  if (checkoutEmail && state.email && !checkoutEmail.value) checkoutEmail.value = state.email;
  if (state.lastResponse) renderCheckoutResult(state.lastResponse, state.mode);
};

checkoutGuest?.addEventListener("click", async () => {
  const email = String(checkoutEmail?.value || "").trim();
  const items = digitalCheckoutItems();
  if (!items.length) {
    status.textContent = "Mock checkout needs at least one digital asset in the basket.";
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = "Enter a buyer email before starting mock checkout.";
    checkoutEmail?.focus();
    return;
  }
  checkoutGuest.disabled = true;
  status.textContent = "Creating mock Checkout Session...";
  try {
    const body = await checkoutFetch("/checkout/guest", {
      method: "POST",
      body: JSON.stringify({ email, items }),
    });
    setCheckoutState({
      email,
      orderId: body.order.id,
      checkoutSessionId: body.checkout.sessionId,
      lastResponse: body,
      mode: "checkout",
    });
    renderCheckoutResult(body, "checkout");
    syncCheckoutControls();
    status.textContent = "Mock Checkout Session ready. Simulate Stripe payment to generate the ZIP.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    checkoutGuest.disabled = false;
  }
});

mockPay?.addEventListener("click", async () => {
  const state = checkoutState();
  if (!state.checkoutSessionId) return;
  mockPay.disabled = true;
  status.textContent = "Simulating Stripe payment and generating the delivery ZIP...";
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
    status.textContent = "Mock payment complete. Delivery ZIP generated.";
    window.location.href = orderPageHref(body.order.id, body.order.buyerEmail || state.email);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    mockPay.disabled = false;
  }
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
  const items = basketStore.write(basketStore.read());
  const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const assetCount = items.reduce((sum, item) => sum + (item.options || []).reduce((count, option) => count + optionQuantity(option), 0), 0);
  const shippingHandlingTotal = items.reduce((sum, item) => sum + (item.options || []).reduce((shipping, option) => shipping + optionShippingHandlingTotal(option), 0), 0);

  basketTotal.textContent = `${assetCount} ${assetCount === 1 ? "asset" : "assets"}, ${formatMoney(total)}`;
  emptyState.hidden = items.length !== 0;
  syncOrderIntent(items, assetCount, total, shippingHandlingTotal);

  const cssUrlValue = (url) => `url("${String(url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, "")}")`;
  basketRoot.innerHTML = items.map((item, index) => {
    const { collection, photo } = photoForItem(item);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const imageSrc = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    const selectedIds = new Set((item.options || []).map((option) => option.id));
    const selectedOptionById = new Map((item.options || []).map((option) => [option.id, option]));
    const availableOptions = photo && window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
      : resolutionOptions;
    const resolutionDetail = (option) => {
      if (!photo || !window.photosByElieProductDetail) return "";
      return `<small>${window.photosByElieProductDetail(photo, option)}</small>`;
    };
    const printConfigMarkup = (option) => {
      if (option.type !== "print") return "";
      const selected = selectedOptionById.get(option.id) || {};
      const selectedFrameId = selected.frame?.id || "none";
      return `
        <div class="print-config">
          <label class="print-quantity">
            <span>Count</span>
            <span class="quantity-stepper">
              <button type="button" data-basket-print-step="${index}" data-option-id="${option.id}" data-step="-1" aria-label="Decrease ${productLabel(option)} count">-</button>
              <input type="number" min="1" max="99" step="1" data-basket-print-quantity="${index}" data-option-id="${option.id}" value="${optionQuantity(selected)}"/>
              <button type="button" data-basket-print-step="${index}" data-option-id="${option.id}" data-step="1" aria-label="Increase ${productLabel(option)} count">+</button>
            </span>
          </label>
          <fieldset class="frame-options">
            <legend>Frame</legend>
            ${frameOptions().map((frame) => `
              <label>
                <input type="radio" name="basket-frame-${index}-${option.id}" data-basket-print-frame="${index}" data-option-id="${option.id}" value="${frame.id}" ${frame.id === selectedFrameId ? "checked" : ""}/>
                <span>${frame.label}${framePriceFor(frame, option) ? ` +$${framePriceFor(frame, option)}` : ""}</span>
              </label>
            `).join("")}
          </fieldset>
        </div>
      `;
    };
    return `
    <article class="basket-item ${imageSrc ? "has-row-bg" : ""}" data-basket-row-bg="${escapeText(imageSrc)}">
      <a class="basket-thumb mock-photo ${thumbClasses} ${imageSrc ? "has-image" : ""}" href="./photo.html?id=${item.photoId}" aria-label="Open ${item.title}">
        ${imageSrc ? `<img src="${imageSrc}" alt="${item.title}"/>` : ""}
        <span>${item.title}</span>
      </a>
      <div>
        <p class="eyebrow">${item.collection || "Collection"}</p>
        <h3>${item.title}</h3>
        <div class="basket-resolution-grid" aria-label="Resolution options for ${item.title}">
          ${availableOptions.map((option) => `
            <div class="basket-product-row">
            <label class="product-choice">
              <input type="checkbox" data-basket-resolution="${index}" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
              <span><strong>${productLabel(option)}</strong>${resolutionDetail(option)}</span>
              <b>${formatMoney(option.price)}</b>
            </label>
            ${printConfigMarkup(option)}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="basket-item-actions">
        <strong>${formatMoney(Number(item.total) || 0)}</strong>
        <button class="btn secondary" type="button" data-remove-item="${index}">Remove</button>
      </div>
    </article>
  `}).join("");

  document.querySelectorAll("[data-basket-row-bg]").forEach((row) => {
    const rowBg = row.dataset.basketRowBg || "";
    if (rowBg) row.style.setProperty("--basket-row-bg", cssUrlValue(rowBg));
  });

  document.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      basketStore.remove(Number(button.dataset.removeItem));
      status.textContent = "Item removed from basket.";
      renderBasket();
    });
  });

  const selectedOptionsFor = (itemIndex) => Array.from(document.querySelectorAll(`[data-basket-resolution="${itemIndex}"]:checked`))
    .map((checkbox) => {
      const option = resolutionOptions.find((item) => item.id === checkbox.value);
      if (!option) return null;
      const selected = { id: option.id };
      if (option.type === "print") {
        selected.quantity = document.querySelector(`[data-basket-print-quantity="${itemIndex}"][data-option-id="${option.id}"]`)?.value || 1;
        selected.frameId = document.querySelector(`[data-basket-print-frame="${itemIndex}"][data-option-id="${option.id}"]:checked`)?.value || "none";
      }
      return selected;
    })
    .filter(Boolean);

  const syncItemOptions = (itemIndex) => {
    const item = basketStore.read()[itemIndex];
    if (!item) return;
    const selectedOptions = selectedOptionsFor(itemIndex);
    basketStore.updateOptions(itemIndex, selectedOptions);
    status.textContent = selectedOptions.length
        ? `${item.title} asset choices updated.`
        : `${item.title} has no selected assets. Use Remove to delete the photo.`;
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
