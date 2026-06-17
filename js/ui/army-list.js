// ui/army-list.js — left-panel army list + points summary.
(function () {
  const UI = window.UI = window.UI || {};

  // Single entry → DOM. `attachedSubtotal` is the combined points of
  // every child attached to this entry (rendered as a small "+N
  // attached" pill on the leader's body). `isAttached` flips on the
  // mini-card styling for nested children.
  UI.createArmyEntryEl = function (entry, index, opts) {
    opts = opts || {};
    const isAttached       = !!opts.isAttached;
    const attachedSubtotal = opts.attachedSubtotal || 0;
    const esc = UI.escapeHtml;
    const li = document.createElement('li');
    li.className = 'army-entry army-entry-card' + (isAttached ? ' army-entry-attached' : '');
    li.dataset.index = index;
    // entryId is the stable handle the attachment graph + drag-to-
    // attach use; data-index is still here for legacy click handlers
    // (events.js delegates on it) and for drag-to-reorder which works
    // off the array index.
    if (entry.entryId) li.dataset.entryId = entry.entryId;
    const pts    = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
    const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
    // Ordinal-aware per-entry total (matches the army total). `surcharge` is the
    // extra this entry pays for copies past the datasheet's per-army threshold.
    const army      = opts.army;
    const surcharge = (army && typeof army.getEntryOrdinalSurcharge === 'function') ? army.getEntryOrdinalSurcharge(index) : 0;
    const total     = (army && typeof army.getEntryPoints === 'function') ? army.getEntryPoints(index) : (pts * entry.count + enhPts);
    const squadHtml = entry.squadLabel
      ? `<span class="army-entry-squad">${esc(entry.squadLabel)}</span>` : '';
    const enhBadges = (entry.enhancements || []).map(e =>
      `<span class="army-enh-badge" title="${esc(e.description || '')}">${esc(e.name)}</span>`
    ).join('');
    // The squad-label (e.g. "20 models") and the "+N attached" pill
    // share a SUB-ROW immediately below the unit name. Keeping them
    // on a dedicated line means:
    //   · The title row gets the FULL header width — long names
    //     ("Necron Warriors", "Canoptek Cryptothralls") aren't
    //     squeezed by the model count + pill competing in the same
    //     flex track ("NE…", "TECHNOMANC…").
    //   · The squad label and the pill, when both present (typical
    //     for a Warriors squad with a leader attached), naturally
    //     line up side-by-side with a separator — both are short
    //     enough that they coexist comfortably.
    // The row is emitted only when at least ONE of the two pieces
    // exists; entries with neither (e.g. a Captain with no attached
    // bodyguard) get no extra row and look identical to pre-feature.
    const attachedPillHtml = attachedSubtotal > 0
      ? `<span class="army-entry-attached-pill" title="Combined points of attached units">+${attachedSubtotal} attached</span>`
      : '';
    const subRow = (squadHtml || attachedPillHtml)
      ? `<div class="army-entry-subline">${squadHtml}${attachedPillHtml}</div>`
      : '';
    // New richer markup. Preserves the original element classes + data-* attrs
    // that events.js delegates on (.army-entry, .army-qty-input,
    // .army-entry-remove, data-index). The grid is replaced by a flex layout
    // styled in build-mode.css; the legacy column-grid CSS still targets the
    // sub-elements via class name when build-mode.css is absent.
    li.innerHTML = `
      <span class="army-entry-stripe" aria-hidden="true"></span>
      <span class="army-entry-handle" aria-hidden="true" title="Drag to reorder or attach">
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
        <span class="army-entry-handle-dot"></span>
      </span>
      <div class="army-entry-body">
        <div class="army-entry-name" title="${esc(entry.unitName)}">
          <span class="army-entry-title">${esc(entry.unitName)}</span>
        </div>
        ${subRow}
        ${enhBadges ? `<div class="army-enh-badges">${enhBadges}</div>` : ''}
        <div class="army-entry-stats">
          <span class="army-entry-stat army-entry-stat-pts">
            <span class="army-entry-stat-label">Pts</span>
            <span class="army-entry-pts">${pts}${enhPts ? `<span class="army-enh-pts">+${enhPts}</span>` : ''}</span>
          </span>
          <span class="army-entry-stat army-entry-stat-qty">
            <span class="army-entry-stat-label">Qty</span>
            <span class="army-entry-qty">
              <input type="number" value="${entry.count}" min="0" max="99" data-index="${index}" class="army-qty-input" />
            </span>
          </span>
          <span class="army-entry-stat army-entry-stat-total">
            <span class="army-entry-stat-label">Total</span>
            <span class="army-entry-total">${total}${surcharge > 0 ? `<span class="army-scaling-pts" title="Includes +${surcharge} pts scaling cost for copies past your first ${(entry.unitData && entry.unitData.ordinal ? entry.unitData.ordinal.fromCount - 1 : 1)}">▲${surcharge}</span>` : ''}</span>
          </span>
        </div>
      </div>
      <button class="army-entry-remove" data-index="${index}" title="Remove" aria-label="Remove unit">&times;</button>
    `;
    return li;
  };

  // Cluster-points helper: sum of an entry's own total + every
  // descendant's total. Used for the leader's "+N attached" pill so the
  // user can see what a Leader + bodyguard + bodyguard-extras cluster
  // costs without doing the math.
  function _entryTotalPts(entry) {
    const pts    = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
    const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
    return pts * entry.count + enhPts;
  }

  UI.renderArmyList = function (army) {
    if (window.App && typeof App.fireArmyChange === 'function') App.fireArmyChange('render');
    if (!army) return;

    const nameInput  = document.getElementById('army-name-input');
    const limitInput = document.getElementById('points-limit-input');
    if (document.activeElement !== nameInput)  nameInput.value  = army.name;
    if (document.activeElement !== limitInput) limitInput.value = army.pointsLimit;

    const total     = army.getTotalPoints();
    const limit     = army.pointsLimit || 0;
    const pct       = limit > 0 ? Math.min((total / limit) * 100, 100) : (total > 0 ? 100 : 0);
    const remaining = limit - total;

    document.getElementById('points-current').textContent      = total;
    document.getElementById('points-limit-display').textContent = limit;
    document.getElementById('points-bar-pct').textContent       = Math.round(pct) + '%';
    document.getElementById('points-bar-remaining').textContent =
      remaining >= 0 ? `${remaining} pts remaining` : `${Math.abs(remaining)} pts over limit`;

    const bar = document.getElementById('points-bar');
    bar.style.width = pct + '%';
    bar.classList.toggle('over-limit',  total > limit && limit > 0);
    bar.classList.toggle('near-limit', !bar.classList.contains('over-limit') && pct >= 90);
    const summaryEl = document.querySelector('.points-summary');
    if (summaryEl) summaryEl.classList.toggle('points-over', total > limit && limit > 0);
    const curEl = document.getElementById('points-current');
    if (curEl) curEl.classList.toggle('over-limit', total > limit && limit > 0);

    // The topbar build-hero has its own current/limit/pct/bar elements
    // (data-build-hero="*"); build-mode.js#syncHero is supposed to refresh
    // them via the armyChange hook, but the hook fires *before* the legacy
    // spans are written, so under some timing it lagged a render behind.
    // Update the visible elements directly here too — cheap, idempotent.
    const heroCur = document.querySelector('[data-build-hero="points-current"]');
    if (heroCur) heroCur.textContent = total;
    const heroLim = document.querySelector('[data-build-hero="points-limit"]');
    if (heroLim) heroLim.textContent = limit;
    const heroPct = document.querySelector('[data-build-hero="pct"]');
    if (heroPct) heroPct.textContent = Math.round(pct) + '%';
    const heroBar = document.querySelector('[data-build-hero="bar"]');
    if (heroBar) {
      heroBar.style.width = pct + '%';
      heroBar.classList.toggle('over-limit',  total > limit && limit > 0);
      heroBar.classList.toggle('near-limit', !heroBar.classList.contains('over-limit') && pct >= 90);
    }

    const list = document.getElementById('army-entry-list');
    list.innerHTML = '';

    if (!army.entries || army.entries.length === 0) {
      const li = document.createElement('li');
      li.id = 'army-list-empty';
      li.className = 'army-list-empty';
      li.innerHTML = 'No units added yet.<br/>Select a unit, then &ldquo;Add to Army&rdquo;.';
      list.appendChild(li);
      return;
    }

    // Hierarchical render: walk array order, but emit each root entry's
    // direct children as a nested <ul.army-entry-attachments> inside
    // the root's body. Order of children mirrors their array order, so
    // dragging a child entry to reorder among siblings still works (the
    // existing reorder splice in flip-animations.js stays untouched).
    // `Army.entries` is NOT mutated by attachment ops — only the
    // `attachedToEntryId` field — so the array index that legacy click
    // handlers depend on stays stable.
    const childrenByParent = new Map(); // parentEntryId → entry[]
    army.entries.forEach(e => {
      if (!e || !e.attachedToEntryId) return;
      const arr = childrenByParent.get(e.attachedToEntryId) || [];
      arr.push(e);
      childrenByParent.set(e.attachedToEntryId, arr);
    });

    // Depth cap: render up to 3 levels of nesting so a pathological
    // chain doesn't blow out the layout. The data model allows deeper
    // chains; the renderer just flattens anything past depth 3 into
    // the depth-3 container.
    const MAX_DEPTH = 3;

    function totalForCluster(entry) {
      let sum = _entryTotalPts(entry);
      const kids = childrenByParent.get(entry.entryId) || [];
      kids.forEach(k => { sum += totalForCluster(k); });
      return sum;
    }

    function renderEntry(entry, depth) {
      const index   = army.entries.indexOf(entry);
      const kids    = childrenByParent.get(entry.entryId) || [];
      // The pill shows only the IMMEDIATE attached subtotal — depth-1
      // sum, not the full cluster total — so it stays readable on
      // dense clusters.
      let pillSubtotal = 0;
      kids.forEach(k => { pillSubtotal += totalForCluster(k); });
      const li = UI.createArmyEntryEl(entry, index, {
        isAttached:       depth > 0,
        attachedSubtotal: pillSubtotal,
        army,
      });
      if (kids.length > 0 && depth < MAX_DEPTH) {
        const subList = document.createElement('ul');
        subList.className = 'army-entry-attachments';
        kids.forEach(child => subList.appendChild(renderEntry(child, depth + 1)));
        // Place children INSIDE the parent's body so the visual nesting
        // reads as ownership, not just adjacency. CSS handles the indent
        // and the connector line.
        const body = li.querySelector('.army-entry-body');
        if (body) body.appendChild(subList);
        else li.appendChild(subList);
      }
      return li;
    }

    army.entries.forEach(entry => {
      if (!entry) return;
      if (entry.attachedToEntryId) return;   // Children rendered by their parent.
      list.appendChild(renderEntry(entry, 0));
    });
  };
})();
