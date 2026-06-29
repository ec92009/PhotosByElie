(() => {
  const $ = (selector) => document.querySelector(selector);
  const status = $("[data-sidecar-status]");
  const versionRoot = $("[data-sidecar-version]");
  const grid = $("[data-sidecar-grid]");
  const detail = $("[data-sidecar-detail]");
  const countsRoot = $("[data-sidecar-counts]");
  const planPanel = $("[data-sidecar-plan-panel]");
  const planEyebrow = $("[data-sidecar-plan-eyebrow]");
  const planTitle = $("[data-sidecar-plan-title]");
  const planOutput = $("[data-sidecar-plan-output]");

  const state = {
    items: [],
    selectedIndex: -1,
    summary: null,
  };

  const escapeHtml = (value = "") => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const formatDate = (value = "") => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  };

  const itemId = (item) => String(item?.localIdentifier || item?.assetId || "").trim();
  const previewUrl = (item) => `/__sidecar/preview/${encodeURIComponent(itemId(item))}?maxPixel=900`;
  const selectedItem = () => state.items[state.selectedIndex] || null;
  const previewFallbackMarkup = `<span class="sidecar-thumb-fallback">Preview unavailable</span>`;
  const shootWindowMs = 2 * 60 * 60 * 1000;
  const colorShortcuts = {
    6: "red",
    7: "yellow",
    8: "green",
    9: "blue",
  };

  const wirePreviewFallbacks = (root) => {
    root?.querySelectorAll("img[data-sidecar-preview]").forEach((img) => {
      const markMissing = () => {
        img.closest(".sidecar-thumb, .sidecar-detail-preview")?.classList.add("is-missing");
        img.removeAttribute("src");
      };
      img.addEventListener("error", markMissing, { once: true });
      if (img.complete && img.naturalWidth === 0) markMissing();
    });
  };

  const sidecarBadges = (item) => {
    const sidecar = item.sidecarState || {};
    const badges = [];
    if (sidecar.color) badges.push(sidecar.color);
    if (sidecar.pickState && sidecar.pickState !== "undecided") badges.push(sidecar.pickState);
    if (sidecar.metadataState && sidecar.metadataState !== "unreviewed") badges.push(sidecar.metadataState);
    if (item.pendingSyncCount) badges.push(`${item.pendingSyncCount} pending`);
    return badges.map((badge) => `<span class="sidecar-badge">${escapeHtml(badge)}</span>`).join("");
  };

  const cardDecisionClasses = (item, selected = false) => {
    const sidecar = item.sidecarState || {};
    return [
      "sidecar-card",
      selected ? "is-selected" : "",
      Number(sidecar.rating || 0) > 0 ? "has-rating" : "",
      sidecar.color ? "has-color" : "",
      sidecar.pickState === "picked" ? "is-picked" : "",
      sidecar.pickState === "rejected" ? "is-rejected" : "",
      sidecar.pickState === "hidden" ? "is-hidden-decision" : "",
    ].filter(Boolean).join(" ");
  };

  const cardDecisionAttrs = (item) => {
    const sidecar = item.sidecarState || {};
    const attrs = [];
    if (sidecar.color) attrs.push(`data-sidecar-color="${escapeHtml(sidecar.color)}"`);
    if (sidecar.pickState) attrs.push(`data-sidecar-pick="${escapeHtml(sidecar.pickState)}"`);
    const rating = Number(sidecar.rating || 0);
    if (rating > 0) attrs.push(`data-sidecar-rating="${rating}"`);
    return attrs.join(" ");
  };

  const ratingStars = (item) => {
    const rating = Math.max(0, Math.min(5, Number(item.sidecarState?.rating || 0)));
    return rating ? `<span class="sidecar-stars" aria-label="${rating} star rating">${"&#9733;".repeat(rating)}</span>` : "";
  };

  const parseKeywords = (value = "") => String(value || "")
    .replace(/;/g, ",")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  const metadataFormValues = () => {
    const form = detail?.querySelector("[data-sidecar-metadata-form]");
    const data = form ? new FormData(form) : new FormData();
    return {
      title: String(data.get("title") || "").trim(),
      keywords: parseKeywords(data.get("keywords") || ""),
    };
  };

  const sameShootIndexes = () => {
    const source = selectedItem();
    const sourceTime = Date.parse(source?.creationDate || "");
    if (!Number.isFinite(sourceTime)) return state.selectedIndex >= 0 ? [state.selectedIndex] : [];
    return state.items
      .map((item, index) => ({ index, time: Date.parse(item.creationDate || "") }))
      .filter(({ index, time }) => index >= state.selectedIndex && Number.isFinite(time) && Math.abs(time - sourceTime) <= shootWindowMs)
      .map(({ index }) => index);
  };

  const renderCounts = (summary = state.summary) => {
    if (!countsRoot) return;
    if (!summary) {
      countsRoot.innerHTML = "";
      return;
    }
    countsRoot.innerHTML = `
      <div><dt>Indexed</dt><dd>${Number(summary.indexedCount || 0).toLocaleString()}</dd></div>
      <div><dt>Pending</dt><dd>${Number(summary.pendingSyncCount || 0).toLocaleString()}</dd></div>
    `;
  };

  const renderGrid = () => {
    if (!grid) return;
    if (!state.items.length) {
      grid.innerHTML = `<p class="empty-basket">No assets in this slice.</p>`;
      renderDetail();
      return;
    }
    grid.innerHTML = state.items.map((item, index) => {
      const id = itemId(item);
      const selected = index === state.selectedIndex;
      const label = item.filename || id;
      return `
        <article class="${cardDecisionClasses(item, selected)}" ${cardDecisionAttrs(item)} data-sidecar-index="${index}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <div class="sidecar-thumb">
            <img data-sidecar-preview src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(label)}" loading="lazy"/>
            ${previewFallbackMarkup}
            ${ratingStars(item)}
          </div>
          <div class="sidecar-card-copy">
            <strong>${escapeHtml(label)}</strong>
            <small>${escapeHtml(formatDate(item.creationDate))} · ${escapeHtml(item.mediaType || "photo")}</small>
            <div class="sidecar-badges">${sidecarBadges(item)}</div>
          </div>
        </article>
      `;
    }).join("");
    wirePreviewFallbacks(grid);
  };

  const cardForIndex = (index) => grid?.querySelector(`[data-sidecar-index="${index}"]`);

  const updateGridSelection = (previousIndex) => {
    if (!grid) return;
    [previousIndex, state.selectedIndex].forEach((index) => {
      if (index < 0) return;
      const card = cardForIndex(index);
      if (!card) return;
      const selected = index === state.selectedIndex;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-selected", selected ? "true" : "false");
    });
  };

  const updateCardVisualState = (index) => {
    if (index < 0) return;
    const card = cardForIndex(index);
    const item = state.items[index];
    if (!card || !item) return;
    const selected = index === state.selectedIndex;
    card.className = cardDecisionClasses(item, selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
    const color = item.sidecarState?.color || "";
    const pick = item.sidecarState?.pickState || "";
    const rating = Number(item.sidecarState?.rating || 0);
    if (color) card.setAttribute("data-sidecar-color", color);
    else card.removeAttribute("data-sidecar-color");
    if (pick) card.setAttribute("data-sidecar-pick", pick);
    else card.removeAttribute("data-sidecar-pick");
    if (rating > 0) card.setAttribute("data-sidecar-rating", String(rating));
    else card.removeAttribute("data-sidecar-rating");
    const thumb = card.querySelector(".sidecar-thumb");
    if (thumb) {
      let stars = thumb.querySelector(".sidecar-stars");
      const starsHtml = ratingStars(item);
      if (starsHtml) {
        if (!stars) {
          thumb.insertAdjacentHTML("beforeend", starsHtml);
        } else {
          stars.outerHTML = starsHtml;
        }
      } else {
        stars?.remove();
      }
    }
    const badges = card?.querySelector(".sidecar-badges");
    if (badges) badges.innerHTML = sidecarBadges(item);
  };

  const chip = (label, action, value, active = false) => `
    <button class="sidecar-chip" type="button" data-sidecar-action="${escapeHtml(action)}" data-sidecar-value="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>
  `;

  const renderDetail = () => {
    const item = selectedItem();
    if (!detail) return;
    if (!item) {
      detail.innerHTML = `<p class="empty-basket">Select a photo to edit.</p>`;
      return;
    }
    const sidecar = item.sidecarState || {};
    const keywords = Array.isArray(sidecar.keywords) ? sidecar.keywords.join(", ") : "";
    const titleInputId = `sidecar-title-${state.selectedIndex}`;
    const keywordsInputId = `sidecar-keywords-${state.selectedIndex}`;
    detail.innerHTML = `
      <div class="sidecar-detail-preview">
        <img data-sidecar-preview src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(item.filename || itemId(item))}"/>
        ${previewFallbackMarkup}
      </div>
      <div>
        <strong>${escapeHtml(item.filename || itemId(item))}</strong>
        <p class="owner-card-note">${escapeHtml(formatDate(item.creationDate))} · ${escapeHtml(item.mediaType || "photo")} · ${escapeHtml(itemId(item))}</p>
      </div>
      <div class="sidecar-decision-row" aria-label="Rating">
        ${[1, 2, 3, 4, 5].map((value) => chip(`${value}`, "rating", String(value), Number(sidecar.rating || 0) === value)).join("")}
        ${chip("0", "rating", "0", Number(sidecar.rating || 0) === 0)}
      </div>
      <div class="sidecar-decision-row" aria-label="Color">
        ${["red", "yellow", "green", "blue", "purple"].map((value) => chip(value, "color", value, sidecar.color === value)).join("")}
        ${chip("clear", "color", "", !sidecar.color)}
      </div>
      <div class="sidecar-button-row">
        ${chip("Pick", "pick", "", sidecar.pickState === "picked")}
        ${chip("Unpick", "unpick", "", sidecar.pickState === "undecided")}
        ${chip("Reject", "reject", "", sidecar.pickState === "rejected")}
        ${chip("Hide", "hide", "", sidecar.pickState === "hidden")}
        ${chip("Approve", "approve", "", sidecar.metadataState === "approved")}
        ${chip("AI rework", "metadata-rework", "", sidecar.metadataState === "rework")}
      </div>
      <form class="sidecar-edit-form" data-sidecar-metadata-form>
        <div class="sidecar-edit-field">
          <div class="sidecar-field-heading">
            <label for="${titleInputId}">Title</label>
            <button class="sidecar-propagate-field" type="button" data-sidecar-propagate-field="title" aria-label="Propagate title down" title="Propagate this title to current and following rows in the same two-hour shoot window">↓</button>
          </div>
          <input id="${titleInputId}" type="text" name="title" value="${escapeHtml(sidecar.title || "")}" placeholder="Title for Photos and future catalog"/>
        </div>
        <div class="sidecar-edit-field">
          <div class="sidecar-field-heading">
            <label for="${keywordsInputId}">Keywords</label>
            <button class="sidecar-propagate-field" type="button" data-sidecar-propagate-field="keywords" aria-label="Propagate keywords down" title="Propagate these keywords to current and following rows in the same two-hour shoot window">↓</button>
          </div>
          <textarea id="${keywordsInputId}" name="keywords" placeholder="Comma-separated descriptive keywords">${escapeHtml(keywords)}</textarea>
        </div>
        <div class="sidecar-metadata-actions">
          <button class="btn secondary" type="submit">Stage metadata</button>
          <button class="btn secondary" type="button" data-sidecar-propagate-field="metadata">Propagate metadata</button>
        </div>
      </form>
    `;
    wirePreviewFallbacks(detail);
  };

  const selectIndex = (index) => {
    if (!state.items.length) {
      state.selectedIndex = -1;
      renderGrid();
      renderDetail();
      return;
    }
    const previousIndex = state.selectedIndex;
    state.selectedIndex = Math.max(0, Math.min(index, state.items.length - 1));
    if (state.selectedIndex === previousIndex) return;
    updateGridSelection(previousIndex);
    renderDetail();
    cardForIndex(state.selectedIndex)?.scrollIntoView({ block: "nearest" });
  };

  const mergeChangedItem = (assetId, nextState, pendingCount = 1) => {
    const index = state.items.findIndex((item) => itemId(item) === assetId);
    if (index < 0) return -1;
    const item = state.items[index];
    item.sidecarState = { ...(item.sidecarState || {}), ...nextState };
    item.pendingSyncCount = Math.max(Number(item.pendingSyncCount || 0), pendingCount);
    return index;
  };

  const postDecision = async (payload, { advance = true } = {}) => {
    const item = selectedItem();
    if (!item) return;
    const assetId = itemId(item);
    setStatus(`Staging ${payload.action} locally...`);
    const response = await fetch("/__sidecar/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not stage Sidecar decision.");
    const changedIndex = mergeChangedItem(assetId, result.state || {}, result.changedFamilies?.length || 1);
    state.summary = result.summary || state.summary;
    renderCounts();
    updateCardVisualState(changedIndex);
    if (advance) selectIndex(state.selectedIndex + 1);
    else {
      updateGridSelection(state.selectedIndex);
      renderDetail();
    }
    setStatus(`Staged ${payload.action}. Photos write-back is pending commit.`);
  };

  const postDecisions = async (decisions, message) => {
    if (!decisions.length) return;
    setStatus(message || `Staging ${decisions.length.toLocaleString()} local decisions...`);
    const response = await fetch("/__sidecar/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not stage Sidecar decisions.");
    (result.items || []).forEach((item) => {
      const changedIndex = mergeChangedItem(item.assetId, item.state || {}, item.changedFamilies?.length || 1);
      updateCardVisualState(changedIndex);
    });
    state.summary = result.summary || state.summary;
    renderCounts();
    renderDetail();
    setStatus(`Propagated metadata to ${Number(result.count || 0).toLocaleString()} same-shoot assets. Photos write-back is pending commit.`);
  };

  const propagateMetadataField = async (field) => {
    const source = selectedItem();
    if (!source) return;
    const sourceValues = metadataFormValues();
    const targets = sameShootIndexes();
    const decisions = targets.map((index) => {
      const target = state.items[index];
      const sidecar = target.sidecarState || {};
      const isSource = index === state.selectedIndex;
      const existingTitle = isSource ? sourceValues.title : String(sidecar.title || "");
      const existingKeywords = isSource
        ? sourceValues.keywords
        : (Array.isArray(sidecar.keywords) ? sidecar.keywords : []);
      return {
        assetId: itemId(target),
        action: "metadata",
        title: field === "keywords" ? existingTitle : sourceValues.title,
        keywords: field === "title" ? existingKeywords : sourceValues.keywords,
        metadataState: "proposed",
      };
    });
    const label = field === "metadata" ? "title and keywords" : field;
    await postDecisions(decisions, `Propagating ${label} locally...`);
  };

  const loadSlice = async () => {
    const params = new URLSearchParams();
    const limit = $("[data-sidecar-limit]")?.value || "96";
    const offset = $("[data-sidecar-offset]")?.value || "0";
    const dateFrom = $("[data-sidecar-date-from]")?.value || "";
    const dateTo = $("[data-sidecar-date-to]")?.value || "";
    params.set("limit", limit);
    params.set("offset", offset);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    setStatus("Loading Apple Photos library slice...");
    const response = await fetch(`/__sidecar/library?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load library slice.");
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.selectedIndex = state.items.length ? 0 : -1;
    state.summary = payload.sidecarSummary || state.summary;
    renderCounts();
    renderGrid();
    renderDetail();
    setStatus(`Loaded ${state.items.length.toLocaleString()} assets from Apple Photos. Decisions are local until commit.`);
  };

  const loadSummary = async () => {
    const response = await fetch("/__sidecar/summary");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar summary.");
    state.summary = payload;
    renderCounts();
    setStatus(`${Number(payload.pendingSyncCount || 0).toLocaleString()} pending Photos write-back changes.`);
  };

  const renderPlan = (title, eyebrow, payload) => {
    if (!planPanel || !planOutput) return;
    planPanel.hidden = false;
    if (planTitle) planTitle.textContent = title;
    if (planEyebrow) planEyebrow.textContent = eyebrow;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const message = payload.message ? `<p>${escapeHtml(payload.message)}</p>` : "";
    planOutput.innerHTML = `
      <p><strong>${items.length.toLocaleString()}</strong> row${items.length === 1 ? "" : "s"}.</p>
      ${message}
      <div class="sidecar-plan-list">
        ${items.slice(0, 80).map((item) => `
          <div class="sidecar-plan-row">
            <strong>${escapeHtml(item.filename || item.assetId || item.syncId || "")}</strong>
            <small>${escapeHtml(item.fieldFamily || item.eligibleReason || "")}</small>
            <small>${escapeHtml(item.capturedAt || item.createdAt || "")}</small>
          </div>
        `).join("") || "<p>No rows.</p>"}
      </div>
    `;
  };

  const loadPlan = async (kind) => {
    const endpoint = kind === "upload" ? "/__sidecar/upload-plan" : "/__sidecar/commit-plan";
    const response = await fetch(endpoint);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar plan.");
    renderPlan(kind === "upload" ? "Next Upload Eligibility" : "Pending Photos Write-Back", kind === "upload" ? "Upload plan" : "Commit plan", payload);
    setStatus(kind === "upload" ? "Upload plan refreshed." : "Photos commit plan refreshed.");
  };

  const handleShortcut = async (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const key = event.key;
    try {
      if (/^[1-5]$/.test(key)) {
        event.preventDefault();
        await postDecision({ action: "rating", rating: Number(key) });
      } else if (key === "0") {
        event.preventDefault();
        await postDecision({ action: "rating", rating: 0 });
      } else if (colorShortcuts[key]) {
        event.preventDefault();
        await postDecision({ action: "color", color: colorShortcuts[key] }, { advance: false });
      } else if (key === "p" || key === "P") {
        event.preventDefault();
        await postDecision({ action: "pick" });
      } else if (key === "a" || key === "A") {
        event.preventDefault();
        await postDecision({ action: "approve" });
      } else if (key === "x" || key === "X") {
        event.preventDefault();
        await postDecision({ action: "reject" });
      } else if (key === "h" || key === "H") {
        event.preventDefault();
        await postDecision({ action: "hide" });
      } else if (key === "u" || key === "U") {
        event.preventDefault();
        await postDecision({ action: "unpick" });
      } else if (key === "ArrowRight" || key === "ArrowDown") {
        event.preventDefault();
        selectIndex(state.selectedIndex + 1);
      } else if (key === "ArrowLeft" || key === "ArrowUp") {
        event.preventDefault();
        selectIndex(state.selectedIndex - 1);
      }
    } catch (error) {
      setStatus(error.message || "Sidecar shortcut failed.");
    }
  };

  grid?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-sidecar-index]");
    if (!card) return;
    selectIndex(Number(card.dataset.sidecarIndex || 0));
  });

  detail?.addEventListener("click", async (event) => {
    const propagateButton = event.target.closest("[data-sidecar-propagate-field]");
    if (propagateButton) {
      try {
        await propagateMetadataField(propagateButton.dataset.sidecarPropagateField || "");
      } catch (error) {
        setStatus(error.message || "Could not propagate metadata.");
      }
      return;
    }
    const button = event.target.closest("[data-sidecar-action]");
    if (!button) return;
    try {
      const action = button.dataset.sidecarAction;
      const value = button.dataset.sidecarValue || "";
      if (action === "rating") await postDecision({ action, rating: Number(value) }, { advance: false });
      else if (action === "color") await postDecision({ action, color: value }, { advance: false });
      else await postDecision({ action }, { advance: action !== "metadata-rework" });
    } catch (error) {
      setStatus(error.message || "Could not stage decision.");
    }
  });

  detail?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-sidecar-metadata-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    try {
      await postDecision({
        action: "metadata",
        title: data.get("title") || "",
        keywords: parseKeywords(data.get("keywords") || ""),
        metadataState: "proposed",
      }, { advance: false });
    } catch (error) {
      setStatus(error.message || "Could not stage metadata.");
    }
  });

  $("[data-sidecar-load]")?.addEventListener("click", () => loadSlice().catch((error) => setStatus(error.message)));
  $("[data-sidecar-summary]")?.addEventListener("click", () => loadSummary().catch((error) => setStatus(error.message)));
  $("[data-sidecar-upload-plan]")?.addEventListener("click", () => loadPlan("upload").catch((error) => setStatus(error.message)));
  $("[data-sidecar-commit-plan]")?.addEventListener("click", () => loadPlan("commit").catch((error) => setStatus(error.message)));
  document.addEventListener("keydown", handleShortcut);

  fetch("/__sidecar/version")
    .then((response) => response.json())
    .then((payload) => {
      if (versionRoot) versionRoot.textContent = `v${payload.version || "121.4"}`;
    })
    .catch(() => {
      if (versionRoot) versionRoot.textContent = "v121.4";
    });
  loadSummary().catch(() => {});
})();
