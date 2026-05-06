// app/bug-report.js — server-backed bug report modal.
//
// Posts to /api/bugs (auth required). Diagnostics are gathered locally
// and submitted alongside a user-typed title + description; the admin
// panel (App.Admin → Reports tab) lists every report and lets the
// operator mark them fixed / unfixed.
//
// Server contract: docs/ADMIN_API.md §"Bug reports".
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const APP_VERSION = 'v0.x.y-dev';
  const ENDPOINT    = '/api/bugs';
  const MAX_BODY    = 4000;
  const MAX_DIAG    = 16000;

  let modalEl = null;

  // ── diagnostics collection ──────────────────────────────────────────────
  async function gatherDiagnostics() {
    const state = (App && App.state) || {};
    const army = state.currentArmy || null;

    let code = '(no army)';
    if (army && window.Storage && typeof Storage.exportArmyToString === 'function') {
      try {
        code = await Storage.exportArmyToString(army, {
          factionName:    state.factionFilter && state.factionFilter !== 'all' ? state.factionFilter : '',
          chapter:        state.selectedChapter,
          detachmentName: state.selectedDetachment ? state.selectedDetachment.name : null,
        });
      } catch (err) {
        code = '(export failed: ' + (err && err.message) + ')';
      }
    }

    const swActive = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    const totalUnits = (state.allUnits && state.allUnits.length) || 0;
    const numFactions = (state.factions && state.factions.length) || 0;
    const detachmentName = state.selectedDetachment ? state.selectedDetachment.name : '(none)';
    const factionFilter = state.factionFilter || 'all';
    const chapter = state.selectedChapter || '(none)';
    const viewport = (window.innerWidth || 0) + 'x' + (window.innerHeight || 0);

    const lines = [
      'App version:      ' + APP_VERSION,
      'Date/time:        ' + new Date().toISOString(),
      'User agent:       ' + (navigator.userAgent || '(unknown)'),
      'Viewport:         ' + viewport,
      'Service worker:   ' + (swActive ? 'active' : 'not active'),
      'Factions loaded:  ' + numFactions,
      'Total units:      ' + totalUnits,
      'Faction filter:   ' + factionFilter,
      'Chapter:          ' + chapter,
      'Detachment:       ' + detachmentName,
      '',
      '-- Current army (YAAB1 code) --',
      code,
    ];
    return lines.join('\n');
  }

  function esc(s) {
    if (UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function toast(msg, kind, ms) {
    if (UI && UI.toast) UI.toast(msg, kind || 'info', ms || 2500);
  }

  // ── modal ───────────────────────────────────────────────────────────────
  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-bug-report';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal bug-report-modal" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">' +
        '<div class="modal-header">' +
          '<h3 id="bug-report-title">Report a bug</h3>' +
          '<button class="modal-close" id="bug-report-close" aria-label="Close" type="button">&times;</button>' +
        '</div>' +
        '<div class="modal-body bug-report-body">' +
          '<div id="bug-report-signin-prompt" class="bug-report-signin" hidden>' +
            '<p>Sign in to send a bug report.</p>' +
            '<button class="btn btn-accent" id="bug-report-signin" type="button">Sign in</button>' +
          '</div>' +
          '<div id="bug-report-form-wrap">' +
            '<label class="bug-report-label" for="bug-report-summary">Summary</label>' +
            '<input id="bug-report-summary" class="form-input bug-report-summary" type="text" maxlength="200" ' +
              'placeholder="Short description (e.g. Wardens of Ultramar shows wrong stats)" autocomplete="off" />' +
            '<label class="bug-report-label" for="bug-report-desc">What went wrong?</label>' +
            '<textarea id="bug-report-desc" class="form-input bug-report-desc" rows="5" maxlength="' + MAX_BODY + '" ' +
              'placeholder="Steps to reproduce, what you expected, what happened…"></textarea>' +
            '<details class="bug-report-diag-wrap">' +
              '<summary>Diagnostics (auto-attached)</summary>' +
              '<textarea id="bug-report-diag" class="bug-report-diag" rows="10" spellcheck="false"></textarea>' +
            '</details>' +
            '<div class="bug-report-status" id="bug-report-status" aria-live="polite"></div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-accent" id="bug-report-submit" type="button">Send report</button>' +
          '<span class="toolbar-spacer" style="flex:1"></span>' +
          '<button class="btn btn-outline" id="bug-report-cancel" type="button">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#bug-report-close').addEventListener('click', closeModal);
    backdrop.querySelector('#bug-report-cancel').addEventListener('click', closeModal);
    backdrop.querySelector('#bug-report-submit').addEventListener('click', onSubmit);
    backdrop.querySelector('#bug-report-signin').addEventListener('click', () => {
      closeModal();
      if (UI.showAuthModal) UI.showAuthModal('login');
    });
    modalEl = backdrop;
    return modalEl;
  }

  function setStatus(msg, kind) {
    const el = modalEl && modalEl.querySelector('#bug-report-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'bug-report-status' + (kind ? (' bug-report-status-' + kind) : '');
  }

  async function onSubmit() {
    if (!isSignedIn()) {
      // Should not happen — UI is gated — but guard anyway.
      setStatus('Sign in to send a bug report.', 'error');
      return;
    }
    const titleEl = modalEl.querySelector('#bug-report-summary');
    const descEl  = modalEl.querySelector('#bug-report-desc');
    const diagEl  = modalEl.querySelector('#bug-report-diag');
    const submit  = modalEl.querySelector('#bug-report-submit');

    const title = (titleEl.value || '').trim();
    const description = (descEl.value || '').trim();
    let diagnostics = (diagEl.value || '').trim();
    if (diagnostics.length > MAX_DIAG) diagnostics = diagnostics.slice(0, MAX_DIAG) + '\n…(truncated)…';

    if (!title) {
      setStatus('Please add a short summary.', 'error');
      titleEl.focus();
      return;
    }
    if (!description) {
      setStatus('Please describe what happened.', 'error');
      descEl.focus();
      return;
    }

    submit.disabled = true;
    setStatus('Sending…');
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ title, description, diagnostics }),
      });
      if (resp.status === 401) {
        if (App.Auth && typeof App.Auth.handleSessionExpired === 'function') App.Auth.handleSessionExpired();
        setStatus('Your session expired. Sign in again.', 'error');
        return;
      }
      if (!resp.ok) {
        let data = null; try { data = await resp.json(); } catch (_) {}
        throw new Error((data && data.error) || ('HTTP ' + resp.status));
      }
      toast('Bug report sent — thanks!', 'success', 3000);
      closeModal();
    } catch (err) {
      setStatus('Send failed: ' + (err.message || 'unknown'), 'error');
    } finally {
      submit.disabled = false;
    }
  }

  function isSignedIn() {
    return !!(App.Auth && typeof App.Auth.isSignedIn === 'function' && App.Auth.isSignedIn());
  }

  async function openReport() {
    const el = ensureModal();
    el.hidden = false;

    const formWrap   = el.querySelector('#bug-report-form-wrap');
    const signinWrap = el.querySelector('#bug-report-signin-prompt');
    const titleEl    = el.querySelector('#bug-report-summary');
    const descEl     = el.querySelector('#bug-report-desc');
    const diagEl     = el.querySelector('#bug-report-diag');
    const submitBtn  = el.querySelector('#bug-report-submit');

    if (!isSignedIn()) {
      formWrap.hidden = true;
      signinWrap.hidden = false;
      submitBtn.hidden = true;
      return;
    }
    formWrap.hidden = false;
    signinWrap.hidden = true;
    submitBtn.hidden = false;
    setStatus('');

    // Reset values; gather diagnostics async.
    titleEl.value = '';
    descEl.value = '';
    diagEl.value = 'Gathering diagnostics…';
    setTimeout(() => titleEl.focus(), 0);
    try {
      const diag = await gatherDiagnostics();
      diagEl.value = diag;
    } catch (_) {
      diagEl.value = '(failed to gather diagnostics)';
    }
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  // ── hook registration ───────────────────────────────────────────────────
  // Topbar-shelf shape: `glyph` is the icon character, `label` is the
  // uppercase text rendered alongside it (matches Settings / Help /
  // Account chrome).
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-bug-report',
    region: 'icon',
    glyph: '!',
    label: 'Report',
    ariaLabel: 'Report a bug',
    title: 'Report a bug',
    onClick: openReport,
  });

  // Public — handy for tests / a future admin shortcut.
  App.BugReport = { open: openReport };
})();
