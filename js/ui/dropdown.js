// ui/dropdown.js — click-to-toggle dropdown menus (army toolbar, etc.).
(function () {
  const UI = window.UI = window.UI || {};

  function closeAll(except) {
    document.querySelectorAll('.dropdown.open').forEach(d => {
      if (d === except) return;
      d.classList.remove('open');
      const t = d.querySelector('.dropdown-trigger');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }

  function onDocClick(e) {
    const trigger = e.target.closest('.dropdown-trigger');
    if (trigger) {
      const dropdown = trigger.closest('.dropdown');
      const wasOpen = dropdown.classList.contains('open');
      closeAll(dropdown);
      dropdown.classList.toggle('open', !wasOpen);
      trigger.setAttribute('aria-expanded', String(!wasOpen));
      return;
    }
    const menu = e.target.closest('.dropdown-menu');
    if (menu) {
      // Close on menu-item click (let the item's own handler run first).
      setTimeout(() => closeAll(null), 0);
      return;
    }
    closeAll(null);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeAll(null);
  }

  UI.initDropdowns = function () {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeydown);
  };

  // Auto-init after DOM is ready. Safe to call again via UI.initDropdowns.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', UI.initDropdowns);
  } else {
    UI.initDropdowns();
  }
})();
