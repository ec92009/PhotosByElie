const root = document.documentElement;
const conceptButtons = [...document.querySelectorAll('[data-concept-target]')];
const conceptPages = [...document.querySelectorAll('.concept-page')];

function showConcept(target) {
  root.dataset.concept = target;
  conceptButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.conceptTarget === target));
  });
  conceptPages.forEach((page) => {
    const isActive = page.id === target;
    page.hidden = !isActive;
    page.classList.toggle('is-active', isActive);
  });
}

conceptButtons.forEach((button) => {
  button.addEventListener('click', () => showConcept(button.dataset.conceptTarget));
});

const stage = document.querySelector('[data-parallax-stage]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (stage && !prefersReducedMotion.matches) {
  stage.addEventListener('pointermove', (event) => {
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    stage.style.setProperty('--mx', `${x * -18}px`);
    stage.style.setProperty('--my', `${y * -14}px`);
    stage.querySelectorAll('[data-depth]').forEach((item) => {
      const depth = Number(item.dataset.depth || 0);
      item.style.translate = `${x * depth}px ${y * depth}px`;
    });
  });

  stage.addEventListener('pointerleave', () => {
    stage.style.setProperty('--mx', '0px');
    stage.style.setProperty('--my', '0px');
    stage.querySelectorAll('[data-depth]').forEach((item) => {
      item.style.translate = '0 0';
    });
  });
}

const initialConcept = new URLSearchParams(window.location.search).get('concept');
if (initialConcept && conceptPages.some((page) => page.id === initialConcept)) {
  showConcept(initialConcept);
}
