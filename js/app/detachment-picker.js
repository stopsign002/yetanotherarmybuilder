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

  // Name of the detachment whose details are currently shown in the Details
  // pane (read-only view). Persists across picker re-renders so the row stays
  // highlighted. Distinct from SELECTED (in the army) — that's the checkbox.
  let viewingName = null;

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
    // `_gdcFactionTag` is GW's own per-detachment chapter tag, set by
    // dc-adapter's GDC-authority pass: 'Adeptus Astartes' means any chapter may
    // take it, anything else names the chapter it belongs to. Prefer it over
    // the "does the parent list this name too?" heuristic, which stopped
    // working the moment the parent adopted GW's full 22: vanilla Space Marines
    // now carries Blade of Ultramar, so Ultramarines' own copy of it read as
    // "Space Marines (generic)".
    const GENERIC_TAG = 'adeptus astartes';
    dets.forEach(d => {
      const tag = d && d._gdcFactionTag;
      const isGeneric = tag
        ? String(tag).toLowerCase() === GENERIC_TAG
        : parentNames.has(String(d && d.name || '').toLowerCase());
      (isGeneric ? generic : specific).push(d);
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

  // ── Force Disposition ────────────────────────────────────────────────────
  // 11e: every detachment carries one or more Force Dispositions, and the
  // player declares ONE of the dispositions marked on the detachments they
  // have taken. So the choices are the union across the selected detachments
  // (deduped by id, in selection order). The army stores only the declared id;
  // the effective disposition is that id when it is still on offer, otherwise
  // the only one on offer, otherwise none (the player has to choose).
  App.getAvailableDispositions = function () {
    const dets = (App.state && App.state.selectedDetachments) || [];
    const seen = new Set(), out = [];
    dets.forEach(d => (d && d.dispositions || []).forEach(x => {
      if (!x || !x.id || seen.has(x.id)) return;
      seen.add(x.id);
      out.push(x);
    }));
    return out;
  };

  App.getArmyDisposition = function () {
    const avail = App.getAvailableDispositions();
    const army = App.state && App.state.currentArmy;
    const chosen = army && army.disposition;
    if (chosen) {
      const hit = avail.find(x => x.id === chosen);
      if (hit) return hit;
    }
    return avail.length === 1 ? avail[0] : null;
  };

  App.setArmyDisposition = function (id) {
    const state = App.state;
    const army = state && state.currentArmy;
    if (!army || typeof army.setDisposition !== 'function') return;
    if (!App.getAvailableDispositions().some(x => x.id === id)) return;
    if (army.disposition === id) return;
    army.setDisposition(id);
    App.renderDetachmentPicker();
    if (state.armyManager && window.ArmyManager && ArmyManager.isNamed && ArmyManager.isNamed(army)) {
      state.armyManager.saveArmy(army);
    }
    if (typeof App.fireSelectionChange === 'function') App.fireSelectionChange();
  };

  function renderDispositionBlock(esc) {
    const selected = (App.state.selectedDetachments || []);
    if (!selected.length) return '';
    const avail = App.getAvailableDispositions();
    const eff = App.getArmyDisposition();
    let html = '<div class="disposition-block" id="disposition-block">' +
      '<div class="disposition-head">' +
        '<span class="disposition-label" id="disposition-label">Force Disposition</span>' +
        (avail.length > 1 && !eff ? '<span class="disposition-needed">Choose one</span>' : '') +
      '</div>';
    if (!avail.length) {
      html += '<div class="disposition-note">Your detachments don&rsquo;t list a disposition.</div>';
    } else if (avail.length === 1) {
      const d = avail[0];
      html += `<div class="disposition-fixed" data-id="${esc(d.id)}">` +
          `<span class="disposition-fixed-name">${esc(d.name)}</span>` +
          '<span class="disposition-fixed-tag">only option</span>' +
        '</div>' +
        (d.text ? `<div class="disposition-note">${esc(d.text)}</div>` : '');
    } else {
      html += '<div class="disposition-choices" role="radiogroup" aria-labelledby="disposition-label">';
      avail.forEach(d => {
        const on = !!(eff && eff.id === d.id);
        html += `<button type="button" class="disposition-choice${on ? ' selected' : ''}" role="radio" ` +
          `aria-checked="${on}" data-id="${esc(d.id)}"${d.text ? ` title="${esc(d.text)}"` : ''}>${esc(d.name)}</button>`;
      });
      html += '</div>' +
        (eff && eff.text ? `<div class="disposition-note">${esc(eff.text)}</div>`
          : '<div class="disposition-note">Your detachments offer more than one. Pick the one you are playing.</div>');
    }
    return html + '</div>';
  }

  // ── Enhancement limits ───────────────────────────────────────────────────
  // A unit takes at most ONE enhancement, and each enhancement can be taken
  // only once per army — except UPGRADE enhancements ("<UNIT> unit only.",
  // usually named "… (Upgrade)"), which several units may take.
  const UPGRADE_CLAUSE = /(?:^|[.!?][)"'’]?\s+)([A-Z][A-Z0-9'’\- ]+?)\s+unit only\b/;
  App.isUpgradeEnhancement = function (enh) {
    if (!enh) return false;
    if (/\(upgrade\)/i.test(String(enh.name || ''))) return true;
    return UPGRADE_CLAUSE.test(String(enh.description || '').trim());
  };
  // The army entry (other than `exceptIndex`) already carrying this
  // non-upgrade enhancement, or null. Upgrades are never "taken".
  App.enhancementTakenBy = function (enh, exceptIndex) {
    const army = App.state && App.state.currentArmy;
    if (!army || !enh || App.isUpgradeEnhancement(enh)) return null;
    const key = String(enh.name || '').toLowerCase();
    return (army.entries || []).find((e, i) => i !== exceptIndex &&
      (e.enhancements || []).some(x => String(x && x.name || '').toLowerCase() === key)) || null;
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

    // js/app/hooks.js documents selectionChange as firing on faction, chapter
    // AND detachment changes, but this function never fired it, so every
    // module following the hook-first convention silently missed detachment
    // toggles and had to hand-roll a `.detachment-row-cb` change listener
    // instead (issue #57; kotc.js carried exactly that workaround).
    //
    // Fired LAST, after the three refreshes above and after the save, so
    // listeners see fully settled state — reserves.js in particular injects
    // its widget into the unit detail that refreshOpenDetail() has just
    // rebuilt, and would be wiped out if it ran first.
    //
    // Fires on programmatic restores (persist:false) too: a load or a share-
    // code apply IS a selection change as far as a listener is concerned, and
    // the hook doc draws no distinction. Cheap either way — the roster render
    // path (js/app/render.js:95) already fans this hook out to ~25 listeners
    // on every repaint, so one more fire per detachment toggle is noise.
    if (typeof App.fireSelectionChange === 'function') App.fireSelectionChange();
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
        const viewing = (d.name === viewingName);
        const pts = d.points;
        html +=
          `<div class="detachment-row${sel ? ' selected' : ''}${viewing ? ' viewing' : ''}" data-name="${esc(d.name)}" ` +
          `role="button" tabindex="0" title="Click to read its rules; tick the box to add it to your army">` +
            `<input type="checkbox" class="detachment-row-cb" data-name="${esc(d.name)}" ${sel ? 'checked' : ''} ` +
            `aria-label="Add ${esc(d.name)} to your army" />` +
            `<span class="detachment-row-name">${esc(d.name)}` +
              ((d.dispositions || []).length
                ? `<span class="detachment-row-dispo">${(d.dispositions || []).map(x => esc(x.name)).join(' · ')}</span>`
                : '') +
            `</span>` +
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
    html += renderDispositionBlock(esc);

    body.innerHTML = html;
    if (total) total.textContent = count ? `${totalPts} pt${totalPts === 1 ? '' : 's'}` : '';
  };

  function inBody(el) {
    const body = document.getElementById('detachments-body');
    return !!(body && el && body.contains(el));
  }

  // Show a detachment's full rules/enhancements/stratagems in the Details pane.
  // Read-only — it does NOT change what's in the army (that's the checkbox).
  function showDetail(name) {
    if (!name) return;
    viewingName = name;
    const avail = (typeof App.getAvailableDetachments === 'function') ? App.getAvailableDetachments() : [];
    const det = avail.find(d => d.name === name);
    if (det && window.UI && typeof UI.renderDetachmentDetail === 'function') {
      UI.renderDetachmentDetail(det);
      if (App.setMobilePanel) App.setMobilePanel('detail');
    }
    const body = document.getElementById('detachments-body');
    if (body) body.querySelectorAll('.detachment-row').forEach(r =>
      r.classList.toggle('viewing', r.dataset.name === name));
  }

  // Checkbox toggles army membership (delegated — survives re-renders).
  document.addEventListener('change', e => {
    const cb = e.target.closest && e.target.closest('.detachment-row-cb');
    if (!cb || !inBody(cb)) return;
    if (cb.dataset.name) App.toggleDetachment(cb.dataset.name);
  });
  // Disposition choice buttons (delegated — survive re-renders).
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.disposition-choice');
    if (b && inBody(b) && b.dataset.id) App.setArmyDisposition(b.dataset.id);
  });
  // Clicking the row anywhere BUT the checkbox opens its details.
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('.detachment-row-cb')) return;
    const row = e.target.closest && e.target.closest('.detachment-row');
    if (row && inBody(row)) showDetail(row.dataset.name);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.closest && e.target.closest('.detachment-row-cb')) return;
    const row = e.target.closest && e.target.closest('.detachment-row');
    if (row && inBody(row)) { e.preventDefault(); showDetail(row.dataset.name); }
  });

  // Defensive first paint once the app has bootstrapped.
  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(() => { try { App.renderDetachmentPicker(); } catch (_) {} });
  }
})();
