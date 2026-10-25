// app/signed-out-banner.js — makes a lost session visible.
//
// Why: the session cookie can expire (or be revoked) while the page still
// holds a cosmetic "signed in" hint. A signed-out page load used to flip to
// anonymous with no cue at all (the topbar is display:none on phones), so a
// browser could run signed out for days with every edit landing in
// localStorage only. App.Auth now tells onChange listeners WHY the user went
// away ({ reason: 'expired' | 'logout' }); this module shows a strip only for
// 'expired' — a deliberate Sign out already says so.
//
// Storage: sessionStorage.yaab_signed_out_banner = '1' once the user has
// dismissed the strip with the x. While set, the banner is not shown again in
// this tab. sessionStorage is per-tab on purpose: a new tab or an app launch
// shows it again, which is wanted — the problem is forgetting, not annoyance.
//
// Phones: the topbar is hidden at <=820px, so the strip sits at the very top
// and the More tab in the bottom bar (injected on bootstrap by pwa-install.js)
// gets a dot while the condition holds. Layout: the strip is position:fixed
// and publishes its measured height as --sob-h; css/auth.css makes room via
// body.has-signed-out-banner.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const DISMISS_KEY = 'yaab_signed_out_banner';
  const DOT = '•';
  let bannerEl = null;
  let _expired = false;     // true from an 'expired' notification until a user signs in

  function dismissed() {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
  }

  function setDot(on) {
    // The tab bar may not exist yet; look it up every time. Only clear a dot
    // we set ourselves.
    const el = document.querySelector('.mobile-tabbar [data-badge="more"]');
    if (!el) return false;
    if (on) el.textContent = DOT;
    else if (el.textContent === DOT) el.textContent = '';
    return true;
  }

  function measure() {
    const h = bannerEl && !bannerEl.hidden ? bannerEl.offsetHeight : 0;
    document.documentElement.style.setProperty('--sob-h', h + 'px');
  }

  function build() {
    const el = document.createElement('div');
    el.id = 'signed-out-banner';
    el.className = 'signed-out-banner';
    el.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.className = 'signed-out-banner-text';
    text.textContent = 'You’re signed out in this browser — your changes stay on this device until you sign in.';

    const signIn = document.createElement('button');
    signIn.type = 'button';
    signIn.className = 'signed-out-banner-btn';
    signIn.textContent = 'Sign in';
    signIn.addEventListener('click', () => {
      if (window.UI && typeof UI.showAuthModal === 'function') UI.showAuthModal('login');
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'signed-out-banner-close';
    close.setAttribute('aria-label', 'Hide');
    close.textContent = '×';
    close.addEventListener('click', () => {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
      unmount();
      setDot(false);
    });

    el.appendChild(text);
    el.appendChild(signIn);
    el.appendChild(close);
    return el;
  }

  function mount() {
    if (bannerEl && bannerEl.isConnected) return;
    bannerEl = build();
    const topbar = document.getElementById('topbar');
    if (topbar && topbar.parentNode === document.body) {
      document.body.insertBefore(bannerEl, topbar.nextSibling);
    } else {
      document.body.insertBefore(bannerEl, document.body.firstChild);
    }
    document.body.classList.add('has-signed-out-banner');
    measure();
  }

  function unmount() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
    document.body.classList.remove('has-signed-out-banner');
    document.documentElement.style.setProperty('--sob-h', '0px');
  }

  function apply() {
    if (_expired && !dismissed()) {
      mount();
      if (!setDot(true)) setTimeout(() => { if (_expired && !dismissed()) setDot(true); }, 500);
    } else {
      unmount();
      setDot(false);
    }
  }

  App.hooks.bootstrap.push(function () {
    if (!App.Auth || typeof App.Auth.onChange !== 'function') return;
    App.Auth.onChange((user, meta) => {
      if (user) {
        _expired = false;
      } else if (meta && meta.reason === 'expired') {
        _expired = true;
      } else {
        _expired = false;    // deliberate logout, or anything else: no banner
      }
      apply();
    });
    window.addEventListener('resize', measure);
  });
})();
