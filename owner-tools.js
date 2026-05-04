(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (!enabled) return;

  document.documentElement.classList.add("is-local-owner");

  document.querySelectorAll("[data-owner-tools]").forEach((element) => {
    element.hidden = false;
  });
})();
