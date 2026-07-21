(() => {
  const version = new URL(document.currentScript?.src || window.location.href, window.location.href).searchParams.get("v") || "74.9";
  const params = new URLSearchParams(window.location.search);
  const defaultView = "title-keywords";
  const requestedView = (params.get("view") || defaultView).toLowerCase();
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
      title: "Waste Basket",
      eyebrow: "Localhost",
      nav: "Waste Basket",
      bodyGallery: "",
      statusAttr: "data-hidden-status",
      hintClass: "hidden-keyboard-hint",
      hintAttr: "data-hidden-shortcut-hint",
      hint: `
        Owner shortcuts:
        <kbd>P</kbd> put back
        <span aria-hidden="true">|</span>
        <kbd>D</kbd> discard
        <span aria-hidden="true">|</span>
        <kbd>Z</kbd> fit / fill
        <span aria-hidden="true">|</span>
        <kbd>Arrows</kbd> move
        <span aria-hidden="true">|</span>
        <kbd>Shift</kbd> + <kbd>Arrows</kbd> select range
        <span aria-hidden="true">|</span>
        <kbd>Enter</kbd> detail
        <span aria-hidden="true">|</span>
        <kbd>Double-click</kbd> detail
      `,
      root: `
        <section class="panel waste-basket-manager" data-waste-basket-manager>
          <div class="waste-basket-manager-summary">
            <strong data-hidden-selection-count>0 selected · 0 in Waste Basket</strong>
            <span>Click selects one. Shift-click or Shift + Arrow selects a range. Command-click toggles.</span>
          </div>
          <div class="waste-basket-manager-actions">
            <button class="btn secondary" type="button" data-hidden-select-all>All visible</button>
            <button class="btn secondary" type="button" data-hidden-clear-selection disabled>Clear</button>
            <button class="btn secondary" type="button" data-hidden-restore-selected disabled>Restore selected</button>
            <button class="btn secondary waste-basket-danger" type="button" data-hidden-discard-selected disabled>Delete selected permanently</button>
            <button class="btn waste-basket-danger" type="button" data-hidden-empty>Empty Waste Basket</button>
          </div>
        </section>
        <section class="panel mock-gallery" data-hidden-root></section>
      `,
      scripts: ["hidden-store.js", "gallery-card.js", "hidden-page.js"],
    },
    unknown: {
      title: "Unassigned",
      eyebrow: "Owner queue",
      nav: "Unassigned",
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
        <kbd>R</kbd> review title/keywords
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
        <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> select
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
    "keyword-blacklist": {
      title: "Keyword blacklist",
      eyebrow: "Metadata",
      nav: "Keyword Blacklist",
      bodyGallery: "",
      statusAttr: "data-owner-keyword-blacklist-page-status",
      hintClass: "title-keyword-review-keyboard-hint",
      hintAttr: "",
      hint: `
        Edit blocked proposal terms. Use comma-separated entry for bulk additions.
      `,
      root: `
        <section class="panel owner-keyword-blacklist-page" data-owner-keyword-blacklist-page>
          <div class="owner-card-titlebar">
            <div>
              <p class="eyebrow">Metadata</p>
              <h2>Keyword blacklist</h2>
            </div>
            <button class="owner-refresh-button" type="button" data-owner-keyword-blacklist-refresh aria-label="Refresh keyword blacklist" title="Refresh keyword blacklist"><span aria-hidden="true">↻</span></button>
          </div>
          <p>Terms blocked from future title and keyword proposals.</p>
          <form class="owner-keyword-blacklist-form" data-owner-keyword-blacklist-page-form>
            <label class="owner-keyword-blacklist-add">
              <span>Add terms</span>
              <input type="text" data-owner-keyword-blacklist-page-input placeholder="Comma-separated terms"/>
            </label>
            <button class="btn secondary" type="submit">Add</button>
          </form>
          <div class="owner-keyword-blacklist-list" data-owner-keyword-blacklist-page-list></div>
          <p class="owner-card-note" data-owner-keyword-blacklist-page-count>Loading blacklist...</p>
        </section>
      `,
      scripts: ["owner-keyword-blacklist.js"],
    },
  };

  const view = views[requestedView] ? requestedView : defaultView;
  const config = views[view] || views[defaultView];
  const href = `./owner-review.html?view=${encodeURIComponent(view)}`;
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
      ${window.photosByEliePageShell.hero({
        eyebrow: config.eyebrow,
        title: config.title,
        statusAttr: config.statusAttr,
        actions: [
          { href: "./owner.html", label: "Owner" },
          { href: "./", label: "Back to collections" },
        ],
      })}
      ${window.photosByEliePageShell.keyboardHint({
        className: config.hintClass,
        attrName: config.hintAttr,
        hidden: Boolean(config.hintAttr),
        html: config.hint,
      })}
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
