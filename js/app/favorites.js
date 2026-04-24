// app/favorites.js — star/unstar units + Recents chip; LS-persisted, hook-driven.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_FAV    = 'yaab_favorites';
  const LS_RECENT = 'yaab_recents';
  const RECENT_CAP = 10;

  const STATE = {
    favorites: new Set(),   // unit ids
    recents:   [],          // [{ unitId, factionName, addedAt }], newest-first
  };

  // Snapshot of previous army entry unit-ids, used by armyChange hook to detect
  // genuine ADDs (id present now that was not present last tick) vs renders /
  // removes / count changes.
  let _prevEntryIds = new Set();
  let _prevArmyId   = null;

  // ----- persistence -------------------------------------------------------

  function loadPersisted() {
    try {
      const favRaw = localStorage.getItem(LS_FAV);
      if (favRaw) {
        const arr = JSON.parse(favRaw);
        if (Array.isArray(arr)) STATE.favorites = new Set(arr.filter(x => typeof x === 'string'));
      }
    } catch (_) { /* ignore corruption */ }
    try {
      const recRaw = localStorage.getItem(LS_RECENT);
      if (recRaw) {
        const arr = JSON.parse(recRaw);
        if (Array.isArray(arr)) {
          STATE.recents = arr.filter(r => r && typeof r.unitId === 'string').slice(0, RECENT_CAP);
        }
      }
    } catch (_) { /* ignore */ }
  }

  function saveFavorites() {
    try { localStorage.setItem(LS_FAV, JSON.stringify([...STATE.favorites])); }
    catch (_) { /* quota or private mode — ignore */ }
  }

  function saveRecents() {
    try { localStorage.setItem(LS_RECENT, JSON.stringify(STATE.recents)); }
    catch (_) { /* ignore */ }
  }

  // ----- favorites toggling -----------------------------------------------

  function isFavorite(unit) {
    return !!(unit && unit.id && STATE.favorites.has(unit.id));
  }

  function toggleFavorite(unit) {
    if (!unit || !unit.id) return;
    if (STATE.favorites.has(unit.id)) STATE.favorites.delete(unit.id);
    else STATE.favorites.add(unit.id);
    saveFavorites();
    // Re-render detail panel so the star flips, and refresh roster if Favorites
    // chip is active (count + filter).
    refreshDetailStar({ animate: true });
    syncChipCounts();
    if (_favChipActive && window.App && typeof App.renderUnitRosterWithContext === 'function') {
      App.renderUnitRosterWithContext();
    }
  }

  // ----- detail-panel star injection --------------------------------------
  //
  // We register a detailActions hook entry whose .html is a GETTER. The getter
  // reads UI._state.selectedUnit (the same unit being rendered) and returns
  // the correct glyph on each render pass. No fork of detail.js required.

  const starAction = {
    id: 'favorite-toggle',
    title: 'Star/unstar this unit (keyboard: click)',
    onClick: function (unit) { toggleFavorite(unit); },
  };
  Object.defineProperty(starAction, 'html', {
    enumerable: true,
    get: function () {
      const sel = window.UI && UI._state && UI._state.selectedUnit;
      const on  = isFavorite(sel);
      return on
        ? '<span class="fav-star is-starred">★</span>'
        : '<span class="fav-star">☆</span>';
    },
  });

  // Re-query the rendered button in the detail panel and sync its icon.
  // Used after toggle (to flip instantly without a full detail re-render) and
  // on selectionChange (which may fire before detail re-renders elsewhere).
  function refreshDetailStar(opts) {
    const panel = document.getElementById('unit-detail-panel');
    if (!panel) return;
    const btn = panel.querySelector('.detail-action-btn[data-action-id="favorite-toggle"]');
    if (!btn) return;
    const sel = window.UI && UI._state && UI._state.selectedUnit;
    const on = isFavorite(sel);
    btn.innerHTML = on
      ? '<span class="fav-star is-starred">★</span>'
      : '<span class="fav-star">☆</span>';
    btn.classList.toggle('is-starred', on);
    if (opts && opts.animate) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        const inner = btn.querySelector('.fav-star');
        if (inner) {
          inner.classList.remove('fav-pop');
          // force reflow so re-adding the class restarts the animation
          void inner.offsetWidth;
          inner.classList.add('fav-pop');
        }
      }
    }
  }

  // ----- recents detection (add-vs-render diff) ---------------------------
  //
  // On each armyChange we build a set of current entry.unitIds and diff
  // against the previous snapshot. Any id present now but not before is a
  // newly-added unit and gets pushed to the front of recents. This correctly
  // distinguishes adds from renders, count updates, and removes. On a "new
  // army" / "load" (detected by army.id change) we reset the baseline so the
  // loaded entries don't all look brand-new.

  function snapshotEntryIds(army) {
    const out = new Set();
    const entries = (army && army.entries) || [];
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i] && entries[i].unitId;
      if (id) out.add(id);
    }
    return out;
  }

  function findUnitById(unitId) {
    const state = App.state;
    if (!state || !state.allUnits) return null;
    for (let i = 0; i < state.allUnits.length; i++) {
      if (state.allUnits[i].id === unitId) return state.allUnits[i];
    }
    return null;
  }

  function pushRecent(unitId) {
    // Deduplicate: if already in recents, move to front; otherwise prepend.
    const idx = STATE.recents.findIndex(r => r.unitId === unitId);
    const unit = findUnitById(unitId);
    const entry = {
      unitId: unitId,
      factionName: (unit && unit._factionName) || '',
      addedAt: Date.now(),
    };
    if (idx >= 0) STATE.recents.splice(idx, 1);
    STATE.recents.unshift(entry);
    if (STATE.recents.length > RECENT_CAP) STATE.recents.length = RECENT_CAP;
    saveRecents();
  }

  function handleArmyChange(army /*, kind */) {
    if (!army) { _prevEntryIds = new Set(); _prevArmyId = null; return; }
    const currentIds = snapshotEntryIds(army);
    // Reset baseline on army-identity change (new/load/import) — don't count
    // every pre-existing entry as a fresh "add".
    if (army.id !== _prevArmyId) {
      _prevEntryIds = currentIds;
      _prevArmyId = army.id;
      return;
    }
    // Ids in current that were NOT in previous = new adds.
    let changed = false;
    currentIds.forEach(id => {
      if (!_prevEntryIds.has(id)) { pushRecent(id); changed = true; }
    });
    _prevEntryIds = currentIds;
    if (changed) {
      syncChipCounts();
      if (_recentChipActive && window.App && typeof App.renderUnitRosterWithContext === 'function') {
        App.renderUnitRosterWithContext();
      }
    }
  }

  // ----- roster chip bar integration --------------------------------------

  let _favChipActive    = false;
  let _recentChipActive = false;
  let _chipsInjected    = false;
  let _chipObserver     = null;
  let _predicateRegistered = false;

  function ensurePredicate() {
    if (_predicateRegistered) return;
    if (!Array.isArray(App.hooks.rosterFilters)) return;
    const pred = function favoritesRecentsPredicate(unit) {
      if (!_favChipActive && !_recentChipActive) return true;
      const id = unit && unit.id;
      if (!id) return false;
      if (_favChipActive && !STATE.favorites.has(id)) return false;
      if (_recentChipActive && !STATE.recents.some(r => r.unitId === id)) return false;
      return true;
    };
    pred._isFavRecentPredicate = true;
    // Dedupe on module re-run.
    App.hooks.rosterFilters = App.hooks.rosterFilters.filter(fn => !fn._isFavRecentPredicate);
    App.hooks.rosterFilters.push(pred);
    _predicateRegistered = true;
  }

  function injectChips(bar) {
    if (!bar) return;
    if (bar.querySelector('.fav-chip') && bar.querySelector('.recent-chip')) {
      _chipsInjected = true;
      syncChipCounts();
      return;
    }

    // Find the clear button so we insert new chips before it (keeps '×' last).
    const clearBtn = bar.querySelector('.filter-chips-clear');

    if (!bar.querySelector('.fav-chip')) {
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'filter-chip fav-chip';
      favBtn.title = 'Show only starred units';
      favBtn.innerHTML = '<span class="fav-chip-glyph">★</span> Favorites <span class="fav-chip-count" data-fav-count>0</span>';
      favBtn.addEventListener('click', () => {
        _favChipActive = !_favChipActive;
        favBtn.classList.toggle('active', _favChipActive);
        if (window.App && typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      });
      if (clearBtn) bar.insertBefore(favBtn, clearBtn); else bar.appendChild(favBtn);
    }

    if (!bar.querySelector('.recent-chip')) {
      const recBtn = document.createElement('button');
      recBtn.type = 'button';
      recBtn.className = 'filter-chip recent-chip';
      recBtn.title = 'Show only recently-added units (last ' + RECENT_CAP + ')';
      recBtn.innerHTML = '<span class="recent-chip-glyph">⟲</span> Recents <span class="recent-chip-count" data-recent-count>0</span>';
      recBtn.addEventListener('click', () => {
        _recentChipActive = !_recentChipActive;
        recBtn.classList.toggle('active', _recentChipActive);
        if (window.App && typeof App.renderUnitRosterWithContext === 'function') {
          App.renderUnitRosterWithContext();
        }
      });
      if (clearBtn) bar.insertBefore(recBtn, clearBtn); else bar.appendChild(recBtn);
    }

    _chipsInjected = true;
    syncChipCounts();
  }

  function syncChipCounts() {
    const favCountEl = document.querySelector('[data-fav-count]');
    if (favCountEl) favCountEl.textContent = '(' + STATE.favorites.size + ')';
    const recCountEl = document.querySelector('[data-recent-count]');
    if (recCountEl) recCountEl.textContent = '(' + STATE.recents.length + ')';
  }

  // Watch the center panel for the chip bar (created by roster.js on first
  // render). Once present, inject our chips; then disconnect. Re-install is
  // allowed via bootstrap (e.g. if the panel is re-mounted by a dev reload).
  function installChipObserver() {
    if (_chipObserver) { _chipObserver.disconnect(); _chipObserver = null; }
    const existing = document.getElementById('roster-filter-chips');
    if (existing) { injectChips(existing); return; }
    const center = document.getElementById('panel-center') || document.body;
    _chipObserver = new MutationObserver(() => {
      const bar = document.getElementById('roster-filter-chips');
      if (bar) {
        injectChips(bar);
        if (_chipObserver) { _chipObserver.disconnect(); _chipObserver = null; }
      }
    });
    _chipObserver.observe(center, { childList: true, subtree: true });
  }

  // ----- hook registration -------------------------------------------------

  App.hooks.detailActions.push(starAction);

  App.hooks.bootstrap.push(function (state) {
    loadPersisted();
    ensurePredicate();
    installChipObserver();
    // Seed the baseline with whatever army is loaded at boot so we don't
    // flag its existing entries as recent additions on the first hook call.
    if (state && state.currentArmy) {
      _prevEntryIds = snapshotEntryIds(state.currentArmy);
      _prevArmyId   = state.currentArmy.id;
    }
    syncChipCounts();
  });

  App.hooks.armyChange.push(handleArmyChange);

  App.hooks.selectionChange.push(function () {
    // Selection change triggers a detail re-render elsewhere; once that DOM
    // settles the getter-based html will already be correct. This call is a
    // safety net for paths that mutate selectedUnit without re-rendering.
    refreshDetailStar({ animate: false });
  });
})();
