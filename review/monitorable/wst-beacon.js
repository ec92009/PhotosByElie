/* Web Signals browser beacon v1.1.0 — aggregate mode uses no visitor/session identifier. */
(function installWebSignals(window, document, navigator) {
  "use strict";

  try {
    const script = document.currentScript;
    if (!script) return;

    const config = {
      enabled: script.dataset.wstEnabled === "true",
      endpoint: script.dataset.wstEndpoint || "",
      siteId: script.dataset.wstSite || "",
      environment: script.dataset.wstEnvironment || "production",
      consentState: script.dataset.wstConsent || "unknown",
      synthetic: script.dataset.wstSynthetic === "true",
      sessionless: script.dataset.wstSessionless === "true",
    };
    const allowedConsent = new Set(["granted", "denied", "not_required", "unknown"]);
    const allowedEnvironment = new Set(["production", "preview", "staging", "development", "test"]);
    const allowedBrowserEvents = new Set(["page_view", "cta_press", "form_start", "form_submit_press"]);
    const stableId = /^[a-z][a-z0-9._-]{1,63}$/;
    const siteId = /^[a-z][a-z0-9-]{2,47}$/;
    const startedForms = new Set();
    let pageViewSent = false;

    if (!config.enabled) return;
    if (!siteId.test(config.siteId) || !allowedEnvironment.has(config.environment)) return;
    if (!allowedConsent.has(config.consentState)) config.consentState = "unknown";
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") config.consentState = "denied";

    const endpoint = new URL(config.endpoint, window.location.href);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") return;
    endpoint.search = "";
    endpoint.hash = "";

    function normalizePath(value) {
      const path = String(value || "/").split(/[?#]/, 1)[0].replace(/\/{2,}/g, "/");
      if (!path.startsWith("/")) return "/";
      const withoutDefault = path.replace(/\/index\.html$/i, "/");
      return withoutDefault.length > 1 ? withoutDefault.replace(/\/$/, "") : "/";
    }

    function safeLocale(value) {
      const locale = String(value || "").trim();
      return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale.slice(0, 35) : undefined;
    }

    function safeCampaign() {
      const names = { utm_source: "source", utm_medium: "medium", utm_campaign: "campaign", utm_content: "content", utm_term: "term" };
      const campaign = {};
      const params = new URLSearchParams(window.location.search);
      for (const [queryName, propertyName] of Object.entries(names)) {
        const value = params.get(queryName);
        if (value && /^[A-Za-z0-9._~ -]+$/.test(value) && value.length <= 100) campaign[propertyName] = value;
      }
      return Object.keys(campaign).length ? campaign : undefined;
    }

    function safeReferrerSite() {
      if (!document.referrer) return undefined;
      try {
        const hostname = new URL(document.referrer).hostname;
        return hostname && hostname !== window.location.hostname ? hostname.slice(0, 253) : undefined;
      } catch {
        return undefined;
      }
    }

    function randomSessionId() {
      const bytes = new Uint8Array(18);
      window.crypto.getRandomValues(bytes);
      const token = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
      return `s_${window.btoa(token).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    }

    function sessionId() {
      const key = `wst:session:${config.siteId}`;
      const now = Date.now();
      try {
        const previous = JSON.parse(window.sessionStorage.getItem(key) || "null");
        const valid = previous && typeof previous.id === "string" && now - previous.touchedAt < 30 * 60 * 1000 && now - previous.createdAt < 24 * 60 * 60 * 1000;
        const session = valid ? { ...previous, touchedAt: now } : { id: randomSessionId(), createdAt: now, touchedAt: now };
        window.sessionStorage.setItem(key, JSON.stringify(session));
        return session.id;
      } catch {
        return randomSessionId();
      }
    }

    function isAllowedToSend() {
      return config.consentState === "granted" || config.consentState === "not_required";
    }

    function transmit(payload) {
      const body = JSON.stringify(payload);
      try {
        if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(endpoint.href, body)) return;
      } catch {
        // A blocked beacon must never affect the host site's interaction.
      }
      try {
        void window.fetch(endpoint.href, {
          method: "POST",
          body,
          keepalive: true,
          mode: "cors",
          credentials: "omit",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
        }).catch(() => {});
      } catch {
        // Analytics failure is deliberately silent and non-blocking.
      }
    }

    function track(eventName, eventProperties) {
      if (!isAllowedToSend() || !allowedBrowserEvents.has(eventName)) return false;
      const path = normalizePath(window.location.pathname);
      const properties = { path };
      if (!config.sessionless) properties.session_id = sessionId();
      const locale = safeLocale(document.documentElement.lang || navigator.language);
      const referrerSite = safeReferrerSite();
      const campaign = safeCampaign();
      if (locale) properties.locale = locale;
      if (referrerSite) properties.referrer_site = referrerSite;
      if (campaign) properties.campaign = campaign;

      if (eventName === "cta_press") {
        if (!stableId.test(eventProperties?.cta_id || "")) return false;
        properties.cta_id = eventProperties.cta_id;
      }
      if (eventName === "form_start" || eventName === "form_submit_press") {
        if (!stableId.test(eventProperties?.form_id || "")) return false;
        properties.form_id = eventProperties.form_id;
      }

      transmit({
        schema_version: "wst.event.v1",
        event_id: window.crypto.randomUUID(),
        occurred_at: new Date().toISOString(),
        site_id: config.siteId,
        environment: config.environment,
        event_name: eventName,
        source: "browser",
        synthetic: config.synthetic,
        bot_classification: navigator.webdriver ? "known_bot" : "unknown",
        consent_state: config.consentState,
        properties,
      });
      return true;
    }

    function sendInitialPageView() {
      if (!pageViewSent && isAllowedToSend()) pageViewSent = track("page_view", {});
    }

    function setConsent(consentState) {
      if (!allowedConsent.has(consentState)) return false;
      config.consentState = consentState;
      if (consentState === "denied") {
        try { window.sessionStorage.removeItem(`wst:session:${config.siteId}`); } catch {}
      }
      sendInitialPageView();
      return true;
    }

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-wst-cta]") : null;
      if (target) track("cta_press", { cta_id: target.dataset.wstCta });
    }, true);

    document.addEventListener("focusin", (event) => {
      const form = event.target instanceof Element ? event.target.closest("form[data-wst-form]") : null;
      const formId = form?.dataset.wstForm;
      if (formId && !startedForms.has(formId) && track("form_start", { form_id: formId })) startedForms.add(formId);
    }, true);

    document.addEventListener("submit", (event) => {
      const form = event.target instanceof Element ? event.target.closest("form[data-wst-form]") : null;
      if (form?.dataset.wstForm) track("form_submit_press", { form_id: form.dataset.wstForm });
    }, true);

    window.WebSignals = Object.freeze({ track, setConsent });
    sendInitialPageView();
  } catch {
    // Installation failure must never break the host page.
  }
})(window, document, navigator);
