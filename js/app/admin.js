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

  // ── State ───────────────────────────────────────────────────────────────
  let modalEl = null;
  let activeTab = 'pending';   // 'pending' | 'users' | 'images' | 'bugs'
  let users = [];              // [{ username, approved, revoked, is_admin, created_at, approved_at, image_count }]
  let images = [];             // [{ id, owner, name, dataUrl, addedAt }]
  let bugs = [];               // [{ id, username, title, description, diagnostics, fixed, fixed_at, fixed_by, fixed_note, created_at }]
  let bugFilter = 'open';      // 'all' | 'open' | 'fixed'
  let loading = false;

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
    const cards = images.map(img => {
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
    return '<div class="admin-img-grid">' + cards + '</div>';
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
        + '</div>'
        + '<p class="admin-bug-desc">' + esc(b.description || '') + '</p>'
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
    if (!confirm('Revoke ' + username + '?\n\nThey will be signed out and unable to log in.')) return;
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
    if (!confirm('Permanently delete this image?')) return;
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
    const note = prompt('Optional note about the fix (e.g. commit hash or PR #):', '') || '';
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
    if (!confirm('Permanently delete this report?')) return;
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
    loading = true;
    renderTabs();
    renderBody();
    try {
      if (activeTab === 'images') {
        images = await fetchJson('/images');
        if (!Array.isArray(images)) images = [];
      } else if (activeTab === 'bugs') {
        bugs = await fetchJson('/bugs');
        if (!Array.isArray(bugs)) bugs = [];
        // Newest first; server should already do this, but be defensive.
        bugs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      } else {
        users = await fetchJson('/users');
        if (!Array.isArray(users)) users = [];
      }
    } catch (err) {
      if (err.status === 403) {
        toast('Admin access denied.', 'error', 4000);
        close();
        return;
      }
      toast('Failed to load: ' + (err.message || 'unknown'), 'error', 4000);
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
  function onKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  // ── Public API ──────────────────────────────────────────────────────────
  App.Admin = {
    open,
    close,
    isAdmin: () => !!(App.Auth && App.Auth.isAdmin && App.Auth.isAdmin()),
  };
})();
