(() => {
  const unworthyStore = window.photosByElieUnworthy;
  const reserveStore = window.photosByElieReserve;
  const root = document.querySelector("[data-unknown-root]");
  const status = document.querySelector("[data-unknown-status]");
  const targetCountries = ["france", "usa", "spain", "mexico", "portugal", "slovakia"];

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

  const unknownPhotos = () => {
    const regular = (window.photosByElieOwnerData?.unknown?.photos || []).map((photo) => ({ ...photo, source: "Regular" }));
    const reserve = (window.photosByElieReserveData?.unknown?.photos || []).map((photo) => ({ ...photo, source: "Reserve" }));
    const byId = new Map();
    regular.concat(reserve).forEach((photo) => {
      if (!byId.has(photo.id)) byId.set(photo.id, photo);
    });
    return [...byId.values()];
  };

  const render = () => {
    if (!root) return;
    if (!unworthyStore?.enabled) {
      root.innerHTML = `
        <article class="owner-card">
          <p class="eyebrow">Locked</p>
          <h2>Owner controls are only available on localhost.</h2>
        </article>
      `;
      setStatus("Unknown classification is locked on the public site.");
      return;
    }

    const assignments = unworthyStore.readCountryAssignments?.() || {};
    const photos = unknownPhotos();
    if (!photos.length) {
      root.innerHTML = `
        <article class="owner-card">
          <p class="eyebrow">Clear</p>
          <h2>No unknown photos are currently loaded.</h2>
        </article>
      `;
      setStatus("Unknown queue is empty.");
      return;
    }

    root.innerHTML = photos.map((photo) => {
      const image = photo.gallerySrc || photo.imageSrc || "";
      const assigned = assignments[photo.id] || "";
      const capture = (photo.metadata || []).find((item) => item.label === "Captured")?.value || "";
      return `
        <article class="unknown-card" data-photo-id="${escapeHtml(photo.id)}">
          <div class="unknown-thumb ${image ? "has-image" : ""}">
            ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(photo.title)}"/>` : ""}
          </div>
          <div class="unknown-card-body">
            <p class="eyebrow">${escapeHtml(photo.source)}</p>
            <h2>${escapeHtml(photo.title)}</h2>
            <p>${escapeHtml(capture || photo.caption || photo.id)}</p>
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

    root.querySelectorAll("[data-country-assignment]").forEach((select) => {
      select.addEventListener("change", () => {
        const card = select.closest("[data-photo-id]");
        const photoId = card?.dataset.photoId;
        const assignmentsNow = unworthyStore.setCountryAssignment?.(photoId, select.value) || {};
        const assignedCount = Object.keys(assignmentsNow).length;
        setStatus(`${assignedCount} unknown photo${assignedCount === 1 ? "" : "s"} assigned. Export a Curation Pass from Owner to apply them on disk.`);
      });
    });

    const assignedCount = Object.keys(assignments).length;
    setStatus(`${photos.length} unknown photo${photos.length === 1 ? "" : "s"} loaded; ${assignedCount} assigned.`);
  };

  reserveStore?.load?.().then(render);
  render();
})();
