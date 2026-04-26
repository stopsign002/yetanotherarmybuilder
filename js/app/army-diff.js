// app/army-diff.js — labeled snapshots on save + two-version diff modal.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const STORAGE_KEY = 'yaab_army_snapshots';
  const MAX_PER_ARMY = 20;
  const SAVE_DEBOUNCE_MS = 200;

  // ── escape / util ─────────────────────────────────────────────────
  const esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  function safeClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); }
    catch (_) { return null; }
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function toast(msg, type) {
    if (window.UI && typeof UI.toast === 'function') UI.toast(msg, type || 'info');
  }

  // ── storage layer ─────────────────────────────────────────────────
  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeAll(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      // Quota: drop oldest snapshot across any army and retry a few times.
      for (let attempt = 0; attempt < 20; attempt++) {
        let oldestArmyId = null;
        let oldestIdx = -1;
        let oldestTs = Infinity;
        Object.keys(store).forEach(aid => {
          const arr = store[aid] || [];
          // Oldest is the LAST element (we store most-recent-first).
          for (let i = 0; i < arr.length; i++) {
            const ts = arr[i].savedAt || 0;
            if (ts < oldestTs) { oldestTs = ts; oldestArmyId = aid; oldestIdx = i; }
          }
        });
        if (oldestArmyId == null || oldestIdx < 0) break;
        store[oldestArmyId].splice(oldestIdx, 1);
        if (store[oldestArmyId].length === 0) delete store[oldestArmyId];
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
          console.warn('[army-diff] localStorage quota hit; dropped oldest snapshot and retried.');
          return true;
        } catch (_) { /* keep dropping */ }
      }
      console.warn('[army-diff] Unable to persist snapshots; storage quota exceeded.');
      return false;
    }
  }

  function getSnapshots(armyId) {
    if (!armyId) return [];
    const store = loadAll();
    return Array.isArray(store[armyId]) ? store[armyId] : [];
  }

  function writeSnapshots(armyId, arr) {
    if (!armyId) return;
    const store = loadAll();
    if (!arr || arr.length === 0) delete store[armyId];
    else store[armyId] = arr;
    writeAll(store);
  }

  function deleteArmySnapshots(armyId) {
    if (!armyId) return;
    const store = loadAll();
    if (store[armyId]) {
      delete store[armyId];
      writeAll(store);
    }
  }

  function hasSnapshots(armyId, min) {
    min = min || 1;
    return getSnapshots(armyId).length >= min;
  }

  // ── snapshot creation ─────────────────────────────────────────────
  function autoLabel(army, existingCount) {
    const units = (army.entries || []).reduce((s, e) => s + (e.count || 0), 0);
    const pts = (typeof army.getTotalPoints === 'function')
      ? army.getTotalPoints()
      : (army.entries || []).reduce((s, e) => {
        const each = (e.selectedPts != null ? e.selectedPts : ((e.unitData && e.unitData.points) || 0));
        const enh = (e.enhancements || []).reduce((ss, x) => ss + (x.pts || 0), 0);
        return s + each * (e.count || 0) + enh;
      }, 0);
    const v = (existingCount || 0) + 1;
    return 'v' + v + ' — ' + units + ' units, ' + pts + ' pts';
  }

  function captureSnapshot(army, opts) {
    if (!army || !army.id) return null;
    opts = opts || {};
    const json = (typeof army.toJSON === 'function') ? army.toJSON() : safeClone(army);
    if (!json) return null;
    const existing = getSnapshots(army.id);

    // Dedupe — if nothing changed since the last snapshot, skip.
    if (!opts.force && existing.length > 0) {
      try {
        const prev = JSON.stringify(existing[0].army);
        const cur = JSON.stringify(json);
        if (prev === cur) return null;
      } catch (_) { /* fall through */ }
    }

    const snap = {
      id: army.id,
      savedAt: Date.now(),
      label: opts.label || autoLabel(army, existing.length),
      army: json,
    };
    existing.unshift(snap);
    while (existing.length > MAX_PER_ARMY) existing.pop();
    writeSnapshots(army.id, existing);
    return snap;
  }

  // ── listen for #btn-save-army clicks (delegated, debounced) ──────
  let saveTimer = 0;
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('#btn-save-army');
    if (!btn) return;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      // Run after the builtin save handler has mutated state.currentArmy.
      const army = App.state && App.state.currentArmy;
      if (!army) return;
      captureSnapshot(army);
      updateToolbarButton();
    }, SAVE_DEBOUNCE_MS);
  }, false);

  // ── listen for saved-army deletion so we can clean up snapshots ──
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const delBtn = t.closest('.btn-delete-saved');
    if (!delBtn) return;
    const armyId = delBtn.dataset && delBtn.dataset.id;
    if (!armyId) return;
    // Run after the manager has actually deleted. If the army is still in
    // the manager after the click settles, the user cancelled.
    setTimeout(function () {
      const am = App.state && App.state.armyManager;
      if (!am) return;
      const still = am.armies && am.armies.some(a => a.id === armyId);
      if (!still) deleteArmySnapshots(armyId);
    }, 0);
  }, false);

  // ── diff computation ──────────────────────────────────────────────
  // Group entries by (unitId + selectedPts + sorted enhancement names) so
  // users see adds/removes/count-changed at the natural "line" granularity.
  function entryKey(e) {
    const enhNames = (e.enhancements || []).map(x => (x && x.name) || '').sort().join('|');
    const pts = (e.selectedPts != null) ? e.selectedPts : '';
    return [e.unitId || '', pts, enhNames].join('::');
  }

  function indexEntries(entries) {
    const map = Object.create(null);
    (entries || []).forEach(function (e) {
      const k = entryKey(e);
      if (!map[k]) map[k] = { entry: e, count: 0, enh: e.enhancements || [] };
      map[k].count += (e.count || 0);
    });
    return map;
  }

  function entryPoints(e) {
    const pts = (e.selectedPts != null) ? e.selectedPts : ((e.unitData && e.unitData.points) || 0);
    const enh = (e.enhancements || []).reduce((s, x) => s + (x.pts || 0), 0);
    return pts + enh; // per-model-set; multiply by count at use.
  }

  function totalPointsOfArmy(armyJson) {
    return (armyJson.entries || []).reduce(function (sum, e) {
      const pts = (e.selectedPts != null) ? e.selectedPts : ((e.unitData && e.unitData.points) || 0);
      const enh = (e.enhancements || []).reduce((s, x) => s + (x.pts || 0), 0);
      return sum + pts * (e.count || 0) + enh;
    }, 0);
  }

  function computeDiff(left, right) {
    const rows = [];
    const L = (left && left.army) || {};
    const R = (right && right.army) || {};

    // Meta diffs
    if ((L.name || '') !== (R.name || '')) {
      rows.push({ kind: 'meta', icon: 'Δ', label: 'Name',
        text: esc(L.name || '(empty)') + ' → ' + esc(R.name || '(empty)') });
    }
    if ((L.factionName || '') !== (R.factionName || '')) {
      rows.push({ kind: 'meta', icon: 'Δ', label: 'Faction',
        text: esc(L.factionName || '(none)') + ' → ' + esc(R.factionName || '(none)') });
    }
    if ((L.pointsLimit || 0) !== (R.pointsLimit || 0)) {
      rows.push({ kind: 'meta', icon: 'Δ', label: 'Points limit',
        text: (L.pointsLimit || 0) + ' → ' + (R.pointsLimit || 0) });
    }

    const li = indexEntries(L.entries);
    const ri = indexEntries(R.entries);
    const keys = Object.create(null);
    Object.keys(li).forEach(k => { keys[k] = true; });
    Object.keys(ri).forEach(k => { keys[k] = true; });

    Object.keys(keys).forEach(function (k) {
      const l = li[k];
      const r = ri[k];
      if (l && !r) {
        const per = entryPoints(l.entry);
        rows.push({
          kind: 'removed', icon: '−',
          name: l.entry.unitName || l.entry.unitId || '(unit)',
          text: l.count + 'x ' + esc(l.entry.unitName || l.entry.unitId || '(unit)'),
          pts: per * l.count,
          enhancements: l.entry.enhancements || [],
          _src: l.entry,
        });
      } else if (!l && r) {
        const per = entryPoints(r.entry);
        rows.push({
          kind: 'added', icon: '+',
          name: r.entry.unitName || r.entry.unitId || '(unit)',
          text: r.count + 'x ' + esc(r.entry.unitName || r.entry.unitId || '(unit)'),
          pts: per * r.count,
          enhancements: r.entry.enhancements || [],
          _src: r.entry,
        });
      } else if (l && r && l.count !== r.count) {
        const per = entryPoints(r.entry);
        rows.push({
          kind: 'count', icon: 'Δ',
          name: r.entry.unitName || r.entry.unitId || '(unit)',
          text: esc(r.entry.unitName || r.entry.unitId || '(unit)') + ': ' + l.count + 'x → ' + r.count + 'x',
          pts: per * (r.count - l.count),
          delta: r.count - l.count,
        });
      }
    });

    // Enhancement changes: same unitId+pts but different enhancement set.
    // Build a set of "consumed" rows — removed+added pairs that really only
    // differ in enhancements should be expressed as enh-diff rows instead of
    // a pair of removed/added rows.
    (function collectEnhDiffs() {
      function unitPtsKey(e) {
        return (e.unitId || '') + '::' + (e.selectedPts != null ? e.selectedPts : '');
      }
      const byUnitL = {};
      const byUnitR = {};
      (L.entries || []).forEach(e => {
        const k = unitPtsKey(e);
        (byUnitL[k] = byUnitL[k] || []).push(e);
      });
      (R.entries || []).forEach(e => {
        const k = unitPtsKey(e);
        (byUnitR[k] = byUnitR[k] || []).push(e);
      });
      const allKeys = {};
      Object.keys(byUnitL).forEach(k => { allKeys[k] = true; });
      Object.keys(byUnitR).forEach(k => { allKeys[k] = true; });
      Object.keys(allKeys).forEach(function (k) {
        const ls = byUnitL[k] || [];
        const rs = byUnitR[k] || [];
        if (ls.length === 0 || rs.length === 0) return;
        const leftEnh = {};
        const rightEnh = {};
        ls.forEach(e => (e.enhancements || []).forEach(x => { leftEnh[x.name] = x; }));
        rs.forEach(e => (e.enhancements || []).forEach(x => { rightEnh[x.name] = x; }));
        const unitName = (rs[0] && rs[0].unitName) || (ls[0] && ls[0].unitName) || '(unit)';

        let addedAny = false;
        Object.keys(leftEnh).forEach(function (nm) {
          if (!rightEnh[nm]) {
            rows.push({
              kind: 'enh-removed', icon: '−',
              name: unitName,
              text: esc(unitName) + ': removed enhancement ' + esc(nm),
              pts: -(leftEnh[nm].pts || 0),
            });
            addedAny = true;
          }
        });
        Object.keys(rightEnh).forEach(function (nm) {
          if (!leftEnh[nm]) {
            rows.push({
              kind: 'enh-added', icon: '+',
              name: unitName,
              text: esc(unitName) + ': added enhancement ' + esc(nm),
              pts: (rightEnh[nm].pts || 0),
            });
            addedAny = true;
          }
        });

        // If we emitted enh-diff rows for this unit+pts bucket AND the bucket
        // is actually a 1↔1 pair that only differs by enhancements, strip the
        // paired removed/added rows so we don't double-report.
        if (addedAny && ls.length === 1 && rs.length === 1 && (ls[0].count || 0) === (rs[0].count || 0)) {
          const kRem = entryKey(ls[0]);
          const kAdd = entryKey(rs[0]);
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.kind === 'removed' && entryKey(row._src || {}) === kRem) rows.splice(i, 1);
            else if (row.kind === 'added' && entryKey(row._src || {}) === kAdd) rows.splice(i, 1);
          }
        }
      });
    })();

    // Sort: meta first, then by kind group, then by name.
    const kindOrder = { meta: 0, removed: 1, added: 2, count: 3, 'enh-removed': 4, 'enh-added': 5 };
    rows.sort(function (a, b) {
      const ka = kindOrder[a.kind] != null ? kindOrder[a.kind] : 99;
      const kb = kindOrder[b.kind] != null ? kindOrder[b.kind] : 99;
      if (ka !== kb) return ka - kb;
      const na = (a.name || a.label || a.text || '').toString();
      const nb = (b.name || b.label || b.text || '').toString();
      return na.localeCompare(nb);
    });

    return {
      rows: rows,
      totals: {
        left: totalPointsOfArmy(L),
        right: totalPointsOfArmy(R),
      },
    };
  }

  // ── modal DOM ─────────────────────────────────────────────────────
  let modalEl = null;
  let selLeftIdx = 1;   // default: previous
  let selRightIdx = 0;  // default: latest

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-army-diff';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal diff-modal">' +
        '<div class="modal-header">' +
          '<h3>Version History</h3>' +
          '<button class="modal-close" id="diff-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="diff-body" id="diff-body"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeModal();
    });
    backdrop.querySelector('#diff-close').addEventListener('click', closeModal);
    modalEl = backdrop;
    return modalEl;
  }

  function closeModal() { if (modalEl) modalEl.hidden = true; }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });

  function snapshotOptionHtml(snap, idx, selected, side) {
    const selAttr = selected ? ' selected' : '';
    const label = snap.label || ('v' + (idx + 1));
    return '<option value="' + idx + '"' + selAttr + '>' + esc(label) + ' — ' + esc(fmtDate(snap.savedAt)) + '</option>';
  }

  function renderModal() {
    const el = ensureModal();
    const body = el.querySelector('#diff-body');
    const army = App.state && App.state.currentArmy;
    const snaps = army ? getSnapshots(army.id) : [];

    if (!army) {
      body.innerHTML = '<div class="diff-empty">No active army.</div>';
      return;
    }
    if (snaps.length === 0) {
      body.innerHTML = '<div class="diff-empty">No snapshots yet. Saving your army will create a snapshot.</div>';
      return;
    }
    if (snaps.length === 1) {
      body.innerHTML =
        '<div class="diff-empty">Only one snapshot so far. Save again to compare versions.</div>' +
        renderSnapshotListHtml(snaps);
      wireSnapshotListHandlers();
      return;
    }

    if (selLeftIdx >= snaps.length) selLeftIdx = snaps.length - 1;
    if (selRightIdx >= snaps.length) selRightIdx = 0;
    if (selLeftIdx === selRightIdx) {
      selLeftIdx = selRightIdx === 0 ? 1 : 0;
    }

    const leftOpts = snaps.map((s, i) => snapshotOptionHtml(s, i, i === selLeftIdx, 'left')).join('');
    const rightOpts = snaps.map((s, i) => snapshotOptionHtml(s, i, i === selRightIdx, 'right')).join('');

    const diff = computeDiff(snaps[selLeftIdx], snaps[selRightIdx]);
    const delta = diff.totals.right - diff.totals.left;
    const deltaCls = delta > 0 ? 'pos' : (delta < 0 ? 'neg' : 'zero');
    const deltaSign = delta > 0 ? '+' : '';

    let rowsHtml;
    if (diff.rows.length === 0) {
      rowsHtml = '<li class="diff-row diff-row-none">No differences.</li>';
    } else {
      rowsHtml = diff.rows.map(function (r) {
        const ptsStr = (r.pts != null)
          ? ' <span class="diff-pts ' + (r.pts > 0 ? 'pos' : (r.pts < 0 ? 'neg' : 'zero')) + '">' +
            (r.pts > 0 ? '+' : '') + r.pts + ' pts</span>'
          : '';
        const prefix = r.label ? '<span class="diff-meta-label">' + esc(r.label) + ':</span> ' : '';
        return '<li class="diff-row diff-' + r.kind + '">' +
          '<span class="diff-icon">' + esc(r.icon || '') + '</span>' +
          '<span class="diff-text">' + prefix + r.text + '</span>' +
          ptsStr +
          '</li>';
      }).join('');
    }

    body.innerHTML =
      '<div class="diff-picker">' +
        '<div class="diff-picker-col">' +
          '<label class="diff-picker-label">From</label>' +
          '<select id="diff-select-left" class="diff-select">' + leftOpts + '</select>' +
        '</div>' +
        '<div class="diff-picker-arrow">→</div>' +
        '<div class="diff-picker-col">' +
          '<label class="diff-picker-label">To</label>' +
          '<select id="diff-select-right" class="diff-select">' + rightOpts + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="diff-totals">' +
        '<div class="diff-total"><span class="diff-total-label">Before</span> ' + diff.totals.left + ' pts</div>' +
        '<div class="diff-total-arrow">→</div>' +
        '<div class="diff-total"><span class="diff-total-label">After</span> ' + diff.totals.right + ' pts</div>' +
        '<div class="diff-total diff-delta ' + deltaCls + '">' + deltaSign + delta + ' pts</div>' +
      '</div>' +
      '<ul class="diff-list">' + rowsHtml + '</ul>' +
      '<h4 class="diff-section-title">All Snapshots</h4>' +
      renderSnapshotListHtml(snaps);

    const leftSel = body.querySelector('#diff-select-left');
    const rightSel = body.querySelector('#diff-select-right');
    if (leftSel) leftSel.addEventListener('change', function (e) {
      selLeftIdx = parseInt(e.target.value, 10) || 0;
      renderModal();
    });
    if (rightSel) rightSel.addEventListener('change', function (e) {
      selRightIdx = parseInt(e.target.value, 10) || 0;
      renderModal();
    });
    wireSnapshotListHandlers();
  }

  function renderSnapshotListHtml(snaps) {
    if (!snaps || snaps.length === 0) return '';
    const items = snaps.map(function (s, i) {
      return '<li class="diff-snap" data-idx="' + i + '">' +
        '<div class="diff-snap-label">' +
          '<span class="diff-snap-text" data-idx="' + i + '">' + esc(s.label || ('v' + (i + 1))) + '</span>' +
          '<span class="diff-snap-date">' + esc(fmtDate(s.savedAt)) + '</span>' +
        '</div>' +
        '<div class="diff-snap-actions">' +
          '<button type="button" class="btn btn-sm btn-outline diff-act-rename" data-idx="' + i + '" title="Rename">Rename</button>' +
          '<button type="button" class="btn btn-sm btn-outline diff-act-export" data-idx="' + i + '" title="Copy YAAB1 code for this snapshot">Export</button>' +
          '<button type="button" class="btn btn-sm btn-accent diff-act-revert" data-idx="' + i + '" title="Revert to this version">Revert</button>' +
          '<button type="button" class="btn btn-sm btn-outline diff-act-delete" data-idx="' + i + '" title="Delete this snapshot">Delete</button>' +
        '</div>' +
      '</li>';
    }).join('');
    return '<ul class="diff-snap-list">' + items + '</ul>';
  }

  function wireSnapshotListHandlers() {
    if (!modalEl) return;
    const body = modalEl.querySelector('#diff-body');
    if (!body) return;
    body.querySelectorAll('.diff-act-revert').forEach(function (btn) {
      btn.addEventListener('click', function () { onRevert(parseInt(btn.dataset.idx, 10)); });
    });
    body.querySelectorAll('.diff-act-delete').forEach(function (btn) {
      btn.addEventListener('click', function () { onDelete(parseInt(btn.dataset.idx, 10)); });
    });
    body.querySelectorAll('.diff-act-export').forEach(function (btn) {
      btn.addEventListener('click', function () { onExport(parseInt(btn.dataset.idx, 10)); });
    });
    body.querySelectorAll('.diff-act-rename').forEach(function (btn) {
      btn.addEventListener('click', function () { onRename(parseInt(btn.dataset.idx, 10)); });
    });
  }

  // ── actions ───────────────────────────────────────────────────────
  function onRevert(idx) {
    const army = App.state && App.state.currentArmy;
    if (!army) return;
    const snaps = getSnapshots(army.id);
    const snap = snaps[idx];
    if (!snap) return;
    const versionNumber = snaps.length - idx; // oldest = v1, newest = vN.
    if (!confirm('Revert current army to "' + (snap.label || ('v' + versionNumber)) + '"? A backup snapshot will be created so you can undo.')) {
      return;
    }
    try {
      // Safety snapshot of the CURRENT army first, labeled clearly.
      captureSnapshot(army, {
        force: true,
        label: 'Before revert to ' + (snap.label || ('v' + versionNumber)),
      });

      const restored = Army.fromJSON(snap.army);
      // Preserve the id so this replaces the same slot in ArmyManager.
      restored.id = army.id;
      restored.updatedAt = new Date().toISOString();

      App.state.currentArmy = restored;
      if (App.state.armyManager) {
        App.state.armyManager.currentArmy = restored;
        App.state.armyManager.saveArmy(restored);
      }
      if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(restored);
      toast('Reverted to ' + (snap.label || ('v' + versionNumber)), 'success');
      renderModal();
      updateToolbarButton();
    } catch (e) {
      toast('Revert failed: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  function onDelete(idx) {
    const army = App.state && App.state.currentArmy;
    if (!army) return;
    const snaps = getSnapshots(army.id);
    if (idx < 0 || idx >= snaps.length) return;
    snaps.splice(idx, 1);
    writeSnapshots(army.id, snaps);
    // Re-clamp selections.
    if (selLeftIdx >= snaps.length) selLeftIdx = Math.max(0, snaps.length - 1);
    if (selRightIdx >= snaps.length) selRightIdx = 0;
    renderModal();
    updateToolbarButton();
  }

  async function onExport(idx) {
    const army = App.state && App.state.currentArmy;
    if (!army) return;
    const snaps = getSnapshots(army.id);
    const snap = snaps[idx];
    if (!snap) return;
    try {
      const restored = Army.fromJSON(snap.army);
      const code = await Storage.exportArmyToString(restored, {
        factionName: restored.factionName || '',
      });
      try {
        await navigator.clipboard.writeText(code);
        toast('Snapshot code copied', 'success');
      } catch (_) {
        if (window.UI && typeof UI.showExportModal === 'function') {
          UI.showExportModal(code);
        } else {
          toast('Copy failed — manual copy required', 'error');
        }
      }
    } catch (e) {
      toast('Export failed: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  function onRename(idx) {
    const army = App.state && App.state.currentArmy;
    if (!army) return;
    const snaps = getSnapshots(army.id);
    const snap = snaps[idx];
    if (!snap) return;
    const next = prompt('Rename snapshot:', snap.label || '');
    if (next == null) return;
    const trimmed = String(next).trim();
    snap.label = trimmed || snap.label || ('v' + (snaps.length - idx));
    writeSnapshots(army.id, snaps);
    renderModal();
  }

  // ── toolbar button ────────────────────────────────────────────────
  function openHistory() {
    selLeftIdx = 1;
    selRightIdx = 0;
    renderModal();
    const el = ensureModal();
    el.hidden = false;
  }

  function updateToolbarButton() {
    const btn = document.getElementById('yaab-btn-history');
    if (!btn) return;
    const army = App.state && App.state.currentArmy;
    const count = army ? getSnapshots(army.id).length : 0;
    const disabled = count < 2;
    btn.disabled = disabled;
    btn.classList.toggle('is-disabled', disabled);
    btn.title = disabled
      ? 'Save the army at least twice to enable version history'
      : 'View army version history (' + count + ' snapshots)';
  }

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-history',
    region: 'primary',
    label: 'History',
    title: 'View army version history',
    onClick: openHistory,
  });

  App.hooks.bootstrap.push(function (state) {
    // Seed a first snapshot if the user has a saved army with none yet and
    // has real entries, so "History" becomes reachable after one more save.
    if (state && state.currentArmy && (state.currentArmy.entries || []).length > 0) {
      const existing = getSnapshots(state.currentArmy.id);
      if (existing.length === 0) {
        // Non-forcing capture: only writes if distinct, which it will be.
        captureSnapshot(state.currentArmy);
      }
    }
    updateToolbarButton();
  });

  App.hooks.armyChange.push(function () {
    // Just keeps the button enabled/disabled state in sync with the current
    // army selection; does NOT capture snapshots here (only save clicks do).
    updateToolbarButton();
  });
})();
