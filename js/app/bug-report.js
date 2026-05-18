// app/bug-report.js — server-backed bug-report / feature-request modal.
//
// Posts to /api/bugs (auth required). The user can pick a kind
// (bug / feature) and optionally attach a single screenshot or
// screen-recording up to 50 MB. Diagnostics are gathered locally and
// submitted alongside a user-typed title + description; the admin
// panel (App.Admin → Reports tab) lists every report and lets the
// operator mark them fixed / unfixed.
//
// Request shape:
//   · No attachment → JSON: { kind, title, description, diagnostics }.
//   · With attachment → multipart/form-data with those fields as text
//     parts plus an "attachment" file part. Server contract for
//     attachments: docs/ADMIN_API.md §"Bug reports".
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const APP_VERSION = 'v0.x.y-dev';
  const ENDPOINT    = '/api/bugs';
  const MAX_BODY    = 4000;
  const MAX_DIAG    = 16000;
  const MAX_ATTACH  = 50 * 1024 * 1024;   // 50 MB cap matches the UI label
  const ATTACH_ACCEPT = 'image/*,video/*';
  const KINDS = [
    { value: 'bug',     label: 'Bug report' },
    { value: 'feature', label: 'Feature request' },
  ];
  let chosenAttachment = null;            // File | null — picked file for the current modal session

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
    const kindOptions = KINDS.map(k =>
      '<option value="' + esc(k.value) + '">' + esc(k.label) + '</option>'
    ).join('');
    backdrop.innerHTML =
      '<div class="modal bug-report-modal" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">' +
        '<div class="modal-header">' +
          '<h3 id="bug-report-title">Send feedback</h3>' +
          '<button class="modal-close" id="bug-report-close" aria-label="Close" type="button">&times;</button>' +
        '</div>' +
        '<div class="modal-body bug-report-body">' +
          '<div id="bug-report-signin-prompt" class="bug-report-signin" hidden>' +
            '<p>Sign in to send feedback.</p>' +
            '<button class="btn btn-accent" id="bug-report-signin" type="button">Sign in</button>' +
          '</div>' +
          '<div id="bug-report-form-wrap">' +
            '<label class="bug-report-label" for="bug-report-kind">Type</label>' +
            '<select id="bug-report-kind" class="form-input bug-report-kind">' + kindOptions + '</select>' +
            '<label class="bug-report-label" for="bug-report-summary">Summary</label>' +
            '<input id="bug-report-summary" class="form-input bug-report-summary" type="text" maxlength="200" ' +
              'placeholder="Short description (e.g. Wardens of Ultramar shows wrong stats)" autocomplete="off" />' +
            '<label class="bug-report-label" for="bug-report-desc"><span id="bug-report-desc-label">What went wrong?</span></label>' +
            '<textarea id="bug-report-desc" class="form-input bug-report-desc" rows="5" maxlength="' + MAX_BODY + '" ' +
              'placeholder="Steps to reproduce, what you expected, what happened…"></textarea>' +
            '<label class="bug-report-label" for="bug-report-attach">Screenshot or recording (optional, up to 50 MB)</label>' +
            '<input id="bug-report-attach" class="form-input bug-report-attach" type="file" accept="' + ATTACH_ACCEPT + '" />' +
            '<div class="bug-report-attach-info" id="bug-report-attach-info"></div>' +
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
    backdrop.querySelector('#bug-report-kind').addEventListener('change', onKindChange);
    backdrop.querySelector('#bug-report-attach').addEventListener('change', onAttachmentChange);
    modalEl = backdrop;
    return modalEl;
  }

  function setStatus(msg, kind) {
    const el = modalEl && modalEl.querySelector('#bug-report-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'bug-report-status' + (kind ? (' bug-report-status-' + kind) : '');
  }

  function getCurrentKind() {
    const sel = modalEl && modalEl.querySelector('#bug-report-kind');
    const v = sel && sel.value;
    return KINDS.some(k => k.value === v) ? v : 'bug';
  }
  function onKindChange() {
    const kind = getCurrentKind();
    const titleEl  = modalEl.querySelector('#bug-report-title');
    const descLbl  = modalEl.querySelector('#bug-report-desc-label');
    const descEl   = modalEl.querySelector('#bug-report-desc');
    const submitEl = modalEl.querySelector('#bug-report-submit');
    const signin   = modalEl.querySelector('#bug-report-signin-prompt p');
    if (kind === 'feature') {
      if (titleEl)  titleEl.textContent  = 'Request a feature';
      if (descLbl)  descLbl.textContent  = 'What would you like to see?';
      if (descEl)   descEl.placeholder   = 'Describe the feature, why it would help, any concrete examples…';
      if (submitEl) submitEl.textContent = 'Send request';
      if (signin)   signin.textContent   = 'Sign in to send a feature request.';
    } else {
      if (titleEl)  titleEl.textContent  = 'Report a bug';
      if (descLbl)  descLbl.textContent  = 'What went wrong?';
      if (descEl)   descEl.placeholder   = 'Steps to reproduce, what you expected, what happened…';
      if (submitEl) submitEl.textContent = 'Send report';
      if (signin)   signin.textContent   = 'Sign in to send a bug report.';
    }
  }
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function onAttachmentChange(e) {
    const input   = e.target;
    const infoEl  = modalEl.querySelector('#bug-report-attach-info');
    const file    = (input.files && input.files[0]) || null;
    if (!file) {
      chosenAttachment = null;
      if (infoEl) infoEl.textContent = '';
      return;
    }
    if (file.size > MAX_ATTACH) {
      chosenAttachment = null;
      input.value = '';
      if (infoEl) infoEl.textContent = 'File is ' + formatBytes(file.size) + ' — the limit is 50 MB.';
      setStatus('Attachment too large.', 'error');
      return;
    }
    const looksRight = /^image\//.test(file.type) || /^video\//.test(file.type);
    if (!looksRight) {
      chosenAttachment = null;
      input.value = '';
      if (infoEl) infoEl.textContent = 'Only image and video files are accepted.';
      setStatus('Unsupported attachment type.', 'error');
      return;
    }
    chosenAttachment = file;
    if (infoEl) infoEl.textContent = file.name + ' · ' + formatBytes(file.size);
    setStatus('');
  }

  async function onSubmit() {
    if (!isSignedIn()) {
      // Should not happen — UI is gated — but guard anyway.
      setStatus('Sign in to send feedback.', 'error');
      return;
    }
    const titleEl = modalEl.querySelector('#bug-report-summary');
    const descEl  = modalEl.querySelector('#bug-report-desc');
    const diagEl  = modalEl.querySelector('#bug-report-diag');
    const submit  = modalEl.querySelector('#bug-report-submit');

    const kind        = getCurrentKind();
    const title       = (titleEl.value || '').trim();
    const description = (descEl.value || '').trim();
    let   diagnostics = (diagEl.value || '').trim();
    if (diagnostics.length > MAX_DIAG) diagnostics = diagnostics.slice(0, MAX_DIAG) + '\n…(truncated)…';

    if (!title) {
      setStatus('Please add a short summary.', 'error');
      titleEl.focus();
      return;
    }
    if (!description) {
      setStatus('Please describe ' + (kind === 'feature' ? 'the feature you\'d like.' : 'what happened.'), 'error');
      descEl.focus();
      return;
    }

    submit.disabled = true;
    setStatus(chosenAttachment ? 'Uploading…' : 'Sending…');
    try {
      // Use multipart when there's an attachment so the file is streamed
      // efficiently; fall back to JSON for the common attachment-free
      // path so the server stays backwards-compatible with the original
      // bug-report contract.
      let resp;
      if (chosenAttachment) {
        const fd = new FormData();
        fd.append('kind',        kind);
        fd.append('title',       title);
        fd.append('description', description);
        fd.append('diagnostics', diagnostics);
        fd.append('attachment',  chosenAttachment, chosenAttachment.name);
        resp = await fetch(ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Accept': 'application/json' },
          body: fd,
        });
      } else {
        resp = await fetch(ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ kind, title, description, diagnostics }),
        });
      }
      if (resp.status === 401) {
        if (App.Auth && typeof App.Auth.handleSessionExpired === 'function') App.Auth.handleSessionExpired();
        setStatus('Your session expired. Sign in again.', 'error');
        return;
      }
      if (resp.status === 413) {
        setStatus('The server rejected the upload as too large.', 'error');
        return;
      }
      if (!resp.ok) {
        let data = null; try { data = await resp.json(); } catch (_) {}
        throw new Error((data && data.error) || ('HTTP ' + resp.status));
      }
      toast((kind === 'feature' ? 'Feature request sent' : 'Bug report sent') + ' — thanks!', 'success', 3000);
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

  async function openReport(opts) {
    const el = ensureModal();
    el.hidden = false;

    const formWrap   = el.querySelector('#bug-report-form-wrap');
    const signinWrap = el.querySelector('#bug-report-signin-prompt');
    const kindEl     = el.querySelector('#bug-report-kind');
    const titleEl    = el.querySelector('#bug-report-summary');
    const descEl     = el.querySelector('#bug-report-desc');
    const diagEl     = el.querySelector('#bug-report-diag');
    const attachEl   = el.querySelector('#bug-report-attach');
    const attachInfo = el.querySelector('#bug-report-attach-info');
    const submitBtn  = el.querySelector('#bug-report-submit');

    // Default kind: caller hint > previous selection > 'bug'.
    const wantKind = (opts && opts.kind) || (kindEl && kindEl.value) || 'bug';
    if (kindEl) kindEl.value = KINDS.some(k => k.value === wantKind) ? wantKind : 'bug';
    onKindChange();

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
    descEl.value  = '';
    if (attachEl)   attachEl.value = '';
    if (attachInfo) attachInfo.textContent = '';
    chosenAttachment = null;
    diagEl.value  = 'Gathering diagnostics…';
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
    label: 'Feedback',
    ariaLabel: 'Send feedback (bug report or feature request)',
    title: 'Send feedback (bug report or feature request)',
    onClick: () => openReport(),
  });

  // Public — handy for tests / a future admin shortcut. Pass
  // `{ kind: 'feature' }` to land the user on the feature-request form
  // instead of the bug-report form.
  App.BugReport = { open: openReport };
})();
