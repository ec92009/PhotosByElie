(() => {
  const version = new URL(document.currentScript?.src || window.location.href, window.location.href).searchParams.get("v") || "74.8";
  const params = new URLSearchParams(window.location.search);
  const view = (params.get("view") || "blocked").toLowerCase();
  const main = document.querySelector("[data-owner-review-main]");
  const nav = document.querySelector("[data-owner-review-nav]");
  const topLink = document.querySelector("[data-owner-review-top-link]");
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;

  const script = (src) => new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = `./${src}?v=${encodeURIComponent(version)}`;
    element.onload = resolve;
    element.onerror = () => reject(new Error(`Could not load ${src}`));
    document.body.append(element);
  });

  const views = {
    blocked: {
      title: "Blocked",
      eyebrow: "Localhost",
      nav: "Blocked",
      bodyGallery: "",
      statusAttr: "data-hidden-status",
      hintClass: "hidden-keyboard-hint",
      hintAttr: "data-hidden-shortcut-hint",
      hint: `
        Owner shortcuts:
        <kbd>P</kbd> promote
        <span aria-hidden="true">|</span>
        <kbd>D</kbd> discard
        <span aria-hidden="true">|</span>
        <kbd>Arrows</kbd> select
        <span aria-hidden="true">|</span>
        <kbd>Enter</kbd> detail
        <span aria-hidden="true">|</span>
        <kbd>Double-click</kbd> detail
      `,
      root: `<section class="panel mock-gallery" data-hidden-root></section>`,
      scripts: ["hidden-store.js", "gallery-card.js", "hidden-page.js"],
    },
    unknown: {
      title: "Unknown",
      eyebrow: "Owner queue",
      nav: "Unknown",
      bodyGallery: "unknown",
      statusAttr: "data-unknown-status",
      hintClass: "unknown-keyboard-hint",
      hintAttr: "data-unknown-shortcut-hint",
      hint: `
        Owner shortcuts:
        <kbd>X</kbd> block
        <span aria-hidden="true">|</span>
        <kbd>U</kbd> undo
        <span aria-hidden="true">|</span>
        <kbd>Arrows</kbd> select
        <span aria-hidden="true">|</span>
        <kbd>Double-click</kbd> preview
      `,
      root: `<section class="panel unknown-classifier" data-unknown-root></section>`,
      scripts: ["unknown-classifier.js"],
    },
    "title-keywords": {
      title: "Title / keywords review",
      eyebrow: "Owner queue",
      nav: "Title/Keywords",
      bodyGallery: "owner-title-keyword-review",
      statusAttr: "data-title-keyword-review-status",
      hintClass: "title-keyword-review-keyboard-hint",
      hintAttr: "",
      hint: `
        Owner shortcuts:
        <kbd>A</kbd> approve
        <span aria-hidden="true">|</span>
        <kbd>R</kbd> reject
        <span aria-hidden="true">|</span>
        <kbd>P</kbd> propagate
        <span aria-hidden="true">|</span>
        <kbd>H</kbd>/<kbd>X</kbd> block
        <span aria-hidden="true">|</span>
        <kbd>Double-click</kbd> detail
      `,
      root: `
        <section class="panel" data-title-keyword-review-locked hidden>
          <p class="empty-basket">This review queue is only available on localhost.</p>
        </section>
        <section class="panel" data-title-keyword-review-summary hidden></section>
        <section class="panel" data-title-keyword-review-root></section>
      `,
      scripts: ["title-keyword-review.js"],
    },
  };

  const config = views[view] || views.blocked;
  const href = `./owner-review.html?view=${encodeURIComponent(views[view] ? view : "blocked")}`;
  if (config.bodyGallery) {
    document.body.dataset.gallery = config.bodyGallery;
  } else {
    document.body.removeAttribute("data-gallery");
  }
  document.title = `Photos By Elie | ${config.title}`;
  if (nav) {
    nav.textContent = config.nav;
    nav.href = versionedHref(href);
  }
  if (topLink) topLink.hidden = view !== "title-keywords";
  if (main) {
    main.innerHTML = `
      <section class="panel gallery-hero owner-hero">
        <p class="eyebrow">${config.eyebrow}</p>
        <h1>${config.title}</h1>
        <p class="gallery-status" ${config.statusAttr} aria-live="polite"></p>
        <div class="cta">
          <a class="btn secondary" href="./owner.html">Owner</a>
          <a class="btn secondary" href="./">Back to collections</a>
        </div>
      </section>
      <p class="keyboard-hint ${config.hintClass}" ${config.hintAttr} ${config.hintAttr ? "hidden" : ""}>${config.hint}</p>
      ${config.root}
    `;
    window.photosByElieVersionInternalLinks?.(main);
  }

  config.scripts.reduce((chain, src) => chain.then(() => script(src)), Promise.resolve())
    .catch((error) => {
      const status = main?.querySelector(".gallery-status");
      if (status) status.textContent = error?.message || "Could not load owner review.";
    });
})();
