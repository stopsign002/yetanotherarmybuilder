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
    const host = buildContainer();
    if (!host) return null;
    const hero = document.createElement('header');
    hero.className = 'build-hero';
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
    // Insert as the very first child of the build-mode container (or app-main).
    if (host.firstChild) host.insertBefore(hero, host.firstChild);
    else host.appendChild(hero);

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

    // Points: read from already-rendered legacy spans so we don't duplicate
    // computation logic. Falls back to army totals if the legacy DOM hasn't
    // been rendered yet.
    let total = 0, limit = 0;
    const legacyCurrent = $('points-current');
    const legacyLimit   = $('points-limit-display');
    if (legacyCurrent) total = parseInt(legacyCurrent.textContent, 10) || 0;
    else if (army && typeof army.getTotalPoints === 'function') total = army.getTotalPoints();
    if (legacyLimit) limit = parseInt(legacyLimit.textContent, 10) || 0;
    else if (army) limit = army.pointsLimit || 0;

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

  // ── Rules pinboard / tab switcher ──────────────────────────────────────
  function setupTabs() {
    const detailPanelBody = $('unit-detail-panel');
    if (!detailPanelBody) return;
    const detailPanelHost = detailPanelBody.parentElement; // .panel-right
    if (!detailPanelHost) return;

    // Build the tab strip and the rules tab body. The rules tab body is a
    // sibling element that shares the panel; we toggle visibility, not
    // remove from DOM, so the events.js delegated handler on
    // #army-rules-section keeps firing.
    if (detailPanelHost.querySelector('.build-detail-tabs')) return;

    const tabStrip = document.createElement('div');
    tabStrip.className = 'build-detail-tabs';
    tabStrip.setAttribute('role', 'tablist');
    tabStrip.innerHTML =
      '<button type="button" class="build-detail-tab is-active" data-build-tab="detail" role="tab" aria-selected="true">Unit Detail</button>' +
      '<button type="button" class="build-detail-tab" data-build-tab="rules" role="tab" aria-selected="false">Rules</button>';

    // Insert tab strip BEFORE the panel-body (#unit-detail-panel).
    detailPanelHost.insertBefore(tabStrip, detailPanelBody);

    // Build the rules pinboard container, inserted AFTER #unit-detail-panel
    // so they share scroll context within the right-panel host.
    const rulesPanel = document.createElement('div');
    rulesPanel.className = 'panel-body build-rules-panel';
    rulesPanel.id = 'build-rules-panel';
    rulesPanel.setAttribute('role', 'tabpanel');
    rulesPanel.hidden = true;
    rulesPanel.innerHTML =
      '<div class="build-rules-header">Army Rules</div>' +
      '<div class="build-rules-mount" id="build-rules-mount"></div>' +
      '<div class="build-rules-stratagems-card" id="build-rules-stratagems">' +
        '<div class="build-rules-stratagems-title">Stratagems</div>' +
        '<div class="build-rules-stratagems-desc">Browse detachment, faction, and core stratagems for game day.</div>' +
        '<button type="button" class="btn btn-sm btn-outline build-rules-stratagems-btn" id="build-rules-stratagems-btn">Open Stratagems</button>' +
      '</div>' +
      '<div class="build-rules-empty" id="build-rules-empty">Select a faction and detachment to see Army Rules, the Detachment Rule, and Enhancements here.</div>';
    detailPanelHost.insertBefore(rulesPanel, detailPanelBody.nextSibling);

    // MOVE the existing army-rules-section node (and its children) into the
    // mount. The events.js delegate listens on #army-rules-section so moving
    // (not duplicating) preserves the click handler.
    const rulesSection = $('army-rules-section');
    const rulesMount   = $('build-rules-mount');
    if (rulesSection && rulesMount) {
      // Force-show: even if section was hidden originally, the empty-state
      // message inside the rules tab handles the empty case.
      rulesMount.appendChild(rulesSection);
    }

    // Wire stratagems button.
    const stratBtn = $('build-rules-stratagems-btn');
    if (stratBtn) {
      stratBtn.addEventListener('click', function () {
        if (typeof App.openStratagems === 'function') App.openStratagems();
        else if (window.UI && typeof UI.toast === 'function') UI.toast('Stratagems are unavailable', 'info');
      });
    }

    // Wire tab buttons.
    ui.rulesTabBtn  = tabStrip.querySelector('[data-build-tab="rules"]');
    ui.detailTabBtn = tabStrip.querySelector('[data-build-tab="detail"]');
    ui.rulesPanel   = rulesPanel;
    ui.panelBody    = detailPanelBody;

    tabStrip.addEventListener('click', function (e) {
      const btn = e.target.closest('.build-detail-tab');
      if (!btn) return;
      const next = btn.dataset.buildTab;
      if (next) setActiveTab(next);
    });
  }

  function setActiveTab(name) {
    if (name !== 'detail' && name !== 'rules') name = 'detail';
    ui.activeTab = name;
    if (ui.detailTabBtn) {
      const isDetail = name === 'detail';
      ui.detailTabBtn.classList.toggle('is-active', isDetail);
      ui.detailTabBtn.setAttribute('aria-selected', isDetail ? 'true' : 'false');
    }
    if (ui.rulesTabBtn) {
      const isRules = name === 'rules';
      ui.rulesTabBtn.classList.toggle('is-active', isRules);
      ui.rulesTabBtn.setAttribute('aria-selected', isRules ? 'true' : 'false');
    }
    if (ui.panelBody) ui.panelBody.hidden = name === 'rules';
    if (ui.rulesPanel) ui.rulesPanel.hidden = name !== 'rules';
    syncRulesEmptyState();
    // Persist intended tab on App.state if the optional flag is wired.
    if (App.state) App.state.activeBuildTab = name;
  }

  function syncRulesEmptyState() {
    const empty = $('build-rules-empty');
    const section = $('army-rules-section');
    if (!empty || !section) return;
    // The faction-rules.js renderer toggles the `hidden` attribute on the
    // section when there's nothing to show. Use that as the empty signal.
    const hasContent = !section.hasAttribute('hidden');
    empty.hidden = hasContent;
  }

  // Auto-switch to a tab when a rule or unit is rendered. We hook the
  // existing UI.renderRuleDetail and UI.renderUnitDetail by wrapping them
  // (defensively — checks they exist on bootstrap, not at IIFE time, since
  // index.js may load this orchestrator before UI module load order).
  function wrapDetailRenderers() {
    if (!window.UI) return;
    if (typeof UI.renderUnitDetail === 'function' && !UI.renderUnitDetail._buildModeWrapped) {
      const orig = UI.renderUnitDetail;
      UI.renderUnitDetail = function () {
        const r = orig.apply(this, arguments);
        setActiveTab('detail');
        return r;
      };
      UI.renderUnitDetail._buildModeWrapped = true;
    }
    if (typeof UI.renderRuleDetail === 'function' && !UI.renderRuleDetail._buildModeWrapped) {
      const orig = UI.renderRuleDetail;
      UI.renderRuleDetail = function () {
        const r = orig.apply(this, arguments);
        setActiveTab('detail'); // rule detail renders in the detail panel body
        return r;
      };
      UI.renderRuleDetail._buildModeWrapped = true;
    }
  }

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
