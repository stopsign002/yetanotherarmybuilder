// app/index.js — DOMContentLoaded bootstrap: init UI, restore army, kick off load.
(function () {
  const App = window.App;

  document.addEventListener('DOMContentLoaded', () => {
    const state = App.state;
    UI.init(state);

    state.armyManager = new ArmyManager();

    if (state.armyManager.armies.length > 0) {
      const sorted = [...state.armyManager.armies].sort((a, b) =>
        new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
      );
      state.currentArmy = sorted[0];
      state.armyManager.currentArmy = state.currentArmy;
    } else {
      state.currentArmy = state.armyManager.newArmy();
    }

    App.applyFactionColor(null);
    App.renderAll();
    App.setupResizablePanels();
    App.wireEvents();
    App.mountArmyToolbarActions();
    App.fireBootstrap(state);
    App.autoLoadFromBSData();
  });

  // ── Toolbar routing config ────────────────────────────────────────────
  // The new surfaces are:
  //   1. Top app bar icon shelf  (#topbar-icons)             — region:'icon'
  //   2. Bottom-toolbar undo/redo (#toolbar-undo-redo)        — undo/redo only
  //   3. Static Export ▾ dropdown (#export-extras)            — region:'export-menu'
  //   4. Action Center sheet      (UI.actionCenter sections)  — everything else
  //
  // The old #toolbar-extras / #toolbar-icons / #tools-menu / #more-menu
  // containers still exist (hidden, in .toolbar-compat-shelf) so any
  // module that does `document.getElementById('tools-menu')` after we
  // mount won't crash.

  // Icons that live inline in the bottom toolbar (undo/redo only).
  const BOTTOM_INLINE_ICON_IDS = new Set(['yaab-btn-undo', 'yaab-btn-redo']);

  // Map known toolbar action IDs to Action Center sections.
  // Sections: 'game-day' | 'analyze' | 'export' | 'browse' | 'collection' | 'settings'
  const ID_TO_SECTION = {
    // Game Day
    'yaab-btn-match':            'game-day',
    'yaab-btn-dmgcalc':          'game-day',
    'yaab-btn-opponent':         'game-day',
    'yaab-btn-matchup':          'game-day',
    'yaab-btn-stratagems':       'game-day',
    'yaab-btn-deploy':           'game-day',
    // Analyze
    'yaab-btn-analytics':        'analyze',
    'yaab-btn-synergy':          'analyze',
    'yaab-btn-history':          'analyze',
    // Print & Export
    'yaab-btn-tournament':       'export',
    'yaab-btn-share':            'export',
    'yaab-btn-qr-share':         'export',
    // Browse
    'yaab-btn-lore':             'browse',
    'yaab-btn-starter-lists':    'browse',
    'yaab-btn-community-feed':   'browse',
    'yaab-btn-replay-tour':      'browse',
    // Collection
    'yaab-btn-collection':       'collection',
    'yaab-btn-crusade':          'collection',
    'yaab-btn-kill-team':        'collection',
    'yaab-btn-activity-log':     'collection',
    // Settings
    'yaab-btn-points-override':  'settings',
    'yaab-btn-legends':          'settings',
    'yaab-btn-bug-report':       'settings',
    'yaab-btn-pwa-install':      'settings',
    'yaab-btn-ork-math':         'settings',
  };

  // Some hook entries don't set an id (e.g. deployment planner). Match
  // by label as a fallback so they still route correctly.
  const LABEL_TO_SECTION = {
    'deploy':           'game-day',
    'deployment':       'game-day',
    'stratagems':       'game-day',
    'tournament':       'export',
    'replay tour':      'browse',
    'starter lists':    'browse',
  };

  // Short, intent-driven descriptions for known actions. Falls back to
  // the action's `title` (then label) when the id is unknown.
  const ID_TO_DESC = {
    'yaab-btn-match':            'Track turns, command points, and damage live during a game.',
    'yaab-btn-dmgcalc':          'Simulate attacks and roll for damage.',
    'yaab-btn-opponent':         'Paste your opponent’s list to compare.',
    'yaab-btn-matchup':          'Side-by-side matchup against the loaded opponent.',
    'yaab-btn-stratagems':       'Browse stratagems for your detachment.',
    'yaab-btn-deploy':           'Drag your units onto a battlefield.',
    'yaab-btn-analytics':        'Charts: roles, points, keywords, breakdowns.',
    'yaab-btn-synergy':          'Detect interactions between units in your list.',
    'yaab-btn-history':          'Browse and diff past versions of this army.',
    'yaab-btn-tournament':       'Generate a tournament prep PDF bundle.',
    'yaab-btn-share':            'Copy a shareable URL for this army.',
    'yaab-btn-qr-share':         'Show a QR code so a teammate can grab the list.',
    'yaab-btn-lore':             'Browse faction lore and background.',
    'yaab-btn-starter-lists':    'Curated starter armies and a randomizer.',
    'yaab-btn-community-feed':   'Browse community army lists.',
    'yaab-btn-replay-tour':      'Restart the first-time walkthrough.',
    'yaab-btn-collection':       'Track owned models and painting progress.',
    'yaab-btn-crusade':          'Crusade campaign tracker.',
    'yaab-btn-kill-team':        'Switch to small-format Kill Team mode.',
    'yaab-btn-activity-log':     'View a log of recent edits.',
    'yaab-btn-points-override':  'Override unit points for dataslates.',
    'yaab-btn-legends':          'Show or hide Legends-only units.',
    'yaab-btn-bug-report':       'Report an issue or attach diagnostic data.',
    'yaab-btn-pwa-install':      'Install the app to your home screen.',
    'yaab-btn-ork-math':         'Toggle Ork numerals (TEEF mode).',
  };

  function resolveSection(a) {
    if (a.section) return a.section;
    if (a.id && ID_TO_SECTION[a.id]) return ID_TO_SECTION[a.id];
    if (a.category) {
      // Legacy category → section mapping.
      switch (a.category) {
        case 'game':     return 'game-day';
        case 'analysis': return 'analyze';
        case 'export':   return 'export';
        case 'data':     return 'collection';
        default:         return 'settings';
      }
    }
    const lbl = String(a.label || '').toLowerCase();
    for (const k in LABEL_TO_SECTION) {
      if (lbl.indexOf(k) !== -1) return LABEL_TO_SECTION[k];
    }
    return 'settings';
  }

  // Build the inline icon button for the top bar / undo-redo shelf.
  function buildIconButton(a) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = a.className || 'topbar-icon-btn';
    btn.textContent = a.label || '';
    if (a.title)     btn.title = a.title;
    if (a.ariaLabel) btn.setAttribute('aria-label', a.ariaLabel);
    if (a.id)        btn.id = a.id;
    if (typeof a.onClick === 'function') btn.addEventListener('click', a.onClick);
    return btn;
  }

  function buildExportMenuButton(a) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = a.className || '';
    b.textContent = a.label || '';
    if (a.title)     b.title = a.title;
    if (a.ariaLabel) b.setAttribute('aria-label', a.ariaLabel);
    if (a.id)        b.id = a.id;
    if (typeof a.onClick === 'function') b.addEventListener('click', a.onClick);
    return b;
  }

  function adaptForActionCenter(a) {
    return {
      id:          a.id,
      label:       a.label,
      title:       a.title,
      ariaLabel:   a.ariaLabel,
      description: a.description || ID_TO_DESC[a.id] || a.title || '',
      onClick:     a.onClick,
    };
  }

  // Renders hook-registered buttons into the new surfaces.
  // Action shape (unchanged for compatibility):
  //   { region:   'primary' | 'icon' | 'export-menu' | 'tools-menu' | 'more-menu',
  //     section?: 'game-day' | 'analyze' | 'export' | 'browse' | 'collection' | 'settings',
  //     id, label, title, ariaLabel, onClick, className, category? }
  App.mountArmyToolbarActions = function () {
    const actions   = (App.hooks && App.hooks.armyToolbarActions) || [];
    const topIcons  = document.getElementById('topbar-icons');
    const undoRedo  = document.getElementById('toolbar-undo-redo');
    const exportTgt = document.getElementById('export-extras');

    // Reset all targets on each mount so re-mounting (e.g. after lazy
    // module load) doesn't duplicate buttons.
    if (window.UI && UI.actionCenter) UI.actionCenter.clearActions();
    if (topIcons)  topIcons.replaceChildren();
    if (undoRedo)  undoRedo.replaceChildren();
    if (exportTgt) exportTgt.replaceChildren();

    actions.forEach(a => {
      const region = a.region || 'primary';

      // Export dropdown stays as a static menu in the bottom toolbar.
      if (region === 'export-menu') {
        if (exportTgt) exportTgt.appendChild(buildExportMenuButton(a));
        return;
      }

      // Icons: undo/redo dock in the bottom toolbar; the auth button keeps
      // its slot in the top-bar shelf; everything else (legends, install,
      // teef, sound, voice, …) is reachable from the Settings drawer instead
      // of cluttering the top bar. The hook onClicks are still invoked
      // directly via clickToolbarBtn's fallback in settings-drawer.js.
      if (region === 'icon') {
        if (BOTTOM_INLINE_ICON_IDS.has(a.id) && undoRedo) {
          undoRedo.appendChild(buildIconButton({ ...a, className: 'btn btn-sm btn-outline btn-icon' }));
        } else if (a.id === 'yaab-btn-auth' && topIcons) {
          topIcons.appendChild(buildIconButton(a));
        }
        return;
      }

      // 'more-menu' → previously top-bar shelf; now Action Center / Settings
      // cover discoverability for these without cluttering the top bar.
      if (region === 'more-menu') {
        return;
      }

      // 'tools-menu' and 'primary' both route to the Action Center now.
      if (window.UI && UI.actionCenter) {
        UI.actionCenter.registerAction(adaptForActionCenter(a), resolveSection(a));
      }
    });
  };
})();
