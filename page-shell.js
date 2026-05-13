(() => {
  const attr = (name) => (name ? ` ${name}` : "");

  const hero = ({ eyebrow = "", title = "", statusAttr = "", actions = [] } = {}) => `
    <section class="panel gallery-hero owner-hero">
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
      <h1>${title}</h1>
      <p class="gallery-status"${attr(statusAttr)} aria-live="polite"></p>
      <div class="cta">
        ${actions.map((action) => `<a class="btn secondary" href="${action.href}">${action.label}</a>`).join("")}
      </div>
    </section>
  `;

  const keyboardHint = ({ className = "", attrName = "", hidden = false, html = "" } = {}) => (
    `<p class="keyboard-hint ${className}"${attr(attrName)} ${hidden ? "hidden" : ""}>${html}</p>`
  );

  window.photosByEliePageShell = { hero, keyboardHint };
})();
