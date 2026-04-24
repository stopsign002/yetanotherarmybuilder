// app/bug-report.js — diagnostics modal + prefilled GitHub issue link.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const APP_VERSION = 'v0.x.y-dev';
  const REPO_URL    = 'https://github.com/traviscw/yetanotherarmybuilder';
  const MAX_URL     = 8000; // GitHub caps issue URLs around 8 KB.

  let modalEl = null;
  let lastDiagnostics = '';
  let lastTruncated = false;

  // ── diagnostics collection ───────────────────────────────────────────────

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

  // ── github issue URL construction ────────────────────────────────────────

  function buildIssueBody(diagnostics) {
    return [
      '<!-- Describe the issue above this line -->',
      '',
      '',
      '### Diagnostics',
      '```',
      diagnostics,
      '```',
    ].join('\n');
  }

  function buildIssueUrl(diagnostics) {
    const title = 'Bug report: ';
    const body  = buildIssueBody(diagnostics);
    const base  = REPO_URL + '/issues/new?title=' + encodeURIComponent(title) +
                  '&body=' + encodeURIComponent(body);
    if (base.length <= MAX_URL) return { url: base, truncated: false };

    // Binary-ish trim of the diagnostics block until the encoded URL fits.
    let body2 = body;
    let code = diagnostics;
    while (code.length > 200) {
      code = code.slice(0, Math.floor(code.length * 0.8));
      body2 = buildIssueBody(code + '\n…(truncated)…');
      const u = REPO_URL + '/issues/new?title=' + encodeURIComponent(title) +
                '&body=' + encodeURIComponent(body2);
      if (u.length <= MAX_URL) return { url: u, truncated: true };
    }
    // Last resort — tiny body.
    const tiny = REPO_URL + '/issues/new?title=' + encodeURIComponent(title) +
                 '&body=' + encodeURIComponent('(diagnostics too large to inline — please paste manually)');
    return { url: tiny, truncated: true };
  }

  // ── modal ────────────────────────────────────────────────────────────────

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-bug-report';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal bug-report-modal">' +
        '<div class="modal-header">' +
          '<h3>Report a bug</h3>' +
          '<button class="modal-close" id="bug-report-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p class="muted bug-report-help">' +
            'The diagnostics below will be included in your GitHub issue. ' +
            'Review, then click "Open GitHub issue" to file it, or "Copy diagnostics" to paste elsewhere.' +
          '</p>' +
          '<div class="bug-report-warn" id="bug-report-warn" hidden></div>' +
          '<textarea id="bug-report-diag" class="bug-report-diag" rows="14" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-accent" id="bug-report-open" type="button">Open GitHub issue</button>' +
          '<button class="btn btn-outline" id="bug-report-copy" type="button" style="margin-left:8px">Copy diagnostics</button>' +
          '<span class="toolbar-spacer" style="flex:1"></span>' +
          '<button class="btn btn-outline" id="bug-report-cancel" type="button">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#bug-report-close').addEventListener('click', closeModal);
    backdrop.querySelector('#bug-report-cancel').addEventListener('click', closeModal);
    backdrop.querySelector('#bug-report-open').addEventListener('click', onOpenIssue);
    backdrop.querySelector('#bug-report-copy').addEventListener('click', onCopyDiag);
    modalEl = backdrop;
    return modalEl;
  }

  function onOpenIssue() {
    const diag = (modalEl && modalEl.querySelector('#bug-report-diag').value) || lastDiagnostics;
    const { url, truncated } = buildIssueUrl(diag);
    if (truncated && window.UI && typeof UI.toast === 'function') {
      UI.toast('Diagnostics were truncated to fit GitHub URL limit', 'info', 5000);
    }
    try { window.open(url, '_blank', 'noopener,noreferrer'); }
    catch (_) { window.location.href = url; }
  }

  async function onCopyDiag() {
    const diag = (modalEl && modalEl.querySelector('#bug-report-diag').value) || lastDiagnostics;
    try {
      await navigator.clipboard.writeText(diag);
      if (window.UI && typeof UI.toast === 'function') UI.toast('Diagnostics copied', 'success');
    } catch (_) {
      if (window.UI && typeof UI.toast === 'function') UI.toast('Clipboard unavailable', 'error', 4000);
    }
  }

  async function openReport() {
    const el = ensureModal();
    el.hidden = false;
    const diagEl = el.querySelector('#bug-report-diag');
    const warnEl = el.querySelector('#bug-report-warn');
    if (diagEl) diagEl.value = 'Gathering diagnostics…';
    if (warnEl) warnEl.hidden = true;
    const diag = await gatherDiagnostics();
    lastDiagnostics = diag;
    if (diagEl) diagEl.value = diag;
    const probe = buildIssueUrl(diag);
    lastTruncated = probe.truncated;
    if (lastTruncated && warnEl) {
      warnEl.hidden = false;
      warnEl.textContent =
        'Warning: diagnostics are too large for a GitHub issue URL and will be truncated. ' +
        'Use "Copy diagnostics" and paste manually for the full payload.';
    }
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  // ── hook registration ────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-bug-report',
    region: 'icon',
    label: '!',
    ariaLabel: 'Report bug',
    title: 'Report an issue',
    onClick: openReport,
  });
})();
