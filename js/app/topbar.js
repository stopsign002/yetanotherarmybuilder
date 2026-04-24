// app/topbar.js — wires the top app bar: brand, mode tabs, search, Settings + Help.
(function () {
  const App = window.App = window.App || {};

  function $(id) { return document.getElementById(id); }

  // ── Search / command-palette button ─────────────────────────────────
  function bindSearch() {
    const open = function () {
      if (typeof App.openCommandPalette === 'function') App.openCommandPalette();
    };
    const search = $('topbar-search');
    if (search) search.addEventListener('click', open);
  }

  // ── Settings (gear) — opens drawer ──────────────────────────────────
  function bindSettings() {
    const btn = $('topbar-settings');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (App.settingsDrawer && typeof App.settingsDrawer.toggle === 'function') {
        App.settingsDrawer.toggle();
      }
    });
  }

  // ── Help (?) — keyboard help, falling back to tour replay ───────────
  function bindHelp() {
    const help = $('topbar-help');
    if (!help) return;
    help.addEventListener('click', () => {
      if (typeof App.openKeyboardHelp === 'function') {
        App.openKeyboardHelp();
        return;
      }
      if (typeof App.replayTour === 'function') {
        App.replayTour();
        return;
      }
      if (typeof App.openCommandPalette === 'function') App.openCommandPalette();
    });
  }

  // ── Brand: prevent navigation; clicking returns to Build mode. ──────
  function bindBrand() {
    const brand = $('topbar-brand');
    if (!brand) return;
    brand.addEventListener('click', e => {
      e.preventDefault();
      if (typeof App.setMode === 'function') App.setMode('build');
    });
  }

  function init() {
    bindSearch();
    bindSettings();
    bindHelp();
    bindBrand();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
