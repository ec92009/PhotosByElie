(() => {
  const page = document.querySelector(".best-mix-current-home");
  if (!page) return;

  const sections = new Map(
    [...page.querySelectorAll("[data-best-mix-section]")]
      .map((section) => [section.dataset.bestMixSection, section])
  );
  const triggers = [...page.querySelectorAll("[data-best-mix-section-trigger]")];
  const stack = page.querySelector("[data-home-stack]");
  const discovery = page.querySelector("[data-home-discovery]");
  const discoveryToggle = discovery?.querySelector("[data-best-mix-discovery-toggle]");
  const discoveryLabel = discovery?.querySelector("[data-best-mix-discovery-toggle-label]");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  let activeSection = "";
  let stackShufflePlayed = false;

  const shuffleStackOnce = () => {
    if (stackShufflePlayed || reducedMotion || !stack?.children.length) return;
    const cards = [...stack.querySelectorAll("[data-home-stack-card]")];
    if (!cards.length) return;
    stackShufflePlayed = true;
    stack.dataset.stackShufflePlayed = "true";
    cards.forEach((card) => {
      card.style.setProperty("--stack-final-transform", getComputedStyle(card).transform);
    });
    stack.classList.remove("is-stack-shuffling");
    window.requestAnimationFrame(() => {
      stack.classList.add("is-stack-shuffling");
      window.setTimeout(() => stack.classList.remove("is-stack-shuffling"), 3500);
    });
  };

  if (stack) {
    shuffleStackOnce();
    const stackObserver = new MutationObserver(() => {
      shuffleStackOnce();
      if (stackShufflePlayed) stackObserver.disconnect();
    });
    stackObserver.observe(stack, { childList: true });
  }

  const setDiscoveryExpanded = (expanded) => {
    if (!discovery || !discoveryToggle) return;
    discovery.classList.toggle("is-discovery-collapsed", !expanded);
    discoveryToggle.setAttribute("aria-expanded", String(expanded));
    discoveryToggle.setAttribute("aria-label", expanded ? "Collapse Find photos" : "Expand Find photos");
    if (discoveryLabel) discoveryLabel.textContent = expanded ? "Hide filters" : "Filters";
  };

  const setActiveSection = (key, { scroll = true } = {}) => {
    const nextSection = activeSection === key ? "" : key;
    activeSection = nextSection;

    sections.forEach((section, sectionKey) => {
      const expanded = sectionKey === activeSection;
      section.classList.toggle("is-best-mix-section-collapsed", !expanded);
      if (sectionKey === "search") setDiscoveryExpanded(expanded);
    });

    triggers.forEach((trigger) => {
      const expanded = trigger.dataset.bestMixSectionTrigger === activeSection;
      trigger.setAttribute("aria-expanded", String(expanded));
    });

    if (!activeSection) return;
    window.dispatchEvent(new Event("resize"));

    if (scroll) {
      window.requestAnimationFrame(() => {
        sections.get(activeSection)?.scrollIntoView({
          block: "start",
          behavior: reducedMotion ? "auto" : "smooth",
        });
      });
    }
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveSection(trigger.dataset.bestMixSectionTrigger);
    });
  });

  sections.forEach((section, key) => {
    section.tabIndex = 0;
    section.addEventListener("click", (event) => {
      const collapsed = section.classList.contains("is-best-mix-section-collapsed");
      const interactive = event.target.closest("a,button,input,textarea,select,label,[data-spaniel],[data-offers-wrap],[data-offer-item]");
      if (collapsed || !interactive) {
        event.preventDefault();
        setActiveSection(key);
      }
    });
    section.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key) || event.target !== section) return;
      event.preventDefault();
      setActiveSection(key);
    });
  });

  discoveryToggle?.addEventListener("click", () => {
    setDiscoveryExpanded(discoveryToggle.getAttribute("aria-expanded") !== "true");
  });

  const initialKey = [...sections.entries()]
    .find(([, section]) => `#${section.id}` === window.location.hash)?.[0];
  if (initialKey) {
    setActiveSection(initialKey, { scroll: false });
  } else {
    sections.forEach((section, sectionKey) => {
      section.classList.add("is-best-mix-section-collapsed");
      if (sectionKey === "search") setDiscoveryExpanded(false);
    });
  }
})();
