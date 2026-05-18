// ui/flip-animations.js — FLIP-style add-to-army flight + drag-to-reorder + micro-interactions.
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Reduced-motion gate
  // ---------------------------------------------------------------------------
  const mqReduce = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')) || null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  // ---------------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------------
  const FLIGHT_MS   = 420;
  const FLIGHT_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const PULSE_MS    = 700;
  const TILT_DEG    = 5;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let inFlight = false;          // only one ghost at a time
  let pendingSourceRect = null;  // captured in capture-phase click handler

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function getArmyList() { return document.getElementById('army-entry-list'); }

  function getSelectedUnitCard() {
    return document.querySelector('.unit-card.selected');
  }

  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // Emit faction-themed stinger + accent particle burst when a unit lands.
  // Falls back to the generic thud if faction-fx hasn't loaded.
  function emitAddFx(entry) {
    const A = window.App || {};
    if (A.factionFx && typeof A.factionFx.playAddStinger === 'function') {
      try { A.factionFx.playAddStinger(); } catch (_) { safePlayThud(); }
    } else {
      safePlayThud();
    }
    if (A.factionFx && typeof A.factionFx.particleBurst === 'function' && entry) {
      try {
        const r = entry.getBoundingClientRect();
        A.factionFx.particleBurst(r.left + r.width / 2, r.top + r.height / 2);
      } catch (_) {}
    }
  }

  function safePlayThud() {
    try {
      // The orphaned sound-fx module exposes App.isSoundEnabled / App.toggleSound
      // but does not expose a "play arbitrary sound" hook. We synthesize a soft
      // thud only if sound is on AND a WebAudio context is available.
      const App = window.App || {};
      if (typeof App.isSoundEnabled !== 'function' || !App.isSoundEnabled()) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t0);
      o.frequency.exponentialRampToValueAtTime(60, t0 + 0.18);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.26);
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 400);
    } catch (_) { /* swallow — audio is best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Glow-pulse on the new entry. Removed automatically.
  // ---------------------------------------------------------------------------
  function pulse(entry, fadeFallback) {
    if (!entry) return;
    const cls = fadeFallback ? 'just-added-fade' : 'just-added';
    entry.classList.remove('just-added', 'just-added-fade');
    // Force reflow so re-adding the class restarts the animation.
    void entry.offsetWidth;
    entry.classList.add(cls);
    setTimeout(() => { entry.classList.remove(cls); }, PULSE_MS + 80);
  }

  function scrollEntryIntoView(entry) {
    if (!entry || typeof entry.getBoundingClientRect !== 'function') return;
    const r = entry.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < 0 || r.bottom > vh) {
      try { entry.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
      catch (_) { entry.scrollIntoView(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Build a ghost clone of the source card and animate to the destination rect.
  // ---------------------------------------------------------------------------
  function flyGhost(sourceRect, sourceEl, destRect, onDone) {
    if (!sourceRect || !destRect || !sourceEl) { onDone && onDone(); return; }

    const ghost = sourceEl.cloneNode(true);
    ghost.classList.add('yaab-flip-ghost');
    ghost.classList.remove('selected', 'is-selected', 'just-added', 'just-added-fade');
    // Strip ids to avoid duplicate-id collisions in cloned subtree.
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    // Inputs in the ghost should not steal focus or take part in the form.
    ghost.querySelectorAll('input, button, select, textarea').forEach(n => {
      n.setAttribute('tabindex', '-1');
      n.setAttribute('aria-hidden', 'true');
      n.disabled = true;
    });

    // Position at source rect. We transform from there into the destination
    // rect, using translate + scale + a tiny rotation for character.
    ghost.style.width  = sourceRect.width + 'px';
    ghost.style.height = sourceRect.height + 'px';
    ghost.style.transform = `translate(${sourceRect.left}px, ${sourceRect.top}px) rotate(0deg) scale(1)`;
    ghost.style.opacity = '1';

    document.body.appendChild(ghost);

    // Compute scale so the ghost ends roughly at destination size. Use the
    // smaller scale to avoid distortion (army-entry is much wider than tall
    // relative to a unit-card).
    const sx = Math.max(0.2, destRect.width  / sourceRect.width);
    const sy = Math.max(0.2, destRect.height / sourceRect.height);
    const s  = Math.min(sx, sy);

    // Center the scaled ghost on the destination's centroid.
    const sw = sourceRect.width  * s;
    const sh = sourceRect.height * s;
    const dx = destRect.left + (destRect.width  - sw) / 2;
    const dy = destRect.top  + (destRect.height - sh) / 2;

    // Force a layout, then start the animation.
    void ghost.offsetWidth;
    ghost.style.transition = `transform ${FLIGHT_MS}ms ${FLIGHT_EASE}, opacity ${FLIGHT_MS}ms ${FLIGHT_EASE}`;
    // Tilt mid-flight via animationend isn't trivial in a single transition.
    // Approximate "character" with a tilt that lands at ~0deg by easing through.
    ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${TILT_DEG}deg) scale(${s})`;
    ghost.style.opacity = '0.55';

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      try { ghost.remove(); } catch (_) {}
      onDone && onDone();
    }
    ghost.addEventListener('transitionend', finish, { once: true });
    // Defensive timeout — never leave a ghost stuck.
    setTimeout(finish, FLIGHT_MS + 120);
  }

  // ---------------------------------------------------------------------------
  // Capture-phase: BEFORE the existing add handler runs we need to snapshot
  // the source rect. We do this on `pointerdown` (capture) so we beat any
  // later click handlers, AND on click capture for keyboard users.
  //
  // Clicking the Add button is also our authoritative "user added a unit"
  // signal — entries.length might NOT increase (Army.addUnit stacks duplicate
  // counts onto an existing entry), but the user still wants the animation.
  // ---------------------------------------------------------------------------
  let pendingAddTick = false;
  let pendingAddDeadline = 0;
  let pendingUnitName = null;

  function snapshotSourceFromEvent(e) {
    if (!e || !e.target || !e.target.closest) return;
    if (!e.target.closest('#btn-detail-add')) return;
    const sel = getSelectedUnitCard();
    pendingSourceRect = sel ? { rect: rectOf(sel), el: sel } : null;
    // Capture the unit name from the selected card so we can target the right
    // <li> after re-render (in case the new entry isn't the last one — e.g.
    // a stack-count increase on an existing entry).
    pendingUnitName = null;
    try {
      const App = window.App;
      const u = App && App.state && App.state.selectedUnit;
      if (u && u.name) pendingUnitName = u.name;
      else if (sel) {
        const nameEl = sel.querySelector('.unit-card-name, [data-unit-name]');
        if (nameEl) pendingUnitName = (nameEl.textContent || '').trim();
      }
    } catch (_) {}
    pendingAddTick = true;
    pendingAddDeadline = Date.now() + 600; // armyChange or DOM mutation should arrive within ~250ms
  }

  document.addEventListener('pointerdown', snapshotSourceFromEvent, true);
  document.addEventListener('click',        snapshotSourceFromEvent, true);

  // Observe the army list for new <li> children and animate.
  function wireArmyListObserver() {
    const list = getArmyList();
    if (!list) return;
    if (list.dataset.yaabFlipObserved === '1') return;
    list.dataset.yaabFlipObserved = '1';
    const mo = new MutationObserver((muts) => {
      if (!pendingAddTick) return;
      if (Date.now() > pendingAddDeadline) {
        pendingAddTick = false;
        return;
      }
      // Did any .army-entry get added in this batch?
      let sawEntryMutation = false;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.classList && node.classList.contains('army-entry')) {
            sawEntryMutation = true;
            break;
          }
        }
        if (sawEntryMutation) break;
      }
      if (!sawEntryMutation) return;
      pendingAddTick = false;

      // Target priority:
      //   1. Entry whose title matches the unit name we captured (handles
      //      stack-count increases on an existing entry).
      //   2. The last entry in the list (army.addUnit pushes new entries).
      let target = null;
      if (pendingUnitName) {
        const rows = Array.from(list.querySelectorAll('.army-entry'));
        target = rows.find(li => {
          const t = li.querySelector('.army-entry-title, .army-entry-name');
          if (!t) return false;
          return (t.textContent || '').trim() === pendingUnitName;
        }) || null;
      }
      if (!target) target = list.querySelector('.army-entry:last-of-type');
      pendingUnitName = null;

      animateAdd(target);
    });
    mo.observe(list, { childList: true });
  }

  function animateAdd(targetEntry) {
    if (!targetEntry) return;

    // Reduced motion: glow-pulse only.
    if (reducedMotion()) {
      pulse(targetEntry, true);
      return;
    }

    // No source card (e.g. user added via command palette): fade-in fallback.
    const src = pendingSourceRect;
    pendingSourceRect = null;

    if (!src || !src.rect || !src.el || inFlight) {
      pulse(targetEntry, true);
      return;
    }

    // Make sure the destination is on-screen before computing its rect.
    scrollEntryIntoView(targetEntry);
    // After scrollIntoView, layout may shift. Use rAF so the rect is fresh.
    requestAnimationFrame(() => {
      const destRect = rectOf(targetEntry);
      if (!destRect) { pulse(targetEntry, true); return; }
      inFlight = true;
      // The destination row will visually appear after the ghost lands; hide it
      // briefly so the flight reads as "card becomes the new row".
      const prevVis = targetEntry.style.visibility;
      targetEntry.style.visibility = 'hidden';
      flyGhost(src.rect, src.el, destRect, () => {
        targetEntry.style.visibility = prevVis || '';
        inFlight = false;
        pulse(targetEntry, false);
        emitAddFx(targetEntry);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Drag-to-reorder. Pointer-based, no external deps.
  // We mutate state.currentArmy.entries and call UI.renderArmyList on drop.
  // ---------------------------------------------------------------------------
  function getArmy() {
    const App = window.App;
    const state = App && App.state;
    if (state && state.currentArmy) return state.currentArmy;
    if (window.ArmyManager && window.ArmyManager.currentArmy) return window.ArmyManager.currentArmy;
    return null;
  }

  function wireDragReorder() {
    const list = getArmyList();
    if (!list) return;
    // Avoid double-wiring if init() runs twice (e.g. retry path).
    if (list.dataset.yaabDragWired === '1') return;
    list.dataset.yaabDragWired = '1';

    const DRAG_THRESHOLD_PX = 6; // must move this far before drag activates
    // The vertical band on each side of an entry that registers as a
    // BETWEEN-SIBLINGS gap drop instead of an ATTACH-ONTO-BODY drop.
    // Top GAP_PX and bottom GAP_PX = reorder. Middle = attach. Tuned by
    // eye against the entry-card height in build-mode.css; 14 px reads
    // as "near the edge" on a ~64 px card.
    const GAP_PX = 14;

    let candidate = null;      // <li> the user pressed on (drag not yet active)
    let dragging = null;       // <li> actively being dragged
    let dragIndex = -1;
    let pointerId = null;
    let startY = 0;
    let lastDropTarget = null;
    let lastDropPos = null;    // 'before' | 'after' | 'attach'
    let lastAttachOk = null;   // last canAttach result (drives green/amber)

    function clearDropMarkers() {
      list.querySelectorAll(
        '.is-drop-target-before, .is-drop-target-after, ' +
        '.is-attach-target, .is-attach-target--ok, .is-attach-target--soft'
      ).forEach(el => {
        el.classList.remove(
          'is-drop-target-before', 'is-drop-target-after',
          'is-attach-target', 'is-attach-target--ok', 'is-attach-target--soft'
        );
      });
      lastDropTarget = null;
      lastDropPos = null;
      lastAttachOk = null;
    }

    // Walk up the ancestor chain in the attachment graph and return
    // the set of entryIds the dragged entry MAY NOT attach to (itself
    // + every descendant — those would form a cycle).
    function forbiddenAttachTargets(draggingLi) {
      const set = new Set();
      const army = getArmy();
      if (!army || !draggingLi) return set;
      const dragId = draggingLi.dataset.entryId;
      if (!dragId) return set;
      set.add(dragId);
      // Walk descendants.
      const queue = [dragId];
      while (queue.length) {
        const id = queue.shift();
        army.entries.forEach(e => {
          if (e && e.attachedToEntryId === id && !set.has(e.entryId)) {
            set.add(e.entryId);
            queue.push(e.entryId);
          }
        });
      }
      return set;
    }

    function activateDrag() {
      if (dragging || !candidate) return;
      dragging = candidate;
      dragging.classList.add('is-dragging');
      try { dragging.setPointerCapture(pointerId); } catch (_) {}
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      const t = e.target;
      if (!t || !t.closest) return;
      // Don't start drag from interactive controls (input/remove button).
      if (t.closest('input, button, select, textarea, .army-entry-remove')) return;
      const li = t.closest('.army-entry');
      // The list now contains BOTH root <li>s and nested children inside
      // `.army-entry-attachments`. Both are valid drag sources — use
      // contains() instead of a direct parentNode === list check so
      // attached entries can be dragged out of their parents.
      if (!li || !list.contains(li)) return;

      candidate = li;
      dragIndex = parseInt(li.dataset.index, 10);
      if (Number.isNaN(dragIndex)) { candidate = null; return; }
      pointerId = e.pointerId;
      startY = e.clientY;
      // We do NOT call setPointerCapture or add the drag class yet — wait
      // until the user actually moves past the threshold. This preserves
      // normal click-to-select behavior on the existing handler in events.js.
    }

    function onPointerMove(e) {
      if (e.pointerId !== pointerId) return;
      if (!dragging) {
        if (!candidate) return;
        if (Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        activateDrag();
      }
      if (!dragging) return;
      const dy = e.clientY - startY;
      dragging.style.transform = `translateY(${dy}px)`;

      // Hit-test every entry card (root AND nested children). Three
      // possible drop modes per hovered row:
      //   · top edge band  → reorder BEFORE (gap drop)
      //   · bottom edge band → reorder AFTER (gap drop)
      //   · middle of the body → ATTACH source as child of target
      //
      // We test rows in document order; the FIRST row whose rect
      // contains the pointer wins. That keeps a child card under its
      // parent winning over the parent's own body when the user aims
      // at the child (mouse-over precedence).
      const rows = Array.from(list.querySelectorAll('.army-entry'));
      const forbidden = forbiddenAttachTargets(dragging);
      let target = null;
      let pos = null;
      for (const row of rows) {
        if (row === dragging) continue;
        // Skip descendants of the dragging entry — they get visually
        // ripped out when the parent is mid-flight and shouldn't be
        // drop targets.
        if (row.dataset.entryId && forbidden.has(row.dataset.entryId)) continue;
        const r = row.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom) continue;
        if (e.clientY < r.top + GAP_PX)        { target = row; pos = 'before'; break; }
        if (e.clientY > r.bottom - GAP_PX)     { target = row; pos = 'after';  break; }
        target = row; pos = 'attach'; break;
      }

      // Paint the drop indicator. Attach drops also colour by
      // canAttach() result — green for "data confirms compatibility",
      // amber for "data doesn't list this but we'll allow anyway".
      let attachOk = null;
      if (target && pos === 'attach') {
        const army = getArmy();
        const dragEntry   = army && Number.isFinite(dragIndex) ? army.entries[dragIndex] : null;
        const targetEntry = army && target.dataset.entryId
          ? army.findByEntryId(target.dataset.entryId) : null;
        if (window.App && App.Attachments && dragEntry && targetEntry) {
          const verdict = App.Attachments.canAttach(dragEntry.unitData, targetEntry.unitData);
          attachOk = !!(verdict && verdict.ok);
        } else {
          attachOk = false;
        }
      }

      if (target !== lastDropTarget || pos !== lastDropPos || attachOk !== lastAttachOk) {
        clearDropMarkers();
        if (target) {
          if (pos === 'before')      target.classList.add('is-drop-target-before');
          else if (pos === 'after')  target.classList.add('is-drop-target-after');
          else /* attach */ {
            target.classList.add('is-attach-target');
            target.classList.add(attachOk ? 'is-attach-target--ok' : 'is-attach-target--soft');
          }
          lastDropTarget = target;
          lastDropPos = pos;
          lastAttachOk = attachOk;
        }
      }
    }

    function onPointerUp(e) {
      if (e.pointerId !== pointerId) return;
      if (!dragging) {
        // Plain click — not a drag. Let the existing click handler do its job.
        candidate = null;
        pointerId = null;
        return;
      }
      const li = dragging;
      const fromIdx = dragIndex;
      const target = lastDropTarget;
      const pos = lastDropPos;

      try { li.releasePointerCapture(pointerId); } catch (_) {}
      li.style.transform = '';
      li.classList.remove('is-dragging');
      clearDropMarkers();

      // Suppress the synthetic click that follows a drag — otherwise the
      // existing army-entry click handler would re-select the dragged row.
      const suppressClick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        list.removeEventListener('click', suppressClick, true);
      };
      list.addEventListener('click', suppressClick, true);
      // Clean up if no click ever arrives (e.g. drop outside list).
      setTimeout(() => list.removeEventListener('click', suppressClick, true), 350);

      const army = getArmy();
      if (army && Array.isArray(army.entries) && target) {
        const dragEntry   = army.entries[fromIdx];
        const targetEntry = target.dataset.entryId ? army.findByEntryId(target.dataset.entryId) : null;

        if (pos === 'attach' && dragEntry && targetEntry && dragEntry !== targetEntry) {
          // Attach mode: set the parent pointer. We DON'T move the
          // entry in `Army.entries` — array order stays stable so
          // existing legacy index-based handlers (events.js,
          // count input) keep working, and the renderer derives the
          // visual tree from `attachedToEntryId` each frame.
          const verdict = window.App && App.Attachments
            ? App.Attachments.canAttach(dragEntry.unitData, targetEntry.unitData)
            : { ok: false, source: 'unknown' };
          dragEntry.attachedToEntryId = targetEntry.entryId;
          try { army.updatedAt = new Date().toISOString(); } catch (_) {}
          if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(army);
          if (window.UI && typeof UI.toast === 'function') {
            if (verdict.ok) {
              UI.toast(`Attached ${dragEntry.unitName} to ${targetEntry.unitName}.`, 'success', 2200);
            } else {
              UI.toast(`Attached ${dragEntry.unitName} to ${targetEntry.unitName} — BSData doesn't list this as a valid pairing.`, 'warning', 3500);
            }
          }
        } else if ((pos === 'before' || pos === 'after') && dragEntry) {
          // Reorder mode. If the dragged entry was attached to something,
          // drop-in-gap detaches it (moves back to root level). Then
          // splice to the target position as before.
          if (dragEntry.attachedToEntryId) dragEntry.attachedToEntryId = null;
          let toIdx = parseInt(target.dataset.index, 10);
          if (!Number.isNaN(toIdx) && toIdx !== fromIdx) {
            if (pos === 'after') toIdx += 1;
            // Adjust for the removal shift.
            if (toIdx > fromIdx) toIdx -= 1;
            if (toIdx !== fromIdx && toIdx >= 0 && toIdx <= army.entries.length) {
              const [moved] = army.entries.splice(fromIdx, 1);
              army.entries.splice(toIdx, 0, moved);
              try { army.updatedAt = new Date().toISOString(); } catch (_) {}
            }
          }
          if (window.UI && typeof UI.renderArmyList === 'function') UI.renderArmyList(army);
        }
      }

      dragging = null;
      candidate = null;
      dragIndex = -1;
      pointerId = null;
    }

    function onPointerCancel(e) {
      if (e.pointerId !== pointerId) return;
      if (dragging) {
        try { dragging.releasePointerCapture(pointerId); } catch (_) {}
        dragging.style.transform = '';
        dragging.classList.remove('is-dragging');
      }
      clearDropMarkers();
      dragging = null;
      candidate = null;
      dragIndex = -1;
      pointerId = null;
    }

    list.addEventListener('pointerdown',   onPointerDown);
    list.addEventListener('pointermove',   onPointerMove);
    list.addEventListener('pointerup',     onPointerUp);
    list.addEventListener('pointercancel', onPointerCancel);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap.
  //
  // The army-list <ul> exists in the static HTML, so we don't need to wait
  // for App.hooks. We do still re-try once if it's not yet in the DOM.
  // ---------------------------------------------------------------------------
  function init() {
    wireArmyListObserver();
    wireDragReorder();
    if (!getArmyList()) {
      // Static markup should always include #army-entry-list, but be defensive.
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (getArmyList()) {
          wireArmyListObserver();
          wireDragReorder();
          clearInterval(iv);
        } else if (tries > 50) {
          clearInterval(iv);
        }
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
