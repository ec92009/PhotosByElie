(() => {
  const unworthyStore = window.photosByElieUnworthy;
  if (!unworthyStore?.enabled) return;

  document.querySelectorAll("[data-owner-tools]").forEach((element) => {
    element.hidden = false;
  });

  document.querySelectorAll("[data-owner-export]").forEach((button) => {
    button.addEventListener("click", () => {
      const filename = unworthyStore.exportBlacklist();
      button.textContent = filename ? "Blacklist exported" : "Export unavailable";
      window.setTimeout(() => {
        button.textContent = "Export blacklist";
      }, 1800);
    });
  });
})();
