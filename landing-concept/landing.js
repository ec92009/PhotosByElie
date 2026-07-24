(() => {
  const slides = [...document.querySelectorAll(".hero-slide")];
  const title = document.querySelector("#hero-title");
  const location = document.querySelector("#hero-location");
  const currentLabel = document.querySelector("#slide-current");
  const totalLabel = document.querySelector("#slide-total");
  const previousButton = document.querySelector("#previous-slide");
  const nextButton = document.querySelector("#next-slide");
  const pauseButton = document.querySelector("#pause-slides");
  const settingsButton = document.querySelector("#settings-open");
  const settingsDialog = document.querySelector("#settings-dialog");
  const languageSelect = document.querySelector("#language-select");
  const transparencyRange = document.querySelector("#transparency-range");
  const translucencyRange = document.querySelector("#translucency-range");
  const exploreMenu = document.querySelector("#explore-menu");
  const exploreTrigger = document.querySelector("#explore-trigger");
  const countryLinks = [...document.querySelectorAll("#country-links a")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const productionLanding = Boolean(document.querySelector("#account-entry-actions"));
  const storageKey = productionLanding ? "photos-by-elie-landing" : "photos-by-elie-landing-concept";
  const slideDuration = 32000;
  let activeIndex = 0;
  let timer = null;
  let activePan = null;
  let resizeTimer = null;
  let paused = reducedMotion.matches;

  const translations = {
    en: {
      photos: "Photos", signUp: "Sign up", signIn: "Sign in",
      eyebrow: "Places, light, and the moment between", explore: "Explore the collection",
      discover: "Discover", selectedWork: "Selected work",
      introTitle: "Photography that lets a place breathe.",
      introBody: "Travel, architecture, coastlines, and lived-in spaces—observed patiently and presented without getting between you and the image.",
      usageEyebrow: "From discovery to use", usageTitle: "Find the image. Know what you can do with it.",
      usageIntro: "Country, region, city, year, and a photographer's note provide useful provenance while sensitive exact coordinates remain private.",
      wallArtTitle: "Wall art",
      licensingTitle: "Personal, editorial, or commercial",
      provenanceTitle: "Location",
      usageAction: "Explore photographs",
      series: "Series", others: "Others…", france: "France", usa: "USA", spain: "Spain", mexico: "Mexico",
      italy: "Italy", portugal: "Portugal", slovakia: "Slovakia",
      latestSocial: "Latest social",
      footerLine: "A quieter way to see more.", support: "Support", privacy: "Privacy", terms: "Terms", dataDeletion: "Data deletion",
      display: "Display", language: "Language", theme: "Theme", night: "Night", day: "Day",
      surface: "Surface", glass: "Glass", solid: "Solid", transparency: "Overlay transparency", translucency: "Frosted blur",
      continueGoogle: "Continue with Google", legacyLogin: "Or use legacy access", username: "Username or email",
      password: "Password", showPassword: "Show", hidePassword: "Hide", continueVisitor: "Continue as visitor",
      signedIn: "Signed in", signOut: "Sign out", sharedWithMe: "Shared with me", checkingSession: "Checking account…", signingIn: "Signing in…",
      redirecting: "Opening Google sign-in…", signingOut: "Signing out…", loginFailed: "Username/email or password is incorrect.",
      sessionFailed: "Account status is temporarily unavailable. You can continue as a visitor."
    },
    fr: {
      photos: "Photos", signUp: "S'inscrire", signIn: "Se connecter",
      eyebrow: "Les lieux, la lumiere et l'instant entre les deux", explore: "Explorer la collection",
      discover: "Decouvrir", selectedWork: "Selection",
      introTitle: "Des photographies qui laissent respirer les lieux.",
      introBody: "Voyages, architecture, littoral et espaces habites — observes patiemment, sans jamais s'interposer entre vous et l'image.",
      usageEyebrow: "De la decouverte a l'usage", usageTitle: "Trouvez l'image. Sachez ce que vous pouvez en faire.",
      usageIntro: "Pays, region, ville, annee et note du photographe apportent une provenance utile, tandis que les coordonnees exactes sensibles restent privees.",
      wallArtTitle: "Art mural",
      licensingTitle: "Usage personnel, editorial ou commercial",
      provenanceTitle: "Lieu",
      usageAction: "Explorer les photographies",
      series: "Serie", others: "Autres…", france: "France", usa: "Etats-Unis", spain: "Espagne", mexico: "Mexique",
      italy: "Italie", portugal: "Portugal", slovakia: "Slovaquie",
      latestSocial: "Dernieres publications",
      footerLine: "Une autre facon de mieux voir.", support: "Assistance", privacy: "Confidentialite", terms: "Conditions", dataDeletion: "Suppression des donnees",
      display: "Affichage", language: "Langue", theme: "Theme", night: "Nuit", day: "Jour",
      surface: "Surface", glass: "Verre", solid: "Opaque", transparency: "Transparence des panneaux", translucency: "Flou du verre",
      continueGoogle: "Continuer avec Google", legacyLogin: "Ou utiliser l'acces classique", username: "Nom d'utilisateur ou e-mail",
      password: "Mot de passe", showPassword: "Afficher", hidePassword: "Masquer", continueVisitor: "Continuer comme visiteur",
      signedIn: "Connecte", signOut: "Se deconnecter", sharedWithMe: "Partage avec moi", checkingSession: "Verification du compte…", signingIn: "Connexion…",
      redirecting: "Ouverture de Google…", signingOut: "Deconnexion…", loginFailed: "Nom d'utilisateur/e-mail ou mot de passe incorrect.",
      sessionFailed: "Le compte est temporairement indisponible. Vous pouvez continuer comme visiteur."
    },
    es: {
      photos: "Fotos", signUp: "Registrarse", signIn: "Iniciar sesion",
      eyebrow: "Lugares, luz y el instante intermedio", explore: "Explorar la coleccion",
      discover: "Descubrir", selectedWork: "Seleccion",
      introTitle: "Fotografia que deja respirar cada lugar.",
      introBody: "Viajes, arquitectura, costas y espacios vividos — observados con paciencia y presentados sin interponerse entre tu y la imagen.",
      usageEyebrow: "Del descubrimiento al uso", usageTitle: "Encuentra la imagen y conoce lo que puedes hacer con ella.",
      usageIntro: "Pais, region, ciudad, ano y una nota del fotografo aportan procedencia util, mientras las coordenadas exactas sensibles siguen siendo privadas.",
      wallArtTitle: "Arte mural",
      licensingTitle: "Uso personal, editorial o comercial",
      provenanceTitle: "Ubicacion",
      usageAction: "Explorar fotografias",
      series: "Serie", others: "Otros…", france: "Francia", usa: "EE. UU.", spain: "Espana", mexico: "Mexico",
      italy: "Italia", portugal: "Portugal", slovakia: "Eslovaquia",
      latestSocial: "Ultimas publicaciones",
      footerLine: "Una forma mas serena de ver mas.", support: "Ayuda", privacy: "Privacidad", terms: "Condiciones", dataDeletion: "Borrado de datos",
      display: "Pantalla", language: "Idioma", theme: "Tema", night: "Noche", day: "Dia",
      surface: "Superficie", glass: "Cristal", solid: "Solida", transparency: "Transparencia de los paneles", translucency: "Desenfoque del cristal",
      continueGoogle: "Continuar con Google", legacyLogin: "O usar el acceso clasico", username: "Usuario o correo",
      password: "Contrasena", showPassword: "Mostrar", hidePassword: "Ocultar", continueVisitor: "Continuar como visitante",
      signedIn: "Sesion iniciada", signOut: "Cerrar sesion", sharedWithMe: "Compartido conmigo", checkingSession: "Comprobando la cuenta…", signingIn: "Iniciando sesion…",
      redirecting: "Abriendo Google…", signingOut: "Cerrando sesion…", loginFailed: "El usuario/correo o la contrasena no son correctos.",
      sessionFailed: "La cuenta no esta disponible temporalmente. Puedes continuar como visitante."
    }
  };

  const activeLanguage = () => translations[document.documentElement.lang] ? document.documentElement.lang : "en";
  const text = (key) => translations[activeLanguage()]?.[key] || translations.en[key] || key;
  const pad = (number) => String(number).padStart(2, "0");

  const placePanoramaAtStart = (slide) => {
    const image = slide?.querySelector("img");
    if (!image) return { image: null, overflow: 0 };
    const overflow = Math.max(0, image.getBoundingClientRect().width - slide.clientWidth);
    image.style.transform = "translate3d(0, 0, 0)";
    return { image, overflow };
  };

  const animatePanorama = (slide) => {
    activePan?.cancel();
    activePan = null;
    const run = () => {
      if (slide !== slides[activeIndex]) return;
      const { image, overflow } = placePanoramaAtStart(slide);
      if (!image || overflow < 8 || paused || reducedMotion.matches) return;
      activePan = image.animate([
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(${-overflow}px, 0, 0)` }
      ], { duration: slideDuration, easing: "linear", fill: "both" });
    };
    const image = slide?.querySelector("img");
    if (image?.complete) window.requestAnimationFrame(run);
    else image?.addEventListener("load", () => window.requestAnimationFrame(run), { once: true });
  };

  const startTimer = () => {
    window.clearInterval(timer);
    timer = null;
    if (paused || reducedMotion.matches || !slides.length) return;
    timer = window.setInterval(() => showSlide(activeIndex + 1, { restart: false }), slideDuration);
  };

  const showSlide = (index, { restart = true } = {}) => {
    if (!slides.length) return;
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeIndex;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });
    const activeSlide = slides[activeIndex];
    if (title) title.textContent = activeSlide.dataset.title;
    if (location) location.textContent = activeSlide.dataset.location;
    if (currentLabel) currentLabel.textContent = pad(activeIndex + 1);
    animatePanorama(activeSlide);
    if (restart) startTimer();
  };

  const syncPauseButton = () => {
    if (!pauseButton) return;
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.setAttribute("aria-label", paused ? "Resume automatic slideshow" : "Pause automatic slideshow");
    pauseButton.textContent = paused ? "▶" : "Ⅱ";
  };

  const setExploreOpen = (open, { focusFirst = false, restoreFocus = false } = {}) => {
    if (!exploreMenu || !exploreTrigger) return;
    exploreMenu.classList.toggle("is-open", open);
    exploreTrigger.setAttribute("aria-expanded", String(open));
    if (focusFirst) countryLinks[0]?.focus();
    if (restoreFocus) exploreTrigger.focus();
  };

  const setLanguage = (language) => {
    const selected = translations[language] ? language : "en";
    document.documentElement.lang = selected;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const value = translations[selected][element.dataset.i18n];
      if (value) element.textContent = value;
    });
    if (languageSelect) languageSelect.value = selected;
    return selected;
  };

  const readPreferences = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); }
    catch { return {}; }
  };

  const savePreferences = () => {
    if (!languageSelect || !transparencyRange) return;
    const preferences = {
      language: languageSelect.value,
      theme: document.querySelector('input[name="theme"]:checked')?.value || "night",
      surface: document.querySelector('input[name="surface"]:checked')?.value || "glass",
      transparency: Number(transparencyRange.value),
      translucency: Number(translucencyRange?.value || 16)
    };
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    window.dispatchEvent(new CustomEvent("photosbyelie:landingpreferenceschange", { detail: preferences }));
  };

  const applyPreferences = (preferences) => {
    const language = setLanguage(preferences.language || navigator.language.slice(0, 2));
    const theme = preferences.theme === "day" ? "day" : "night";
    const surface = preferences.surface === "solid" ? "solid" : "glass";
    const transparency = Math.min(90, Math.max(35, Number(preferences.transparency) || 68));
    const translucency = Math.min(30, Math.max(6, Number(preferences.translucency) || 16));
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.surface = surface;
    document.documentElement.style.setProperty("--glass-alpha", String(transparency / 100));
    document.documentElement.style.setProperty("--glass-blur", `${translucency}px`);
    if (languageSelect) languageSelect.value = language;
    if (transparencyRange) transparencyRange.value = String(transparency);
    if (translucencyRange) translucencyRange.value = String(translucency);
    const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    const surfaceRadio = document.querySelector(`input[name="surface"][value="${surface}"]`);
    if (themeRadio) themeRadio.checked = true;
    if (surfaceRadio) surfaceRadio.checked = true;
  };

  const accountWorkerBaseUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("authWorkerBase") || params.get("workerBase")
      || window.photosByElieMediaConfig?.authWorkerBaseUrl
      || window.photosByElieMediaConfig?.checkoutWorkerBaseUrl
      || "";
    return String(raw).trim().replace(/\/+$/, "");
  };

  const initAccount = () => {
    const entry = document.querySelector("#account-entry-actions");
    if (!entry) return;
    const signup = document.querySelector("#account-signup");
    const signin = document.querySelector("#account-signin");
    const face = document.querySelector("#account-face");
    const sharedEntry = document.querySelector("#account-shared-entry");
    const dialog = document.querySelector("#account-dialog");
    const close = document.querySelector("#account-close");
    const visitor = document.querySelector("#account-visitor");
    const signedOut = document.querySelector("#account-signed-out");
    const signedIn = document.querySelector("#account-signed-in");
    const identity = document.querySelector("#account-identity");
    const message = document.querySelector("#account-message");
    const google = document.querySelector("#account-google-signin");
    const form = document.querySelector("#account-form");
    const username = document.querySelector("#account-username");
    const password = document.querySelector("#account-password");
    const reveal = document.querySelector("#account-password-reveal");
    const signout = document.querySelector("#account-signout");
    const routeKey = "photosbyelie-route-after-login";
    let authenticated = false;
    let email = "";
    let accountProfile = null;
    let applyingAccountProfile = false;
    let accountProfileWriteTimer = null;

    const accountInitialFor = (value = "") => {
      const first = Array.from(String(value || "").trim())[0] || "?";
      return first.toLocaleUpperCase(document.documentElement.lang || undefined);
    };

    const setMessage = (value = "", error = false) => {
      message.textContent = value;
      message.classList.toggle("is-error", error);
    };

    const render = () => {
      entry.hidden = authenticated;
      face.hidden = !authenticated;
      if (sharedEntry) sharedEntry.hidden = !authenticated;
      if (authenticated) {
        const initial = document.createElement("span");
        initial.className = "account-initial";
        initial.setAttribute("aria-hidden", "true");
        initial.textContent = accountInitialFor(email);
        face.replaceChildren(initial);
      }
      signedOut.hidden = authenticated;
      signedIn.hidden = !authenticated;
      identity.textContent = email;
    };

    const openDialog = () => {
      render();
      dialog.showModal();
      window.setTimeout(() => (authenticated ? signout : google)?.focus(), 0);
    };

    const accountReturnUrl = () => {
      const url = new URL("./", window.location.href);
      url.searchParams.set("account", "1");
      url.searchParams.set("accountMode", "signin");
      return url.href;
    };

    const cleanAccountReturn = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("account") !== "1") return false;
      url.searchParams.delete("account");
      url.searchParams.delete("accountMode");
      window.history.replaceState(window.history.state, document.title, url.href);
      return true;
    };

    const routeAuthorizedClient = (clients = []) => {
      const galleryKey = Array.isArray(clients) ? clients[0] : "";
      if (!galleryKey || sessionStorage.getItem(routeKey) !== "google") return false;
      sessionStorage.removeItem(routeKey);
      const client = String(galleryKey).replace(/-real-estate$/i, "").trim().toLowerCase();
      const destination = new URL("./real-estate.html", window.location.href);
      destination.searchParams.set("client", client);
      destination.searchParams.set("access", "google");
      window.location.assign(destination.href);
      return true;
    };

    const loadAccountProfile = async (worker) => {
      const response = await fetch(`${worker}/account/profile`, { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) return;
      accountProfile = payload.profile || { liked: [], basket: [], language: "", theme: "" };
      const localPreferences = readPreferences();
      const mergedPreferences = {
        ...localPreferences,
        language: accountProfile.language || localPreferences.language,
        theme: accountProfile.theme === "dark" ? "night" : accountProfile.theme === "light" ? "day" : localPreferences.theme
      };
      applyingAccountProfile = true;
      applyPreferences(mergedPreferences);
      localStorage.setItem(storageKey, JSON.stringify(mergedPreferences));
      applyingAccountProfile = false;
    };

    const scheduleAccountProfileSave = (preferences) => {
      if (!authenticated || applyingAccountProfile || !accountProfile) return;
      window.clearTimeout(accountProfileWriteTimer);
      accountProfileWriteTimer = window.setTimeout(async () => {
        const worker = accountWorkerBaseUrl();
        if (!worker) return;
        const profile = {
          ...accountProfile,
          liked: Array.isArray(accountProfile.liked) ? accountProfile.liked : [],
          basket: Array.isArray(accountProfile.basket) ? accountProfile.basket : [],
          language: preferences.language,
          theme: preferences.theme === "night" ? "dark" : "light"
        };
        try {
          const response = await fetch(`${worker}/account/profile`, {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(profile)
          });
          const payload = await response.json().catch(() => ({}));
          if (response.ok && payload?.ok !== false) accountProfile = payload.profile || profile;
        } catch {
          // Display preferences remain safely stored on this device when cloud sync is unavailable.
        }
      }, 900);
    };

    const refresh = async ({ showErrors = false } = {}) => {
      const worker = accountWorkerBaseUrl();
      if (!worker) return render();
      try {
        const response = await fetch(`${worker}/auth/session`, { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) throw new Error("session");
        authenticated = payload.authenticated === true;
        email = payload.user?.email || payload.email || "";
        render();
        if (authenticated) {
          await loadAccountProfile(worker).catch(() => {});
          const routeRequested = sessionStorage.getItem(routeKey) === "google";
          if (!routeAuthorizedClient(payload.realEstateClients) && routeRequested) sessionStorage.removeItem(routeKey);
        }
      } catch {
        authenticated = false;
        email = "";
        render();
        if (showErrors) setMessage(text("sessionFailed"), true);
      }
    };

    const beginGoogle = (intent) => {
      const worker = accountWorkerBaseUrl();
      if (!worker) return setMessage(text("sessionFailed"), true);
      sessionStorage.setItem(routeKey, "google");
      const url = new URL(`${worker}/auth/google/login`);
      url.searchParams.set("returnTo", accountReturnUrl());
      url.searchParams.set("intent", intent);
      url.searchParams.set("prompt", "select_account");
      setMessage(text("redirecting"));
      window.location.assign(url.href);
    };

    signup.addEventListener("click", () => beginGoogle("signup"));
    signin.addEventListener("click", openDialog);
    face.addEventListener("click", openDialog);
    close.addEventListener("click", () => dialog.close());
    visitor.addEventListener("click", () => dialog.close());
    google.addEventListener("click", () => beginGoogle("signin"));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    reveal.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      reveal.textContent = text(showing ? "showPassword" : "hidePassword");
      reveal.dataset.i18n = showing ? "showPassword" : "hidePassword";
      reveal.setAttribute("aria-pressed", String(!showing));
      password.focus();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const worker = accountWorkerBaseUrl();
      const loginName = username.value.trim();
      const accessCode = password.value;
      if (!worker || !loginName || !accessCode) return;
      setMessage(text("signingIn"));
      try {
        const response = await fetch(`${worker}/real-estate/login`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: loginName, accessCode })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.session?.galleryKey) throw new Error("login");
        const client = String(payload.session.galleryKey).replace(/-real-estate$/i, "").trim().toLowerCase();
        const destination = new URL("./real-estate.html", window.location.href);
        destination.searchParams.set("client", client);
        destination.searchParams.set("access", "password");
        window.location.assign(destination.href);
      } catch {
        setMessage(text("loginFailed"), true);
      }
    });
    signout.addEventListener("click", () => {
      const worker = accountWorkerBaseUrl();
      if (!worker) return;
      setMessage(text("signingOut"));
      const url = new URL(`${worker}/auth/logout`);
      url.searchParams.set("returnTo", accountReturnUrl());
      window.location.assign(url.href);
    });
    window.addEventListener("photosbyelie:landingpreferenceschange", (event) => {
      scheduleAccountProfileSave(event.detail || readPreferences());
    });

    const returned = cleanAccountReturn();
    refresh({ showErrors: returned }).then(() => {
      if (returned && !authenticated && !dialog.open) openDialog();
    });
  };

  if (totalLabel) totalLabel.textContent = pad(slides.length);
  applyPreferences(readPreferences());
  syncPauseButton();
  showSlide(0);
  initAccount();

  previousButton?.addEventListener("click", () => showSlide(activeIndex - 1));
  nextButton?.addEventListener("click", () => showSlide(activeIndex + 1));
  pauseButton?.addEventListener("click", () => {
    paused = !paused;
    syncPauseButton();
    if (paused) activePan?.pause();
    else animatePanorama(slides[activeIndex]);
    startTimer();
  });

  exploreTrigger?.addEventListener("click", () => {
    const open = !exploreMenu.classList.contains("is-open");
    setExploreOpen(open, { focusFirst: open });
  });
  exploreMenu?.addEventListener("pointerenter", () => exploreTrigger.setAttribute("aria-expanded", "true"));
  exploreMenu?.addEventListener("pointerleave", () => {
    if (!exploreMenu.classList.contains("is-open")) exploreTrigger.setAttribute("aria-expanded", "false");
  });
  exploreMenu?.addEventListener("focusin", () => exploreTrigger.setAttribute("aria-expanded", "true"));
  exploreMenu?.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      if (!exploreMenu.contains(document.activeElement) && !exploreMenu.classList.contains("is-open")) {
        exploreTrigger.setAttribute("aria-expanded", "false");
      }
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (exploreMenu && !exploreMenu.contains(event.target)) setExploreOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (settingsDialog?.open || document.querySelector("#account-dialog")?.open) return;
    if (event.key === "Escape" && exploreMenu?.classList.contains("is-open")) {
      event.preventDefault();
      setExploreOpen(false, { restoreFocus: true });
      return;
    }
    if (event.key === "ArrowLeft") showSlide(activeIndex - 1);
    if (event.key === "ArrowRight") showSlide(activeIndex + 1);
    if (event.key === " ") {
      event.preventDefault();
      paused = !paused;
      syncPauseButton();
      if (paused) activePan?.pause();
      else animatePanorama(slides[activeIndex]);
      startTimer();
    }
  });

  settingsButton?.addEventListener("click", () => settingsDialog.showModal());
  settingsDialog?.addEventListener("click", (event) => { if (event.target === settingsDialog) settingsDialog.close(); });
  languageSelect?.addEventListener("change", () => { setLanguage(languageSelect.value); savePreferences(); });
  document.querySelectorAll('input[name="theme"], input[name="surface"]').forEach((input) => {
    input.addEventListener("change", () => {
      document.documentElement.dataset.theme = document.querySelector('input[name="theme"]:checked')?.value || "night";
      document.documentElement.dataset.surface = document.querySelector('input[name="surface"]:checked')?.value || "glass";
      savePreferences();
    });
  });
  transparencyRange?.addEventListener("input", () => {
    document.documentElement.style.setProperty("--glass-alpha", String(Number(transparencyRange.value) / 100));
    savePreferences();
  });
  translucencyRange?.addEventListener("input", () => {
    document.documentElement.style.setProperty("--glass-blur", `${Number(translucencyRange.value)}px`);
    savePreferences();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => animatePanorama(slides[activeIndex]), 140);
  });
  reducedMotion.addEventListener?.("change", () => {
    if (reducedMotion.matches) {
      activePan?.cancel();
      activePan = null;
      placePanoramaAtStart(slides[activeIndex]);
    } else if (!paused) animatePanorama(slides[activeIndex]);
    startTimer();
  });
})();
