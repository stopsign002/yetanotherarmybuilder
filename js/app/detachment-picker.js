// app/detachment-picker.js — the "Detachments" box (multi-select).
//
// Replaces the old single-select detachment dropdown. Lists every detachment
// available to the current army (via App.getAvailableDetachments, selections.js),
// each with its 40kdc `detachment_points` rating; clicking one toggles it into
// the army. Selected detachments' rules / enhancements / stratagems are shown as
// a UNION in the Army Rules & Stratagems box (js/ui/faction-rules.js), and their
// enhancements become assignable to characters (App.getActiveEnhancements).
//
// For Space Marine chapters, chapter-specific detachments are listed first
// (alphabetical), then the generic codex Space Marines detachments — the generic
// ones are identified as those that also exist on the parent SM faction.
(function () {
  const App = window.App = window.App || {};

  const alpha = (a, b) =>
    String(a && a.name || '').localeCompare(String(b && b.name || ''), undefined, { sensitivity: 'base' });

  // Split the available detachments into display groups. For an SM chapter:
  // [{label:'Space Wolves', items:[chapter-specific…]}, {label:'Space Marines
  // (generic)', items:[generic…]}]. For anything else: one unlabeled group.
  function groupDetachments(dets) {
    const state   = App.state;
    const curFac  = (typeof App.getCurrentFaction === 'function') ? App.getCurrentFaction() : null;
    const curName = curFac && curFac.factionName;
    const parentName = curName && App.CHAPTER_PARENTS && App.CHAPTER_PARENTS[curName];
    if (!parentName) {
      return [{ label: null, items: dets.slice().sort(alpha) }];
    }
    const parentFac = (state.factions || []).find(f => f.factionName === parentName);
    const parentNames = new Set((parentFac && parentFac.detachments || [])
      .map(d => String(d && d.name || '').toLowerCase()));
    const specific = [], generic = [];
    dets.forEach(d => {
      (parentNames.has(String(d && d.name || '').toLowerCase()) ? generic : specific).push(d);
    });
    const shortChapter = curName.includes(' - ') ? curName.split(' - ').pop().trim() : curName;
    return [
      { label: shortChapter,             items: specific.sort(alpha) },
      { label: 'Space Marines (generic)', items: generic.sort(alpha) },
    ].filter(g => g.items.length > 0);
  }

  const ptLabel = (p) => (p == null ? '' : `${p} pt${p === 1 ? '' : 's'}`);

  // Enhancements available for assignment = union across all selected
  // detachments, deduped by name (first occurrence wins).
  App.getActiveEnhancements = function () {
    const dets = (App.state && App.state.selectedDetachments) || [];
    const seen = new Set(), out = [];
    dets.forEach(d => (d && d.enhancements || []).forEach(e => {
      if (!e || !e.name) return;
      const k = e.name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    }));
    return out;
  };

  // Re-render whichever unit detail is open so its Enhancements section tracks
  // the current union. Mirrors the logic the old detachment-select handler had.
  function refreshOpenDetail() {
    const state = App.state;
    if (!window.UI || typeof UI.renderUnitDetail !== 'function') return;
    const enh = App.getActiveEnhancements();
    if (state.selectedArmyEntryIndex != null && state.currentArmy) {
      const entry = state.currentArmy.entries[state.selectedArmyEntryIndex];
      if (entry) UI.renderUnitDetail(entry.unitData, enh, entry.enhancements || []);
    } else if (state.selectedUnit) {
      UI.renderUnitDetail(state.selectedUnit, enh, []);
    }
  }

  // Canonical entry point for CHANGING the selection. `names` is the full new
  // list of selected detachment names; only names present in the available list
  // are kept. Resolves them to objects, syncs state + the current army, and
  // re-renders the picker, the Army Rules union, and any open unit detail.
  // opts.persist (default true) saves the army when it's named.
  App.setSelectedDetachments = function (names, opts) {
    const state = App.state;
    opts = opts || {};
    const persist = opts.persist !== false;
    const available = (typeof App.getAvailableDetachments === 'function') ? App.getAvailableDetachments() : [];
    const byName = new Map(available.map(d => [d.name, d]));
    const clean = (Array.isArray(names) ? names : []).filter(n => byName.has(n));

    state.selectedDetachments = clean.map(n => byName.get(n));
    state.selectedDetachment  = state.selectedDetachments[0] || null;
    if (state.currentArmy && typeof state.currentArmy.setDetachments === 'function') {
      // Only advance updatedAt on a genuine user toggle (persist), never on a
      // programmatic load/restore — otherwise every load looks newer than cloud.
      state.currentArmy.setDetachments(clean, { touch: persist });
    }

    App.renderDetachmentPicker();
    if (window.UI && typeof UI.updateFactionRules === 'function') {
      UI.updateFactionRules(typeof App.getCurrentFaction === 'function' ? App.getCurrentFaction() : null);
    }
    refreshOpenDetail();

    if (persist && state.currentArmy && state.armyManager &&
        window.ArmyManager && ArmyManager.isNamed && ArmyManager.isNamed(state.currentArmy)) {
      state.armyManager.saveArmy(state.currentArmy);
    }
  };

  // Toggle one detachment in/out of the current selection.
  App.toggleDetachment = function (name) {
    if (!name) return;
    const cur = ((App.state.currentArmy && App.state.currentArmy.detachmentNames) ||
                 (App.state.selectedDetachments || []).map(d => d.name) || []).slice();
    const i = cur.indexOf(name);
    if (i >= 0) cur.splice(i, 1); else cur.push(name);
    App.setSelectedDetachments(cur, { persist: true });
  };

  // (Re)render the box body + the summary total badge.
  App.renderDetachmentPicker = function () {
    const body  = document.getElementById('detachments-body');
    const total = document.getElementById('detachments-total');
    if (!body) return;
    const esc = (window.UI && UI.escapeHtml) ? UI.escapeHtml : (s => String(s == null ? '' : s));

    const detFaction = (typeof App.getDetachmentFaction === 'function') ? App.getDetachmentFaction() : null;
    const factionsReady = Array.isArray(App.state.factions) && App.state.factions.length > 0;

    if (!detFaction) {
      // Don't wipe a populated list during warm-up (a visibility re-render can
      // fire before factions hydrate) — mirrors the old dropdown's guard.
      if (!factionsReady && body.querySelector('.detachment-row')) return;
      body.innerHTML = '<div class="detachments-empty">Pick a faction to see its detachments.</div>';
      if (total) total.textContent = '';
      return;
    }

    const dets = (typeof App.getAvailableDetachments === 'function') ? App.getAvailableDetachments() : [];
    if (!dets.length) {
      body.innerHTML = '<div class="detachments-empty">No detachments for this faction.</div>';
      if (total) total.textContent = '';
      return;
    }

    const selectedNames = new Set(
      ((App.state.currentArmy && App.state.currentArmy.detachmentNames) ||
       (App.state.selectedDetachments || []).map(d => d.name) || [])
    );

    const groups = groupDetachments(dets);
    let html = '';
    groups.forEach(g => {
      if (g.label) html += `<div class="detachments-group-label">${esc(g.label)}</div>`;
      html += '<div class="detachments-list">';
      g.items.forEach(d => {
        const sel = selectedNames.has(d.name);
        const pts = d.points;
        html +=
          `<div class="detachment-row${sel ? ' selected' : ''}" data-name="${esc(d.name)}" ` +
          `role="button" tabindex="0" aria-pressed="${sel ? 'true' : 'false'}">` +
            `<span class="detachment-row-check" aria-hidden="true">${sel ? '&#10003;' : ''}</span>` +
            `<span class="detachment-row-name">${esc(d.name)}</span>` +
            (pts != null ? `<span class="detachment-row-pts">${esc(ptLabel(pts))}</span>` : '') +
          '</div>';
      });
      html += '</div>';
    });

    // Running total of detachment points across the selection.
    const selectedDets = (App.state.selectedDetachments || []);
    const totalPts = selectedDets.reduce((s, d) => s + (d && d.points || 0), 0);
    const count = selectedDets.length;
    html +=
      `<div class="detachments-footer">` +
        `<span class="detachments-footer-count">${count} selected</span>` +
        `<span class="detachments-footer-pts">${totalPts} pt${totalPts === 1 ? '' : 's'}</span>` +
      `</div>`;

    body.innerHTML = html;
    if (total) total.textContent = count ? `${totalPts} pt${totalPts === 1 ? '' : 's'}` : '';
  };

  // One delegated listener handles clicks/keys on every (re-rendered) row.
  function onActivate(name) { if (name) App.toggleDetachment(name); }
  document.addEventListener('click', e => {
    const row = e.target.closest && e.target.closest('.detachment-row');
    if (row && document.getElementById('detachments-body') &&
        document.getElementById('detachments-body').contains(row)) {
      onActivate(row.dataset.name);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest && e.target.closest('.detachment-row');
    if (row && document.getElementById('detachments-body') &&
        document.getElementById('detachments-body').contains(row)) {
      e.preventDefault();
      onActivate(row.dataset.name);
    }
  });

  // Defensive first paint once the app has bootstrapped.
  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(() => { try { App.renderDetachmentPicker(); } catch (_) {} });
  }
})();
