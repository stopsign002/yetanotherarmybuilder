// app/qr-share.js — render a QR code for the current share URL (mobile-to-mobile).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MAX_QR_CHARS = 1500;
  let modalEl = null;

  // ── share url generation (mirrors url-share.js) ──────────────────────────

  async function buildShareUrl() {
    const state = App.state;
    if (!state || !state.currentArmy || !window.Storage) return null;
    const code = await Storage.exportArmyToString(state.currentArmy, {
      factionName:    state.factionFilter && state.factionFilter !== 'all' ? state.factionFilter : '',
      chapter:        state.selectedChapter,
      detachmentName: state.selectedDetachment ? state.selectedDetachment.name : null,
    });
    return window.location.origin + window.location.pathname + '?a=' + code;
  }

  // ── qr rendering ─────────────────────────────────────────────────────────

  function renderQrSvg(url) {
    if (typeof window.qrcode !== 'function') {
      throw new Error('QR library not loaded');
    }
    // Type 0 = auto-select the smallest version that fits; ECC level L for
    // maximum capacity (share URLs are long).
    const qr = window.qrcode(0, 'L');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }

  // ── modal ────────────────────────────────────────────────────────────────

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-qr-share';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal qr-share-modal">' +
        '<div class="modal-header">' +
          '<h3>Scan to share army</h3>' +
          '<button class="modal-close" id="qr-share-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="qr-share-warn" id="qr-share-warn" hidden></div>' +
          '<div class="qr-share-canvas" id="qr-share-canvas"></div>' +
          '<label class="qr-share-url-label" for="qr-share-url">Share URL</label>' +
          '<textarea id="qr-share-url" class="qr-share-url" readonly rows="3"></textarea>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-accent" id="qr-share-copy" type="button">Copy URL</button>' +
          '<span class="toolbar-spacer" style="flex:1"></span>' +
          '<button class="btn btn-outline" id="qr-share-done" type="button">Done</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#qr-share-close').addEventListener('click', closeModal);
    backdrop.querySelector('#qr-share-done').addEventListener('click', closeModal);
    backdrop.querySelector('#qr-share-copy').addEventListener('click', onCopyUrl);
    modalEl = backdrop;
    return modalEl;
  }

  async function onCopyUrl() {
    const ta = modalEl && modalEl.querySelector('#qr-share-url');
    const url = ta ? ta.value : '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      if (window.UI && typeof UI.toast === 'function') UI.toast('URL copied', 'success');
    } catch (_) {
      try { ta.select(); document.execCommand('copy'); }
      catch (__) {
        if (window.UI && typeof UI.toast === 'function') UI.toast('Clipboard unavailable', 'error', 4000);
      }
    }
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  async function showQr() {
    if (!App.state || !App.state.currentArmy) {
      if (window.UI && typeof UI.toast === 'function') UI.toast('No army to share', 'info');
      return;
    }
    if (typeof window.qrcode !== 'function') {
      if (window.UI && typeof UI.toast === 'function') {
        UI.toast('QR library not loaded', 'error', 4000);
      }
      return;
    }
    const el = ensureModal();
    const canvas = el.querySelector('#qr-share-canvas');
    const urlTa  = el.querySelector('#qr-share-url');
    const warn   = el.querySelector('#qr-share-warn');

    canvas.innerHTML = '<div class="qr-share-loading muted">Generating&hellip;</div>';
    urlTa.value = '';
    warn.hidden = true;
    el.hidden = false;

    let url;
    try { url = await buildShareUrl(); }
    catch (err) {
      canvas.innerHTML = '';
      warn.hidden = false;
      warn.textContent = 'Failed to build share URL: ' + (err && err.message);
      return;
    }
    if (!url) {
      canvas.innerHTML = '';
      warn.hidden = false;
      warn.textContent = 'No army to share.';
      return;
    }

    urlTa.value = url;

    if (url.length > MAX_QR_CHARS) {
      canvas.innerHTML = '';
      warn.hidden = false;
      warn.textContent =
        'This army\'s share URL is ' + url.length + ' characters — too long for a reliably scannable QR code. ' +
        'Try removing a few units, or share the URL directly (use "Copy URL").';
      return;
    }

    try {
      canvas.innerHTML = renderQrSvg(url);
    } catch (err) {
      canvas.innerHTML = '';
      warn.hidden = false;
      warn.textContent = 'QR generation failed: ' + (err && err.message);
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  // ── hook registration ────────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-qr-share',
    region: 'export-menu',
    label: 'Show QR code',
    title: 'Display a QR code for the share URL (mobile-to-mobile)',
    onClick: showQr,
  });
})();
