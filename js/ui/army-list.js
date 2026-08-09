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
    // 11e wargear points, per squad copy (priced defaults + selection net
    // deltas, floored at 0 — mirrors army.getEntryPoints).
    const wgSel  = (entry.wargear || []).reduce((s, w) => s + (w.pts || 0) * (w.count || 0), 0);
    const wgBase = (army && typeof army.getEntryWargearBasePts === 'function') ? army.getEntryWargearBasePts(index) : 0;
    const wgPts  = Math.max(0, wgBase + wgSel);
    const surcharge = (army && typeof army.getEntryOrdinalSurcharge === 'function') ? army.getEntryOrdinalSurcharge(index) : 0;
    const total     = (army && typeof army.getEntryPoints === 'function') ? army.getEntryPoints(index) : (pts * entry.count + enhPts);
    const squadHtml = entry.squadLabel
      ? `<span class="army-entry-squad">${esc(entry.squadLabel)}</span>` : '';
    const enhBadges = (entry.enhancements || []).map(e =>
      `<span class="army-enh-badge" title="${UI.mdPlain(e.description || '')}">${esc(e.name)}</span>`
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
            <span class="army-entry-pts">${pts}${enhPts ? `<span class="army-enh-pts">+${enhPts}</span>` : ''}${wgPts ? `<span class="army-enh-pts" title="Wargear points (MFM per-item costs)">+${wgPts}</span>` : ''}</span>
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
    // Every live entryId, so a pointer at a REMOVED parent can be recognised.
    // Removing a leader does not clear `attachedToEntryId` on the units it was
    // leading, so those pointers dangle. They used to fall through every branch
    // below — skipped at root level as "a child", and never claimed by a parent
    // because the parent is gone — leaving the unit invisible in the list while
    // it was still in `entries`, still billed by getTotalPoints(), and still
    // synced. Reloading then made it reappear (Army.fromJSON nulls unresolvable
    // pointers), which reads as "a unit I deleted came back".
    const liveIds = new Set();
    army.entries.forEach(e => { if (e && e.entryId) liveIds.add(e.entryId); });
    const isOrphan = e => !!e.attachedToEntryId && !liveIds.has(e.attachedToEntryId);

    const childrenByParent = new Map(); // parentEntryId → entry[]
    army.entries.forEach(e => {
      if (!e || !e.attachedToEntryId || isOrphan(e)) return;
      const arr = childrenByParent.get(e.attachedToEntryId) || [];
      arr.push(e);
      childrenByParent.set(e.attachedToEntryId, arr);
    });

    // Depth cap: render up to 3 levels of nesting so a pathological
    // chain doesn't blow out the layout. The data model allows deeper
    // chains; the renderer just flattens anything past depth 3 into
    // the depth-3 container.
    const MAX_DEPTH = 3;

    // `seen` is not optional bookkeeping: this walks childrenByParent
    // independently of the render pass, so an attachment cycle recursed until
    // the stack blew — and because it runs inside renderEntry, that exception
    // aborted the WHOLE army list, not just one row.
    function totalForCluster(entry, seen) {
      seen = seen || new Set();
      if (seen.has(entry)) return 0;
      seen.add(entry);
      let sum = _entryTotalPts(entry);
      const kids = childrenByParent.get(entry.entryId) || [];
      kids.forEach(k => { sum += totalForCluster(k, seen); });
      return sum;
    }

    // Guarantees every entry is rendered exactly once. Doubles as cycle
    // protection: a A→B, B→A pair resolves on both sides, so neither is a root
    // and Army.fromJSON will not repair it either — without this both units
    // would vanish from the list while still counting toward points.
    const rendered = new Set();

    function renderEntry(entry, depth) {
      rendered.add(entry);
      const index   = army.entries.indexOf(entry);
      const kids    = (childrenByParent.get(entry.entryId) || []).filter(k => !rendered.has(k));
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
      if (kids.length > 0) {
        const subList = document.createElement('ul');
        subList.className = 'army-entry-attachments';
        // Past MAX_DEPTH, genuinely flatten into the depth-3 container — hold
        // the depth constant instead of skipping the branch. `depth < MAX_DEPTH`
        // here used to DROP those children entirely, which the comment above
        // said it flattened; same invisible-but-still-billed outcome as an
        // orphan.
        kids.forEach(child => subList.appendChild(
          renderEntry(child, Math.min(depth + 1, MAX_DEPTH))));
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
      // Children are rendered by their parent — but an entry pointing at a
      // parent that no longer exists is a root now, not a child.
      if (entry.attachedToEntryId && !isOrphan(entry)) return;
      list.appendChild(renderEntry(entry, 0));
    });

    // Backstop: anything the passes above did not reach (an attachment cycle,
    // where every member has a live parent so none qualifies as a root) is
    // rendered at top level. Nothing in `entries` may be silently invisible —
    // the user is being charged points for it.
    army.entries.forEach(entry => {
      if (!entry || rendered.has(entry)) return;
      list.appendChild(renderEntry(entry, 0));
    });
  };
})();
