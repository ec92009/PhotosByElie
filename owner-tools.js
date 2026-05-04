(() => {
  const unworthyStore = window.photosByElieUnworthy;
  if (!unworthyStore?.enabled) return;

  document.querySelectorAll("[data-owner-tools]").forEach((element) => {
    element.hidden = false;
  });
})();
