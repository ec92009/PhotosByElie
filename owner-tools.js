(() => {
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const hasOwnerRole = (state = {}) => {
    const roles = Array.isArray(state.roles) ? state.roles : [];
    return isLocal || state.admin === true || roles.includes("admin") || roles.includes("owner");
  };

  const showOwnerTools = () => {
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
  };

  if (isLocal) {
    showOwnerTools();
    return;
  }

  const ownerAuth = window.photosByElieOwnerAuth;
  if (!ownerAuth?.enabled) return;
  if (hasOwnerRole(ownerAuth.state)) {
    showOwnerTools();
    return;
  }
  window.addEventListener("photosbyelie:ownerauthchange", (event) => {
    if (hasOwnerRole(event.detail)) showOwnerTools();
  });
  ownerAuth.refresh?.().then((state) => {
    if (hasOwnerRole(state)) showOwnerTools();
  }).catch(() => {});
})();
