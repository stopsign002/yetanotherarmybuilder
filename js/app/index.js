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
  // Buttons in this allowlist stay in the always-visible primary row.
  // Everything else registered with region:'primary' is funneled into
  // the Tools ▾ dropdown. Action objects can override either way by
  // setting priority: 'visible' | 'menu'.
  const PRIMARY_VISIBLE_IDS = new Set([
    // (intentionally empty — Print, New, Save, Load, Import, Export are
    // hardcoded static buttons in index.html. All hook-registered
    // primary actions now route to the Tools menu by default. To
    // promote one back to the row, add its id here OR set
    // priority:'visible' on the action.)
  ]);

  // Icon shelf: small allowlist that stays visible inline. Anything else
  // registered with region:'icon' moves into the More ▾ menu.
  const ICON_VISIBLE_IDS = new Set([
    'yaab-btn-undo',
    'yaab-btn-redo',
    'yaab-btn-cmdp',
  ]);

  // Default category guess for known primary actions (used when an action
  // doesn't specify category:). Future modules should set category
  // explicitly. Falls back to 'other'.
  const DEFAULT_CATEGORY_BY_ID = {
    'yaab-btn-analytics':       'analysis',
    'yaab-btn-dmgcalc':         'analysis',
    'yaab-btn-matchup':         'analysis',
    'yaab-btn-tournament':      'analysis',
    'yaab-btn-match':           'game',
    'yaab-btn-opponent':        'game',
    'yaab-btn-history':         'data',
    'yaab-btn-collection':      'data',
    'yaab-btn-points-override': 'data',
    'yaab-btn-starter-lists':   'data',
  };

  const CATEGORY_LABEL = {
    analysis: 'Analysis',
    game:     'Game day',
    export:   'Export',
    data:     'Data & lists',
    other:    'Other',
  };
  const CATEGORY_ORDER = ['analysis', 'game', 'data', 'export', 'other'];

  // Build a styled menu item button for a hook action.
  function buildMenuButton(a) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.className = 'menu-item';
    btn.textContent = a.label || '';
    if (a.title)     btn.title = a.title;
    if (a.ariaLabel) btn.setAttribute('aria-label', a.ariaLabel);
    if (a.id)        btn.id = a.id;
    if (typeof a.onClick === 'function') btn.addEventListener('click', a.onClick);
    return btn;
  }

  // Build the inline button (primary row or icon shelf) for an action.
  function buildInlineButton(a, region) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = a.className || (
      region === 'icon' ? 'btn btn-sm btn-outline btn-icon' :
      'btn btn-sm btn-outline'
    );
    btn.textContent = a.label || '';
    if (a.title)     btn.title = a.title;
    if (a.ariaLabel) btn.setAttribute('aria-label', a.ariaLabel);
    if (a.id)        btn.id = a.id;
    if (typeof a.onClick === 'function') btn.addEventListener('click', a.onClick);
    return btn;
  }

  // Renders hook-registered buttons into named toolbar regions.
  // Action shape:
  //   { region:   'primary' | 'icon' | 'export-menu' | 'tools-menu' | 'more-menu',
  //     priority: 'visible' | 'menu',     // optional override for primary/icon routing
  //     category: 'analysis' | 'game' | 'export' | 'data' | 'other',
  //     id, label, title, ariaLabel, onClick, className }
  // Default region is 'primary'. Default routing: see allowlists above.
  App.mountArmyToolbarActions = function () {
    const actions = (App.hooks && App.hooks.armyToolbarActions) || [];
    const targets = {
      primary:       document.getElementById('toolbar-extras'),
      icon:          document.getElementById('toolbar-icons'),
      'export-menu': document.getElementById('export-extras'),
      'tools-menu':  document.getElementById('tools-menu'),
      'more-menu':   document.getElementById('more-menu'),
    };

    // Bucket actions per resolved region. We collect tools-menu items first
    // so we can group them by category at render time.
    const toolsBucket = []; // { action, category }
    const moreBucket  = []; // action

    actions.forEach(a => {
      const region = a.region || 'primary';

      if (region === 'export-menu') {
        if (targets['export-menu']) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'menuitem');
          b.className = a.className || '';
          b.textContent = a.label || '';
          if (a.title)     b.title = a.title;
          if (a.ariaLabel) b.setAttribute('aria-label', a.ariaLabel);
          if (a.id)        b.id = a.id;
          if (typeof a.onClick === 'function') b.addEventListener('click', a.onClick);
          targets['export-menu'].appendChild(b);
        }
        return;
      }

      if (region === 'tools-menu') {
        toolsBucket.push({ action: a, category: a.category || 'other' });
        return;
      }
      if (region === 'more-menu') {
        moreBucket.push(a);
        return;
      }

      if (region === 'primary') {
        const visible = a.priority === 'visible'
          || (a.priority !== 'menu' && PRIMARY_VISIBLE_IDS.has(a.id));
        if (visible && targets.primary) {
          targets.primary.appendChild(buildInlineButton(a, 'primary'));
        } else if (targets['tools-menu']) {
          toolsBucket.push({
            action: a,
            category: a.category || DEFAULT_CATEGORY_BY_ID[a.id] || 'other',
          });
        }
        return;
      }

      if (region === 'icon') {
        const visible = a.priority === 'visible'
          || (a.priority !== 'menu' && ICON_VISIBLE_IDS.has(a.id));
        if (visible && targets.icon) {
          targets.icon.appendChild(buildInlineButton(a, 'icon'));
        } else if (targets['more-menu']) {
          moreBucket.push(a);
        }
        return;
      }

      // Unknown region — fall through to primary container.
      if (targets.primary) {
        targets.primary.appendChild(buildInlineButton(a, 'primary'));
      }
    });

    // Render Tools menu, grouped by category.
    if (targets['tools-menu']) {
      const groups = {};
      toolsBucket.forEach(({ action, category }) => {
        const key = CATEGORY_LABEL[category] ? category : 'other';
        (groups[key] = groups[key] || []).push(action);
      });
      const keys = CATEGORY_ORDER.filter(k => groups[k] && groups[k].length);
      keys.forEach(key => {
        const header = document.createElement('div');
        header.className = 'menu-section-header';
        header.textContent = CATEGORY_LABEL[key];
        targets['tools-menu'].appendChild(header);
        groups[key].forEach(a => targets['tools-menu'].appendChild(buildMenuButton(a)));
      });
      const empty = document.getElementById('tools-menu-empty');
      if (empty) empty.style.display = keys.length ? 'none' : '';
      const trigger = document.querySelector('#tools-dropdown .dropdown-trigger');
      if (trigger && !keys.length) trigger.setAttribute('disabled', '');
    }

    // Render More menu (flat).
    if (targets['more-menu']) {
      moreBucket.forEach(a => targets['more-menu'].appendChild(buildMenuButton(a)));
      const empty = document.getElementById('more-menu-empty');
      if (empty) empty.style.display = moreBucket.length ? 'none' : '';
      const trigger = document.querySelector('#more-dropdown .dropdown-trigger');
      if (trigger && !moreBucket.length) trigger.setAttribute('disabled', '');
    }
  };
})();
