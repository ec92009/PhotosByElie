(() => {
  const hero = document.querySelector("[data-gallery-hero]");
  const image = document.querySelector("[data-gallery-hero-image]");
  if (!hero || !image) return;

  const countryHeroes = {
    france: { src: "./assets/gallery-heroes/france.jpg", panoramic: true },
    usa: { src: "./assets/gallery-heroes/usa.jpg", panoramic: true },
    spain: { src: "./assets/gallery-heroes/spain.jpg", panoramic: true },
    mexico: { src: "./assets/gallery-heroes/mexico.jpg", panoramic: true },
    italy: { src: "./assets/gallery-heroes/italy.jpg", panoramic: false },
    portugal: { src: "./assets/gallery-heroes/portugal.jpg", panoramic: true },
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const requested = String(new URLSearchParams(window.location.search).get("gallery") || "").trim().toLowerCase();
  const entry = countryHeroes[requested];
  let activePan = null;
  let resizeTimer = null;

  if (!entry) return;

  hero.classList.add("has-country-panorama");
  image.classList.toggle("is-wide-source", entry.panoramic);
  image.classList.toggle("is-standard-source", !entry.panoramic);
  image.src = entry.src;

  const startPan = () => {
    activePan?.cancel();
    activePan = null;
    image.style.transform = "translate3d(0, 0, 0)";
    if (reducedMotion.matches || !image.complete) return;

    const overflow = Math.max(0, image.getBoundingClientRect().width - hero.clientWidth);
    if (overflow < 8) return;
    const duration = Math.min(52000, Math.max(30000, overflow * 42));
    activePan = image.animate([
      { transform: "translate3d(0, 0, 0)" },
      { transform: `translate3d(${-overflow}px, 0, 0)` },
    ], {
      duration,
      easing: "linear",
      direction: "alternate",
      iterations: Infinity,
      fill: "both",
    });
  };

  if (image.complete) window.requestAnimationFrame(startPan);
  else image.addEventListener("load", () => window.requestAnimationFrame(startPan), { once: true });

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(startPan, 160);
  });
  reducedMotion.addEventListener?.("change", startPan);
})();
