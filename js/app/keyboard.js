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

  // Shortcuts belong to the Build page only: in Collect / Cards / Play / Waha
  // #build-mode is hidden but its cards keep a non-'none' display, so without
  // this `a` silently added units and arrows moved a selection nobody can see.
  function buildModeActive() {
    const mode = document.body && document.body.getAttribute('data-mode');
    if (mode && mode !== 'build') return false;
    const bm = document.getElementById('build-mode');
    if (!bm || bm.hidden) return false;
    const cs = window.getComputedStyle(bm);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  // An open dropdown / listbox / menu owns the arrow keys and Enter.
  function inInteractiveWidget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('[role="listbox"], [role="menu"], [role="menuitem"], [role="option"], [role="combobox"], [role="tablist"], [role="dialog"], dialog, .dropdown-menu, .custom-dropdown, .modal');
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
    // Never claim a chord: Ctrl/Cmd+A is select-all, Ctrl+K belongs to the
    // palette, Alt+Arrow is browser history.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.defaultPrevented) return;
    if (!buildModeActive()) return;

    const target = e.target;
    const typing = isTypingTarget(target);

    if (e.key === '/' && !typing) {
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

    // Arrow keys inside an open dropdown / menu / dialog move THAT widget.
    const widget = inInteractiveWidget(target);

    if (e.key === 'ArrowDown') {
      if (widget) return;
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (widget) return;
      e.preventDefault();
      moveSelection(-1);
      return;
    }

    if (e.key === 'Enter') {
      // Enter on a button, link or role'd control activates THAT control; it
      // must not be hijacked into re-clicking the selected unit card.
      if (target && target.closest && (target.closest('button, a, summary') || target.matches('[role]'))) return;
      const sel = document.querySelector('.unit-card.selected');
      if (sel) {
        e.preventDefault();
        sel.click();
      }
      return;
    }

    if (e.key === 'a' || e.key === 'A') {
      if (widget) return;
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
