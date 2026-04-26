// app/ork-math.js — convert point displays to teef when Orks faction active.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_ork_math';
  const BTN_ID = 'yaab-btn-teef';
  const ATTR = 'data-teef-orig';

  let enabled = false;
  let observer = null;

  function isOrks() {
    const s = App.state || {};
    const name = s.selectedChapter || (s.factionFilter && s.factionFilter !== 'all' ? s.factionFilter : '');
    return /orks/i.test(String(name || ''));
  }

  function teefWord(n) {
    if (!isFinite(n)) return '? teef';
    if (n <= 0) return '0 teef';
    if (n < 10)   return n + ' lil bits';
    if (n < 50)   return n + ' teef';
    if (n < 100)  return n + ' gud teef';
    if (n < 250)  return n + ' shiny teef';
    return n + " gork's own teef";
  }

  function setDisplay(el, text) {
    // Idempotent: only rewrite if current visible text differs from target.
    if (el.textContent === text) return;
    if (!el.hasAttribute(ATTR)) el.setAttribute(ATTR, el.textContent);
    el.textContent = text;
  }

  function restoreDisplay(el) {
    if (!el.hasAttribute(ATTR)) return;
    const orig = el.getAttribute(ATTR);
    el.removeAttribute(ATTR);
    if (el.textContent !== orig) el.textContent = orig;
  }

  function extractNumber(el) {
    // Prefer the original (pre-transform) value if we've stored one.
    const src = el.hasAttribute(ATTR) ? el.getAttribute(ATTR) : el.textContent;
    const m = String(src || '').match(/-?\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }

  function targets() {
    const out = [];
    const pc = document.getElementById('points-current');
    if (pc) out.push(pc);
    const entries = document.querySelectorAll('.army-entry-pts, .army-entry-total');
    for (let i = 0; i < entries.length; i++) out.push(entries[i]);
    return out;
  }

  function apply() {
    const on = enabled && isOrks();
    const list = targets();
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (on) {
        const n = extractNumber(el);
        if (isNaN(n)) continue;
        setDisplay(el, teefWord(n));
      } else {
        restoreDisplay(el);
      }
    }
    updateButton();
  }

  function startObserver() {
    if (observer) return;
    const root = document.getElementById('app-main') || document.body;
    if (!root) return;
    observer = new MutationObserver(() => {
      // Re-apply on any DOM churn; idempotent.
      apply();
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function updateButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const orks = isOrks();
    btn.hidden = !orks;
    btn.classList.toggle('is-active', enabled && orks);
    btn.title = enabled ? 'Ork math: ON (click to hide teef)' : 'Toggle Ork math (show points as teef)';
  }

  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(LS_KEY, enabled ? '1' : '0'); } catch (_) {}
    apply();
  }

  // Register button into icon region; hidden unless Orks is active.
  App.hooks.armyToolbarActions.push({
    id: BTN_ID,
    region: 'icon',
    label: 'TEEF',
    title: 'Toggle Ork math',
    onClick: toggle,
  });

  App.hooks.bootstrap.push(function () {
    try { enabled = localStorage.getItem(LS_KEY) === '1'; } catch (_) { enabled = false; }
    startObserver();
    apply();
  });

  App.hooks.armyChange.push(apply);
  App.hooks.selectionChange.push(apply);
})();
