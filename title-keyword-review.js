(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const enabled = localHosts.has(window.location.hostname);

  const status = document.querySelector("[data-title-keyword-review-status]");
  const lockedPanel = document.querySelector("[data-title-keyword-review-locked]");
  const summaryRoot = document.querySelector("[data-title-keyword-review-summary]");
  const root = document.querySelector("[data-title-keyword-review-root]");

  const queueUrl = "./assets/owner-actions/title-keyword-review-queue/latest.json";
  const blacklistUrl = "./assets/owner-actions/keyword-blacklist.json";
  const approvalsEndpoint = "/__photosbyelie/photo-action";

  const escapeHtml = (value) => String(value ?? "")
    .replace(/[&<>'\"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;",
    }[char] || char));

  const uniqueKeywords = (items) => {
    const seen = new Set();
    const next = [];
    for (const item of items || []) {
      const value = String(item || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(value);
    }
    return next;
  };

  const splitKeywordText = (raw) => String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const downloadJson = (filename, payload) => {
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;

  const loadJson = async (url) => {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(`Could not load ${url}`);
    }
    return payload;
  };

  const keywordBlacklistSet = (payload) => {
    const keywords = payload?.keywords;
    if (!Array.isArray(keywords)) return new Set();
    return new Set(keywords.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  };

  const normalizeKeywords = (raw, blacklist) => uniqueKeywords(splitKeywordText(raw))
    .filter((keyword) => !blacklist.has(keyword.toLowerCase()));

  const publicMediaUrl = (key) => {
    const base = String(window.photosByEliePublicMediaBase || "").replace(/\/+$/, "");
    const cleanKey = String(key || "").replace(/^\/+/, "");
    return base && cleanKey ? `${base}/${cleanKey}` : "";
  };

  const reviewThumbUrl = (item) => {
    const key = item?.thumbs?.gallery_key || item?.thumbs?.galleryKey || item?.thumbs?.detail_key || item?.thumbs?.detailKey;
    return publicMediaUrl(key)
      || String(item?.thumbs?.gallery || item?.thumbs?.gallery_src || item?.thumb?.gallery || item?.gallerySrc || "");
  };

  const render = async () => {
    if (!enabled) {
      lockedPanel.hidden = false;
      summaryRoot.hidden = true;
      root.replaceChildren();
      if (status) status.textContent = "localhost-only";
      return;
    }

    status.textContent = "Loading queue…";
    lockedPanel.hidden = true;
    summaryRoot.hidden = true;

    const [queue, blacklistPayload] = await Promise.all([
      loadJson(queueUrl),
      loadJson(blacklistUrl).catch(() => ({ keywords: [] })),
    ]);

    const batchId = String(queue?.batch_id || queue?.batchId || "").trim();
    const photos = Array.isArray(queue?.photos) ? queue.photos : [];
    const blacklist = keywordBlacklistSet(blacklistPayload);

    if (!batchId || !photos.length) {
      status.textContent = "Queue is empty.";
      summaryRoot.hidden = true;
      root.replaceChildren();
      return;
    }

    const newest = queue?.range?.newest || "";
    const oldest = queue?.range?.oldest || "";
    status.textContent = `${photos.length} photos ready for review.`;

    summaryRoot.hidden = false;
    summaryRoot.innerHTML = `
      <h2>Batch ${escapeHtml(batchId)}</h2>
      <p class="gallery-status">Newest: ${escapeHtml(newest || "—")} • Oldest: ${escapeHtml(oldest || "—")}</p>
      <div class="cta">
        <button class="btn secondary" type="button" data-title-keyword-review-save>Save approvals</button>
        <button class="btn secondary" type="button" data-title-keyword-review-download>Download approvals JSON</button>
        <a class="btn secondary" href="${escapeHtml(queueUrl)}" target="_blank" rel="noreferrer">Open proposal file</a>
      </div>
      <p class="gallery-status">Review each photo, edit the proposed title or keywords if needed, then approve the row.</p>
    `;

    root.replaceChildren();
    const list = document.createElement("div");
    list.className = "title-keyword-review-list";
    root.append(list);

    const cardById = new Map();

    list.innerHTML = photos.map((item) => {
      const photoId = String(item?.photo_id || item?.photoId || "");
      const title = String(item?.current?.title || "");
      const capture = String(item?.capture?.raw || item?.capture?.date || "");
      const galleryLabel = String(item?.gallery?.label || item?.gallery_label || item?.gallery_key || "");
      const thumb = reviewThumbUrl(item);
      const currentKeywords = Array.isArray(item?.current?.keywords) ? item.current.keywords.join(", ") : String(item?.current?.keywords_raw || "");
      const proposedTitle = String(item?.proposed?.title || title || "");
      const proposedKeywords = Array.isArray(item?.proposed?.keywords) ? item.proposed.keywords.join(", ") : currentKeywords;
      const href = versionedHref(`./photo.html?id=${encodeURIComponent(photoId)}`);
      return `
        <article class="title-keyword-review-row" data-review-photo-id="${escapeHtml(photoId)}">
          <a class="title-keyword-review-preview ${thumb ? "has-image" : "is-missing-preview"}" href="${escapeHtml(href)}" aria-label="Open photo ${escapeHtml(photoId)}">
            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(title || photoId)}" loading="lazy"/>` : `<span class="unknown-missing-preview">No preview</span>`}
          </a>
          <div class="title-keyword-review-current">
            <p class="eyebrow">${escapeHtml(galleryLabel || "Photo")}${capture ? ` / ${escapeHtml(capture)}` : ""}</p>
            <h2>${escapeHtml(title || photoId)}</h2>
            <p>${escapeHtml(currentKeywords || "No current keywords")}</p>
          </div>
          <form class="title-keyword-review-proposed" data-review-editor>
              <label>
                <span>Proposed title</span>
                <input type="text" value="${escapeHtml(proposedTitle)}" data-review-title/>
              </label>
              <label>
                <span>Proposed keywords</span>
                <textarea rows="3" data-review-keywords>${escapeHtml(proposedKeywords)}</textarea>
              </label>
          </form>
          <label class="title-keyword-review-approve">
            <input type="checkbox" data-review-approve/>
            <span>Approve</span>
          </label>
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-review-photo-id]").forEach((card) => {
      const photoId = card.getAttribute("data-review-photo-id") || "";
      if (!photoId) return;
      cardById.set(photoId, card);
    });

    const buildApprovalsPayload = () => {
      const approvals = [];
      for (const [photoId, card] of cardById.entries()) {
        const approved = Boolean(card.querySelector("[data-review-approve]")?.checked);
        if (!approved) continue;
        const title = String(card.querySelector("[data-review-title]")?.value || "").trim();
        const keywordsRaw = String(card.querySelector("[data-review-keywords]")?.value || "");
        const keywords = normalizeKeywords(keywordsRaw, blacklist);
        approvals.push({ photo_id: photoId, approved: true, title, keywords });
      }
      return {
        action: "save-title-keyword-review-approvals",
        batch_id: batchId,
        approvals,
      };
    };

    const saveApprovals = async () => {
      const payload = buildApprovalsPayload();
      if (!payload.approvals.length) {
        window.alert?.("Select at least one photo to approve.");
        return;
      }
      const ok = await window.photosByElieOwnerAuth?.requireAuth?.("Owner helper unavailable.") ?? true;
      if (!ok) return;
      const response = await fetch(approvalsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Could not save approvals.");
      }
      window.alert?.(`Saved approvals to ${result.path || "assets/owner-actions/title-keyword-review-queue/"}.\n\nCommit the approvals file when ready.`);
    };

    const downloadApprovals = () => {
      const payload = buildApprovalsPayload();
      if (!payload.approvals.length) {
        window.alert?.("Select at least one photo to approve.");
        return;
      }
      downloadJson(`title-keyword-review-approvals-${batchId}.json`, payload);
    };

    summaryRoot.querySelector("[data-title-keyword-review-save]")?.addEventListener("click", () => {
      saveApprovals().catch((error) => {
        window.alert?.(error?.message || "Could not save approvals.");
      });
    });
    summaryRoot.querySelector("[data-title-keyword-review-download]")?.addEventListener("click", downloadApprovals);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => render().catch((error) => {
      if (status) status.textContent = error?.message || "Could not load queue.";
    }), { once: true });
  } else {
    render().catch((error) => {
      if (status) status.textContent = error?.message || "Could not load queue.";
    });
  }
})();
