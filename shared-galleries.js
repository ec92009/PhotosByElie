(() => {
  const config = window.photosByElieMediaConfig || {};
  const workerBase = String(config.authWorkerBaseUrl || config.checkoutWorkerBaseUrl || "").replace(/\/+$/, "");
  const status = document.querySelector("[data-shared-status]");
  const root = document.querySelector("[data-shared-root]");
  const login = document.querySelector("[data-shared-login]");
  const loginLink = document.querySelector("[data-shared-login-link]");
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));

  const showLogin = () => {
    status.textContent = "Sign in to see photos shared privately with you.";
    const url = new URL(`${workerBase}/auth/google/login`);
    url.searchParams.set("returnTo", window.location.href);
    url.searchParams.set("prompt", "select_account");
    loginLink.href = url.href;
    login.hidden = false;
  };

  const render = (payload) => {
    const fixtures = Array.isArray(payload.fixtures) ? payload.fixtures : [];
    status.textContent = fixtures.length
      ? `${payload.user.displayName}, you have ${payload.uniquePhotoCount} unique photos in ${fixtures.length} circles.`
      : "Nothing has been shared with this account yet.";
    root.innerHTML = fixtures.map((fixture) => `
      <section class="shared-fixture" data-fixture-id="${escapeHtml(fixture.id)}">
        <div class="shared-fixture-head">
          <div>
            <p class="eyebrow">${fixture.parentId ? "INNER CIRCLE" : "SHARED CIRCLE"}</p>
            <h2>${escapeHtml(fixture.label)}</h2>
          </div>
          <p>${fixture.photos.length} photos</p>
        </div>
        <div class="shared-photo-grid">
          ${fixture.photos.map((photo) => `
            <figure class="shared-photo">
              <img src="${escapeHtml(photo.previewUrl)}" alt="${escapeHtml(photo.title)}" loading="lazy"/>
              <figcaption>${escapeHtml(photo.title)}</figcaption>
            </figure>
          `).join("")}
        </div>
      </section>
    `).join("") || '<section class="panel shared-empty">No private circles are assigned to this Google account.</section>';
  };

  fetch(`${workerBase}/shared-galleries`, { credentials: "include", cache: "no-store" })
    .then(async (response) => {
      if (response.status === 401) return showLogin();
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Shared galleries could not be loaded.");
      render(payload);
    })
    .catch((error) => {
      status.textContent = error.message;
      showLogin();
    });
})();
