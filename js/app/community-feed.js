// app/community-feed.js — read-only browsable feed of curated community army lists.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const FEED_URL = 'js/data/community-feed.json';

  // Module-local cache of the parsed feed.
  let feedData = null;        // { version, updatedAt, lists: [...] }
  let feedError = null;       // string when fetch fails
  let feedLoading = false;

  // Filter state, lives across reopens within a session.
  let filterFaction = 'all';
  let filterPoints  = 'all';
  let filterTags    = new Set();
  let searchTerm    = '';
  let expandedIds   = new Set();

  const esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  function shortFaction(name) {
    if (!name) return '';
    return name.includes(' - ') ? name.split(' - ').pop().trim() : name;
  }

  function accentFor(factionName) {
    const colors = App.FACTION_COLORS || {};
    const short = shortFaction(factionName);
    const tuple = colors[short] || colors[factionName] || App.DEFAULT_ACCENT || ['#666'];
    return tuple[0];
  }

  function findFaction(name) {
    const facs = (App.state && App.state.factions) || [];
    if (!name) return null;
    const direct = facs.find(f => f.factionName === name);
    if (direct) return direct;
    const shortTarget = shortFaction(name).toLowerCase();
    return facs.find(f => shortFaction(f.factionName).toLowerCase() === shortTarget) || null;
  }

  function factionUnits(faction) {
    if (!faction) return [];
    return (faction.units || []).filter(u => u && u.name);
  }

  function findUnitByName(units, needle) {
    const n = (needle || '').toLowerCase();
    if (!n) return null;
    const exact = units.find(u => u.name && u.name.toLowerCase() === n);
    if (exact) return exact;
    return units.find(u => u.name && u.name.toLowerCase().includes(n)) || null;
  }

  function factionsLoaded() {
    return App.state && Array.isArray(App.state.factions) && App.state.factions.length > 0;
  }

  // ── Feed loading ───────────────────────────────────────────
  function loadFeed() {
    if (feedData || feedLoading) return Promise.resolve(feedData);
    feedLoading = true;
    return fetch(FEED_URL, { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        feedData = data;
        feedError = null;
        feedLoading = false;
        if (modalEl && !modalEl.hidden) renderContent();
        return feedData;
      })
      .catch(err => {
        feedError = 'Community feed not available offline yet — load this page once with internet to cache it.';
        feedLoading = false;
        if (modalEl && !modalEl.hidden) renderContent();
        console.warn('[community-feed] fetch failed:', err);
        return null;
      });
  }

  // Kick off prefetch at bootstrap (service worker will cache it on first online load).
  App.hooks.bootstrap.push(function () {
    loadFeed();
  });

  // ── Apply prepared army (mirrors starter-lists pattern) ────
  function applyPreparedArmy(prepared) {
    const state = App.state;
    if (!state || !state.armyManager) return;

    const army = state.armyManager.newArmy(prepared.factionName || '');
    army.name = prepared.title;
    army.pointsLimit = prepared.points || 2000;
    army.factionName = prepared.factionName || '';

    let added = 0;
    prepared.pairs.forEach(p => {
      if (!p.unit) return;
      const squadOpt = (p.unit.squadOptions && p.unit.squadOptions[0]) || null;
      army.addUnit(p.unit, p.count || 1, squadOpt);
      added++;
    });

    state.armyManager.saveArmy(army);
    state.currentArmy = army;
    state.armyManager.currentArmy = army;

    const factionSelect    = document.getElementById('army-faction-select');
    const detachmentSelect = document.getElementById('army-detachment-select');

    if (factionSelect && prepared.factionName) {
      const topLevel = App.getVirtualParentOf
        ? (App.getVirtualParentOf(prepared.factionName) || prepared.factionName)
        : prepared.factionName;
      const exists = [...factionSelect.options].some(o => o.value === topLevel);
      if (exists) {
        factionSelect.value = topLevel;
        factionSelect.dispatchEvent(new Event('change'));
        if (topLevel !== prepared.factionName) {
          const chapterSelect = document.getElementById('army-chapter-select');
          if (chapterSelect && [...chapterSelect.options].some(o => o.value === prepared.factionName)) {
            chapterSelect.value = prepared.factionName;
            chapterSelect.dispatchEvent(new Event('change'));
          }
        }
      }
    }

    if (detachmentSelect && prepared.detachment) {
      const match = [...detachmentSelect.options].find(o =>
        o.value.toLowerCase() === prepared.detachment.toLowerCase()
      );
      if (match) {
        detachmentSelect.value = match.value;
        detachmentSelect.dispatchEvent(new Event('change'));
      }
    }

    const nameInput = document.getElementById('army-name-input');
    const ptsInput  = document.getElementById('points-limit-input');
    if (nameInput) nameInput.value = army.name;
    if (ptsInput)  ptsInput.value  = army.pointsLimit;

    if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(army);

    const missingMsg = prepared.missing && prepared.missing.length
      ? ' (missing ' + prepared.missing.length + ' units)'
      : '';
    if (window.UI && typeof UI.toast === 'function') {
      UI.toast('Loaded ' + prepared.title + ' (' + added + ' units)' + missingMsg,
        prepared.missing && prepared.missing.length ? 'info' : 'success',
        prepared.missing && prepared.missing.length ? 5000 : 3000);
    }
  }

  function prepareList(list) {
    const faction = findFaction(list.faction);
    if (!faction) {
      return { ok: false, reason: 'Faction "' + shortFaction(list.faction) + '" is not loaded yet.' };
    }
    const units = factionUnits(faction);
    const pairs = [];
    const missing = [];
    list.units.forEach(req => {
      const u = findUnitByName(units, req.nameMatches);
      if (u) pairs.push({ unit: u, count: req.count || 1 });
      else missing.push(req.nameMatches);
    });
    return {
      ok: true,
      prepared: {
        title:       list.title,
        points:      list.points,
        factionName: faction.factionName,
        detachment:  list.detachment,
        pairs, missing,
      },
    };
  }

  // ── Filtering ──────────────────────────────────────────────
  function uniqueFactions(lists) {
    const seen = new Map();
    lists.forEach(l => {
      const k = shortFaction(l.faction);
      if (!seen.has(k)) seen.set(k, l.faction);
    });
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  function uniquePoints(lists) {
    const set = new Set();
    lists.forEach(l => set.add(l.points));
    return [...set].sort((a, b) => a - b);
  }

  function uniqueTags(lists) {
    const set = new Set();
    lists.forEach(l => (l.tags || []).forEach(t => set.add(t)));
    return [...set].sort();
  }

  function listMatches(list) {
    if (filterFaction !== 'all' && shortFaction(list.faction) !== filterFaction) return false;
    if (filterPoints !== 'all' && Number(list.points) !== Number(filterPoints)) return false;
    if (filterTags.size > 0) {
      const tags = list.tags || [];
      let any = false;
      filterTags.forEach(t => { if (tags.indexOf(t) !== -1) any = true; });
      if (!any) return false;
    }
    if (searchTerm) {
      const hay = (
        list.title + ' ' +
        (list.author || '') + ' ' +
        (list.event || '') + ' ' +
        list.faction + ' ' +
        shortFaction(list.faction)
      ).toLowerCase();
      if (hay.indexOf(searchTerm) === -1) return false;
    }
    return true;
  }

  // ── Modal rendering ────────────────────────────────────────
  let modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'modal-community-feed';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="modal community-modal">' +
        '<div class="modal-header">' +
          '<h3>Community Lists</h3>' +
          '<span class="community-updated" id="community-updated"></span>' +
          '<button class="modal-close" id="community-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="community-toolbar">' +
            '<select class="form-select community-filter" id="community-filter-faction" aria-label="Filter by faction">' +
              '<option value="all">All factions</option>' +
            '</select>' +
            '<select class="form-select community-filter" id="community-filter-points" aria-label="Filter by points">' +
              '<option value="all">All points</option>' +
            '</select>' +
            '<input type="text" class="community-search" id="community-search" placeholder="Search title or author..." aria-label="Search lists" />' +
          '</div>' +
          '<div class="community-tag-row" id="community-tag-row"></div>' +
          '<div id="community-content"></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeFeed();
    });
    backdrop.querySelector('#community-close').addEventListener('click', closeFeed);
    backdrop.querySelector('#community-filter-faction').addEventListener('change', e => {
      filterFaction = e.target.value;
      renderContent();
    });
    backdrop.querySelector('#community-filter-points').addEventListener('change', e => {
      filterPoints = e.target.value;
      renderContent();
    });
    backdrop.querySelector('#community-search').addEventListener('input', e => {
      searchTerm = (e.target.value || '').trim().toLowerCase();
      renderContent();
    });

    modalEl = backdrop;
    return modalEl;
  }

  function renderFilterDropdowns() {
    if (!modalEl || !feedData) return;
    const lists = feedData.lists || [];

    const facSel = modalEl.querySelector('#community-filter-faction');
    const ptsSel = modalEl.querySelector('#community-filter-points');

    if (facSel && facSel.options.length <= 1) {
      uniqueFactions(lists).forEach(([shortName]) => {
        const opt = document.createElement('option');
        opt.value = shortName;
        opt.textContent = shortName;
        facSel.appendChild(opt);
      });
    }
    if (ptsSel && ptsSel.options.length <= 1) {
      uniquePoints(lists).forEach(p => {
        const opt = document.createElement('option');
        opt.value = String(p);
        opt.textContent = p + ' pts';
        ptsSel.appendChild(opt);
      });
    }

    facSel.value = filterFaction;
    ptsSel.value = filterPoints;
  }

  function renderTagChips() {
    if (!modalEl || !feedData) return;
    const row = modalEl.querySelector('#community-tag-row');
    if (!row) return;

    const tags = uniqueTags(feedData.lists || []);
    if (tags.length === 0) { row.innerHTML = ''; return; }

    row.innerHTML = tags.map(t => {
      const active = filterTags.has(t) ? ' active' : '';
      return '<button type="button" class="community-tag-chip' + active + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');

    row.querySelectorAll('.community-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const t = chip.getAttribute('data-tag');
        if (filterTags.has(t)) filterTags.delete(t);
        else filterTags.add(t);
        renderContent();
      });
    });
  }

  function renderUpdatedAt() {
    if (!modalEl) return;
    const el = modalEl.querySelector('#community-updated');
    if (!el) return;
    if (feedData && feedData.updatedAt) {
      el.textContent = 'Last updated: ' + feedData.updatedAt;
    } else {
      el.textContent = '';
    }
  }

  function unitListHtml(list) {
    const faction = findFaction(list.faction);
    const facUnits = factionUnits(faction);
    const items = (list.units || []).map(req => {
      const matched = faction ? findUnitByName(facUnits, req.nameMatches) : null;
      const cls = matched ? 'community-preview-unit' : 'community-preview-unit missing';
      const tag = matched ? '' : ' <span class="community-preview-missing">(unmatched)</span>';
      const name = matched ? matched.name : req.nameMatches;
      return '<li class="' + cls + '"><span class="community-preview-count">' + (req.count || 1) + '&times;</span> ' +
        esc(name) + tag + '</li>';
    }).join('');
    return '<ul class="community-preview-units">' + items + '</ul>';
  }

  function renderCard(list) {
    const faction = findFaction(list.faction);
    const available = !!faction;
    const accent = accentFor(list.faction);
    const shortFac = shortFaction(list.faction);
    const expanded = expandedIds.has(list.id);
    const disabledAttr = available ? '' : 'disabled';
    const disabledClass = available ? '' : ' disabled';
    const loadTitle = available
      ? 'Load this list as a new army'
      : 'Faction "' + shortFac + '" is not loaded yet.';

    const tagsHtml = (list.tags || []).map(t =>
      '<span class="community-card-tag">' + esc(t) + '</span>'
    ).join('');

    const eventLine = [list.author, list.event, list.placement]
      .filter(Boolean).map(esc).join(' &middot; ');

    return (
      '<div class="community-card' + disabledClass + '" style="--community-accent:' + accent + '" data-id="' + esc(list.id) + '">' +
        '<div class="community-card-header">' +
          '<div class="community-card-title">' + esc(list.title) + '</div>' +
          '<div class="community-card-pill">' + list.points + ' pt</div>' +
        '</div>' +
        (eventLine ? '<div class="community-card-meta">' + eventLine + '</div>' : '') +
        '<div class="community-card-faction">' + esc(shortFac) +
          (list.detachment ? ' &middot; <span class="community-card-detachment">' + esc(list.detachment) + '</span>' : '') +
        '</div>' +
        (tagsHtml ? '<div class="community-card-tags">' + tagsHtml + '</div>' : '') +
        '<div class="community-card-desc">' + esc(list.description || '') + '</div>' +
        (expanded ? '<div class="community-card-preview">' + unitListHtml(list) + '</div>' : '') +
        '<div class="community-card-actions">' +
          '<button type="button" class="btn btn-sm btn-outline community-btn-preview" data-id="' + esc(list.id) + '">' +
            (expanded ? 'Hide' : 'Preview') + '</button>' +
          '<button type="button" class="btn btn-sm btn-accent community-btn-load" data-id="' + esc(list.id) + '" title="' + esc(loadTitle) + '" ' + disabledAttr + '>Load</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderContent() {
    if (!modalEl) return;
    const container = modalEl.querySelector('#community-content');
    if (!container) return;

    if (feedError && !feedData) {
      container.innerHTML = '<div class="community-empty">' + esc(feedError) + '</div>';
      return;
    }
    if (!feedData) {
      container.innerHTML = '<div class="community-empty">Loading community feed&hellip;</div>';
      loadFeed();
      return;
    }
    if (!factionsLoaded()) {
      container.innerHTML = '<div class="community-empty">Loading faction data&hellip; lists will be loadable once a faction is selected.</div>';
      return;
    }

    renderFilterDropdowns();
    renderTagChips();
    renderUpdatedAt();

    const visible = (feedData.lists || []).filter(listMatches);
    if (visible.length === 0) {
      container.innerHTML = '<div class="community-empty">No community lists match your filters.</div>';
      return;
    }

    container.innerHTML = '<div class="community-grid">' + visible.map(renderCard).join('') + '</div>';

    container.querySelectorAll('.community-btn-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (expandedIds.has(id)) expandedIds.delete(id);
        else expandedIds.add(id);
        renderContent();
      });
    });
    container.querySelectorAll('.community-btn-load').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const list = (feedData.lists || []).find(l => l.id === id);
        if (!list) return;
        loadList(list);
      });
    });
  }

  function loadList(list) {
    const res = prepareList(list);
    if (!res.ok) {
      if (window.UI && typeof UI.toast === 'function') UI.toast(res.reason, 'error', 4000);
      return;
    }
    applyPreparedArmy(res.prepared);
    closeFeed();
  }

  function openFeed() {
    const el = ensureModal();
    // Don't reset filters between opens — feels nicer.
    const search = el.querySelector('#community-search');
    if (search) search.value = searchTerm;
    el.hidden = false;
    if (!feedData && !feedError) loadFeed();
    renderContent();
    setTimeout(() => { if (search) search.focus(); }, 50);
  }

  function closeFeed() {
    if (modalEl) modalEl.hidden = true;
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeFeed();
  });

  // Re-render when faction data finishes loading so cards become loadable.
  App.hooks.selectionChange.push(function () {
    if (modalEl && !modalEl.hidden) renderContent();
  });

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-community-feed',
    region: 'primary',
    label: 'Community',
    category: 'data',
    title: 'Browse community army lists',
    onClick: openFeed,
  });
})();
