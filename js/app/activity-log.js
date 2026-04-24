// app/activity-log.js — passive session change history; in-memory + per-day localStorage.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // ── config ─────────────────────────────────────────────────────────
  const SESSION_CAP   = 200;
  const PERSIST_KEY   = 'yaab_activity_log';
  const PERSIST_DAYS  = 30;
  const DEBOUNCE_MS   = 500;

  // Visual map per kind. Each entry: { glyph, cls, label }.
  const KIND_META = {
    add:        { glyph: '+', cls: 'add',    label: 'Add'         },
    remove:     { glyph: '×', cls: 'remove', label: 'Remove' }, // ×
    qty:        { glyph: 'Δ', cls: 'qty',    label: 'Quantity' }, // Δ
    faction:    { glyph: '⚑', cls: 'faction', label: 'Faction' }, // ⚑
    detachment: { glyph: '⚐', cls: 'detachment', label: 'Detachment' }, // ⚐
    armyLoad:   { glyph: '◉', cls: 'load',   label: 'Army loaded' }, // ◉
    save:       { glyph: '✓', cls: 'save',   label: 'Saved' }, // ✓
    'export':   { glyph: '↑', cls: 'export', label: 'Export' }, // ↑
    'import':   { glyph: '↓', cls: 'import', label: 'Import' }, // ↓
    print:      { glyph: '⏙', cls: 'print',  label: 'Print' }, // ⏙
    undo:       { glyph: '⟲', cls: 'undo',   label: 'Undo' }, // ⟲
    redo:       { glyph: '⟳', cls: 'redo',   label: 'Redo' }, // ⟳
    other:      { glyph: '•', cls: 'other',  label: 'Event' }, // •
  };

  // ── in-memory session log (newest-first) ───────────────────────────
  const sessionLog = [];

  // ── debouncing per-kind ────────────────────────────────────────────
  const lastFiredAt = Object.create(null);
  function debounced(kind) {
    const now = Date.now();
    const prev = lastFiredAt[kind] || 0;
    if (now - prev < DEBOUNCE_MS) return true;
    lastFiredAt[kind] = now;
    return false;
  }

  // ── time + escape utils ────────────────────────────────────────────
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fmtDayHeader(key) {
    if (!key) return '';
    const today = dayKey(Date.now());
    if (key === today) return 'Today (' + key + ')';
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (key === dayKey(y.getTime())) return 'Yesterday (' + key + ')';
    return key;
  }
  const esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // ── persistent storage ─────────────────────────────────────────────
  function loadStore() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
  }
  function pruneStore(store) {
    // Keep only the most-recent PERSIST_DAYS day buckets by key (YYYY-MM-DD).
    const keys = Object.keys(store).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
    if (keys.length <= PERSIST_DAYS) return store;
    keys.sort(); // ascending
    const drop = keys.length - PERSIST_DAYS;
    for (let i = 0; i < drop; i++) delete store[keys[i]];
    return store;
  }
  function writeStore(store) {
    pruneStore(store);
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      // Quota: drop oldest day at a time.
      const keys = Object.keys(store).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      for (let i = 0; i < keys.length; i++) {
        delete store[keys[i]];
        try { localStorage.setItem(PERSIST_KEY, JSON.stringify(store)); return true; }
        catch (_) { /* keep dropping */ }
      }
      return false;
    }
  }
  function persistEntry(entry) {
    const store = loadStore();
    const key = dayKey(entry.at);
    if (!key) return;
    if (!Array.isArray(store[key])) store[key] = [];
    store[key].push({ at: entry.at, kind: entry.kind, summary: entry.summary });
    writeStore(store);
  }

  // ── core: log() ────────────────────────────────────────────────────
  function log(kind, summary, details) {
    if (!kind || !summary) return;
    if (debounced(kind + '::' + summary)) return;
    const entry = {
      at: Date.now(),
      kind: kind,
      summary: summary,
      details: details || null,
    };
    sessionLog.unshift(entry);
    while (sessionLog.length > SESSION_CAP) sessionLog.pop();
    persistEntry(entry);
    refreshModal();
  }

  // ── armyChange diff detection ──────────────────────────────────────
  // Snapshot keyed by entry unitId+selectedPts+enhNames so qty changes line up.
  function entryKey(e) {
    const enhNames = (e.enhancements || []).map(x => (x && x.name) || '').sort().join('|');
    const pts = (e.selectedPts != null) ? e.selectedPts : '';
    return [e.unitId || '', pts, enhNames].join('::');
  }
  function indexEntries(entries) {
    const m = Object.create(null);
    (entries || []).forEach(function (e) {
      const k = entryKey(e);
      if (!m[k]) m[k] = { name: e.unitName || e.unitId || '(unit)', count: 0 };
      m[k].count += (e.count || 0);
    });
    return m;
  }

  let prevSnap = { armyId: null, name: '', faction: '', detachment: '', entries: {} };

  function snapshotState() {
    const army = App.state && App.state.currentArmy;
    return {
      armyId:     army ? army.id : null,
      name:       army ? (army.name || '') : '',
      faction:    (App.state && App.state.factionFilter) || '',
      detachment: (App.state && App.state.selectedDetachment) || '',
      entries:    army ? indexEntries(army.entries) : {},
    };
  }

  function diffArmyChange(prev, curr) {
    // Army-load: id changed and the prior id was non-null.
    if (prev.armyId && curr.armyId && prev.armyId !== curr.armyId) {
      log('armyLoad', 'Army loaded: ' + (curr.name || '(unnamed)'));
      return; // avoid emitting a flurry of add events from the swap
    }
    if (!prev.armyId && curr.armyId && Object.keys(curr.entries).length > 0) {
      log('armyLoad', 'Army loaded: ' + (curr.name || '(unnamed)'));
      return;
    }

    const keys = Object.create(null);
    Object.keys(prev.entries).forEach(k => { keys[k] = true; });
    Object.keys(curr.entries).forEach(k => { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      const p = prev.entries[k];
      const c = curr.entries[k];
      if (p && !c) {
        log('remove', 'Removed ' + p.count + 'x ' + p.name);
      } else if (!p && c) {
        log('add', 'Added ' + c.count + 'x ' + c.name);
      } else if (p && c && p.count !== c.count) {
        const delta = c.count - p.count;
        const sign = delta > 0 ? '+' : '';
        log('qty', c.name + ' qty ' + p.count + ' → ' + c.count + ' (' + sign + delta + ')');
      }
    });
  }

  // ── selectionChange detection ──────────────────────────────────────
  function diffSelection(prev, curr) {
    if ((prev.faction || '') !== (curr.faction || '')) {
      const label = curr.faction && curr.faction !== 'all'
        ? curr.faction
        : 'All factions';
      log('faction', 'Faction changed: ' + label);
    }
    if ((prev.detachment || '') !== (curr.detachment || '')) {
      const label = curr.detachment || '(none)';
      log('detachment', 'Detachment changed: ' + label);
    }
  }

  // ── hooks: armyChange + selectionChange ────────────────────────────
  App.hooks.armyChange.push(function () {
    const curr = snapshotState();
    diffArmyChange(prevSnap, curr);
    diffSelection(prevSnap, curr);
    prevSnap = curr;
  });
  App.hooks.selectionChange.push(function () {
    const curr = snapshotState();
    diffSelection(prevSnap, curr);
    // Don't overwrite full prevSnap here — armyChange does that. Keep selection
    // fields fresh so we don't double-fire.
    prevSnap.faction    = curr.faction;
    prevSnap.detachment = curr.detachment;
  });

  // ── delegated click logging for explicit user actions ──────────────
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;

    if (t.closest('#btn-save-army')) {
      const army = App.state && App.state.currentArmy;
      log('save', 'Saved army' + (army && army.name ? ': ' + army.name : ''));
      return;
    }
    if (t.closest('#btn-export-string') || t.closest('#btn-export-text') ||
        t.closest('#btn-export-csv')    || t.closest('#btn-export-copy')) {
      log('export', 'Exported army');
      return;
    }
    if (t.closest('#btn-import-string') || t.closest('#btn-import-confirm')) {
      log('import', 'Imported army');
      return;
    }
    if (t.closest('#btn-print-army')) {
      log('print', 'Printed army datasheets');
      return;
    }
    if (t.closest('.btn-load-saved')) {
      // armyChange hook will follow with armyLoad; this gives a fast-path label.
      const row = t.closest('[data-army-name],[data-name]');
      const nm = row ? (row.dataset.armyName || row.dataset.name || '') : '';
      log('armyLoad', 'Loaded saved army' + (nm ? ': ' + nm : ''));
      return;
    }
    if (t.closest('#yaab-btn-undo')) { log('undo', 'Undo'); return; }
    if (t.closest('#yaab-btn-redo')) { log('redo', 'Redo'); return; }
  }, false);

  // ── modal DOM ──────────────────────────────────────────────────────
  let modalEl = null;
  let activeTab = 'session'; // 'session' | 'history'
  let filterText = '';

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop activity-log-backdrop';
    backdrop.id = 'modal-activity-log';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal activity-modal">' +
        '<div class="modal-header">' +
          '<h3>Activity Log</h3>' +
          '<button class="modal-close" id="al-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="al-tabs" role="tablist">' +
            '<button type="button" role="tab" class="al-tab is-active" data-tab="session">This session</button>' +
            '<button type="button" role="tab" class="al-tab" data-tab="history">History</button>' +
          '</div>' +
          '<div class="al-filter-row">' +
            '<input type="text" id="al-filter" class="form-input al-filter" placeholder="Filter by keyword…" autocomplete="off" />' +
            '<button type="button" class="btn btn-sm btn-outline" id="al-clear-session" title="Clear in-memory session log">Clear session</button>' +
          '</div>' +
          '<div class="al-content" id="al-content"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeModal();
    });
    backdrop.querySelector('#al-close').addEventListener('click', closeModal);
    backdrop.querySelectorAll('.al-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        activeTab = b.dataset.tab || 'session';
        backdrop.querySelectorAll('.al-tab').forEach(function (x) {
          x.classList.toggle('is-active', x.dataset.tab === activeTab);
        });
        renderModalContent();
      });
    });
    const filterInput = backdrop.querySelector('#al-filter');
    filterInput.addEventListener('input', function () {
      filterText = (filterInput.value || '').trim().toLowerCase();
      renderModalContent();
    });
    backdrop.querySelector('#al-clear-session').addEventListener('click', function () {
      sessionLog.length = 0;
      renderModalContent();
    });

    modalEl = backdrop;
    return modalEl;
  }

  function closeModal() { if (modalEl) modalEl.hidden = true; }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  function matches(entry) {
    if (!filterText) return true;
    const hay = ((entry.kind || '') + ' ' + (entry.summary || '')).toLowerCase();
    return hay.indexOf(filterText) !== -1;
  }

  function entryRowHtml(entry) {
    const meta = KIND_META[entry.kind] || KIND_META.other;
    return '<li class="al-row al-row-' + meta.cls + '">' +
      '<span class="al-icon" aria-hidden="true">' + esc(meta.glyph) + '</span>' +
      '<span class="al-time">' + esc(fmtTime(entry.at)) + '</span>' +
      '<span class="al-summary">' + esc(entry.summary) + '</span>' +
      '</li>';
  }

  function renderSessionTab() {
    const filtered = sessionLog.filter(matches);
    if (filtered.length === 0) {
      return '<div class="al-empty">' +
        (sessionLog.length === 0
          ? 'No activity in this session yet. Start building — events will show up here.'
          : 'No events match “' + esc(filterText) + '”.') +
        '</div>';
    }
    return '<ul class="al-list">' + filtered.map(entryRowHtml).join('') + '</ul>';
  }

  function dayStats(entries) {
    const counts = Object.create(null);
    entries.forEach(function (e) {
      counts[e.kind] = (counts[e.kind] || 0) + 1;
    });
    const parts = [];
    if (counts.armyLoad)   parts.push(counts.armyLoad + ' armies loaded');
    if (counts.add)        parts.push(counts.add + ' units added');
    if (counts.remove)     parts.push(counts.remove + ' units removed');
    if (counts.qty)        parts.push(counts.qty + ' qty changes');
    if (counts.save)       parts.push(counts.save + ' saves');
    if (counts['export'])  parts.push(counts['export'] + ' exports');
    if (counts['import'])  parts.push(counts['import'] + ' imports');
    if (counts.faction)    parts.push(counts.faction + ' faction switches');
    if (counts.detachment) parts.push(counts.detachment + ' detachment switches');
    if (counts.print)      parts.push(counts.print + ' prints');
    if (counts.undo || counts.redo) {
      parts.push(((counts.undo || 0) + (counts.redo || 0)) + ' undo/redo');
    }
    return parts.length ? parts.join(', ') : (entries.length + ' events');
  }

  function renderHistoryTab() {
    const store = loadStore();
    const keys = Object.keys(store).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
    if (keys.length === 0) {
      return '<div class="al-empty">No persistent history yet.</div>';
    }
    keys.sort().reverse(); // newest day first

    const sections = keys.map(function (key) {
      const all = Array.isArray(store[key]) ? store[key].slice() : [];
      // newest entries first within a day
      all.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      const visible = all.filter(matches);
      if (visible.length === 0 && filterText) return '';

      const stats = dayStats(all);
      const expanded = (key === dayKey(Date.now())) || !!filterText;
      return '<details class="al-day"' + (expanded ? ' open' : '') + '>' +
        '<summary class="al-day-summary">' +
          '<span class="al-day-title">' + esc(fmtDayHeader(key)) + '</span>' +
          '<span class="al-day-count">' + all.length + ' events</span>' +
          '<span class="al-day-stats">' + esc(stats) + '</span>' +
        '</summary>' +
        '<ul class="al-list">' + visible.map(entryRowHtml).join('') + '</ul>' +
      '</details>';
    }).filter(Boolean).join('');

    if (!sections) {
      return '<div class="al-empty">No events match “' + esc(filterText) + '”.</div>';
    }
    return sections;
  }

  function renderModalContent() {
    if (!modalEl || modalEl.hidden) return;
    const c = modalEl.querySelector('#al-content');
    if (!c) return;
    c.innerHTML = activeTab === 'history' ? renderHistoryTab() : renderSessionTab();
    const clearBtn = modalEl.querySelector('#al-clear-session');
    if (clearBtn) clearBtn.style.display = activeTab === 'session' ? '' : 'none';
  }

  function refreshModal() {
    if (modalEl && !modalEl.hidden) renderModalContent();
  }

  function openLog() {
    const el = ensureModal();
    el.hidden = false;
    renderModalContent();
    const fi = el.querySelector('#al-filter');
    if (fi) { try { fi.focus(); } catch (_) {} }
  }

  // ── toolbar registration ───────────────────────────────────────────
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-activity-log',
    region: 'primary',
    label: 'Activity',
    category: 'data',
    title: 'View session activity log',
    onClick: openLog,
  });

  // ── seed prevSnap on bootstrap so the first armyChange isn't a flood ──
  App.hooks.bootstrap.push(function () {
    prevSnap = snapshotState();
  });
})();
