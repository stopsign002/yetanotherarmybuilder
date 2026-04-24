// ui/tooltip.js — global fixed-position tooltip bound to [data-tooltip] elements.
(function () {
  const UI = window.UI = window.UI || {};

  UI._initTooltip = function () {
    const tip = document.getElementById('global-tooltip');
    if (!tip) return;
    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tooltip]');
      if (!el) { tip.hidden = true; return; }
      tip.textContent = el.dataset.tooltip;
      tip.hidden = false;
      const r  = el.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let top  = r.top - th - 8;
      let left = r.left + r.width / 2 - tw / 2;
      if (top < 4) top = r.bottom + 8;
      left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
      tip.style.top  = top  + 'px';
      tip.style.left = left + 'px';
    });
    document.addEventListener('mouseout', e => {
      if (!e.relatedTarget || !e.relatedTarget.closest('[data-tooltip]')) tip.hidden = true;
    });
  };
})();
