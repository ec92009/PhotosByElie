(() => {
  const ownerAuth = window.photosByElieOwnerAuth;
  const hiddenActions = window.photosByElieHiddenActions;
  const form = document.querySelector("[data-owner-keyword-blacklist-page-form]");
  const input = document.querySelector("[data-owner-keyword-blacklist-page-input]");
  const list = document.querySelector("[data-owner-keyword-blacklist-page-list]");
  const count = document.querySelector("[data-owner-keyword-blacklist-page-count]");
  const status = document.querySelector("[data-owner-keyword-blacklist-page-status]");
  const refresh = document.querySelector("[data-owner-keyword-blacklist-refresh]");
  let terms = [];

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setCount = (message) => {
    if (count) count.textContent = message;
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const normalizeTerms = (values = []) => {
    const seen = new Set();
    return values
      .flatMap((value) => String(value || "").split(/[\n,]/))
      .map((value) => value.trim())
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const render = (nextTerms = terms) => {
    terms = normalizeTerms(nextTerms);
    if (!list) return;
    if (!terms.length) {
      list.innerHTML = '<p class="owner-card-note">No terms are blacklisted.</p>';
      setCount("0 terms.");
      return;
    }
    list.innerHTML = terms.map((term) => `
      <span class="owner-keyword-blacklist-term">
        <span>${escapeHtml(term)}</span>
        <button type="button" data-owner-keyword-blacklist-remove="${escapeHtml(term)}" aria-label="Remove ${escapeHtml(term)}">×</button>
      </span>
    `).join("");
    setCount(`${terms.length.toLocaleString()} terms.`);
  };

  const save = async (nextTerms) => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to save the keyword blacklist.");
    if (ownerAuth?.enabled && !authorized) throw new Error("Owner helper server required.");
    setStatus("Saving keyword blacklist...");
    const payload = hiddenActions?.saveKeywordBlacklist
      ? await hiddenActions.saveKeywordBlacklist(normalizeTerms(nextTerms))
      : null;
    if (!payload?.ok) throw new Error(payload?.error || "Could not save keyword blacklist.");
    render(payload.keywords || []);
    setStatus(`Keyword blacklist saved: ${(payload.keyword_count || terms.length).toLocaleString()} terms.`);
  };

  const load = async () => {
    setStatus("Loading keyword blacklist...");
    setCount("Loading blacklist...");
    try {
      const href = window.photosByElieVersionedHref?.("./assets/owner-actions/keyword-blacklist.json") || "./assets/owner-actions/keyword-blacklist.json";
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) throw new Error(`Keyword blacklist ${response.status}`);
      const payload = await response.json();
      render(payload.keywords || []);
      setStatus("Keyword blacklist loaded.");
    } catch (error) {
      render([]);
      setStatus(error?.message || "Could not load keyword blacklist.");
    }
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const additions = normalizeTerms([input?.value || ""]);
    if (!additions.length) {
      setStatus("Enter a term to add.");
      return;
    }
    try {
      await save([...terms, ...additions]);
      if (input) input.value = "";
    } catch (error) {
      setStatus(error?.message || "Could not save keyword blacklist.");
    }
  });

  list?.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-owner-keyword-blacklist-remove]");
    if (!button) return;
    const term = button.dataset.ownerKeywordBlacklistRemove || "";
    try {
      await save(terms.filter((value) => value !== term));
    } catch (error) {
      setStatus(error?.message || "Could not save keyword blacklist.");
    }
  });

  refresh?.addEventListener("click", load);
  load();
})();
