// ui/offline-pip.js — topbar chip giving feedback on offline state + the
// pending sync queue. See GitHub issue #59: the sync queue itself has
// always been correct (js/app/sync.js drains once navigator.onLine flips
// back), but nothing on screen told the user anything was queued or that
// they were offline at all. Not a toolbar action, so it doesn't register
// via App.hooks.armyToolbarActions — it just needs to sit next to one
// (the auth button), so it inserts its own element directly into the DOM
// at bootstrap time.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const PIP_ID = 'topbar-offline';
  let _el = null;

  function buildPip() {
    const el = document.createElement('span');
    el.id = PIP_ID;
    el.className = 'topbar-offline-pip';
    el.setAttribute('role', 'status');
    el.hidden = true;
    return el;
  }

  function queueLength() {
    return (App.Sync && typeof App.Sync.queueLength === 'function') ? App.Sync.queueLength() : 0;
  }

  // Insert immediately before the auth button's mount point in the topbar
  // icon shelf. That button starts life as a bare placeholder <button
  // id="yaab-btn-auth"> appended straight into #topbar-icons
  // (js/app/index.js buildTopbarShelfButton), then js/ui/auth-button.js's
  // own bootstrap hook replaces it in place with a wrapper <div
  // class="auth-btn-wrap"> holding the real button + dropdown — still a
  // direct child of #topbar-icons, just one level deeper. Script order in
  // index.html runs that swap before this module's hook, but climbing to
  // whichever ancestor IS the direct child of #topbar-icons handles both
  // shapes without caring which one we see.
  function mount() {
    if (_el && _el.isConnected) return _el;
    const el = _el || buildPip();
    const authBtn = document.getElementById('yaab-btn-auth');
    if (authBtn) {
      let anchor = authBtn;
      while (anchor.parentNode && anchor.parentNode.id !== 'topbar-icons') {
        anchor = anchor.parentNode;
      }
      if (anchor.parentNode) {
        anchor.parentNode.insertBefore(el, anchor);
        _el = el;
        return el;
      }
    }
    // Fall back gracefully rather than throwing if the auth button isn't
    // there for some reason.
    const actions = document.querySelector('.topbar-actions');
    if (actions) actions.appendChild(el);
    _el = el;
    return el;
  }

  function render() {
    if (!_el) return;
    const offline = !navigator.onLine;
    const queued = queueLength();
    _el.textContent = '';
    if (offline) {
      _el.appendChild(document.createTextNode('Offline'));
    }
    if (queued > 0) {
      if (offline) _el.appendChild(document.createTextNode(' · '));
      const n = document.createElement('span');
      n.className = 'topbar-offline-n';
      n.textContent = String(queued);
      _el.appendChild(n);
      const word = document.createElement('span');
      word.className = 'topbar-offline-word';
      word.textContent = ' queued';
      _el.appendChild(word);
    }
    _el.hidden = !(offline || queued > 0);
  }

  function update() {
    mount();
    render();
  }

  App.hooks.bootstrap.push(function () {
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('yaab:sync-queue', update);
  });
})();
