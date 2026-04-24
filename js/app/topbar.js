// app/topbar.js — wires the top app bar (faction chip mirror, ⌘K, Action Center, status row).
(function () {
  const App = window.App = window.App || {};

  function $(id) { return document.getElementById(id); }

  function selectedText(sel) {
    if (!sel) return '';
    const opt = sel.options && sel.options[sel.selectedIndex];
    return opt ? (opt.textContent || '').trim() : '';
  }

  // ── Faction chip ────────────────────────────────────────────────────
  function bindChipSegment(buttonId, selectId) {
    const btn = $(buttonId);
    const sel = $(selectId);
    if (!btn || !sel) return;
    btn.addEventListener('click', () => {
      // Open the corresponding native select. focus + click triggers it
      // on Chromium/Safari for desktop; on mobile it routes to the
      // platform picker just fine.
      try {
        sel.focus({ preventScroll: false });
        if (typeof sel.showPicker === 'function') {
          sel.showPicker();
        } else {
          sel.click();
        }
      } catch (_) {
        sel.focus();
      }
      // Also scroll the panel into view in case it's collapsed on mobile.
      const panel = sel.closest('.panel-left');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function syncChip() {
    const factionSel    = $('army-faction-select');
    const chapterSel    = $('army-chapter-select');
    const chapterGroup  = $('army-chapter-group');
    const detachmentSel = $('army-detachment-select');

    const fVal = $('topbar-chip-faction-value');
    const cVal = $('topbar-chip-chapter-value');
    const cBtn = $('topbar-chip-chapter');
    const dVal = $('topbar-chip-detachment-value');

    if (fVal && factionSel) {
      const txt = selectedText(factionSel) || 'All Factions';
      fVal.textContent = txt;
    }
    if (cBtn) {
      // Show chapter chip only when chapter group is visible (some
      // factions don't have chapter sub-selection).
      const hasChapter = chapterGroup && !chapterGroup.hidden;
      cBtn.hidden = !hasChapter;
      if (hasChapter && cVal) {
        const txt = selectedText(chapterSel) || '—';
        cVal.textContent = txt;
      }
    }
    if (dVal && detachmentSel) {
      const t = selectedText(detachmentSel);
      dVal.textContent = (!t || /select faction/i.test(t)) ? '—' : t;
    }
  }

  function watchSelects() {
    ['army-faction-select', 'army-chapter-select', 'army-detachment-select'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('change', syncChip);
    });
    // Watch chapter group visibility (it's toggled via [hidden] attr).
    const chapterGroup = $('army-chapter-group');
    if (chapterGroup && 'MutationObserver' in window) {
      const obs = new MutationObserver(syncChip);
      obs.observe(chapterGroup, { attributes: true, attributeFilter: ['hidden'] });
    }
    if (App.hooks) {
      App.hooks.selectionChange.push(syncChip);
      App.hooks.armyChange.push(syncChip);
    }
  }

  // ── Status row (saved / unsaved indicator) ──────────────────────────
  let savedAt = null;
  let dirty = false;
  function fmtAgo(ts) {
    if (!ts) return '';
    const ms = Date.now() - ts;
    const s  = Math.floor(ms / 1000);
    if (s < 30)    return 'just now';
    if (s < 60)   return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60)   return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)   return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function renderStatus() {
    const el = $('toolbar-status');
    if (!el) return;
    el.classList.remove('is-saved', 'is-unsaved');
    if (dirty) {
      el.classList.add('is-unsaved');
      el.textContent = 'Unsaved changes';
    } else if (savedAt) {
      el.classList.add('is-saved');
      el.textContent = `Saved ${fmtAgo(savedAt)}`;
    } else {
      el.textContent = 'Ready';
    }
  }
  function watchStatus() {
    if (!App.hooks) return;
    App.hooks.armyChange.push((army, kind) => {
      if (kind === 'save') {
        savedAt = Date.now();
        dirty = false;
      } else {
        dirty = true;
      }
      renderStatus();
    });
    // Listen for the Save button click separately (events.js doesn't fire
    // a 'save' kind through the hook).
    const saveBtn = $('btn-save-army');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        savedAt = Date.now();
        dirty = false;
        renderStatus();
      });
    }
    setInterval(renderStatus, 30 * 1000);
  }

  // ── Top bar buttons ─────────────────────────────────────────────────
  function bindTopbarButtons() {
    const cmd = function () {
      if (typeof App.openCommandPalette === 'function') App.openCommandPalette();
    };
    const search = $('topbar-search');
    if (search) search.addEventListener('click', cmd);
    const cmdBtn = $('topbar-cmdk');
    if (cmdBtn) cmdBtn.addEventListener('click', cmd);

    const ac = $('topbar-action-center');
    if (ac) ac.addEventListener('click', () => {
      if (window.UI && UI.actionCenter) UI.actionCenter.toggle();
    });

    const help = $('topbar-help');
    if (help) help.addEventListener('click', () => {
      if (typeof App.replayTour === 'function') {
        App.replayTour();
      } else if (typeof App.openCommandPalette === 'function') {
        App.openCommandPalette();
      }
    });

    // Mobile hamburger: toggles a body class so mobile.css can react.
    const burger = $('topbar-mobile-menu');
    if (burger) burger.addEventListener('click', () => {
      document.body.classList.toggle('topbar-mobile-open');
    });

    const brand = $('topbar-brand');
    if (brand) brand.addEventListener('click', e => e.preventDefault());
  }

  function init() {
    bindChipSegment('topbar-chip-faction',    'army-faction-select');
    bindChipSegment('topbar-chip-chapter',    'army-chapter-select');
    bindChipSegment('topbar-chip-detachment', 'army-detachment-select');
    watchSelects();
    syncChip();
    watchStatus();
    renderStatus();
    bindTopbarButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
