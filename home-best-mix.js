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
  const campaignPreviewFrames = {
    "pinterest-valencia-aquarium-2026-05-16": [
      "./socials/Pinterest/2026-05-15/valencia-aquarium/images-square/01-img-1567-8286aafbcb-square.jpg",
      "./socials/Pinterest/2026-05-15/valencia-aquarium/images-square/02-img-1566-117503577f-square.jpg",
      "./socials/Pinterest/2026-05-15/valencia-aquarium/images-square/04-img-1564-1f9e3891b9-square.jpg",
      "./socials/Pinterest/2026-05-15/valencia-aquarium/images-square/06-img-1562-8b45fdf05c-square.jpg",
      "./socials/Pinterest/2026-05-15/valencia-aquarium/images-square/10-img-1558-97860683e7-square.jpg",
    ],
    "pinterest-invalides-2026-05-14": [
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-154558-03388-a887904b4b_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-160631-03403-51426edaac_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-145248-03337-8deb7b57a5_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-145149-03333-e92838da6f_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-145037-03329-9100ee8314_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-054409-03193-8303575241_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-051024-03188-26c219176a_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-045942-03172-b368612e02_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-044820-03115-d18397db96_900.jpg",
      "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/expo/20220506-041124-03096-fad0dd9f78_900.jpg",
    ],
  };
  let activeSection = "";
  let stackShufflePlayed = false;
  let stackShuffleTimer = 0;

  const removeHomeBasketRail = () => {
    page.querySelectorAll(".basket-rail").forEach((rail) => rail.remove());
    page.querySelector("main.shell")?.classList.remove("has-basket-rail");
  };

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
    stack.classList.remove("has-stack-shuffled");
    window.clearTimeout(stackShuffleTimer);
    window.requestAnimationFrame(() => {
      stack.classList.add("is-stack-shuffling");
      stackShuffleTimer = window.setTimeout(() => {
        cards.forEach((card) => {
          const finalTransform = card.style.getPropertyValue("--stack-final-transform");
          if (finalTransform) card.style.transform = finalTransform;
          card.style.removeProperty("--stack-final-transform");
        });
        stack.classList.remove("is-stack-shuffling");
        stack.classList.add("has-stack-shuffled");
      }, 2600);
    });
  };

  const normalizeDiscoveryStatus = () => {
    const status = discovery?.querySelector("[data-home-discovery-status]");
    if (!status) return;
    const text = status.textContent.trim().replace(/\s+/g, " ");
    if (/^0\s+photos?\s+ready\.?$/i.test(text)) {
      status.textContent = "Ready when you search.";
    }
  };

  const setupDiscoveryStatusText = () => {
    const status = discovery?.querySelector("[data-home-discovery-status]");
    if (!status) return;
    normalizeDiscoveryStatus();
    new MutationObserver(normalizeDiscoveryStatus).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener("photosbyelie:languagechange", () => {
      window.requestAnimationFrame(normalizeDiscoveryStatus);
    });
  };

  const setupFeaturedPreviewCyclers = () => {
    if (reducedMotion) return;

    page.querySelectorAll(".featured-campaign-card").forEach((card) => {
      const image = card.querySelector("img");
      let campaignId = "";
      try {
        campaignId = new URL(card.getAttribute("href") || "", window.location.href)
          .searchParams.get("c") || "";
      } catch {}

      let renderedFrames = [];
      try {
        renderedFrames = JSON.parse(card.dataset.previewFrames || "[]");
      } catch {}
      const frames = Array.isArray(renderedFrames) && renderedFrames.length ? renderedFrames : campaignPreviewFrames[campaignId] || [];
      if (!image || frames.length < 2) return;
      card.dataset.previewFrameCount = String(frames.length);

      frames.forEach((src) => {
        const preload = new Image();
        preload.decoding = "async";
        preload.src = src;
      });

      let frameIndex = 0;
      let intervalId = 0;
      let swapTimeout = 0;
      const cycleMs = 1020;
      const swapMs = 135;

      const setFrame = (nextIndex, { animate = true } = {}) => {
        frameIndex = ((nextIndex % frames.length) + frames.length) % frames.length;
        window.clearTimeout(swapTimeout);

        if (!animate) {
          image.classList.remove("is-preview-swapping");
          image.src = frames[frameIndex];
          image.dataset.previewIndex = String(frameIndex);
          return;
        }

        image.classList.add("is-preview-swapping");
        swapTimeout = window.setTimeout(() => {
          image.src = frames[frameIndex];
          image.dataset.previewIndex = String(frameIndex);
          image.classList.remove("is-preview-swapping");
        }, swapMs);
      };

      const advance = () => setFrame(frameIndex + 1);

      const start = () => {
        if (intervalId) return;
        card.classList.add("is-preview-cycling");
        setFrame(1);
        intervalId = window.setInterval(advance, cycleMs);
      };

      const stop = () => {
        if (!intervalId) return;
        window.clearInterval(intervalId);
        intervalId = 0;
        window.clearTimeout(swapTimeout);
        card.classList.remove("is-preview-cycling");
        setFrame(0, { animate: false });
      };

      card.addEventListener("pointerenter", start);
      card.addEventListener("pointerleave", stop);
      card.addEventListener("mouseenter", start);
      card.addEventListener("mouseleave", stop);
      card.addEventListener("mouseover", start);
      card.addEventListener("mouseout", (event) => {
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        stop();
      });
      card.addEventListener("focusin", start);
      card.addEventListener("focusout", (event) => {
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        stop();
      });
    });
  };

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

  removeHomeBasketRail();
  window.addEventListener("photosbyelie:catalogloaded", removeHomeBasketRail);
  window.addEventListener("photosbyelie:basketchange", removeHomeBasketRail);

  if (stack) {
    shuffleStackOnce();
    const stackObserver = new MutationObserver(() => {
      shuffleStackOnce();
      if (stackShufflePlayed) stackObserver.disconnect();
    });
    stackObserver.observe(stack, { childList: true });
  }

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

  setupDiscoveryStatusText();
  setupFeaturedPreviewCyclers();
  window.addEventListener("photosbyelie:featuredcampaignsrendered", setupFeaturedPreviewCyclers);

  const initialKey = [...sections.entries()]
    .find(([, section]) => `#${section.id}` === window.location.hash)?.[0];
  if (initialKey) {
    setActiveSection(initialKey, { scroll: false });
  } else {
    setActiveSection(sections.has("collections") ? "collections" : "", { scroll: false });
  }
})();
