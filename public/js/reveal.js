// Revela elementos ao entrar na viewport (fade + subida), com atraso escalonado entre irmãos.
(function () {
  var SELECTORS = [
    '.page-hero > *', '.pd-hero > *',
    '.about-section > *', '.pillars-section > h2', '.team-section > h2',
    '.pillar-card', '.team-card', '.about-cta > *',
    '.pd-plan', '.pd-why > h2', '.pd-feature', '.pd-faq > h2', '.pd-faq__sub', '.pd-faq__item'
  ].join(',');

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var nodes = document.querySelectorAll(SELECTORS);
  if (reduce || !('IntersectionObserver' in window) || !nodes.length) return;

  document.documentElement.classList.add('reveal-ready');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-visible');
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });

  nodes.forEach(function (el) {
    var i = Array.prototype.indexOf.call(el.parentNode.children, el);
    el.style.setProperty('--reveal-delay', Math.min(i, 5) * 80 + 'ms');
    el.classList.add('reveal');
    io.observe(el);
  });
})();
