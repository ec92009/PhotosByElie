/* Recovery only reloads this URL. It never retries a payment or changes selections. */
(() => {
  const region = document.querySelector('[data-customer-recovery]');
  if (!region) return;
  const main = document.querySelector('main');
  const status = region.querySelector('[role="status"]');
  const retry = region.querySelector('button');
  const collectionLink = region.querySelector('a');
  const copy = {
    en: { loading: 'Loading your photos…', unavailable: 'Photos are unavailable right now. Check your connection and try again. Your saved selections have not been changed.', storage: 'Your browser is blocking saved selections. Allow site storage, then try again to see your basket.', retry: 'Try again', retrying: 'Reloading…', collections: 'Browse collections' },
    fr: { loading: 'Chargement de vos photos…', unavailable: 'Les photos sont indisponibles pour le moment. Vérifiez votre connexion et réessayez. Vos sélections enregistrées n’ont pas été modifiées.', storage: 'Votre navigateur bloque les sélections enregistrées. Autorisez le stockage du site, puis réessayez pour voir votre panier.', retry: 'Réessayer', retrying: 'Rechargement…', collections: 'Parcourir les collections' },
    es: { loading: 'Cargando tus fotos…', unavailable: 'Las fotos no están disponibles ahora. Comprueba tu conexión e inténtalo de nuevo. Tus selecciones guardadas no se han modificado.', storage: 'Tu navegador bloquea las selecciones guardadas. Permite el almacenamiento del sitio e inténtalo de nuevo para ver tu cesta.', retry: 'Reintentar', retrying: 'Recargando…', collections: 'Ver colecciones' },
  };
  let state = 'loading';
  let retrying = false;
  const render = () => {
    const language = document.documentElement.lang?.slice(0, 2) || 'en';
    const text = copy[language] || copy.en;
    region.hidden = state === 'ready';
    main.dataset.customerState = state;
    main.setAttribute('aria-busy', String(state === 'loading'));
    status.textContent = text[state] || '';
    retry.hidden = state === 'loading' || state === 'ready';
    retry.textContent = retrying ? text.retrying : text.retry;
    collectionLink.textContent = text.collections;
  };
  const timer = window.setTimeout(() => { if (state === 'loading') fail(); }, 20000);
  function fail(reason = 'unavailable') {
    window.clearTimeout(timer);
    state = reason === 'storage' ? 'storage' : 'unavailable';
    render();
  }
  retry.addEventListener('click', () => {
    if (retrying) return;
    retrying = true;
    retry.disabled = true;
    render();
    // GET reload preserves static body identity, query/hash, and durable basket state.
    window.location.reload();
  });
  window.photosByElieCustomerRecovery = {
    fail,
    ready() {
      window.clearTimeout(timer);
      const restoreFocus = region.contains?.(document.activeElement);
      state = 'ready';
      render();
      if (restoreFocus) { main.setAttribute('tabindex', '-1'); main.focus(); }
    },
  };
  window.addEventListener('photosbyelie:languagechange', render);
  render();
})();
