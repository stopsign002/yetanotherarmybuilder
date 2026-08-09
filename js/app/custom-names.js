// app/custom-names.js — user-given names for characters and units.
//
// Two surfaces, one idea: a unit can have a name of its own ("Brother-Captain
// Gaius") on top of its datasheet name ("Captain"). The custom name becomes the
// primary title everywhere; the datasheet name is shown underneath as a
// subtitle so the actual sheet is always identifiable.
//
//   1. RESERVES — naming one unit out of a ×N stack splits it off as its own
//      unique card. Storage is a separate key from yaab_reserves, because a
//      named instance is a record (id + unitId + name), not a count.
//   2. ARMY ENTRIES — `entry.customName` (owned by army.js). Every export path
//      reads it. Cards mode edits it from the per-card panel.
//
// The two connect at add-to-army time: adding a named reserve instance stamps
// its name onto the new entry. After that they are independent — deleting the
// reserve instance does not rename the army entry.
//
// Everything here is additive. reserves.js / cards-mode.js touchpoints are all
// guarded with `App.CustomNames &&`, so if this module fails to load the app
// degrades to its pre-feature behaviour rather than breaking the roster.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_custom_names';
  const MAX_LEN = 60;

  // { [instanceId]: { u: unitId, n: name, t: createdAt } }
  //
  // Deliberately NOT nested inside yaab_reserves: one record carries id +
  // unitId + name atomically, so a partial cloud pull can never leave a name
  // orphaned from the count it belongs to.
  //
  // Instance ids are opaque and never derived from the unitId, so
  // id-migration.js — which rewrites the KEYS of yaab_reserves from stale
  // BSData GUIDs to 40kdc slugs — needs no knowledge of this key. A record
  // whose `u` no longer resolves is hidden at render time but never deleted,
  // matching that shim's conservative policy.
  let RECORDS = loadRecords();

  let _mintN = 0;
  let _detailObserver = null;
  let _gridObserver = null;
  let _gridScanRaf = 0;

  // ── persistence ────────────────────────────────────────────────────────

  function sanitizeName(v) {
    if (typeof v !== 'string') return '';
    return v.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  }

  function parseRecords(raw) {
    const out = Object.create(null);
    try {
      const obj = raw ? JSON.parse(raw) : null;
      if (!obj || typeof obj !== 'object') return out;
      Object.keys(obj).forEach(id => {
        const rec = obj[id];
        if (!rec || typeof rec !== 'object') return;
        const u = typeof rec.u === 'string' ? rec.u : '';
        const n = sanitizeName(rec.n);
        if (!u || !n) return;
        out[id] = { u, n, t: Number.isFinite(rec.t) ? rec.t : 0 };
      });
    } catch (_) { /* corrupt blob — start empty rather than throw at boot */ }
    return out;
  }

  function loadRecords() {
    try { return parseRecords(localStorage.getItem(LS_KEY)); }
    catch (_) { return Object.create(null); }
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(RECORDS)); }
    catch (_) { /* quota — ignore, same as every other bag in this app */ }
  }

  function mintId() {
    _mintN += 1;
    return 'ci_' + Math.random().toString(36).slice(2, 10) + _mintN.toString(36);
  }

  // ── reads ──────────────────────────────────────────────────────────────

  function allRecords() {
    const out = {};
    Object.keys(RECORDS).forEach(id => { out[id] = Object.assign({}, RECORDS[id]); });
    return out;
  }

  function idsFor(unitId) {
    if (!unitId) return [];
    return Object.keys(RECORDS)
      .filter(id => RECORDS[id].u === unitId)
      .sort((a, b) => (RECORDS[a].t || 0) - (RECORDS[b].t || 0));
  }

  function listFor(unitId) {
    return idsFor(unitId).map(id => Object.assign({ id }, RECORDS[id]));
  }

  function countFor(unitId) {
    return idsFor(unitId).length;
  }

  function isInstance(unit) {
    return !!(unit && unit._yaabInstance);
  }

  // ── the synthetic roster unit ──────────────────────────────────────────
  // A shallow clone of the base datasheet with a new id and name. Rebuilt on
  // EVERY render rather than cached, so point overrides (which mutate the
  // shared unit object in place) and data-bundle refreshes are picked up for
  // free. Object.assign — not Object.create — because roster predicates and
  // card renderers read own properties.
  function instanceUnit(instanceId) {
    const rec = RECORDS[instanceId];
    if (!rec) return null;
    // Use the UNWRAPPED lookup — going through the wrapped App.findUnit would
    // recurse straight back into here. Falls back to App.findUnit only when
    // wrapping never happened (filters.js not loaded yet at our IIFE time).
    const finder = _origFindUnit || App.findUnit;
    if (typeof finder !== 'function') return null;
    const base = finder.call(App, rec.u, '');
    if (!base) return null;
    const clone = Object.assign({}, base);
    clone.id = instanceId;
    clone.name = rec.n;
    // Keeps the datasheet name searchable in the roster (roster.js fuzzyMatch
    // reads this) — otherwise typing "Intercessor" would hide the very units
    // you named.
    clone._searchAlias = base.name;
    clone._yaabInstance = {
      id: instanceId,
      base,
      baseId: base.id,
      name: rec.n,
      dsName: base.name,
    };
    return clone;
  }

  // ── writes ─────────────────────────────────────────────────────────────

  // Name one unit out of the stack. This SPLITS: the unnamed count drops by
  // one so the total you own is unchanged (naming one of your 3 Intercessor
  // Squads must not make you own 4).
  function create(unitId, name) {
    const n = sanitizeName(name);
    if (!unitId || !n) return null;
    const id = mintId();
    RECORDS[id] = { u: unitId, n, t: Date.now() };
    persist();
    if (App.Reserves && typeof App.Reserves.getQty === 'function') {
      const qty = App.Reserves.getQty(unitId);
      if (qty > 0) App.Reserves.setQty(unitId, qty - 1);
    }
    notifyChanged({ structural: true });
    return id;
  }

  function rename(instanceId, name) {
    const rec = RECORDS[instanceId];
    if (!rec) return false;
    const n = sanitizeName(name);
    if (!n || n === rec.n) return false;
    rec.n = n;
    persist();
    // Renaming changes no ids, so roster.js's content signature would skip the
    // re-render entirely. Repaint the affected cards in place instead — which
    // is also nicer than a full rebuild, since it can't jump the scroll.
    notifyChanged({ structural: false });
    return true;
  }

  // Delete a named instance and hand the model back to the unnamed stack.
  function remove(instanceId) {
    const rec = RECORDS[instanceId];
    if (!rec) return false;
    const unitId = rec.u;
    delete RECORDS[instanceId];
    persist();
    if (App.Reserves && typeof App.Reserves.getQty === 'function') {
      App.Reserves.setQty(unitId, App.Reserves.getQty(unitId) + 1);
    }
    // If the detail pane is showing the instance we just deleted, drop the
    // selection so the pane doesn't keep rendering a unit that no longer
    // exists.
    const sel = App.state && App.state.selectedUnit;
    if (sel && sel._yaabInstance && sel._yaabInstance.id === instanceId) {
      App.state.selectedUnit = null;
    }
    notifyChanged({ structural: true });
    return true;
  }

  function notifyChanged(opts) {
    const structural = !opts || opts.structural !== false;
    if (structural && typeof App.renderUnitRosterWithContext === 'function') {
      // Adding/removing an instance changes the roster's unit count, which is
      // part of roster.js's filter signature — so this really does re-render.
      App.renderUnitRosterWithContext();
    } else {
      scheduleGridScan();
    }
    // force: the context signature (e.g. "u:captain") is unchanged after
    // naming, so without this the widget would keep the text you just
    // submitted sitting in its input.
    injectDetailWidget(true);
    if (App.Reserves && typeof App.Reserves.refreshPtsBadge === 'function') {
      App.Reserves.refreshPtsBadge();
    }
    if (App.Reserves && typeof App.Reserves.refreshCardBadges === 'function') {
      App.Reserves.refreshCardBadges();
    }
    // Deliberately NOT firing armyChange: naming a RESERVE unit doesn't touch
    // the army, and autosave saves on any kind — it would write the army to
    // localStorage on every keystroke of an unrelated edit. The army-list
    // "owns N" warnings still refresh, because create()/remove() go through
    // App.Reserves.setQty, which calls refreshArmyWarnings itself.
  }

  // ── army-entry helpers (used by army-list, cards mode, exports) ─────────

  function entryDisplayName(entry) {
    if (!entry) return '';
    return entry.customName || entry.unitName || '';
  }

  function entrySubName(entry) {
    if (!entry || !entry.customName) return '';
    return entry.unitName || '';
  }

  // ── roster augmentation ────────────────────────────────────────────────
  // Wrapping UI.renderUnitRoster covers every render path (App.renderAll and
  // App.renderUnitRosterWithContext are its only callers), so no shared file
  // needs to know instances exist.
  function withInstances(units) {
    // Return the caller's array BY IDENTITY unless we actually have something
    // to add. roster.js's content-signature short-circuit and scroll-restore
    // then behave exactly as they did before this feature existed.
    if (!Array.isArray(units)) return units;
    const view = (App.Reserves && typeof App.Reserves.getView === 'function')
      ? App.Reserves.getView() : null;
    if (view !== 'reserves') return units;
    const mode = (typeof App.getMode === 'function') ? App.getMode() : 'build';
    if (mode !== 'build') return units;

    const ids = Object.keys(RECORDS);
    if (!ids.length) return units;

    const clones = [];
    for (let i = 0; i < ids.length; i++) {
      const clone = instanceUnit(ids[i]);
      if (clone) clones.push(clone);   // unresolvable base → hidden, not deleted
    }
    if (!clones.length) return units;
    return units.concat(clones);
  }

  const _origRenderRoster = (window.UI && UI.renderUnitRoster) || null;
  if (_origRenderRoster) {
    UI.renderUnitRoster = function (units, searchTerm, factionFilter, selectedUnitId, linkedFactions) {
      return _origRenderRoster.call(
        UI, withInstances(units), searchTerm, factionFilter, selectedUnitId, linkedFactions
      );
    };
  }

  // ── click resolution ───────────────────────────────────────────────────
  // Instance cards carry the instance id in data-unit-id, so events.js's
  // App.findUnit lookup has to resolve it. Wrapping keeps events.js untouched.
  const _origFindUnit = App.findUnit;
  if (typeof _origFindUnit === 'function') {
    App.findUnit = function (unitId, factionName) {
      if (unitId && RECORDS[unitId]) {
        const clone = instanceUnit(unitId);
        if (clone) return clone;
      }
      return _origFindUnit.call(App, unitId, factionName);
    };
  }

  // ── add-to-army translation ────────────────────────────────────────────
  // Both add paths (double-click a card, and the Add to Army button) call
  // army.addUnit(unit, …) with whatever App.findUnit returned. Swapping the
  // clone for its base + a customName opt here means neither path needs an
  // edit, and the entry stores the REAL unitId — which matters, because 11e
  // ordinal pricing groups by entry.unitId.
  if (window.Army && Army.prototype && typeof Army.prototype.addUnit === 'function') {
    const _origAddUnit = Army.prototype.addUnit;
    Army.prototype.addUnit = function (unitData, count, squadOption, enhancements, wargear, opts) {
      if (unitData && unitData._yaabInstance) {
        const inst = unitData._yaabInstance;
        const merged = Object.assign({}, opts || {});
        if (!merged.customName) merged.customName = inst.name;
        return _origAddUnit.call(this, inst.base, count, squadOption, enhancements, wargear, merged);
      }
      return _origAddUnit.call(this, unitData, count, squadOption, enhancements, wargear, opts);
    };
  }

  // ── card decoration ────────────────────────────────────────────────────
  // UI.createUnitCard has no subtitle slot and forking it is not on the table,
  // so instance cards get their datasheet sub-line inserted here.
  function decorateCard(card) {
    if (!card) return;
    const id = card.dataset.unitId;
    const rec = id ? RECORDS[id] : null;
    if (!rec) {
      if (card.dataset.yaabInstance) {
        delete card.dataset.yaabInstance;
        card.classList.remove('unit-card-named');
        const stale = card.querySelector('.unit-card-subname');
        if (stale) stale.remove();
      }
      return;
    }
    const esc = UI.escapeHtml;
    card.dataset.yaabInstance = id;
    card.classList.add('unit-card-named');

    const nameEl = card.querySelector('.unit-card-name');
    if (nameEl && nameEl.textContent !== rec.n) nameEl.textContent = rec.n;

    const clone = instanceUnit(id);
    const dsName = clone ? clone._yaabInstance.dsName : '';
    if (!dsName) return;
    let sub = card.querySelector('.unit-card-subname');
    if (!sub) {
      sub = document.createElement('div');
      sub.className = 'unit-card-subname';
      const header = card.querySelector('.unit-card-header');
      if (header && header.parentNode) header.parentNode.insertBefore(sub, header.nextSibling);
      else card.appendChild(sub);
    }
    if (sub.innerHTML !== esc(dsName)) sub.innerHTML = esc(dsName);
  }

  function scheduleGridScan() {
    if (_gridScanRaf) return;
    _gridScanRaf = requestAnimationFrame(() => {
      _gridScanRaf = 0;
      const grid = document.getElementById('unit-grid');
      if (!grid) return;
      grid.querySelectorAll('.unit-card').forEach(decorateCard);
    });
  }

  function installGridObserver() {
    if (_gridObserver) return;
    const grid = document.getElementById('unit-grid');
    if (!grid) return;
    scheduleGridScan();
    // Decorate incrementally from the mutation records — a full re-scan on
    // every append would make scroll-pagination O(N²) (same reasoning as
    // reserves.js's grid observer).
    _gridObserver = new MutationObserver(records => {
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        if (!added) continue;
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (!node || node.nodeType !== 1) continue;
          if (node.classList && node.classList.contains('unit-card')) decorateCard(node);
        }
      }
    });
    _gridObserver.observe(grid, { childList: true, subtree: false });
  }

  // ── detail-pane widget ─────────────────────────────────────────────────

  function selectedContext() {
    const s = App.state || {};
    if (s.selectedUnit && s.selectedUnit._yaabInstance) {
      return { kind: 'instance', unit: s.selectedUnit, inst: s.selectedUnit._yaabInstance };
    }
    if (s.selectedUnit) {
      return { kind: 'unit', unit: s.selectedUnit };
    }
    if (s.currentArmy && s.selectedArmyEntryIndex != null) {
      const entry = s.currentArmy.entries[s.selectedArmyEntryIndex];
      if (entry) return { kind: 'entry', entry, index: s.selectedArmyEntryIndex };
    }
    return null;
  }

  function reservesViewActive() {
    return !!(App.Reserves && typeof App.Reserves.getView === 'function'
      && App.Reserves.getView() === 'reserves');
  }

  function widgetSignature(ctx) {
    if (!ctx) return '';
    if (ctx.kind === 'instance') return 'i:' + ctx.inst.id;
    if (ctx.kind === 'entry')    return 'e:' + (ctx.entry.entryId || ctx.index);
    return 'u:' + (ctx.unit && ctx.unit.id);
  }

  function buildWidget(ctx) {
    const esc = UI.escapeHtml;
    const wrap = document.createElement('div');
    wrap.className = 'custom-name-widget';
    wrap.dataset.ctx = widgetSignature(ctx);

    let title = '', value = '', placeholder = '', sub = '', actions = '';

    if (ctx.kind === 'instance') {
      title = 'Unit name';
      value = ctx.inst.name;
      placeholder = ctx.inst.dsName;
      sub = ctx.inst.dsName;
      actions =
        '<button type="button" class="cn-btn cn-btn-primary" data-action="rename">Rename</button>' +
        '<button type="button" class="cn-btn cn-btn-danger" data-action="release" ' +
          'title="Delete this name and return the model to the unnamed stack">Remove name</button>';
    } else if (ctx.kind === 'entry') {
      title = 'Unit name';
      value = ctx.entry.customName || '';
      placeholder = ctx.entry.unitName || '';
      sub = ctx.entry.customName ? (ctx.entry.unitName || '') : '';
      actions =
        '<button type="button" class="cn-btn cn-btn-primary" data-action="set-entry">Save name</button>' +
        (ctx.entry.customName
          ? '<button type="button" class="cn-btn cn-btn-danger" data-action="clear-entry">Clear</button>'
          : '');
    } else {
      title = 'Name one of these';
      value = '';
      placeholder = 'e.g. ' + (ctx.unit.name || 'Squad Gamma');
      actions =
        '<button type="button" class="cn-btn cn-btn-primary" data-action="create">Name this one</button>';
    }

    wrap.innerHTML =
      '<div class="custom-name-title">' + esc(title) + '</div>' +
      (ctx.kind === 'unit'
        ? '<div class="custom-name-hint">Splits one off your Reserves stack as its own unique unit.</div>'
        : '') +
      '<div class="custom-name-row">' +
        '<input type="text" class="custom-name-input" maxlength="' + MAX_LEN + '" ' +
          'value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" ' +
          'aria-label="' + esc(title) + '" />' +
      '</div>' +
      (sub ? '<div class="custom-name-sub">Datasheet: ' + esc(sub) + '</div>' : '') +
      '<div class="custom-name-actions">' + actions + '</div>';

    const input = wrap.querySelector('.custom-name-input');

    function commit(action) {
      const val = input ? input.value : '';
      if (action === 'create') {
        if (!sanitizeName(val)) { input && input.focus(); return; }
        create(ctx.unit.id, val);
        if (UI.toast) UI.toast('Named “' + sanitizeName(val) + '”', 'success');
      } else if (action === 'rename') {
        if (!sanitizeName(val)) { input && input.focus(); return; }
        rename(ctx.inst.id, val);
      } else if (action === 'release') {
        remove(ctx.inst.id);
        if (UI.toast) UI.toast('Name removed — model returned to Reserves', 'info');
      } else if (action === 'set-entry' || action === 'clear-entry') {
        const army = App.state && App.state.currentArmy;
        if (!army || typeof army.setCustomName !== 'function') return;
        const idx = army.entries.indexOf(ctx.entry);
        if (idx < 0) return;
        army.setCustomName(idx, action === 'clear-entry' ? '' : val);
        // Explicit save rather than leaning on autosave: autosave deliberately
        // skips armies still called "New Army", and naming a unit in a scratch
        // list should still stick.
        if (App.state.armyManager && typeof App.state.armyManager.saveArmy === 'function') {
          App.state.armyManager.saveArmy(army);
        }
        if (UI.renderArmyList) UI.renderArmyList(army);
        injectDetailWidget(true);
      }
    }

    wrap.addEventListener('click', evt => {
      const btn = evt.target.closest('[data-action]');
      if (!btn) return;
      commit(btn.dataset.action);
    });
    if (input) {
      input.addEventListener('keydown', evt => {
        if (evt.key !== 'Enter') return;
        evt.preventDefault();
        commit(ctx.kind === 'instance' ? 'rename' : ctx.kind === 'entry' ? 'set-entry' : 'create');
      });
    }
    return wrap;
  }

  // Give the detail pane's own header the same primary/subtitle treatment, and
  // stop the Google Images button searching for a nickname nobody has heard of.
  function decorateDetailHeader(content, ctx) {
    const esc = UI.escapeHtml;
    const stale = content.querySelector('.detail-datasheet-sub');
    const dsName = (ctx && ctx.kind === 'instance') ? ctx.inst.dsName : '';
    if (!dsName) { if (stale) stale.remove(); return; }

    const nameEl = content.querySelector('.detail-name');
    if (nameEl && !stale) {
      const el = document.createElement('div');
      el.className = 'detail-datasheet-sub';
      el.innerHTML = esc(dsName);
      nameEl.parentNode.insertBefore(el, nameEl.nextSibling);
    } else if (stale) {
      stale.innerHTML = esc(dsName);
    }
    const gbtn = content.querySelector('#btn-google-images');
    if (gbtn) gbtn.dataset.unit = dsName;
  }

  function injectDetailWidget(force) {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const content = panel.querySelector('.unit-detail-content');
    const dropStale = () => {
      const stale = panel.querySelector('.custom-name-widget');
      if (stale) stale.remove();
      const sub = panel.querySelector('.detail-datasheet-sub');
      if (sub) sub.remove();
    };
    if (!content || content.getAttribute('data-detail-kind') !== 'unit') { dropStale(); return; }

    const ctx = selectedContext();
    // A plain unit only gets the "name one of these" affordance in the Reserves
    // view, and only if there is actually an un-named one to split off.
    if (!ctx ||
        (ctx.kind === 'unit' && !(reservesViewActive() &&
          App.Reserves && App.Reserves.getQty(ctx.unit.id) > 0))) {
      dropStale();
      return;
    }

    decorateDetailHeader(content, ctx);

    const existing = panel.querySelector('.custom-name-widget');
    if (existing && !force && existing.dataset.ctx === widgetSignature(ctx)) return;
    if (existing) existing.remove();

    const widget = buildWidget(ctx);
    // Mount inside .detail-add-section, after reserves.js's stockpile
    // stepper — deciding what a unit is called belongs in the same box as
    // deciding whether it joins the army or the shelf. custom-names.js loads
    // after reserves.js, so its observer runs second and the stepper is
    // already there.
    const addSection = content.querySelector('.detail-add-section');
    const host = addSection || content;
    const stockpile = host.querySelector('.stockpile-detail-widget');
    if (stockpile && stockpile.parentNode === host) {
      host.insertBefore(widget, stockpile.nextSibling);
    } else {
      host.appendChild(widget);
    }
  }

  function installDetailObserver() {
    if (_detailObserver) return;
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    injectDetailWidget();
    _detailObserver = new MutationObserver(records => {
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'childList' && records[i].addedNodes &&
            records[i].addedNodes.length) {
          injectDetailWidget();
          return;
        }
      }
    });
    // subtree:false — our own insert lands inside .detail-add-section, so it
    // cannot retrigger this and loop.
    _detailObserver.observe(panel, { childList: true, subtree: false });
  }

  // ── hook registrations ─────────────────────────────────────────────────

  App.hooks.cardClassContributors.push(function (unit) {
    return (unit && unit._yaabInstance) ? 'unit-card-named' : null;
  });

  App.hooks.bootstrap.push(function () {
    installDetailObserver();
    installGridObserver();
    scheduleGridScan();
  });

  App.hooks.selectionChange.push(function () {
    injectDetailWidget();
    scheduleGridScan();
  });

  // ── cross-tab + cloud-pull rehydration ─────────────────────────────────
  // REBUILD from the incoming value; never merge into the stale in-memory map.
  // Merging would resurrect records another device deleted, and the next local
  // write would push them back to the server.
  function rehydrate(raw) {
    RECORDS = parseRecords(raw);
    if (typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
    injectDetailWidget(true);
    if (App.Reserves && typeof App.Reserves.refreshPtsBadge === 'function') {
      App.Reserves.refreshPtsBadge();
    }
  }

  window.addEventListener('storage', function (e) {
    if (!e || e.key !== LS_KEY) return;
    rehydrate(e.newValue);
  });

  // Same-tab sync pulls write through the patched localStorage.setItem and so
  // never fire a `storage` event; sync.js announces them with this instead.
  window.addEventListener('yaab-bag-pulled', function (e) {
    const keys = (e && e.detail && e.detail.keys) || null;
    if (keys && keys.indexOf(LS_KEY) === -1) return;
    try { rehydrate(localStorage.getItem(LS_KEY)); } catch (_) {}
  });

  // ── public API ─────────────────────────────────────────────────────────
  App.CustomNames = {
    list: listFor,
    countFor,
    all: allRecords,
    create,
    rename,
    remove,
    instanceUnit,
    isInstance,
    entryDisplayName,
    entrySubName,
    MAX_LEN,
  };
})();
