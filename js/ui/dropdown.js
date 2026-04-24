// ui/dropdown.js — click-to-toggle dropdown menus with keyboard support.
(function () {
  const UI = window.UI = window.UI || {};

  function menuItems(dropdown) {
    if (!dropdown) return [];
    return Array.from(
      dropdown.querySelectorAll('.dropdown-menu button:not([disabled])')
    ).filter(b => b.offsetParent !== null || b.getClientRects().length > 0);
  }

  function focusItem(dropdown, idx) {
    const items = menuItems(dropdown);
    if (!items.length) return;
    const i = ((idx % items.length) + items.length) % items.length;
    items[i].focus();
  }

  function closeAll(except) {
    document.querySelectorAll('.dropdown.open').forEach(d => {
      if (d === except) return;
      d.classList.remove('open');
      const t = d.querySelector('.dropdown-trigger');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }

  function openDropdown(dropdown) {
    closeAll(dropdown);
    dropdown.classList.add('open');
    const t = dropdown.querySelector('.dropdown-trigger');
    if (t) t.setAttribute('aria-expanded', 'true');
  }

  function onDocClick(e) {
    const trigger = e.target.closest('.dropdown-trigger');
    if (trigger) {
      if (trigger.hasAttribute('disabled')) return;
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
    if (e.key === 'Escape') {
      const open = document.querySelector('.dropdown.open');
      if (open) {
        closeAll(null);
        const t = open.querySelector('.dropdown-trigger');
        if (t) t.focus();
        e.preventDefault();
      }
      return;
    }

    const trigger = e.target.closest && e.target.closest('.dropdown-trigger');
    if (trigger) {
      const dropdown = trigger.closest('.dropdown');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        if (trigger.hasAttribute('disabled')) return;
        const wasOpen = dropdown.classList.contains('open');
        if (!wasOpen) openDropdown(dropdown);
        e.preventDefault();
        focusItem(dropdown, e.key === 'ArrowUp' ? -1 : 0);
      }
      return;
    }

    const item = e.target.closest && e.target.closest('.dropdown-menu button');
    if (item) {
      const dropdown = item.closest('.dropdown');
      const items = menuItems(dropdown);
      const idx = items.indexOf(item);
      if (e.key === 'ArrowDown') {
        focusItem(dropdown, idx + 1);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        focusItem(dropdown, idx - 1);
        e.preventDefault();
      } else if (e.key === 'Home') {
        focusItem(dropdown, 0);
        e.preventDefault();
      } else if (e.key === 'End') {
        focusItem(dropdown, items.length - 1);
        e.preventDefault();
      } else if (e.key === 'Tab') {
        // Tab away closes the menu.
        closeAll(null);
      }
    }
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
