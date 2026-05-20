// app/changelog.js — "Updates" button + modal showing recent user-facing
// changes. Data lives in js/data/changelog-data.js (App.CHANGELOG).
//
// Adding a change? See the comment at the top of changelog-data.js.
// CLAUDE.md also reminds future contributors: every user-facing change
// MUST add a changelog entry there.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const STORAGE_KEY = 'yaab_changelog_seen';

  let modalEl = null;

  function esc(s) {
    if (UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    // Accept either a YYYY-MM-DD or a full ISO timestamp. For the
    // date-only form we MUST build a local-midnight Date — `new
    // Date('2026-05-15')` and `new Date('2026-05-15T00:00:00Z')` both
    // parse as UTC midnight, which `toLocaleDateString` then shifts
    // back to May 14 for every viewer west of UTC. Construct from
    // parts so the date the author wrote is the date the reader sees.
    try {
      let d;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
      else   d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return iso; }
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch (_) { return iso; }
  }

  // ── modal ───────────────────────────────────────────────────────────────
  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-changelog';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal changelog-modal" role="dialog" aria-modal="true" aria-labelledby="changelog-title">' +
        '<div class="modal-header changelog-header">' +
          '<div class="changelog-header-text">' +
            '<h3 id="changelog-title">What\'s new</h3>' +
            '<div class="changelog-meta" id="changelog-meta"></div>' +
          '</div>' +
          '<button class="modal-close" id="changelog-close" aria-label="Close" type="button">&times;</button>' +
        '</div>' +
        '<div class="modal-body changelog-body" id="changelog-body"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#changelog-close').addEventListener('click', closeModal);
    modalEl = backdrop;
    return modalEl;
  }

  // Platform-aware hard-refresh shortcut. Mac uses Cmd; everything else
   // uses Ctrl. Browsers send the keyboard event consistently with the
   // user's platform, so the label should match what they have to press.
  function refreshShortcutLabel() {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '')
                  || /Mac/i.test(navigator.userAgent || '');
    return isMac ? '⌘⇧R' : 'Ctrl+Shift+R';
  }

  function render() {
    ensureModal();
    const data = App.CHANGELOG || { version: '—', lastUpdated: null, entries: [] };
    const meta = modalEl.querySelector('#changelog-meta');
    meta.innerHTML =
      '<span class="changelog-version">v' + esc(data.version || '—') + '</span>' +
      (data.lastUpdated
        ? ' <span class="changelog-updated">Updated ' + esc(fmtDateTime(data.lastUpdated)) + '</span>'
        : '');

    const body = modalEl.querySelector('#changelog-body');
    const entries = Array.isArray(data.entries) ? data.entries : [];
    // Hard-refresh tip. Browsers cache aggressively for static sites, so
    // someone reading "What's new" on a stale tab won't see the new
    // feature until they force a refresh. This banner tells them how.
    const refreshTip =
      '<div class="changelog-refresh-tip" role="note">' +
        '<span class="changelog-refresh-tip-icon" aria-hidden="true">↻</span>' +
        '<span class="changelog-refresh-tip-text">' +
          'Don\'t see a new feature yet? Press <kbd>' + esc(refreshShortcutLabel()) + '</kbd> ' +
          'to hard-refresh and pull the latest version.' +
        '</span>' +
      '</div>';
    if (entries.length === 0) {
      body.innerHTML = refreshTip + '<p class="changelog-empty">No updates yet — check back soon.</p>';
      return;
    }

    // Group by date string. Order preserved from data file (newest first).
    const groups = [];
    const groupIdx = new Map();
    for (const entry of entries) {
      const d = entry.date || '';
      if (!groupIdx.has(d)) { groupIdx.set(d, groups.length); groups.push({ date: d, items: [] }); }
      groups[groupIdx.get(d)].items.push(entry);
    }

    body.innerHTML = refreshTip + groups.map(g => {
      const items = g.items.map(item => {
        const kind = (item.kind || 'change').toLowerCase();
        const kindLabel = kind === 'feature' ? 'New' : kind === 'fix' ? 'Fix' : 'Change';
        return '<li class="changelog-item changelog-item-' + esc(kind) + '">' +
          '<span class="changelog-kind changelog-kind-' + esc(kind) + '">' + esc(kindLabel) + '</span>' +
          '<div class="changelog-text">' +
            '<div class="changelog-item-title">' + esc(item.title || '') + '</div>' +
            (item.description
              ? '<div class="changelog-item-desc">' + esc(item.description) + '</div>'
              : '') +
          '</div>' +
        '</li>';
      }).join('');
      return '<section class="changelog-day">' +
        '<h4 class="changelog-day-head">' + esc(fmtDate(g.date)) + '</h4>' +
        '<ul class="changelog-list">' + items + '</ul>' +
      '</section>';
    }).join('');
  }

  function openModal() {
    render();
    modalEl.hidden = false;
    markSeen();
  }
  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  // Show a small dot on the icon while the user has unseen entries.
  function markSeen() {
    try {
      const v = (App.CHANGELOG && App.CHANGELOG.version) || '';
      if (v) localStorage.setItem(STORAGE_KEY, v);
    } catch (_) {}
    refreshBadge();
  }
  function hasUnseen() {
    try {
      const v = (App.CHANGELOG && App.CHANGELOG.version) || '';
      if (!v) return false;
      const seen = localStorage.getItem(STORAGE_KEY);
      return seen !== v;
    } catch (_) { return false; }
  }
  function refreshBadge() {
    const btn = document.getElementById('yaab-btn-changelog');
    if (!btn) return;
    btn.classList.toggle('has-unseen', hasUnseen());
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  // ── hook registration ───────────────────────────────────────────────────
  // Topbar-shelf shape: `glyph` is the icon character, `label` is the
  // uppercase text rendered alongside it (matches Settings / Help /
  // Account chrome).
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-changelog',
    region: 'icon',
    glyph: '✦',
    label: 'Updates',
    ariaLabel: 'Recent updates',
    title: 'What\'s new',
    onClick: openModal,
  });

  App.hooks.bootstrap.push(refreshBadge);

  App.Changelog = { open: openModal, close: closeModal };
})();
