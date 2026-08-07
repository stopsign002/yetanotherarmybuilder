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
  // Drag-to-reorder / drag-to-attach. Pointer-based, no external deps.
  // We mutate state.currentArmy.entries and call UI.renderArmyList on drop.
  //
  // Mouse, touch and pen all share one code path (Pointer Events). The only
  // real branch is HOW the drag arms: a mouse can afford a 6 px move
  // threshold because the pointer has no competing job, whereas on touch the
  // vertical axis belongs to the scroller — so touch arms on a long press.
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

    const DRAG_THRESHOLD_PX = 6; // MOUSE: must move this far before drag activates
    // The vertical band on each side of an entry that registers as a
    // BETWEEN-SIBLINGS gap drop instead of an ATTACH-ONTO-BODY drop.
    // Top GAP_PX and bottom GAP_PX = reorder. Middle = attach. Tuned by
    // eye against the entry-card height in build-mode.css; 14 px reads
    // as "near the edge" on a ~64 px card.
    const GAP_PX = 14;

    // TOUCH/PEN tunables.
    //   LONG_PRESS_MS   — long enough that a flick-to-scroll never trips it,
    //                     short enough that a deliberate press doesn't feel
    //                     broken. 320 ms sits between iOS's ~500 ms callout
    //                     and Android's ~300 ms, which is the window most
    //                     touch sortables land in.
    //   LONG_PRESS_SLOP — a finger is never perfectly still. Move further
    //                     than this before the timer fires and we read the
    //                     gesture as a scroll and get out of the way.
    //   EDGE_SCROLL_*   — auto-scroll band at the top/bottom of the scroll
    //                     container, and the per-frame speed cap at the very
    //                     edge. Without this a long army list is undraggable
    //                     on a phone: the finger runs out of screen.
    const LONG_PRESS_MS       = 320;
    const LONG_PRESS_SLOP_PX  = 10;
    const EDGE_SCROLL_PX      = 64;
    const EDGE_SCROLL_MAX_PX  = 16;

    let candidate = null;      // <li> the user pressed on (drag not yet active)
    let dragging = null;       // <li> actively being dragged
    let dragIndex = -1;
    let pointerId = null;
    let pointerKind = 'mouse'; // e.pointerType of the active gesture
    let startX = 0;
    let startY = 0;
    let lastClientY = 0;       // latest finger/cursor Y — the auto-scroll loop reads it
    let pressTimer = null;     // long-press arming timer (touch/pen only)
    let scroller = null;       // scroll container the list lives in
    let startScrollTop = 0;
    let autoScrollRaf = 0;
    let armedY = 0;            // clientY at the moment the drag armed
    let dragMoved = false;     // has the pointer moved since arming?
    let prevTouchAction = '';  // dragged element's inline touch-action, restored on drop
    let prevUserSelect = '';   // body's inline user-select, restored on drop
    let lastDropTarget = null;
    let lastDropPos = null;    // 'before' | 'after' | 'attach'
    let lastAttachOk = null;   // last canAttach result (drives green/amber)

    // Touch and pen need the long-press treatment; mouse does not. Anything
    // we can't identify is treated as a mouse (that's the legacy behaviour).
    function isTouchLike(kind) { return kind === 'touch' || kind === 'pen'; }

    function buzz(ms) {
      // Haptic confirmation that the drag armed. Unsupported on desktop and
      // on iOS Safari — the transform lift below is the visual counterpart
      // so the feedback never depends on it.
      try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {}
    }

    // Nearest scrollable ancestor. `.panel-body` is `overflow-y: auto` on both
    // desktop and mobile, but resolve it at drag time rather than hard-coding
    // a selector — expand-pane and cards-mode reparent things.
    function findScroller(el) {
      let n = el && el.parentElement;
      while (n && n !== document.body && n !== document.documentElement) {
        let oy = '';
        try { oy = window.getComputedStyle(n).overflowY; } catch (_) {}
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
        n = n.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    // Viewport-space top/bottom of the scroll container, so the auto-scroll
    // band can be compared against a raw clientY.
    function scrollerBand(sc) {
      if (!sc || sc === document.scrollingElement || sc === document.documentElement || sc === document.body) {
        return { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight };
      }
      const r = sc.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }

    function cancelLongPress() {
      if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    }

    // Give up on a press that turned out to be a scroll. We deliberately drop
    // pointerId too, so the rest of the gesture is ignored wholesale and the
    // browser is left to pan in peace.
    function abandonCandidate() {
      cancelLongPress();
      candidate = null;
      dragIndex = -1;
      pointerId = null;
    }

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
      cancelLongPress();
      dragging = candidate;
      dragging.classList.add('is-dragging');
      try { dragging.setPointerCapture(pointerId); } catch (_) {}

      // `.army-entry` carries `transition: transform 0.16s` (card-chassis.css)
      // so the row would trail the pointer by a frame or six. Kill it for the
      // duration of the drag — this is a render detail, not a behaviour
      // change, and on touch a card that lags the finger reads as broken.
      dragging.style.transition = 'none';

      scroller = findScroller(list);
      startScrollTop = scroller ? scroller.scrollTop : 0;
      armedY = lastClientY;
      dragMoved = false;

      if (isTouchLike(pointerKind)) {
        // From here on the gesture is ours. `touch-action` is latched by the
        // browser when the gesture STARTS, so setting it now does not retake
        // the current one — the non-passive `touchmove` handler below is what
        // actually stops the pane scrolling. Set it anyway so a re-press on
        // the lifted card can't hand the axis back mid-drag.
        prevTouchAction = dragging.style.touchAction;
        dragging.style.touchAction = 'none';
        // A long press with the finger down would otherwise start a text
        // selection / callout on the row underneath.
        prevUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        buzz(10);
        // Confirm the arm BEFORE the finger moves — a long press that looks
        // like nothing happened is indistinguishable from a dead feature.
        applyDragTransform(0);
        startAutoScroll();
      }
    }

    // The lift. Touch gets an extra scale so the armed state is visible
    // without a cursor or a hover to lean on; mouse keeps the plain
    // translate it has always had.
    function applyDragTransform(dy) {
      if (!dragging) return;
      dragging.style.transform = isTouchLike(pointerKind)
        ? `translateY(${dy}px) scale(1.03)`
        : `translateY(${dy}px)`;
    }

    // One place that turns "the pointer is at clientY" into a rendered frame,
    // shared by pointermove and the auto-scroll loop. The scroll delta keeps
    // the row under the pointer while the container moves beneath it.
    function updateDrag(clientY) {
      if (!dragging) return;
      const scrolled = scroller ? scroller.scrollTop - startScrollTop : 0;
      applyDragTransform(clientY - startY + scrolled);
      paintDropTarget(clientY);
    }

    function startAutoScroll() {
      if (autoScrollRaf) return;
      const step = () => {
        autoScrollRaf = 0;
        if (!dragging) return;
        // A long press that arms within the edge band (top or bottom row of a
        // short pane) must not immediately run away from the finger. Wait for
        // a deliberate move first.
        if (!dragMoved && Math.abs(lastClientY - armedY) > 4) dragMoved = true;
        if (scroller && dragMoved) {
          const band = scrollerBand(scroller);
          let dy = 0;
          if (lastClientY < band.top + EDGE_SCROLL_PX) {
            dy = -EDGE_SCROLL_MAX_PX * Math.min(1, (band.top + EDGE_SCROLL_PX - lastClientY) / EDGE_SCROLL_PX);
          } else if (lastClientY > band.bottom - EDGE_SCROLL_PX) {
            dy = EDGE_SCROLL_MAX_PX * Math.min(1, (lastClientY - (band.bottom - EDGE_SCROLL_PX)) / EDGE_SCROLL_PX);
          }
          if (dy) {
            // Always move at least a pixel — a sub-pixel ramp that rounds to
            // zero would stall the scroll right at the edge of the band.
            const stepPx = dy > 0 ? Math.max(1, Math.round(dy)) : Math.min(-1, Math.round(dy));
            const before = scroller.scrollTop;
            scroller.scrollTop = before + stepPx;
            // Only re-render if we actually moved (we're at the end otherwise).
            if (scroller.scrollTop !== before) updateDrag(lastClientY);
          }
        }
        autoScrollRaf = requestAnimationFrame(step);
      };
      autoScrollRaf = requestAnimationFrame(step);
    }

    function stopAutoScroll() {
      if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = 0; }
    }

    // Undo everything activateDrag() put on the DOM. Split out because both
    // the normal drop and the pointercancel path need it, and a half-restored
    // element (stuck at `touch-action: none`, or still translated) is a much
    // worse bug than a failed drag.
    function releaseDragChrome(li) {
      stopAutoScroll();
      cancelLongPress();
      if (li) {
        try { li.releasePointerCapture(pointerId); } catch (_) {}
        li.style.transform = '';
        li.style.transition = '';
        li.style.touchAction = prevTouchAction || '';
        li.classList.remove('is-dragging');
      }
      document.body.style.userSelect = prevUserSelect || '';
      document.body.style.webkitUserSelect = '';
      prevTouchAction = '';
      prevUserSelect = '';
      scroller = null;
      startScrollTop = 0;
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
      pointerKind = e.pointerType || 'mouse';
      startX = e.clientX;
      startY = e.clientY;
      lastClientY = e.clientY;
      cancelLongPress();
      // We do NOT call setPointerCapture or add the drag class yet — wait
      // until the user actually moves past the threshold (mouse) or holds
      // still long enough (touch). This preserves normal click-to-select
      // behavior on the existing handler in events.js.
      if (isTouchLike(pointerKind)) {
        // The grip is an unambiguous "I mean to drag this" target, so it arms
        // straight away — no wait. Everything else has to earn it with a long
        // press, otherwise the finger's vertical axis is the scroller's.
        // (The grip is hidden on attached child rows, so those always take
        // the long-press path.)
        if (t.closest('.army-entry-handle')) activateDrag();
        else pressTimer = setTimeout(() => { pressTimer = null; activateDrag(); }, LONG_PRESS_MS);
      }
    }

    function onPointerMove(e) {
      if (e.pointerId !== pointerId) return;
      lastClientY = e.clientY;
      if (!dragging) {
        if (!candidate) return;
        if (isTouchLike(pointerKind)) {
          // Still waiting on the long press. Any real movement means the user
          // is scrolling, so bail out and leave the gesture to the browser.
          const moved = Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY));
          if (moved > LONG_PRESS_SLOP_PX) abandonCandidate();
          return;
        }
        if (Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        activateDrag();
      }
      if (!dragging) return;
      updateDrag(e.clientY);
    }

    // Hit-test + drop-indicator paint for a given pointer Y. Called on every
    // move and on every auto-scroll frame (the finger can sit still while the
    // list slides past under it).
    function paintDropTarget(clientY) {
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
        if (clientY < r.top || clientY > r.bottom) continue;
        if (clientY < r.top + GAP_PX)          { target = row; pos = 'before'; break; }
        if (clientY > r.bottom - GAP_PX)       { target = row; pos = 'after';  break; }
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
        // Plain tap/click — not a drag. The long press never fired (or never
        // got the chance). Let the existing click handler do its job.
        cancelLongPress();
        candidate = null;
        pointerId = null;
        return;
      }
      const li = dragging;
      const fromIdx = dragIndex;
      const target = lastDropTarget;
      const pos = lastDropPos;

      releaseDragChrome(li);
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

    // The OS can take the gesture off us at any moment — an incoming call, a
    // system edge-swipe, a second finger landing. Reset everything.
    function onPointerCancel(e) {
      if (e.pointerId !== pointerId) return;
      releaseDragChrome(dragging);
      clearDropMarkers();
      dragging = null;
      candidate = null;
      dragIndex = -1;
      pointerId = null;
    }

    // Non-passive ON PURPOSE, and registered here at wire time rather than
    // when the drag arms. Two reasons:
    //   1. `touch-action` is latched when a gesture begins, so flipping it
    //      after the long press fires does nothing for the gesture in hand —
    //      preventDefault() here is what actually keeps the pane from
    //      scrolling out from under the dragged row.
    //   2. Chrome decides whether touchmove is cancelable based on the
    //      listeners present when the touch STARTS. A handler added later
    //      would arrive to a stream of already-uncancelable events.
    // It is scoped to the army list, so the rest of the page keeps its
    // compositor-thread scrolling.
    function onTouchMove(e) {
      if (!dragging || !isTouchLike(pointerKind)) return;
      if (e.cancelable) e.preventDefault();
    }

    // A long press also asks Android/iOS for the selection callout. Suppress
    // it whenever our own long press owns (or is about to own) the gesture.
    function onContextMenu(e) {
      if (dragging || pressTimer !== null) e.preventDefault();
    }

    list.addEventListener('pointerdown',   onPointerDown);
    list.addEventListener('pointermove',   onPointerMove);
    list.addEventListener('pointerup',     onPointerUp);
    list.addEventListener('pointercancel', onPointerCancel);
    list.addEventListener('touchmove',     onTouchMove, { passive: false });
    list.addEventListener('contextmenu',   onContextMenu);
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
