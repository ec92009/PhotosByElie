(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (!enabled) return;

  document.documentElement.classList.add("is-local-owner");

  document.querySelectorAll("[data-owner-tools]").forEach((element) => {
    element.hidden = false;
  });

  const nav = document.querySelector(".version-switch");
  if (!nav || nav.querySelector("[data-owner-tools-nav]")) return;
  const hasOwnerLink = [...nav.querySelectorAll("a")]
    .some((link) => new URL(link.getAttribute("href") || "", window.location.href).pathname.endsWith("/owner.html"));
  if (hasOwnerLink) return;

  const separator = document.createElement("span");
  separator.textContent = "|";
  separator.dataset.ownerToolsNav = "";
  const link = document.createElement("a");
  link.href = "./owner.html";
  link.textContent = "Owner";
  link.dataset.ownerToolsNav = "";
  nav.append(" ", separator, " ", link);
})();
