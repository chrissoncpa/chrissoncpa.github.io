(function () {
  'use strict';

  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const topbar = document.querySelector('.topbar');
  const yearEl = document.getElementById('year');

  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  if (toggle) {
    toggle.addEventListener('click', function () {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      if (next === 'dark') root.dataset.theme = 'dark';
      else delete root.dataset.theme;
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  if (topbar) {
    const onScroll = function () {
      if (window.scrollY > 4) topbar.classList.add('scrolled');
      else topbar.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // mobile Menu disclosure: close after navigating or tapping outside
  const mobnav = document.querySelector('.mobnav');
  if (mobnav) {
    mobnav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { mobnav.removeAttribute('open'); });
    });
    document.addEventListener('click', function (e) {
      if (mobnav.hasAttribute('open') && !mobnav.contains(e.target)) {
        mobnav.removeAttribute('open');
      }
    });
  }

  const revealTargets = document.querySelectorAll(
    '.section-head, .case, .stack-card, .timeline li, .manifesto .quote, .manifesto-body, .creds, .creds-verify'
  );
  revealTargets.forEach(function (el) { el.classList.add('reveal'); });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('in'); });
  }
})();
