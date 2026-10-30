// app/admin.js — Admin panel for site operators (stopsign002 by default).
//
// Surfaces four things behind an admin-only modal:
//   1. Pending account approvals + approve/revoke
//   2. All approved accounts + revoke
//   3. All uploaded images (across users) + delete (moderation)
//   4. User-submitted bug reports + mark fixed / unfix / delete
//
// The auth layer reads `is_admin` from /api/auth/me — admins see an
// "Admin" entry in the topbar account dropdown. Server-side permissions
// are checked again on every /api/admin/* call (the client gate is just
// for UX).
//
// Server contract: docs/ADMIN_API.md.
//
// Also owns UI.askDialog(): the site's styled confirm/prompt replacement
// (.modal + .btn/.btn-outline). admin.js is the first of the three files that
// use it (admin, bug-report, cards-mode — all `defer`, loaded in that order),
// so it is defined here rather than copied three times.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};

  const ADMIN_API = '/api/admin';

  function esc(s) {
    if (UI && UI.escapeHtml) return UI.escapeHtml(s == null ? '' : String(s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function toast(msg, kind, ms) {
    if (UI && UI.toast) UI.toast(msg, kind || 'info', ms || 2500);
  }
  function fmtDate(ms) {
    if (!ms) return '—';
    try { return new Date(ms).toLocaleString(); } catch (_) { return String(ms); }
  }
  async function fetchJson(path, opts) {
    const init = Object.assign({
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    }, opts || {});
    if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
    if (init.body) init.headers['Content-Type'] = 'application/json';
    const resp = await fetch(ADMIN_API + path, init);
    if (resp.status === 401) {
      if (App.Auth && typeof App.Auth.handleSessionExpired === 'function') {
        App.Auth.handleSessionExpired();
      }
      const e = new Error('Unauthorized'); e.status = 401; throw e;
    }
    if (resp.status === 403) {
      const e = new Error('Forbidden'); e.status = 403; throw e;
    }
    if (resp.status === 204) return null;
    let data = null;
    try { data = await resp.json(); } catch (_) {}
    if (!resp.ok) {
      const e = new Error((data && data.error) || ('HTTP ' + resp.status));
      e.status = resp.status; e.data = data;
      throw e;
    }
    return data;
  }

  // ── Styled confirm / prompt ─────────────────────────────────────────────
  // UI.askDialog({ title, message, confirmLabel, cancelLabel, danger, input })
  //   · no `input`  → resolves true (confirm) / false (cancel, Esc, backdrop)
  //   · with `input: { label, value, placeholder, maxlength }`
  //                 → resolves the typed string (maybe '') or null on cancel
  // Cancel is a real .btn-outline button, same box as the primary. Esc is
  // taken on `window` in the capture phase and stopped, so a panel that sits
  // underneath (admin, bug-report, card options) does not also close.
  let askOpen = false;
  function askDialog(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      const wantsInput = !!opts.input;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop yaab-ask-backdrop';
      backdrop.style.zIndex = '2000';            // above admin (1600) and auth (1500)
      const uid = 'yaab-ask-' + Math.random().toString(36).slice(2, 8);
      backdrop.innerHTML =
        '<div class="modal yaab-ask-modal" role="dialog" aria-modal="true" aria-labelledby="' + uid + '-t" style="max-width:420px">' +
          '<div class="modal-header"><h3 id="' + uid + '-t">' + esc(opts.title || 'Confirm') + '</h3></div>' +
          '<div class="modal-body">' +
            (opts.message ? '<p class="yaab-ask-msg" style="margin:0 0 10px;white-space:pre-line">' + esc(opts.message) + '</p>' : '') +
            (wantsInput
              ? (opts.input.label ? '<label for="' + uid + '-i" class="bug-report-label">' + esc(opts.input.label) + '</label>' : '')
                + '<input id="' + uid + '-i" class="form-input" type="text" autocomplete="off" style="width:100%"'
                + (opts.input.maxlength ? ' maxlength="' + (opts.input.maxlength | 0) + '"' : '')
                + (opts.input.placeholder ? ' placeholder="' + esc(opts.input.placeholder) + '"' : '') + '>'
              : '') +
          '</div>' +
          '<div class="modal-footer" style="gap:8px;justify-content:flex-end">' +
            '<button type="button" class="btn btn-outline" data-ask="cancel">' + esc(opts.cancelLabel || 'Cancel') + '</button>' +
            '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-accent') + '" data-ask="ok">' + esc(opts.confirmLabel || 'OK') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(backdrop);
      askOpen = true;
      const inputEl = backdrop.querySelector('input');
      if (inputEl) inputEl.value = opts.input.value == null ? '' : String(opts.input.value);

      let done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        askOpen = false;
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (_) {}
        resolve(wantsInput ? (ok ? inputEl.value : null) : !!ok);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
        else if (e.key === 'Enter' && inputEl && e.target === inputEl) { e.preventDefault(); e.stopImmediatePropagation(); finish(true); }
        else if (e.key === 'Tab') {
          // keep focus inside the dialog
          const f = Array.from(backdrop.querySelectorAll('input,button'));
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          else if (!backdrop.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        }
      }
      window.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) return finish(false);
        const b = e.target.closest('button[data-ask]');
        if (b) finish(b.getAttribute('data-ask') === 'ok');
      });
      setTimeout(() => {
        const target = inputEl || backdrop.querySelector('[data-ask="ok"]');
        if (target) { target.focus(); if (inputEl && inputEl.select) inputEl.select(); }
      }, 0);
    });
  }
  askDialog.isOpen = () => askOpen;
  UI.askDialog = askDialog;

  // ── State ───────────────────────────────────────────────────────────────
  let modalEl = null;
  let activeTab = 'pending';   // 'pending' | 'users' | 'images' | 'bugs'
  let users = [];              // [{ username, approved, revoked, is_admin, created_at, approved_at, image_count }]
  let images = [];             // [{ id, owner, name, dataUrl, addedAt }]
  let bugs = [];               // [{ id, username, title, description, diagnostics, fixed, fixed_at, fixed_by, fixed_note, created_at }]
  let bugFilter = 'open';      // 'all' | 'open' | 'fixed'
  let loading = false;
  let loadError = null;        // message of the last failed load for the active tab, or null
  let reqSeq = 0;              // bumped per load; a response for an older seq is discarded
  const IMG_PAGE = 20;         // Images tab is paginated client-side
  let imagePage = 0;

  // ── Modal shell ─────────────────────────────────────────────────────────
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'admin-backdrop';
    modalEl.id = 'yaab-admin-modal';
    modalEl.setAttribute('hidden', '');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', 'Admin panel');

    modalEl.innerHTML = ''
      + '<div class="admin-modal" role="document">'
      +   '<header class="admin-head">'
      +     '<h2 class="admin-title">Admin</h2>'
      +     '<nav class="admin-tabs" role="tablist">'
      +       '<button type="button" class="admin-tab" data-tab="pending" role="tab">Pending</button>'
      +       '<button type="button" class="admin-tab" data-tab="users"   role="tab">Users</button>'
      +       '<button type="button" class="admin-tab" data-tab="images"  role="tab">Images</button>'
      +       '<button type="button" class="admin-tab" data-tab="bugs"    role="tab">Reports</button>'
      +     '</nav>'
      +     '<button type="button" class="admin-close" aria-label="Close">&times;</button>'
      +   '</header>'
      +   '<div class="admin-body" id="admin-body"></div>'
      + '</div>';

    document.body.appendChild(modalEl);

    modalEl.addEventListener('click', e => { if (e.target === modalEl) close(); });
    modalEl.querySelector('.admin-close').addEventListener('click', close);
    modalEl.querySelector('.admin-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.admin-tab');
      if (!btn) return;
      activeTab = btn.dataset.tab;
      reloadAndRender();
    });
    modalEl.querySelector('#admin-body').addEventListener('click', onBodyClick);

    return modalEl;
  }

  // ── Tab rendering ───────────────────────────────────────────────────────
  function renderTabs() {
    modalEl.querySelectorAll('.admin-tab').forEach(btn => {
      const on = btn.dataset.tab === activeTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  function renderBody() {
    const body = modalEl.querySelector('#admin-body');
    if (loading) {
      body.innerHTML = '<div class="admin-empty">Loading…</div>';
      return;
    }
    if (loadError) {
      // A failed fetch is not an empty list — say so, and offer a retry.
      body.innerHTML = '<div class="admin-empty admin-error" role="alert">'
        + '<p>Couldn\u2019t load this tab: ' + esc(loadError) + '</p>'
        + '<button type="button" class="btn btn-outline" data-act="retry">Retry</button>'
        + '</div>';
      return;
    }
    if (activeTab === 'images') {
      body.innerHTML = renderImages();
    } else if (activeTab === 'bugs') {
      body.innerHTML = renderBugs();
    } else {
      body.innerHTML = renderUsers(activeTab);
    }
  }

  function renderUsers(scope) {
    const list = users.filter(u => scope === 'pending' ? !u.approved && !u.revoked : true);
    if (list.length === 0) {
      return '<div class="admin-empty">'
        + (scope === 'pending' ? 'No accounts awaiting approval.' : 'No users.')
        + '</div>';
    }
    const rows = list.map(u => {
      const status = u.revoked ? 'Revoked'
                  : !u.approved ? 'Pending'
                  : u.is_admin ? 'Admin'
                  : 'Approved';
      const statusClass = u.revoked ? 'is-revoked'
                       : !u.approved ? 'is-pending'
                       : u.is_admin ? 'is-admin'
                       : 'is-ok';
      const actions = [];
      if (!u.approved && !u.revoked) actions.push('<button class="admin-btn admin-btn-primary" data-act="approve" data-user="' + esc(u.username) + '">Approve</button>');
      if (u.approved && !u.revoked && !u.is_admin) actions.push('<button class="admin-btn admin-btn-danger" data-act="revoke" data-user="' + esc(u.username) + '">Revoke</button>');
      if (u.revoked) actions.push('<button class="admin-btn admin-btn-primary" data-act="approve" data-user="' + esc(u.username) + '">Reinstate</button>');
      return '<tr>'
        + '<td>' + esc(u.username) + '</td>'
        + '<td><span class="admin-pill ' + statusClass + '">' + esc(status) + '</span></td>'
        + '<td>' + fmtDate(u.created_at) + '</td>'
        + '<td>' + fmtDate(u.approved_at) + '</td>'
        + '<td>' + (u.image_count != null ? u.image_count : '—') + '</td>'
        + '<td class="admin-actions">' + actions.join(' ') + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="admin-table-wrap"><table class="admin-table">'
      + '<thead><tr>'
      +   '<th>Username</th><th>Status</th><th>Created</th><th>Approved</th><th>Images</th><th></th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>';
  }

  function renderImages() {
    if (images.length === 0) return '<div class="admin-empty">No images uploaded yet.</div>';
    const pages = Math.max(1, Math.ceil(images.length / IMG_PAGE));
    if (imagePage > pages - 1) imagePage = pages - 1;
    if (imagePage < 0) imagePage = 0;
    const slice = images.slice(imagePage * IMG_PAGE, (imagePage + 1) * IMG_PAGE);
    const pager = pages > 1
      ? '<div class="admin-pager" style="display:flex;align-items:center;gap:10px;margin:8px 0">'
        + '<button type="button" class="btn btn-outline" data-act="img-prev"' + (imagePage === 0 ? ' disabled' : '') + '>Previous</button>'
        + '<span class="admin-pager-info">Page ' + (imagePage + 1) + ' of ' + pages + ' · ' + images.length + ' images</span>'
        + '<button type="button" class="btn btn-outline" data-act="img-next"' + (imagePage >= pages - 1 ? ' disabled' : '') + '>Next</button>'
        + '</div>'
      : '';
    const cards = slice.map(img => {
      return '<figure class="admin-img" data-image-id="' + esc(img.id) + '">'
        + '<img src="' + esc(img.dataUrl) + '" alt="' + esc(img.name || '') + '">'
        + '<figcaption>'
        +   '<div class="admin-img-name">' + esc(img.name || '(unnamed)') + '</div>'
        +   '<div class="admin-img-meta">'
        +     '<span><strong>' + esc(img.owner || '?') + '</strong></span>'
        +     '<span>' + fmtDate(img.addedAt) + '</span>'
        +   '</div>'
        +   '<button class="admin-btn admin-btn-danger" data-act="image-delete" data-image-id="' + esc(img.id) + '">Delete</button>'
        + '</figcaption>'
        + '</figure>';
    }).join('');
    return pager + '<div class="admin-img-grid">' + cards + '</div>' + pager;
  }

  // Screenshot / recording the reporter attached (served admin-only by
  // GET /api/admin/bugs/:id/attachment). Images and video preview inline;
  // the link opens the original full size.
  function renderBugAttachment(b) {
    if (!b.attachment_url) return '';
    const url = esc(b.attachment_url);
    const mime = String(b.attachment_mime || '');
    const size = b.attachment_size ? ' · ' + (b.attachment_size >= 1048576
      ? (b.attachment_size / 1048576).toFixed(1) + ' MB'
      : Math.max(1, Math.round(b.attachment_size / 1024)) + ' KB') : '';
    const media = mime.startsWith('video/')
      ? '<video class="admin-bug-attach-media" src="' + url + '" controls preload="metadata"></video>'
      : '<a href="' + url + '" target="_blank" rel="noopener"><img class="admin-bug-attach-media" src="' + url + '" alt="Attached screenshot" loading="lazy"></a>';
    return '<div class="admin-bug-attach">' + media
      + '<a class="admin-bug-attach-link" href="' + url + '" target="_blank" rel="noopener">Open attachment</a>'
      + '<span class="admin-bug-attach-meta">' + esc(mime) + esc(size) + '</span></div>';
  }

  function renderBugs() {
    const filter = bugFilter;
    const list = bugs.filter(b => filter === 'all' ? true : filter === 'fixed' ? !!b.fixed : !b.fixed);
    const filterTabs =
      '<div class="admin-bug-filters" role="tablist">' +
        '<button type="button" class="admin-filter' + (filter === 'open'  ? ' is-active' : '') + '" data-bug-filter="open">Open</button>' +
        '<button type="button" class="admin-filter' + (filter === 'fixed' ? ' is-active' : '') + '" data-bug-filter="fixed">Fixed</button>' +
        '<button type="button" class="admin-filter' + (filter === 'all'   ? ' is-active' : '') + '" data-bug-filter="all">All</button>' +
      '</div>';
    if (list.length === 0) {
      return filterTabs + '<div class="admin-empty">No '
        + (filter === 'fixed' ? 'fixed' : filter === 'open' ? 'open' : '')
        + ' reports.</div>';
    }
    const cards = list.map(b => {
      const fixed = !!b.fixed;
      const status = fixed ? 'Fixed' : 'Open';
      const statusClass = fixed ? 'is-ok' : 'is-pending';
      const actions = fixed
        ? '<button class="admin-btn admin-btn-outline" data-act="bug-unfix" data-bug-id="' + esc(b.id) + '">Reopen</button>'
        : '<button class="admin-btn admin-btn-primary" data-act="bug-fix" data-bug-id="' + esc(b.id) + '">Mark fixed</button>';
      const del = ' <button class="admin-btn admin-btn-danger" data-act="bug-delete" data-bug-id="' + esc(b.id) + '">Delete</button>';
      const fixedMeta = fixed
        ? '<div class="admin-bug-fixed-meta">Fixed ' + esc(fmtDate(b.fixed_at))
            + (b.fixed_by ? ' by ' + esc(b.fixed_by) : '')
            + (b.fixed_note ? ' · ' + esc(b.fixed_note) : '')
            + '</div>'
        : '';
      return '<article class="admin-bug-card" data-bug-id="' + esc(b.id) + '">'
        + '<header class="admin-bug-head">'
        +   '<div class="admin-bug-title">' + esc(b.title || '(no title)') + '</div>'
        +   '<span class="admin-pill ' + statusClass + '">' + esc(status) + '</span>'
        + '</header>'
        + '<div class="admin-bug-meta">'
        +   '<span><strong>' + esc(b.username || '?') + '</strong></span>'
        +   '<span>' + esc(fmtDate(b.created_at)) + '</span>'
        +   (b.kind === 'feature' ? '<span class="admin-pill is-feature">Feature request</span>' : '')
        + '</div>'
        + '<p class="admin-bug-desc">' + esc(b.description || '') + '</p>'
        + renderBugAttachment(b)
        + (b.diagnostics
          ? '<details class="admin-bug-diag-wrap"><summary>Diagnostics</summary>'
            + '<pre class="admin-bug-diag">' + esc(b.diagnostics) + '</pre></details>'
          : '')
        + fixedMeta
        + '<div class="admin-actions">' + actions + del + '</div>'
        + '</article>';
    }).join('');
    return filterTabs + '<div class="admin-bug-list">' + cards + '</div>';
  }

  // ── Click handler ───────────────────────────────────────────────────────
  function onBodyClick(e) {
    const filterBtn = e.target.closest('button[data-bug-filter]');
    if (filterBtn) {
      bugFilter = filterBtn.getAttribute('data-bug-filter');
      renderBody();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act  = btn.getAttribute('data-act');
    const user = btn.getAttribute('data-user');
    const imgId = btn.getAttribute('data-image-id');
    const bugId = btn.getAttribute('data-bug-id');
    if (act === 'retry') return reloadAndRender();
    if (act === 'img-prev') { imagePage = Math.max(0, imagePage - 1); renderBody(); return; }
    if (act === 'img-next') { imagePage += 1; renderBody(); return; }
    if (act === 'approve' && user) return doApprove(user, btn);
    if (act === 'revoke'  && user) return doRevoke(user, btn);
    if (act === 'image-delete' && imgId) return doDeleteImage(imgId, btn);
    if (act === 'bug-fix'    && bugId) return doFixBug(bugId, btn);
    if (act === 'bug-unfix'  && bugId) return doUnfixBug(bugId, btn);
    if (act === 'bug-delete' && bugId) return doDeleteBug(bugId, btn);
  }

  async function doApprove(username, btn) {
    btn.disabled = true;
    try {
      await fetchJson('/users/' + encodeURIComponent(username) + '/approve', { method: 'POST' });
      toast(username + ' approved.', 'info');
      await reloadAndRender();
    } catch (err) {
      toast('Approve failed: ' + (err.message || 'unknown'), 'error', 4000);
      btn.disabled = false;
    }
  }
  async function doRevoke(username, btn) {
    if (!await askDialog({
      title: 'Revoke ' + username + '?',
      message: 'They will be signed out and unable to log in.',
      confirmLabel: 'Revoke', danger: true,
    })) return;
    btn.disabled = true;
    try {
      await fetchJson('/users/' + encodeURIComponent(username) + '/revoke', { method: 'POST' });
      toast(username + ' revoked.', 'info');
      await reloadAndRender();
    } catch (err) {
      toast('Revoke failed: ' + (err.message || 'unknown'), 'error', 4000);
      btn.disabled = false;
    }
  }
  async function doDeleteImage(id, btn) {
    if (!await askDialog({ title: 'Delete image?', message: 'This permanently deletes the image.', confirmLabel: 'Delete', danger: true })) return;
    btn.disabled = true;
    try {
      await fetchJson('/images/' + encodeURIComponent(id), { method: 'DELETE' });
      images = images.filter(i => String(i.id) !== String(id));
      toast('Image deleted.', 'info');
      renderBody();
    } catch (err) {
      toast('Delete failed: ' + (err.message || 'unknown'), 'error', 4000);
      btn.disabled = false;
    }
  }

  async function doFixBug(id, btn) {
    // Cancel (null) aborts. Only an explicit confirm — with or without a
    // note — marks the report fixed, because the reporter is emailed for it.
    const typed = await askDialog({
      title: 'Mark fixed',
      message: 'The reporter is emailed when a report is marked fixed.',
      confirmLabel: 'Mark fixed',
      input: { label: 'Optional note (e.g. commit hash or PR #)', value: '', maxlength: 500 },
    });
    if (typed === null) return;
    const note = typed;
    btn.disabled = true;
    try {
      const updated = await fetchJson('/bugs/' + encodeURIComponent(id) + '/fix', {
        method: 'POST', body: { note: note.trim() || undefined },
      });
      // Server may return the updated record — fall back to a local patch.
      const idx = bugs.findIndex(b => String(b.id) === String(id));
      if (idx >= 0) {
        bugs[idx] = Object.assign({}, bugs[idx],
          updated && typeof updated === 'object' && updated.id ? updated : {
            fixed: true,
            fixed_at: Date.now(),
            fixed_by: (App.Auth && App.Auth.getCurrentUser && App.Auth.getCurrentUser()?.username) || 'admin',
            fixed_note: note.trim() || null,
          });
      }
      toast('Marked fixed.', 'info');
      renderBody();
    } catch (err) {
      toast('Mark-fixed failed: ' + (err.message || 'unknown'), 'error', 4000);
      btn.disabled = false;
    }
  }
  async function doUnfixBug(id, btn) {
    btn.disabled = true;
    try {
      const updated = await fetchJson('/bugs/' + encodeURIComponent(id) + '/unfix', { method: 'POST' });
      const idx = bugs.findIndex(b => String(b.id) === String(id));
      if (idx >= 0) {
        bugs[idx] = Object.assign({}, bugs[idx],
          updated && typeof updated === 'object' && updated.id ? updated : {
            fixed: false, fixed_at: null, fixed_by: null, fixed_note: null,
          });
      }
      toast('Reopened.', 'info');
      renderBody();
    } catch (err) {
      toast('Reopen failed: ' + (err.message || 'unknown'), 'error', 4000);
      btn.disabled = false;
    }
  }
  async function doDeleteBug(id, btn) {
    if (!await askDialog({ title: 'Delete report?', message: 'This permanently deletes the report.', confirmLabel: 'Delete', danger: true })) return;
    btn.disabled = true;
    try {
      await fetchJson('/bugs/' + encodeURIComponent(id), { method: 'DELETE' });
      bugs = bugs.filter(b => String(b.id) !== String(id));
      toast('Report deleted.', 'info');
      renderBody();
    } catch (err) {
      toast('Delete failed: ' + (err.message || 'unknown'), 'error', 4000);
      btn.disabled = false;
    }
  }

  async function reloadAndRender() {
    const seq = ++reqSeq;
    const tab = activeTab;
    loading = true;
    loadError = null;
    if (tab === 'images') imagePage = 0;
    renderTabs();
    renderBody();
    try {
      // Fetch into locals; only the newest request is allowed to commit, so
      // rapid tab switching can't paint tab A's data under tab B.
      let data = await fetchJson(tab === 'images' ? '/images' : tab === 'bugs' ? '/bugs' : '/users');
      if (seq !== reqSeq) return;
      if (!Array.isArray(data)) data = [];
      if (tab === 'images') images = data;
      else if (tab === 'bugs') {
        bugs = data;
        // Newest first; server should already do this, but be defensive.
        bugs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      } else users = data;
    } catch (err) {
      if (seq !== reqSeq) return;
      if (err.status === 403) {
        loading = false;
        toast('Admin access denied.', 'error', 4000);
        close();
        return;
      }
      loadError = err.message || 'unknown error';
      toast('Failed to load: ' + loadError, 'error', 4000);
    }
    loading = false;
    renderBody();
  }

  // ── Open / close ────────────────────────────────────────────────────────
  function open(initialTab) {
    if (!App.Auth || !App.Auth.isAdmin || !App.Auth.isAdmin()) {
      toast('Admin only.', 'warning');
      return;
    }
    ensureModal();
    activeTab = (initialTab && ['pending', 'users', 'images', 'bugs'].includes(initialTab))
      ? initialTab : 'pending';
    renderTabs();
    modalEl.removeAttribute('hidden');
    document.body.classList.add('admin-modal-open');
    document.addEventListener('keydown', onKeydown, true);
    reloadAndRender();
  }
  function close() {
    if (!modalEl || modalEl.hasAttribute('hidden')) return;
    modalEl.setAttribute('hidden', '');
    document.body.classList.remove('admin-modal-open');
    document.removeEventListener('keydown', onKeydown, true);
  }
  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    if (askOpen) return;             // the confirm/prompt on top owns this Esc
    e.stopPropagation(); close();
  }

  // ── Public API ──────────────────────────────────────────────────────────
  App.Admin = {
    open,
    close,
    isAdmin: () => !!(App.Auth && App.Auth.isAdmin && App.Auth.isAdmin()),
  };
})();
