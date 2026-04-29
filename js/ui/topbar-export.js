// ui/topbar-export.js — Export button + dropdown menu in the topbar,
// styled like Settings/Help, sitting next to the account button. Replaces
// the in-panel Export dropdown that lived in the .panel-footer toolbar.
// Each menu item programmatically clicks the original (now-hidden) button
// in the panel-footer compat shelf, so existing event-listener wiring
// (events.js + activity-log + command-palette) keeps firing untouched.
(function () {
  const App = window.App = window.App || {};
  const UI = window.UI = window.UI || {};
  if (!App.hooks) return;

  const BTN_ID  = 'topbar-export-btn';
  const MENU_ID = 'topbar-export-menu';

  function clickHidden(id) {
    const el = document.getElementById(id);
    if (el && typeof el.click === 'function') el.click();
  }

  function build() {
    const wrap = document.createElement('div');
    wrap.className = 'topbar-export-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'topbar-action-btn topbar-export-btn';
    btn.title = 'Export army';
    btn.setAttribute('aria-label', 'Export army');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');

    const glyph = document.createElement('span');
    glyph.className = 'topbar-action-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '⬇'; // ⬇ down arrow / export glyph
    btn.appendChild(glyph);

    const label = document.createElement('span');
    label.className = 'topbar-action-label';
    label.textContent = 'Export';
    btn.appendChild(label);

    const caret = document.createElement('span');
    caret.className = 'topbar-export-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾'; // ▾
    btn.appendChild(caret);

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'auth-menu topbar-export-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    function mkItem(textLabel, hiddenBtnId) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'auth-menu-item';
      it.setAttribute('role', 'menuitem');
      it.textContent = textLabel;
      it.addEventListener('click', () => { closeMenu(); clickHidden(hiddenBtnId); });
      return it;
    }

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
    }
    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) {
      if (!wrap.contains(e.target)) closeMenu();
    }
    btn.addEventListener('click', () => { menu.hidden ? openMenu() : closeMenu(); });

    menu.appendChild(mkItem('Copy army code',  'btn-export-string'));
    menu.appendChild(mkItem('Copy as text',    'btn-export-text'));
    menu.appendChild(mkItem('Download CSV',    'btn-export-csv'));
    menu.appendChild(mkItem('Print datasheets','btn-print-army'));

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  function mount() {
    if (document.getElementById(BTN_ID)) return; // already mounted
    const actions = document.querySelector('.topbar-actions');
    if (!actions) return;
    const settingsBtn = document.getElementById('topbar-settings');
    const node = build();
    if (settingsBtn && settingsBtn.parentNode === actions) {
      actions.insertBefore(node, settingsBtn);
    } else {
      actions.appendChild(node);
    }
  }

  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(mount);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
