// ui/toast.js — transient popup notifications.
(function () {
  const UI = window.UI = window.UI || {};

  // Screen-reader channel. The visible .toast can't double as the live region:
  // sound-fx.js's MutationObserver reads node.textContent the instant the toast
  // is appended, so the text has to be in place BEFORE insertion — and a live
  // region that arrives with its text already inside it usually fails to
  // announce. So we keep two off-screen regions that are already in the DOM and
  // write into them a tick later. 'error' is assertive; everything else polite.
  let politeEl = null, assertiveEl = null;

  function liveRegion(assertive) {
    let el = assertive ? assertiveEl : politeEl;
    if (el && el.isConnected) return el;
    if (!document.body) return null;
    el = document.createElement('div');
    el.id = assertive ? 'toast-live-assertive' : 'toast-live-polite';
    el.setAttribute('role', assertive ? 'alert' : 'status');
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    // Clipped, NOT display:none / visibility:hidden / aria-hidden — those all
    // stop a live region announcing. Inline so this module owns no CSS.
    el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;'
      + 'padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);'
      + 'clip-path:inset(50%);white-space:nowrap;pointer-events:none;';
    document.body.appendChild(el);
    if (assertive) assertiveEl = el; else politeEl = el;
    return el;
  }

  function announce(message, assertive) {
    const region = liveRegion(assertive);
    if (!region) return;
    region.textContent = '';   // reset so an identical repeat still re-announces
    setTimeout(() => { region.textContent = String(message == null ? '' : message); }, 50);
  }

  UI.toast = function (message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    // The off-screen region does the announcing — keep the visual copy out of
    // the accessibility tree so the message isn't read twice.
    el.setAttribute('aria-hidden', 'true');
    container.appendChild(el);
    announce(message, type === 'error');
    setTimeout(() => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
    }, duration);
  };
})();
