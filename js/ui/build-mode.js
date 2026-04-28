// ui/build-mode.js — orchestrator for the BUILD mode layout: hero header, rules pinboard tab, roster polish.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Animated hex crest reused from animated-crest.js styling — same SVG markup
  // so the existing .atmosphere-crest CSS animations apply when present.
  const HERO_CREST_SVG =
    '<svg class="build-hero-crest atmosphere-crest" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M50 6 L86 26 L86 74 L50 94 L14 74 L14 26 Z" stroke-opacity="0.85"/>' +
        '<path d="M50 22 L72 35 L72 65 L50 78 L28 65 L28 35 Z" stroke-opacity="0.45"/>' +
        '<g class="atmosphere-crest-rotor" stroke-opacity="0.7">' +
          '<line x1="50" y1="14" x2="50" y2="22"/>' +
          '<line x1="80" y1="32" x2="73" y2="36"/>' +
          '<line x1="80" y1="68" x2="73" y2="64"/>' +
          '<line x1="50" y1="86" x2="50" y2="78"/>' +
          '<line x1="20" y1="68" x2="27" y2="64"/>' +
          '<line x1="20" y1="32" x2="27" y2="36"/>' +
        '</g>' +
        '<g class="atmosphere-crest-pulse">' +
          '<path d="M38 56 L50 44 L62 56" stroke-opacity="0.95"/>' +
          '<circle cx="50" cy="62" r="2.4" fill="currentColor" stroke="none"/>' +
        '</g>' +
      '</g>' +
    '</svg>';

  // Module-private state for tab switching + saved-status timing.
  const ui = {
    hero: null,
    factionEl: null,
    armyNameInput: null,
    detachmentEl: null,
    pointsCurrentEl: null,
    pointsLimitEl: null,
    pointsBarEl: null,
    pointsPctEl: null,
    statusEl: null,
    crestWrap: null,
    rulesTabBtn: null,
    detailTabBtn: null,
    rulesPanel: null,
    panelBody: null,
    activeTab: 'detail', // 'detail' | 'rules'
    savedAt: null,
    dirty: false,
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function buildContainer() {
    return document.getElementById('build-mode') || document.getElementById('app-main');
  }

  // The topbar exposes #topbar-hero-slot as the preferred mount point
  // for the build-hero so the YAAB row + status row collapse into one
  // bar. If the slot isn't on the page (older index.html, or a build
  // that ran before the topbar refactor), we fall back to the legacy
  // mount inside the build-mode page.
  function heroMountHost() {
    return document.getElementById('topbar-hero-slot') || buildContainer();
  }

  function fmtAgo(ts) {
    if (!ts) return '';
    const ms = Date.now() - ts;
    const s  = Math.floor(ms / 1000);
    if (s < 30)  return 'just now';
    if (s < 60)  return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60)  return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24)  return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function esc(s) {
    if (window.UI && typeof UI.escapeHtml === 'function') return UI.escapeHtml(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Hero header ────────────────────────────────────────────────────────
  function buildHero() {
    if (ui.hero) return ui.hero;
    const host = heroMountHost();
    if (!host) return null;
    const hero = document.createElement('header');
    hero.className = 'build-hero';
    if (host.id === 'topbar-hero-slot') hero.classList.add('build-hero--in-topbar');
    hero.setAttribute('role', 'region');
    hero.setAttribute('aria-label', 'Army summary');
    hero.innerHTML =
      '<div class="build-hero-crest-wrap" data-build-hero-crest="1">' + HERO_CREST_SVG + '</div>' +
      '<div class="build-hero-main">' +
        '<div class="build-hero-status">' +
          '<span class="build-hero-status-dot" aria-hidden="true"></span>' +
          '<span class="build-hero-status-text" data-build-hero="status">Ready</span>' +
        '</div>' +
        '<div class="build-hero-faction" data-build-hero="faction">Select a faction</div>' +
        '<div class="build-hero-subtitle">' +
          '<input type="text" class="build-hero-name" data-build-hero="name" ' +
                 'aria-label="Army name" placeholder="My Army" />' +
          '<span class="build-hero-sep" aria-hidden="true">&middot;</span>' +
          '<span class="build-hero-detachment" data-build-hero="detachment">No detachment</span>' +
        '</div>' +
      '</div>' +
      '<div class="build-hero-points">' +
        '<div class="build-hero-points-readout">' +
          '<span class="build-hero-points-current" data-build-hero="points-current">0</span>' +
          '<span class="build-hero-points-sep">/</span>' +
          '<span class="build-hero-points-limit" data-build-hero="points-limit">2000</span>' +
          '<span class="build-hero-points-label">PTS</span>' +
        '</div>' +
        '<div class="build-hero-bar-wrap">' +
          '<div class="build-hero-bar" data-build-hero="bar"></div>' +
          '<div class="build-hero-bar-shimmer" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="build-hero-bar-pct" data-build-hero="pct">0%</div>' +
      '</div>';
    // For the topbar slot we just append (the slot is already positioned).
    // For the legacy build-mode/app-main host, insert at the top so the
    // hero sits above the panels.
    if (host.id === 'topbar-hero-slot') {
      host.appendChild(hero);
    } else if (host.firstChild) {
      host.insertBefore(hero, host.firstChild);
    } else {
      host.appendChild(hero);
    }

    ui.hero            = hero;
    ui.crestWrap       = hero.querySelector('[data-build-hero-crest="1"]');
    ui.factionEl       = hero.querySelector('[data-build-hero="faction"]');
    ui.armyNameInput   = hero.querySelector('[data-build-hero="name"]');
    ui.detachmentEl    = hero.querySelector('[data-build-hero="detachment"]');
    ui.pointsCurrentEl = hero.querySelector('[data-build-hero="points-current"]');
    ui.pointsLimitEl   = hero.querySelector('[data-build-hero="points-limit"]');
    ui.pointsBarEl     = hero.querySelector('[data-build-hero="bar"]');
    ui.pointsPctEl     = hero.querySelector('[data-build-hero="pct"]');
    ui.statusEl        = hero.querySelector('[data-build-hero="status"]');

    wireHeroProxies();
    return hero;
  }

  // The hero-name input proxies edits down to the legacy #army-name-input
  // (which events.js reads on Save). Two-way sync so external mutations
  // (load saved army, undo) reflect upward.
  function wireHeroProxies() {
    const legacyName  = $('army-name-input');
    if (!legacyName || !ui.armyNameInput) return;
    ui.armyNameInput.value = legacyName.value || '';
    ui.armyNameInput.addEventListener('input', function () {
      legacyName.value = ui.armyNameInput.value;
      // Trigger an input event on the legacy input so any direct listener picks it up.
      try { legacyName.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { legacyName.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    });
    ui.armyNameInput.addEventListener('change', function () {
      try { legacyName.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    });

    // Click-to-edit on the points limit. The legacy #points-limit-input is
    // hidden (build-mode-enhanced hides .army-meta), so the hero must own the
    // affordance.
    if (ui.pointsLimitEl) {
      ui.pointsLimitEl.classList.add('is-editable');
      ui.pointsLimitEl.title = 'Click to edit points limit';
      ui.pointsLimitEl.setAttribute('role', 'button');
      ui.pointsLimitEl.setAttribute('tabindex', '0');
      const beginEdit = function () {
        if (ui.pointsLimitEl.dataset.editing === '1') return;
        ui.pointsLimitEl.dataset.editing = '1';
        const current = parseInt(ui.pointsLimitEl.textContent, 10) || 0;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '50';
        input.value = current;
        input.className = 'build-hero-points-limit-input';
        input.setAttribute('aria-label', 'Points limit');
        ui.pointsLimitEl.replaceWith(input);
        input.focus();
        input.select();
        const commit = function () {
          const next = Math.max(0, parseInt(input.value, 10) || 0);
          // Push to legacy input so the existing change listener in events.js
          // updates army.pointsLimit and re-renders the army list.
          const legacyLimit = $('points-limit-input');
          if (legacyLimit) {
            legacyLimit.value = next;
            try { legacyLimit.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
            try { legacyLimit.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
          } else {
            // Fallback: write directly + re-render.
            const army = App.state && App.state.currentArmy;
            if (army) {
              army.pointsLimit = next;
              if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(army);
            }
          }
          // Restore the span. syncHero() will fill its text from the army on next render.
          const span = document.createElement('span');
          span.className = 'build-hero-points-limit is-editable';
          span.setAttribute('data-build-hero', 'points-limit');
          span.setAttribute('role', 'button');
          span.setAttribute('tabindex', '0');
          span.title = 'Click to edit points limit';
          span.textContent = next;
          input.replaceWith(span);
          ui.pointsLimitEl = span;
          span.addEventListener('click', beginEdit);
          span.addEventListener('keydown', onKey);
          delete span.dataset.editing;
          syncHero();
        };
        input.addEventListener('blur', commit, { once: true });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          else if (e.key === 'Escape') {
            input.value = current; // restore so commit writes the original
            input.blur();
          }
        });
      };
      const onKey = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginEdit(); }
      };
      ui.pointsLimitEl.addEventListener('click', beginEdit);
      ui.pointsLimitEl.addEventListener('keydown', onKey);
    }
  }

  function syncHero() {
    if (!ui.hero) return;
    const state = App.state || {};
    const army  = state.currentArmy || null;

    // Faction display: prefer detachmentFaction, else factionFilter.
    let factionLabel = '';
    if (state.detachmentFaction && state.detachmentFaction.name) {
      factionLabel = state.detachmentFaction.name;
    } else if (state.factionFilter && state.factionFilter !== 'all') {
      factionLabel = state.factionFilter;
    }
    if (factionLabel && factionLabel.indexOf(' - ') !== -1) {
      factionLabel = factionLabel.split(' - ').pop().trim();
    }
    if (ui.factionEl) {
      if (factionLabel) {
        ui.factionEl.textContent = factionLabel;
        ui.factionEl.classList.remove('is-empty');
      } else {
        ui.factionEl.textContent = 'Select a faction';
        ui.factionEl.classList.add('is-empty');
      }
    }

    // Detachment label.
    if (ui.detachmentEl) {
      const det = state.selectedDetachment;
      if (det && det.name) {
        ui.detachmentEl.textContent = det.name;
        ui.detachmentEl.classList.remove('is-empty');
      } else {
        ui.detachmentEl.textContent = 'No detachment';
        ui.detachmentEl.classList.add('is-empty');
      }
    }

    // Army name. Don't clobber while user is typing in the hero input.
    if (ui.armyNameInput && army && document.activeElement !== ui.armyNameInput) {
      ui.armyNameInput.value = army.name || '';
    }

    // Points: prefer authoritative army totals. Reading the legacy spans is
    // unreliable because UI.renderArmyList fires armyChange BEFORE updating
    // those spans, so we'd lag one render behind.
    let total = 0, limit = 0;
    if (army && typeof army.getTotalPoints === 'function') total = army.getTotalPoints();
    if (army) limit = army.pointsLimit || 0;
    if (!army) {
      const legacyCurrent = $('points-current');
      const legacyLimit   = $('points-limit-display');
      if (legacyCurrent) total = parseInt(legacyCurrent.textContent, 10) || 0;
      if (legacyLimit)   limit = parseInt(legacyLimit.textContent, 10) || 0;
    }

    const pct = limit > 0 ? Math.min((total / limit) * 100, 100) : (total > 0 ? 100 : 0);

    if (ui.pointsCurrentEl) ui.pointsCurrentEl.textContent = total;
    if (ui.pointsLimitEl)   ui.pointsLimitEl.textContent   = limit;
    if (ui.pointsPctEl)     ui.pointsPctEl.textContent     = Math.round(pct) + '%';
    if (ui.pointsBarEl) {
      ui.pointsBarEl.style.width = pct + '%';
      ui.pointsBarEl.classList.toggle('over-limit',  total > limit && limit > 0);
      ui.pointsBarEl.classList.toggle('near-limit', !(total > limit && limit > 0) && pct >= 90);
    }
    if (ui.hero) {
      ui.hero.classList.toggle('has-faction', !!factionLabel);
      ui.hero.classList.toggle('points-over', total > limit && limit > 0);
    }
  }

  function syncHeroStatus() {
    if (!ui.statusEl) return;
    // Apply classes on the wrapping `.build-hero-status` so the dot styling
    // (which reads .is-saved / .is-unsaved on the wrapper) updates too.
    const wrap = ui.statusEl.closest('.build-hero-status') || ui.statusEl;
    wrap.classList.remove('is-saved', 'is-unsaved', 'is-ready');
    if (ui.dirty) {
      wrap.classList.add('is-unsaved');
      ui.statusEl.textContent = 'Unsaved';
    } else if (ui.savedAt) {
      wrap.classList.add('is-saved');
      ui.statusEl.textContent = 'Saved ' + fmtAgo(ui.savedAt);
    } else {
      wrap.classList.add('is-ready');
      ui.statusEl.textContent = 'Ready';
    }
  }

  // ── Rules placement ────────────────────────────────────────────────────
  // Earlier versions moved #army-rules-section into a right-panel "Rules" tab,
  // which buried it under the unit-detail content. The rules now stay where
  // the static markup puts them — left panel, between selection controls and
  // the entry list — so they're always visible without tab switching. The
  // section's own `hidden` attribute (toggled by faction-rules.js) collapses
  // it to nothing when no faction/detachment is set.
  function setupTabs() { /* no-op — rules stay in left panel */ }
  function syncRulesEmptyState() { /* no-op */ }
  function wrapDetailRenderers() { /* no-op */ }

  // ── Saved-status tracking ──────────────────────────────────────────────
  // Mirror save-pulse.js: signature-check so "render" callbacks that don't
  // actually mutate the army don't flip the indicator to "Unsaved".
  function entriesSig(army) {
    if (!army || !army.entries) return '|';
    const parts = [];
    army.entries.forEach(function (e) {
      const enh = (e.enhancements || []).map(x => (x && x.name) || '').sort().join(',');
      parts.push((e.unitId || e.unitName || '') + ':' + (e.count || 0) + ':' + enh + ':' + (e.selectedPts || ''));
    });
    parts.sort();
    return (army.name || '') + '#' + (army.pointsLimit || 0) + '#' + parts.join('|');
  }
  let lastSig = null;

  function watchSavedStatus() {
    lastSig = entriesSig(App.state && App.state.currentArmy);
    App.hooks.armyChange.push(function (army, kind) {
      const sig = entriesSig(army);
      if (kind === 'load') {
        const ts = army && army.updatedAt ? new Date(army.updatedAt).getTime() : null;
        ui.savedAt = ts && !isNaN(ts) ? ts : null;
        ui.dirty   = false;
        lastSig    = sig;
      } else if (kind === 'save') {
        ui.savedAt = Date.now();
        ui.dirty   = false;
        lastSig    = sig;
      } else if (sig !== lastSig) {
        ui.dirty = true;
        lastSig  = sig;
      }
      syncHeroStatus();
    });
    const saveBtn = $('btn-save-army');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        ui.savedAt = Date.now();
        ui.dirty   = false;
        syncHeroStatus();
      });
    }
    // Re-tick the "Saved Nm ago" text every 30s.
    setInterval(syncHeroStatus, 30 * 1000);
  }

  // ── Bootstrap wiring ───────────────────────────────────────────────────
  App.hooks.bootstrap.push(function (state) {
    // Add a marker class on <body> so build-mode.css can scope cleanly.
    document.body.classList.add('build-mode-enhanced');

    buildHero();
    setupTabs();
    wrapDetailRenderers();
    watchSavedStatus();
    syncHero();
    syncHeroStatus();
    syncRulesEmptyState();

    // Persist optional active-tab flag on App.state (read on subsequent
    // renders by other modules if needed).
    if (App.state && typeof App.state.activeBuildTab !== 'string') {
      App.state.activeBuildTab = 'detail';
    }
  });

  App.hooks.armyChange.push(function () {
    syncHero();
  });

  App.hooks.selectionChange.push(function () {
    syncHero();
    syncRulesEmptyState();
    // If the user changed faction/detachment AND the rules tab is open,
    // keep the rules tab visible (don't auto-switch). If currently on detail
    // tab and a rule list just appeared, stay on detail — user must click.
  });
})();
