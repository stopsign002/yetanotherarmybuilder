// app/mobile-history.js — wires the mobile panel + More drawer into the
// browser history stack so the back button moves Detail → Units and
// closes the More drawer instead of leaving the site.
//
// Activates only on mobile (matchMedia <= 820px). On desktop the wraps
// are no-ops and popstate ignores us, so two-pane / three-pane layouts
// stay completely unaffected.
//
// Mechanics:
//   - Tapping Details (App.setMobilePanel('detail')) pushes a history
//     state tagged {yaab: 'panel:detail'}.
//   - Opening the More drawer (App.settingsDrawer.open) pushes a state
//     tagged {yaab: 'drawer'}.
//   - popstate inspects the marker on the entry we just landed on and
//     reconciles the UI to match. With no marker we tear down any
//     drawer / detail panel state we previously installed.
//
// We don't try to consume stale entries when the user manually
// navigates away (e.g. tapping Units from Detail). The popstate
// reconciler is idempotent, so a stale "yaab:panel:detail" entry just
// re-aligns the UI to detail when popped — defensible "back rewinds"
// semantics.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MQ = '(max-width: 820px)';
  const MARK_PANEL  = 'panel:detail';
  const MARK_DRAWER = 'drawer';

  function isMobile() {
    try { return window.matchMedia && window.matchMedia(MQ).matches; }
    catch (_) { return false; }
  }

  let _replaying = false;

  function tryPush(mark) {
    try { history.pushState({ yaab: mark }, ''); }
    catch (_) { /* history API unavailable — ignore */ }
  }

  // ── wrap App.setMobilePanel ───────────────────────────────────────────
  function wrapSetPanel() {
    const orig = App.setMobilePanel;
    if (typeof orig !== 'function' || orig._yaabHistoryWrapped) return;
    const wrapped = function (name) {
      const prev = document.body && document.body.dataset.mobilePanel;
      const r = orig.apply(this, arguments);
      const now = document.body && document.body.dataset.mobilePanel;
      if (!_replaying && isMobile() && now === 'detail' && prev !== 'detail') {
        tryPush(MARK_PANEL);
      }
      return r;
    };
    wrapped._yaabHistoryWrapped = true;
    App.setMobilePanel = wrapped;
  }

  // ── wrap App.settingsDrawer ───────────────────────────────────────────
  // We have to wrap BOTH `open` and `toggle`. `toggle` is a closure in
  // settings-drawer.js that calls the IIFE-local `open` directly, so
  // wrapping `App.settingsDrawer.open` alone misses the More-tab path
  // (pwa-install.js calls `toggle()` from the tab bar).
  function wrapDrawer() {
    const d = App.settingsDrawer;
    if (!d || typeof d.open !== 'function' || d._yaabHistoryWrapped) return;
    function maybePushAfterOpen(wasOpen) {
      const isOpenNow = typeof d.isOpen === 'function' ? d.isOpen() : true;
      if (!_replaying && isMobile() && !wasOpen && isOpenNow) {
        tryPush(MARK_DRAWER);
      }
    }
    const origOpen = d.open;
    d.open = function () {
      const wasOpen = typeof d.isOpen === 'function' ? d.isOpen() : false;
      const r = origOpen.apply(this, arguments);
      maybePushAfterOpen(wasOpen);
      return r;
    };
    if (typeof d.toggle === 'function') {
      const origToggle = d.toggle;
      d.toggle = function () {
        const wasOpen = typeof d.isOpen === 'function' ? d.isOpen() : false;
        const r = origToggle.apply(this, arguments);
        maybePushAfterOpen(wasOpen);
        return r;
      };
    }
    d._yaabHistoryWrapped = true;
  }

  // ── popstate reconciler ───────────────────────────────────────────────
  function reconcile(mark) {
    const drawer = App.settingsDrawer;
    const drawerOpen = !!(drawer && typeof drawer.isOpen === 'function' && drawer.isOpen());
    const onDetail = document.body && document.body.dataset.mobilePanel === 'detail';

    if (mark === MARK_DRAWER) {
      // Forward navigation back into the drawer state — re-open if needed.
      if (!drawerOpen && drawer && typeof drawer.open === 'function') {
        drawer.open();
      }
    } else if (mark === MARK_PANEL) {
      // Forward navigation back into the detail state — close drawer,
      // ensure detail panel is active.
      if (drawerOpen && drawer && typeof drawer.close === 'function') {
        drawer.close();
      }
      if (!onDetail && typeof App.setMobilePanel === 'function') {
        App.setMobilePanel('detail');
      }
    } else {
      // Past all of our markers (or a non-yaab entry) — tear down any
      // back-trappable UI we'd installed. Drawer first, then return to
      // Units (the list pane) if we're currently on Detail.
      if (drawerOpen && drawer && typeof drawer.close === 'function') {
        drawer.close();
      }
      if (onDetail && typeof App.setMobilePanel === 'function') {
        App.setMobilePanel('units');
      }
    }
  }

  window.addEventListener('popstate', function (e) {
    const mark = e && e.state && e.state.yaab;
    _replaying = true;
    try { reconcile(mark); }
    finally { _replaying = false; }
  });

  // ── install ───────────────────────────────────────────────────────────
  // Both target APIs are exposed at IIFE-load time by their owning
  // modules. Bootstrap is the safest hook — by then every IIFE has run
  // and any defensive re-wraps would also be in place. Belt-and-braces:
  // also try to wrap immediately in case bootstrap never fires (e.g. an
  // earlier hook threw).
  function install() { wrapSetPanel(); wrapDrawer(); }
  install();
  App.hooks.bootstrap.push(install);
})();
