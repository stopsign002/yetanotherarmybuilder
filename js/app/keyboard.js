// app/keyboard.js — global keyboard shortcuts for search, navigation, add.
(function () {
  const App = window.App = window.App || {};

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function visibleCards() {
    const grid = document.getElementById('unit-grid');
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('.unit-card')).filter(c => {
      if (c.hidden) return false;
      const style = window.getComputedStyle(c);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return true;
    });
  }

  function moveSelection(delta) {
    const cards = visibleCards();
    if (cards.length === 0) return;
    const current = document.querySelector('.unit-card.selected');
    let idx = cards.indexOf(current);
    if (idx === -1) {
      idx = 0;
    } else {
      idx = Math.max(0, Math.min(cards.length - 1, idx + delta));
    }
    const next = cards[idx];
    if (!next) return;
    next.click();
    try { next.scrollIntoView({ block: 'nearest' }); } catch (_) {}
  }

  function showShortcutsToast() {
    if (!window.UI || typeof UI.toast !== 'function') return;
    const msg = [
      'Shortcuts:',
      '/  focus search',
      '↑/↓  move selection',
      'Enter  open selected unit',
      'a  add selected unit to army',
      'Cmd/Ctrl+Z  undo',
      'Cmd/Ctrl+Shift+Z  redo',
      '?  this help',
    ].join('  |  ');
    UI.toast(msg, 'info', 6000);
  }

  document.addEventListener('keydown', function (e) {
    const target = e.target;
    const typing = isTypingTarget(target);

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const search = document.getElementById('search-input');
      if (search && document.activeElement !== search) {
        e.preventDefault();
        search.focus();
        if (typeof search.select === 'function') search.select();
        return;
      }
    }

    if (typing) return;

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      showShortcutsToast();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return;
    }

    if (e.key === 'Enter') {
      const sel = document.querySelector('.unit-card.selected');
      if (sel) {
        e.preventDefault();
        sel.click();
      }
      return;
    }

    if (e.key === 'a' || e.key === 'A') {
      const sel = document.querySelector('.unit-card.selected');
      const addBtn = document.getElementById('btn-detail-add');
      if (sel && addBtn) {
        e.preventDefault();
        addBtn.click();
      }
      return;
    }
  });
})();
