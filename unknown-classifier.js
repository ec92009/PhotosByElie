(() => {
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const root = document.querySelector("[data-unknown-root]");
  const status = document.querySelector("[data-unknown-status]");
  const shortcutHint = document.querySelector("[data-unknown-shortcut-hint]");
  const shouldShowKeyboardHints = () => window.photosByElieInputMode?.shouldShowKeyboardHints?.() ?? true;
  const targetCountries = ["france", "usa", "spain", "mexico", "portugal", "slovakia"];
  let selectedPhotoId = "";
  let lastHiddenPhotoId = "";
  let fullscreenPreview = null;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const countryOptions = (selected = "") => [
    '<option value="">Choose country</option>',
    ...targetCountries.map((key) => {
      const title = window.photosByElieData?.[key]?.title || key;
      return `<option value="${key}" ${key === selected ? "selected" : ""}>${escapeHtml(title)}</option>`;
    }),
  ].join("");

  const captureDay = (photo) => {
    const captured = (photo.metadata || []).find((item) => item.label === "Captured")?.value || "";
    const text = [captured, photo.caption, photo.title, photo.id].filter(Boolean).join(" ");
    const dateMatch = text.match(/\b(\d{4})[:\-](\d{2})[:\-](\d{2})\b/);
    if (dateMatch) return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const compactMatch = text.match(/\b(\d{4})(\d{2})(\d{2})\b/);
    return compactMatch ? `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}` : "";
  };

  const allUnknownPhotos = () => {
    const regular = (window.photosByElieOwnerData?.unknown?.photos || []).map((photo) => ({ ...photo, source: "Expo" }));
    const reserve = (window.photosByElieReserveData?.unknown?.photos || []).map((photo) => ({ ...photo, source: "Reserve" }));
    const byId = new Map();
    regular.concat(reserve).forEach((photo) => {
      if (!byId.has(photo.id)) byId.set(photo.id, photo);
    });
    return [...byId.values()];
  };

  const unknownPhotos = () => {
    const hidden = new Set(hiddenActions?.read?.() || []);
    const assigned = hiddenActions?.readCountryAssignments?.() || {};
    return allUnknownPhotos().filter((photo) => !hidden.has(photo.id) && !assigned[photo.id]);
  };

  const countAssignedUnknown = (assignments) => allUnknownPhotos()
    .filter((photo) => assignments[photo.id])
    .length;

  const sameDayPhotos = (photo) => {
    const day = captureDay(photo);
    if (!day) return [photo];
    return allUnknownPhotos().filter((candidate) => captureDay(candidate) === day);
  };

  const countryTitle = (countryKey) => (
    window.photosByElieData?.[countryKey]?.title
    || window.photosByElieReserveData?.[countryKey]?.title
    || countryKey
  );

  const shiftCaptureDay = (day, offset) => {
    const match = String(day || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + offset);
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
  };

  const knownCountryPhotos = () => {
    const byId = new Map();
    const addCollections = (collections) => {
      targetCountries.forEach((countryKey) => {
        (collections?.[countryKey]?.photos || []).forEach((photo) => {
          if (!photo?.id) return;
          byId.set(`${countryKey}:${photo.id}`, { ...photo, countryKey });
        });
      });
    };
    addCollections(window.photosByElieData);
    addCollections(window.photosByElieReserveData);
    return [...byId.values()];
  };

  const knownCountryDayIndex = () => knownCountryPhotos().reduce((index, photo) => {
    const day = captureDay(photo);
    if (!day) return index;
    if (!index.has(day)) index.set(day, new Map());
    const countryCounts = index.get(day);
    if (!countryCounts.has(photo.countryKey)) countryCounts.set(photo.countryKey, new Set());
    countryCounts.get(photo.countryKey).add(photo.id);
    return index;
  }, new Map());

  const countryDayEntries = (dayIndex, day) => {
    const countryCounts = dayIndex.get(day);
    if (!countryCounts) return [];
    return [...countryCounts.entries()]
      .map(([countryKey, ids]) => ({
        countryKey,
        count: ids.size,
        title: countryTitle(countryKey),
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  };

  const photoCountLabel = (count) => `${count} photo${count === 1 ? "" : "s"}`;

  const formatCountryDayEntries = (entries) => entries
    .map((entry, index) => `${index === 0 ? photoCountLabel(entry.count) : entry.count} in ${entry.title}`)
    .join(", ");

  const shootingDayNear = (dayIndex, day, direction) => {
    if (!day) return "";
    const days = [...dayIndex.keys()].sort();
    if (direction < 0) {
      return days.reverse().find((candidate) => candidate < day) || "";
    }
    return days.find((candidate) => candidate > day) || "";
  };

  const daysBetween = (fromDay, toDay) => {
    const fromMatch = String(fromDay || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const toMatch = String(toDay || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!fromMatch || !toMatch) return 0;
    const fromTime = Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]));
    const toTime = Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]));
    return Math.round((toTime - fromTime) / 86400000);
  };

  const shootingDayLabel = (baseDay, shootingDay, direction) => {
    const distance = Math.abs(daysBetween(baseDay, shootingDay));
    const suffix = distance === 1
      ? (direction < 0 ? "1 day before" : "1 day after")
      : `${distance} days ${direction < 0 ? "before" : "after"}`;
    return `${direction < 0 ? "Previous shoot" : "Next shoot"}, ${suffix}`;
  };

  const adjacentDayHints = (photo, dayIndex) => {
    const day = captureDay(photo);
    if (!day) return [];
    const hints = [];
    const addSide = (dayLabel, exactDay, shootLabel, shootDay) => {
      const exactEntries = countryDayEntries(dayIndex, exactDay);
      if (exactEntries.length) {
        hints.push({
          label: shootDay === exactDay ? `${dayLabel} / ${shootLabel}` : dayLabel,
          day: exactDay,
          entries: exactEntries,
        });
      }
      if (shootDay && shootDay !== exactDay) {
        const shootEntries = countryDayEntries(dayIndex, shootDay);
        if (shootEntries.length) {
          hints.push({
            label: shootingDayLabel(day, shootDay, shootLabel === "previous shoot" ? -1 : 1),
            day: shootDay,
            entries: shootEntries,
          });
        }
      }
    };
    addSide("Day before", shiftCaptureDay(day, -1), "previous shoot", shootingDayNear(dayIndex, day, -1));
    addSide("Day after", shiftCaptureDay(day, 1), "next shoot", shootingDayNear(dayIndex, day, 1));
    return hints;
  };

  const splitKeywordText = (value) => String(value || "")
    .split(/[;,]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  const keywordsFor = (photo) => {
    const keywords = [];
    const add = (value) => {
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      splitKeywordText(value).forEach((keyword) => {
        if (!keywords.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
          keywords.push(keyword);
        }
      });
    };
    add(photo?.keywords);
    add((photo?.metadata || []).find((item) => item.label === "Keywords")?.value);
    add(photo?.selection_metadata?.Subject);
    add(photo?.selection_metadata?.Keywords);
    add(photo?.raw_metadata?.Subject);
    add(photo?.raw_metadata?.Keywords);
    return keywords;
  };

  const rawSourceLabel = (photo) => window.photosByElieRawSourceLabel?.(photo) || "";

  const closeFullscreenPreview = () => {
    fullscreenPreview?.remove();
    fullscreenPreview = null;
    document.body.classList.remove("detail-fullscreen-active");
  };

  const openFullscreenPreview = (photo) => {
    const image = photo?.imageSrc || photo?.gallerySrc || "";
    if (!image || fullscreenPreview) return;
    fullscreenPreview = document.createElement("div");
    fullscreenPreview.className = "detail-fullscreen-preview";
    fullscreenPreview.setAttribute("role", "button");
    fullscreenPreview.setAttribute("aria-label", `Close full screen preview for ${photo.title}`);
    fullscreenPreview.tabIndex = 0;
    const fullscreenImage = document.createElement("img");
    fullscreenImage.src = image;
    fullscreenImage.alt = photo.title;
    fullscreenPreview.append(fullscreenImage);
    fullscreenPreview.addEventListener("click", closeFullscreenPreview);
    fullscreenPreview.addEventListener("dblclick", closeFullscreenPreview);
    fullscreenPreview.addEventListener("keydown", (event) => {
      if (!["Escape", "Enter", " "].includes(event.key)) return;
      closeFullscreenPreview();
      event.preventDefault();
    });
    document.body.append(fullscreenPreview);
    document.body.classList.add("detail-fullscreen-active");
    fullscreenPreview.focus({ preventScroll: true });
  };

  const updateSelection = () => {
    const cards = [...root.querySelectorAll("[data-photo-id]")];
    if (!cards.length) {
      selectedPhotoId = "";
      return;
    }
    if (!selectedPhotoId || !cards.some((card) => card.dataset.photoId === selectedPhotoId)) {
      selectedPhotoId = cards[0].dataset.photoId || "";
    }
    cards.forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.photoId === selectedPhotoId);
    });
    cards.find((card) => card.dataset.photoId === selectedPhotoId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const moveSelection = (delta) => {
    const cards = [...root.querySelectorAll("[data-photo-id]")];
    if (!cards.length) return;
    const currentIndex = Math.max(0, cards.findIndex((card) => card.dataset.photoId === selectedPhotoId));
    const nextIndex = (currentIndex + delta + cards.length) % cards.length;
    selectedPhotoId = cards[nextIndex].dataset.photoId || "";
    updateSelection();
  };

  const shouldIgnoreShortcut = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
  };

  const shouldIgnoreUnknownActionShortcut = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName);
  };

  const render = () => {
    if (!root) return;
    if (shortcutHint) shortcutHint.hidden = !hiddenActions?.enabled || !shouldShowKeyboardHints();
    if (!hiddenActions?.enabled) {
      root.innerHTML = `
        <article class="owner-card">
          <p class="eyebrow">Locked</p>
          <h2>Owner controls are only available on localhost.</h2>
        </article>
      `;
      setStatus("Unknown classification is locked on the public site.");
      return;
    }

    const assignments = hiddenActions.readCountryAssignments?.() || {};
    const allPhotos = allUnknownPhotos();
    const dayCounts = allPhotos.reduce((counts, photo) => {
      const day = captureDay(photo);
      if (day) counts.set(day, (counts.get(day) || 0) + 1);
      return counts;
    }, new Map());
    const countryDayIndex = knownCountryDayIndex();
    const photos = unknownPhotos();
    if (!photos.length) {
      root.innerHTML = `
        <article class="owner-card">
          <p class="eyebrow">Clear</p>
          <h2>No unassigned unknown photos are currently loaded.</h2>
        </article>
      `;
      setStatus("Unknown queue is empty.");
      return;
    }

    root.innerHTML = photos.map((photo) => {
      const image = photo.gallerySrc || photo.imageSrc || "";
      const rawLabel = rawSourceLabel(photo);
      const assigned = assignments[photo.id] || "";
      const capture = (photo.metadata || []).find((item) => item.label === "Captured")?.value || "";
      const dayCount = dayCounts.get(captureDay(photo)) || 1;
      const dayHints = adjacentDayHints(photo, countryDayIndex);
      const keywords = keywordsFor(photo);
      return `
        <article class="unknown-card ${rawLabel ? "has-raw-source" : ""}" data-photo-id="${escapeHtml(photo.id)}">
          <div class="unknown-thumb ${image ? "has-image" : ""}">
            ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(photo.title)}"/>` : ""}
            ${rawLabel ? `<span class="raw-source-badge" title="${escapeHtml(rawLabel)} source">RAW</span>` : ""}
          </div>
          <div class="unknown-card-body">
            <p class="eyebrow">${escapeHtml(photo.source)}</p>
            <h2>${escapeHtml(photo.title)}</h2>
            <p>${escapeHtml(capture || photo.caption || photo.id)}</p>
            <dl class="unknown-metadata">
              <div>
                <dt>Title</dt>
                <dd>${escapeHtml(photo.title || photo.id)}</dd>
              </div>
              <div>
                <dt>Keywords</dt>
                <dd>${keywords.length ? keywords.map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("") : '<em>None</em>'}</dd>
              </div>
            </dl>
            ${dayCount > 1 ? `<p>${dayCount} photos from the same day</p>` : ""}
            ${dayHints.length ? `
              <div class="unknown-day-context">
                ${dayHints.map((hint) => `
                  <p><strong>${escapeHtml(hint.label)}:</strong> ${escapeHtml(formatCountryDayEntries(hint.entries))}</p>
                `).join("")}
              </div>
            ` : ""}
            <label class="owner-number-control">
              <span>Country</span>
              <select data-country-assignment>
                ${countryOptions(assigned)}
              </select>
            </label>
          </div>
        </article>
      `;
    }).join("");

    root.querySelectorAll("[data-photo-id]").forEach((card) => {
      card.addEventListener("click", () => {
        selectedPhotoId = card.dataset.photoId || "";
        updateSelection();
      });
      card.querySelector(".unknown-thumb.has-image")?.addEventListener("dblclick", (event) => {
        const photo = unknownPhotos().find((item) => item.id === card.dataset.photoId);
        if (!photo) return;
        selectedPhotoId = photo.id;
        updateSelection();
        openFullscreenPreview(photo);
        event.preventDefault();
        event.stopPropagation();
      });
    });

    root.querySelectorAll("[data-country-assignment]").forEach((select) => {
      select.addEventListener("change", async () => {
        const card = select.closest("[data-photo-id]");
        const photoId = card?.dataset.photoId;
        const photo = allUnknownPhotos().find((item) => item.id === photoId);
        const affectedPhotos = photo ? sameDayPhotos(photo) : [];
        const affectedIds = affectedPhotos.map((item) => item.id);
        const targetCountry = select.value;
        const affectedCount = affectedPhotos.length || 1;
        select.disabled = true;
        if (!targetCountry) {
          const assignmentsNow = hiddenActions.setCountryAssignments?.(affectedIds, "") || {};
          const assignedCount = countAssignedUnknown(assignmentsNow);
          selectedPhotoId = photoId || selectedPhotoId;
          render();
          setStatus(`${affectedCount} same-day photo${affectedCount === 1 ? "" : "s"} returned to the Unknown queue; ${assignedCount} current Unknown assignment${assignedCount === 1 ? "" : "s"}.`);
          return;
        }
        let result = null;
        try {
          result = await hiddenActions.assignUnknownsToCountry?.(affectedIds, targetCountry);
        } catch (error) {
          select.disabled = false;
          setStatus(error?.message || "Could not assign unknown photos.");
          return;
        }
        selectedPhotoId = photoId || selectedPhotoId;
        render();
        const movedCount = result?.moved?.length ?? affectedCount;
        const skippedCount = result?.skipped?.length || 0;
        setStatus(`${movedCount} same-day photo${movedCount === 1 ? "" : "s"} moved to Reserve / ${countryTitle(targetCountry)}${skippedCount ? `; ${skippedCount} already assigned` : ""}. Hints refreshed.`);
      });
    });

    const assignedCount = countAssignedUnknown(assignments);
    updateSelection();
    setStatus(`${photos.length} unassigned unknown photo${photos.length === 1 ? "" : "s"} visible; ${assignedCount} current Unknown assignment${assignedCount === 1 ? "" : "s"}.`);
  };

  window.addEventListener("keydown", async (event) => {
    if (!hiddenActions?.enabled) return;
    const key = event.key.toLowerCase();
    const hOrU = key === "h" || key === "u";
    if (hOrU && shouldIgnoreUnknownActionShortcut(event)) return;
    if (!hOrU && shouldIgnoreShortcut(event)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (key === "h") {
      event.preventDefault();
      const photo = unknownPhotos().find((item) => item.id === selectedPhotoId) || unknownPhotos()[0];
      if (!photo) return;
      lastHiddenPhotoId = photo.id;
      try {
        await hiddenActions.mark(photo.id);
        selectedPhotoId = "";
        render();
        setStatus(`${photo.title} moved from Unknown to Hidden.`);
      } catch (error) {
        setStatus(error?.message || "Could not move unknown photo to Hidden.");
      }
      return;
    }
    if (key !== "u") return;
    event.preventDefault();
    let restoredId = null;
    try {
      restoredId = await hiddenActions.undo(lastHiddenPhotoId);
    } catch (error) {
      setStatus(error?.message || "Could not undo the hide.");
      return;
    }
    if (restoredId) selectedPhotoId = restoredId;
    render();
    setStatus(restoredId ? "Last hidden unknown photo moved back." : "No hidden unknown photo to undo.");
  });

  window.addEventListener("photosbyelie:hiddenchange", () => {
    render();
  });
  window.addEventListener("photosbyelie:inputmodechange", render);

  reserveStore?.load?.().then(render);
  render();
})();
