(() => {
  const root = document.querySelector(".best-mix-current-home [data-home-discovery]");
  const toggle = root?.querySelector("[data-best-mix-discovery-toggle]");
  const label = root?.querySelector("[data-best-mix-discovery-toggle-label]");
  if (!root || !toggle) return;

  const setExpanded = (expanded) => {
    root.classList.toggle("is-discovery-collapsed", !expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Collapse Find photos" : "Expand Find photos");
    if (label) label.textContent = expanded ? "Hide filters" : "Filters";
  };

  setExpanded(false);
  toggle.addEventListener("click", () => {
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  });
})();
