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
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const storageKey = "photos-by-elie-landing-concept";
  let activeIndex = 0;
  let timer = null;
  let paused = reducedMotion.matches;

  const translations = {
    en: {
      photos: "Photos", realEstate: "Real Estate", signIn: "Sign in",
      eyebrow: "Places, light, and the moment between", explore: "Explore the collection",
      discover: "Discover", selectedWork: "Selected work",
      introTitle: "Photography that lets a place breathe.",
      introBody: "Travel, architecture, coastlines, and lived-in spaces—observed patiently and presented without getting between you and the image.",
      series: "Series", services: "Services", spain: "Spain", italy: "Italy",
      spaces: "Spaces & Real Estate", footerLine: "A quieter way to see more.", support: "Support",
      display: "Display", language: "Language", theme: "Theme", night: "Night", day: "Day",
      surface: "Surface", glass: "Glass", solid: "Solid", transparency: "Overlay transparency"
    },
    fr: {
      photos: "Photos", realEstate: "Immobilier", signIn: "Se connecter",
      eyebrow: "Les lieux, la lumière et l'instant entre les deux", explore: "Explorer la collection",
      discover: "Découvrir", selectedWork: "Sélection",
      introTitle: "Des photographies qui laissent respirer les lieux.",
      introBody: "Voyages, architecture, littoral et espaces habités — observés patiemment, sans jamais s'interposer entre vous et l'image.",
      series: "Série", services: "Services", spain: "Espagne", italy: "Italie",
      spaces: "Espaces & Immobilier", footerLine: "Une autre façon de mieux voir.", support: "Assistance",
      display: "Affichage", language: "Langue", theme: "Thème", night: "Nuit", day: "Jour",
      surface: "Surface", glass: "Verre", solid: "Opaque", transparency: "Transparence des panneaux"
    },
    es: {
      photos: "Fotos", realEstate: "Inmobiliaria", signIn: "Iniciar sesión",
      eyebrow: "Lugares, luz y el instante intermedio", explore: "Explorar la colección",
      discover: "Descubrir", selectedWork: "Selección",
      introTitle: "Fotografía que deja respirar cada lugar.",
      introBody: "Viajes, arquitectura, costas y espacios vividos — observados con paciencia y presentados sin interponerse entre tú y la imagen.",
      series: "Serie", services: "Servicios", spain: "España", italy: "Italia",
      spaces: "Espacios e Inmobiliaria", footerLine: "Una forma más serena de ver más.", support: "Ayuda",
      display: "Pantalla", language: "Idioma", theme: "Tema", night: "Noche", day: "Día",
      surface: "Superficie", glass: "Cristal", solid: "Sólida", transparency: "Transparencia de los paneles"
    }
  };

  const pad = (number) => String(number).padStart(2, "0");

  const showSlide = (index, { restart = true } = {}) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeIndex;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });
    const activeSlide = slides[activeIndex];
    title.textContent = activeSlide.dataset.title;
    location.textContent = activeSlide.dataset.location;
    currentLabel.textContent = pad(activeIndex + 1);
    if (restart) startTimer();
  };

  const startTimer = () => {
    window.clearInterval(timer);
    timer = null;
    if (paused || reducedMotion.matches) return;
    timer = window.setInterval(() => showSlide(activeIndex + 1, { restart: false }), 8500);
  };

  const syncPauseButton = () => {
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.setAttribute("aria-label", paused ? "Resume automatic slideshow" : "Pause automatic slideshow");
    pauseButton.textContent = paused ? "▶" : "Ⅱ";
  };

  const setLanguage = (language) => {
    const selected = translations[language] ? language : "en";
    document.documentElement.lang = selected;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const value = translations[selected][element.dataset.i18n];
      if (value) element.textContent = value;
    });
    languageSelect.value = selected;
    return selected;
  };

  const readPreferences = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  };

  const savePreferences = () => {
    const preferences = {
      language: languageSelect.value,
      theme: document.querySelector('input[name="theme"]:checked')?.value || "night",
      surface: document.querySelector('input[name="surface"]:checked')?.value || "glass",
      transparency: Number(transparencyRange.value)
    };
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  };

  const applyPreferences = (preferences) => {
    const language = setLanguage(preferences.language || navigator.language.slice(0, 2));
    const theme = preferences.theme === "day" ? "day" : "night";
    const surface = preferences.surface === "solid" ? "solid" : "glass";
    const transparency = Math.min(90, Math.max(35, Number(preferences.transparency) || 68));
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.surface = surface;
    document.documentElement.style.setProperty("--glass-alpha", String(transparency / 100));
    languageSelect.value = language;
    transparencyRange.value = String(transparency);
    const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    const surfaceRadio = document.querySelector(`input[name="surface"][value="${surface}"]`);
    if (themeRadio) themeRadio.checked = true;
    if (surfaceRadio) surfaceRadio.checked = true;
  };

  totalLabel.textContent = pad(slides.length);
  applyPreferences(readPreferences());
  syncPauseButton();
  showSlide(0);

  previousButton.addEventListener("click", () => showSlide(activeIndex - 1));
  nextButton.addEventListener("click", () => showSlide(activeIndex + 1));
  pauseButton.addEventListener("click", () => {
    paused = !paused;
    syncPauseButton();
    startTimer();
  });

  document.addEventListener("keydown", (event) => {
    if (settingsDialog.open) return;
    if (event.key === "ArrowLeft") showSlide(activeIndex - 1);
    if (event.key === "ArrowRight") showSlide(activeIndex + 1);
    if (event.key === " ") {
      event.preventDefault();
      paused = !paused;
      syncPauseButton();
      startTimer();
    }
  });

  settingsButton.addEventListener("click", () => settingsDialog.showModal());
  settingsDialog.addEventListener("click", (event) => {
    if (event.target === settingsDialog) settingsDialog.close();
  });

  languageSelect.addEventListener("change", () => {
    setLanguage(languageSelect.value);
    savePreferences();
  });

  document.querySelectorAll('input[name="theme"], input[name="surface"]').forEach((input) => {
    input.addEventListener("change", () => {
      document.documentElement.dataset.theme = document.querySelector('input[name="theme"]:checked')?.value || "night";
      document.documentElement.dataset.surface = document.querySelector('input[name="surface"]:checked')?.value || "glass";
      savePreferences();
    });
  });

  transparencyRange.addEventListener("input", () => {
    document.documentElement.style.setProperty("--glass-alpha", String(Number(transparencyRange.value) / 100));
    savePreferences();
  });

  reducedMotion.addEventListener?.("change", () => startTimer());
})();
