// app/lazy-modules.js — defer feature modules until first user trigger; placeholder toolbar actions keep menus populated at boot.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // ── Module registry ─────────────────────────────────────────────────────
  // Each entry:
  //   id:              stable module key
  //   srcs:            ordered list of script URLs to inject (data deps first)
  //   placeholders:    optional toolbar/detail action stubs registered eagerly
  //   triggers:        optional list of selector-based delegated triggers
  //                    { selector, event } — first match loads the module then
  //                    re-fires the original event so the real handler runs.
  //   onLoad:          optional fn(loadedAction) called after the module's
  //                    real handler is found, used to invoke the user's intent.
  const MODULES = [
    {
      id: 'match-mode',
      srcs: ['js/app/match-mode.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-match',
        region: 'primary',
        label: 'Match',
        category: 'game',
        title: 'Start a game-day match tracker',
      }],
    },
    {
      id: 'damage-calc',
      srcs: ['js/ui/damage-calc.js'],
      placeholders: [
        {
          kind: 'toolbar',
          id: 'yaab-btn-dmgcalc',
          region: 'primary',
          label: 'Calc',
          category: 'analysis',
          title: 'Damage calculator',
        },
        {
          kind: 'detail',
          id: 'sim-attack',
          title: 'Simulate attack with this unit',
          html: '<span style="font-weight:700">&Sigma;</span>',
        },
      ],
    },
    {
      id: 'tournament-export',
      srcs: ['js/ui/tournament-export.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-tournament',
        region: 'primary',
        label: 'Tournament',
        category: 'analysis',
        title: 'Generate tournament prep PDF',
      }],
    },
    {
      id: 'crusade',
      srcs: ['js/app/crusade.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-crusade',
        region: 'primary',
        label: 'Crusade',
        category: 'game',
        title: 'Crusade campaign tracker',
      }],
    },
    {
      id: 'kill-team',
      srcs: ['js/app/kill-team.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-kill-team',
        region: 'primary',
        label: 'Kill Team',
        category: 'game',
        title: 'Toggle small-format game mode',
      }],
    },
    {
      id: 'deployment-planner',
      srcs: ['js/ui/deployment-planner.js'],
      placeholders: [{
        kind: 'toolbar',
        // Deployment planner registers without an id; key by label so we can
        // match the real action when it loads.
        id: 'yaab-btn-deploy',
        matchByLabel: 'Deploy',
        region: 'primary',
        label: 'Deploy',
        category: 'game',
        title: 'Deployment planner — drag units onto a battlefield',
      }],
    },
    {
      id: 'synergy',
      srcs: ['js/ui/synergy.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-synergy',
        region: 'icon',
        label: '⟡',
        ariaLabel: 'Synergy detector',
        title: 'Detected synergies in your army',
      }],
    },
    {
      id: 'lore',
      srcs: ['js/data/lore-data.js', 'js/app/lore.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-faction-lore',
        region: 'icon',
        label: 'i',
        ariaLabel: 'Faction lore',
        title: 'Faction lore',
      }],
      triggers: [{ selector: '.detail-faction', event: 'click' }],
      onLoad: function () {
        // After load, invoke openFactionLore directly with the user's last click.
        const name = pendingLoreFaction;
        pendingLoreFaction = null;
        if (typeof App.openFactionLore === 'function' && name) {
          try { App.openFactionLore(name); } catch (_) {}
        }
      },
    },
    {
      id: 'analytics',
      srcs: ['js/ui/analytics.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-analytics',
        region: 'primary',
        label: 'Analytics',
        category: 'analysis',
        title: 'Army analytics dashboard',
      }],
    },
    {
      id: 'opponent',
      srcs: ['js/app/opponent.js', 'js/ui/matchup.js'],
      placeholders: [
        {
          kind: 'toolbar',
          id: 'yaab-btn-opponent',
          region: 'primary',
          label: 'Opponent',
          category: 'game',
          title: "Paste your opponent's army to compare",
        },
        {
          kind: 'toolbar',
          id: 'yaab-btn-matchup',
          region: 'primary',
          label: 'Matchup',
          category: 'analysis',
          title: 'View side-by-side matchup',
        },
      ],
    },
    {
      id: 'army-diff',
      srcs: ['js/app/army-diff.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-history',
        region: 'primary',
        label: 'History',
        category: 'data',
        title: 'View army version history',
      }],
    },
    {
      id: 'community-feed',
      srcs: ['js/app/community-feed.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-community-feed',
        region: 'primary',
        label: 'Community',
        category: 'data',
        title: 'Browse community army lists',
      }],
    },
    {
      id: 'activity-log',
      srcs: ['js/app/activity-log.js'],
      placeholders: [{
        kind: 'toolbar',
        id: 'yaab-btn-activity-log',
        region: 'primary',
        label: 'Activity',
        category: 'data',
        title: 'View session activity log',
      }],
    },
  ];

  // ── State ───────────────────────────────────────────────────────────────
  const loaded   = Object.create(null); // id -> true when fully loaded
  const loading  = Object.create(null); // id -> Promise while loading
  let pendingLoreFaction = null;        // captured from .detail-faction click

  // ── Loader ──────────────────────────────────────────────────────────────
  function injectScript(src) {
    return new Promise((resolve, reject) => {
      // Skip if already in the DOM (defensive — shouldn't happen in normal flow)
      const existing = document.querySelector('script[data-lazy-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.lazyLoaded === '1') return resolve();
        existing.addEventListener('load',  () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('lazy load failed: ' + src)), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // preserve script order within this load batch
      s.dataset.lazySrc = src;
      s.addEventListener('load', () => {
        s.dataset.lazyLoaded = '1';
        resolve();
      }, { once: true });
      s.addEventListener('error', () => reject(new Error('lazy load failed: ' + src)), { once: true });
      document.head.appendChild(s);
    });
  }

  // ctx may include { firePlaceholder: 'toolbar:<id>' | 'detail:<id>' }
  // so the real action's onClick fires for the user's original click.
  function loadModule(mod, ctx) {
    if (loaded[mod.id]) {
      // Already loaded — fire the real action immediately.
      if (ctx) firePlaceholderAction(mod, ctx);
      return Promise.resolve();
    }
    if (loading[mod.id]) {
      // In-flight — chain on it so the real action fires once.
      return loading[mod.id].then(() => { if (ctx) firePlaceholderAction(mod, ctx); });
    }

    // Show a "Loading…" toast only if injection takes long enough to notice.
    const toastTimer = setTimeout(() => {
      if (window.UI && typeof UI.toast === 'function') {
        try { UI.toast('Loading ' + mod.id.replace(/-/g, ' ') + '…', 'info', 1500); } catch (_) {}
      }
    }, 120);

    // Snapshot hook arrays so we can fire newly-pushed bootstrap callbacks
    // after the module's IIFE finishes.
    const hooks = App.hooks;
    const snap = {
      bootstrap:        hooks.bootstrap.length,
      armyToolbarActions: hooks.armyToolbarActions.length,
      detailActions:    hooks.detailActions.length,
    };

    const p = mod.srcs.reduce(
      (acc, src) => acc.then(() => injectScript(src)),
      Promise.resolve()
    ).then(() => {
      clearTimeout(toastTimer);
      loaded[mod.id] = true;
      delete loading[mod.id];

      // Rewire placeholders to point at the real actions just pushed.
      rewirePlaceholders(mod, snap);

      // Fire any bootstrap hooks the module just registered.
      const newBoots = hooks.bootstrap.slice(snap.bootstrap);
      newBoots.forEach(fn => {
        try { fn(App.state); } catch (e) { console.warn('[lazy-modules.bootstrap]', e); }
      });

      // Fire the action for the click that triggered the load.
      if (ctx) firePlaceholderAction(mod, ctx, snap);

      // Allow custom post-load logic (e.g. delegated trigger replay).
      if (typeof mod.onLoad === 'function') {
        try { mod.onLoad(); } catch (e) { console.warn('[lazy-modules.onLoad]', e); }
      }
    }).catch((err) => {
      clearTimeout(toastTimer);
      delete loading[mod.id];
      console.warn('[lazy-modules]', mod.id, err);
      if (window.UI && typeof UI.toast === 'function') {
        try { UI.toast('Failed to load ' + mod.id, 'error', 3000); } catch (_) {}
      }
      throw err;
    });

    loading[mod.id] = p;
    return p;
  }

  // ── Re-fire user's intent after lazy-load ───────────────────────────────
  // ctx = { kind: 'toolbar' | 'detail', id: '...', unit?: ... }
  // After load + rewire, the real action is in the hook array — call its
  // onClick to honour the click that started the load. We pass `snap` from
  // the load-time scope when possible; for the 'already loaded' fast path
  // we just scan the array fully (no placeholders left there by then).
  function firePlaceholderAction(mod, ctx, snap) {
    if (!ctx) return;
    const hooks = App.hooks;
    const arr   = ctx.kind === 'detail' ? hooks.detailActions : hooks.armyToolbarActions;
    const ph    = (mod.placeholders || []).find(p => p.kind === ctx.kind && p.id === ctx.id);
    const fromIdx = snap ? (ctx.kind === 'detail' ? snap.detailActions : snap.armyToolbarActions) : 0;
    const real  = ph ? findRealAction(arr, fromIdx, ph) :
                       arr.find(a => a && !a._lazyPlaceholder && a.id === ctx.id);
    if (real && typeof real.onClick === 'function') {
      try {
        if (ctx.kind === 'detail') real.onClick(ctx.unit);
        else                       real.onClick();
      } catch (e) { console.warn('[lazy-modules.fire]', e); }
    }
  }

  // ── Placeholder rewiring ────────────────────────────────────────────────
  // After load, the real module's IIFE has pushed actions with matching ids
  // onto App.hooks.armyToolbarActions / App.hooks.detailActions. Splice each
  // placeholder out of the hook array, then re-mount the toolbar so the
  // Action Center / icon shelves show the real action's onClick. Live detail
  // buttons currently in the panel are rebuilt in place because the detail
  // panel is not re-rendered on every mount.
  function rewirePlaceholders(mod, snap) {
    if (!mod.placeholders) return;
    const hooks = App.hooks;
    let toolbarChanged = false;

    mod.placeholders.forEach(ph => {
      if (ph.kind === 'toolbar') {
        const phIdx = hooks.armyToolbarActions.findIndex(
          a => a && a._lazyPlaceholder === mod.id && a.id === ph.id
        );
        if (phIdx >= 0) {
          hooks.armyToolbarActions.splice(phIdx, 1);
          toolbarChanged = true;
        }
      } else if (ph.kind === 'detail') {
        const real = findRealAction(hooks.detailActions, snap.detailActions, ph);
        const phIdx = hooks.detailActions.findIndex(
          a => a && a._lazyPlaceholder === mod.id && a.id === ph.id
        );
        if (real) {
          // Live detail-action buttons currently in the panel were wired
          // to placeholder.onClick — rebind to real.onClick in place.
          const btns = document.querySelectorAll('.detail-action-btn[data-action-id="' + ph.id + '"]');
          btns.forEach(btn => {
            const fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);
            fresh.addEventListener('click', () => {
              const unit = App.state && App.state.selectedUnit;
              try { real.onClick(unit); } catch (e) { console.warn('[lazy-modules.detail]', e); }
            });
          });
          if (phIdx >= 0) hooks.detailActions.splice(phIdx, 1);
        }
      }
    });

    if (toolbarChanged && typeof App.mountArmyToolbarActions === 'function') {
      try { App.mountArmyToolbarActions(); }
      catch (e) { console.warn('[lazy-modules.mount]', e); }
    }
  }

  // Find the most-recently-pushed action with matching id (or label fallback)
  // among entries pushed AFTER the snapshot index.
  function findRealAction(arr, fromIdx, ph) {
    for (let i = arr.length - 1; i >= fromIdx; i--) {
      const a = arr[i];
      if (!a || a._lazyPlaceholder) continue;
      if (ph.id && a.id === ph.id) return a;
      if (ph.matchByLabel && a.label === ph.matchByLabel) return a;
    }
    return null;
  }

  // ── Placeholder registration (eager) ────────────────────────────────────
  // Push placeholder entries onto App.hooks.armyToolbarActions /
  // App.hooks.detailActions BEFORE App.mountArmyToolbarActions runs at
  // bootstrap, so the menus include the buttons even though the modules
  // haven't loaded yet.
  MODULES.forEach(mod => {
    // If a real (non-placeholder) action with one of this module's
    // placeholder ids is already registered, the module was eager-loaded
    // earlier in this page load. Skip placeholder registration entirely.
    const realLoaded = (mod.placeholders || []).some(ph => {
      const arr = (ph.kind === 'detail') ? App.hooks.detailActions : App.hooks.armyToolbarActions;
      return arr.some(a => a && !a._lazyPlaceholder && a.id === ph.id);
    });
    if (realLoaded) { loaded[mod.id] = true; return; }

    (mod.placeholders || []).forEach(ph => {
      if (ph.kind === 'toolbar') {
        App.hooks.armyToolbarActions.push({
          _lazyPlaceholder: mod.id,
          id:        ph.id,
          region:    ph.region,
          category:  ph.category,
          label:     ph.label,
          ariaLabel: ph.ariaLabel,
          title:     ph.title,
          onClick:   () => loadModule(mod, { kind: 'toolbar', id: ph.id }),
        });
      } else if (ph.kind === 'detail') {
        App.hooks.detailActions.push({
          _lazyPlaceholder: mod.id,
          id:    ph.id,
          title: ph.title,
          html:  ph.html,
          label: ph.label,
          onClick: (unit) => loadModule(mod, { kind: 'detail', id: ph.id, unit }),
        });
      }
    });
  });

  // ── Selector-based triggers (delegated) ─────────────────────────────────
  // For modules that aren't reachable by a toolbar button, install a
  // capture-phase delegated listener. First match loads the module and
  // dispatches a replay click for the now-live handler (or calls onLoad).
  MODULES.forEach(mod => {
    (mod.triggers || []).forEach(trig => {
      document.addEventListener(trig.event, function (e) {
        if (loaded[mod.id]) return; // real handler is in charge now
        const target = e.target && e.target.closest && e.target.closest(trig.selector);
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        // Capture user intent for onLoad to act on.
        if (mod.id === 'lore') {
          pendingLoreFaction = (target.textContent || '').trim();
        }
        loadModule(mod);
      }, true); // capture: run before any later-installed real handler
    });
  });

  // ── Public surface ──────────────────────────────────────────────────────
  App.lazyModules = {
    load: function (id) {
      const mod = MODULES.find(m => m.id === id);
      return mod ? loadModule(mod) : Promise.reject(new Error('unknown module: ' + id));
    },
    isLoaded: function (id) { return !!loaded[id]; },
    list:     function ()   { return MODULES.map(m => m.id); },
  };
})();
