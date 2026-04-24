// app/theme.js — light/dark theme toggle persisted to localStorage.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const KEY = 'yaab_theme';

  function apply(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  }

  function read() {
    try { return localStorage.getItem(KEY) || 'dark'; }
    catch (_) { return 'dark'; }
  }

  function write(theme) {
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }

  function updateLabel() {
    const btn = document.getElementById('yaab-btn-theme');
    if (!btn) return;
    const cur = read();
    btn.textContent = cur === 'light' ? 'Theme: Light' : 'Theme: Dark';
  }

  function cycle() {
    const cur = read();
    const next = cur === 'dark' ? 'light' : 'dark';
    write(next);
    apply(next);
    updateLabel();
  }

  apply(read());

  App.hooks.bootstrap.push(function () {
    apply(read());
    updateLabel();
  });

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-theme',
    label: 'Theme',
    title: 'Toggle light/dark theme',
    className: 'btn btn-sm btn-outline',
    onClick: cycle,
  });
})();
