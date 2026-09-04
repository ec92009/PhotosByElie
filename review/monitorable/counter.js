/* This panel is injected only by the local monitorable-preview server. */
(() => {
  const panel = document.createElement('details');
  panel.className = 'wst-preview-counter';
  panel.innerHTML = `<summary>Preview signals <span data-wst-count>…</span></summary>
    <div class="wst-preview-counter-body"><p>Local preview counts · resets when the server restarts</p>
    <p data-wst-status role="status">Reading counts…</p>
    <dl data-wst-actions></dl></div>`;
  document.querySelector('.wst-preview-banner').append(panel);
  const privacy = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let pending = false;
  async function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    try {
      const response = await fetch('/__wst/stats', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const stats = await response.json();
      panel.querySelector('[data-wst-count]').textContent = `${stats.page_views} views · ${stats.cta_presses} clicks`;
      panel.querySelector('[data-wst-status]').textContent = privacy
        ? 'Your browser privacy setting suppresses this page’s events.'
        : 'Counts received by the local preview server. No production traffic or sales.';
      const list = panel.querySelector('[data-wst-actions]');
      list.replaceChildren();
      for (const [id, count] of Object.entries(stats.ctas)) {
        const term = document.createElement('dt'); term.textContent = id;
        const value = document.createElement('dd'); value.textContent = String(count);
        list.append(term, value);
      }
    } catch {
      panel.querySelector('[data-wst-status]').textContent = 'Counter unavailable. Browsing still works; reconnect to the preview server.';
    } finally { pending = false; }
  }
  refresh();
  setInterval(refresh, 1500);
  panel.addEventListener('toggle', refresh);
})();
