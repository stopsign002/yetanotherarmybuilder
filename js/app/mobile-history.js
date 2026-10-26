// app/mobile-history.js — makes the hardware/browser Back button behave on
// mobile: one press closes exactly one thing, and nothing the user already
// dismissed can come back.
//
// ── Why this was rewritten ────────────────────────────────────────────────
// The previous version monkey-patched App.setMobilePanel and App.settingsDrawer
// from the outside. That could never balance its own history entries:
//
//   * It pushed an entry on EVERY entry into the Details panel, but the tab bar
//     leaves Details by calling pwa-install's module-local setPanel(), which the
//     wrapper can't see. Browsing N units left N stacked entries and N-1 back
//     presses that did nothing at all, then a sudden exit from the site.
//   * It pushed an entry when the More drawer opened, but the scrim, the X, the
//     Escape key and every action row call settings-drawer's IIFE-local close(),
//     which a wrapper on the exported App.settingsDrawer.close structurally
//     cannot observe. So the entry leaked — and because popstate re-opened the
//     drawer on the way back, Back acted as *redo* on a sheet the user had
//     already dismissed.
//
// The fix inverts the direction. Surfaces announce themselves; nothing is
// patched. A surface calls App.backTrap.opened(id, closeFn) when it opens and
// App.backTrap.closed(id) when it closes by any means. We keep one history
// entry per live trap, so the stack always mirrors what is actually on screen.
//
// ── Contract for callers ──────────────────────────────────────────────────
//   App.backTrap.opened(id, closeFn)  — an overlay opened. Pushes one entry.
//                                       Re-calling with a live id is a no-op,
//                                       so entries can never stack up.
//   App.backTrap.closed(id)           — it closed by its own means. Consumes the
//                                       entry (and any above it) so Back never
//                                       replays it.
//   App.backTrap.isTrapped(id)        — is this surface currently back-trapped?
//
// closeFn must be idempotent: we call it when Back pops past the trap, and the
// surface will typically call closed(id) from inside its own close path. The
// trap is removed from the stack BEFORE closeFn runs, so that re-entrant
// closed() call is a cheap no-op rather than a loop.
//
// Pushes are gated on mobile (the desktop three-pane layout has no panel
// switching and keeps its dropdown/Escape affordances). popstate is NOT gated —
// entries pushed at phone width must still unwind correctly if the user rotates
// or resizes past the breakpoint, which the old media-query-free reconciler got
// wrong in the other direction.
//
// ── closed() then opened() in the same tick (#73, #106) ───────────────────
// history.go() is ASYNC: the traversal runs on a later task and only then
// fires popstate. history.pushState() is SYNC. So a surface that closes one
// trap and opens another in the same call — the Settings drawer handing off
// to a mode, or mode-shell switching Collect → Play — used to push the new
// entry BEFORE the queued go(-1) ran. The traversal then rewound relative to
// the advanced position, leaving the document behind an orphaned forward
// entry, and the NEXT closed() went one entry past the yaab document: on a
// phone, Collect → Play → Build reloaded the page (#106). #73 fixed one
// caller by waiting for the popstate; this fixes it for every caller.
// opened() during an in-flight traversal records the trap at once (so
// isTrapped() and nested closed() see it) but defers its pushState until the
// popstate that traversal causes, which serialises the two history writes.
(function () {
  const App = window.App = window.App || {};

  const MQ = '(max-width: 820px)';
  function isMobile() {
    try { return window.matchMedia && window.matchMedia(MQ).matches; }
    catch (_) { return false; }
  }

  // Live traps, innermost last. Exactly one pushed history entry each.
  const traps = [];
  let seq = 0;
  // popstate events we caused ourselves via history.go() and must not act on.
  // A multi-step traversal fires popstate once, so this counts go() calls.
  let swallow = 0;

  function indexOf(id) {
    for (let i = 0; i < traps.length; i++) if (traps[i].id === id) return i;
    return -1;
  }

  function opened(id, closeFn) {
    if (!id || typeof closeFn !== 'function') return;
    if (!isMobile()) return;
    if (indexOf(id) !== -1) return;   // already trapped — never stack duplicates
    const key = 'yaab:' + (++seq);
    const trap = { id: id, key: key, close: closeFn, pushed: false };
    traps.push(trap);
    // A go() from a closed() earlier in this task has not been processed yet
    // — pushing now would land ahead of it (see the header). Defer the push
    // to the popstate that traversal fires; flushPending() does it.
    if (swallow > 0) return;
    push(trap);
  }

  function push(trap) {
    try {
      history.pushState({ yaab: trap.key }, '');
      trap.pushed = true;
    } catch (_) {
      const i = traps.indexOf(trap);  // history unavailable — stay consistent
      if (i !== -1) traps.splice(i, 1);
    }
  }

  function flushPending() {
    for (let i = 0; i < traps.length; i++) {
      if (!traps[i].pushed) push(traps[i]);
    }
  }

  function closed(id) {
    const i = indexOf(id);
    if (i === -1) return;
    // Drop this trap and anything nested above it, then rewind the same number
    // of entries. Splice FIRST so the popstate we're about to cause — and any
    // re-entrant closed() from a nested surface — sees the updated stack.
    // Only traps that actually reached history count towards the rewind — a
    // trap still waiting on a traversal (see the header) has no entry yet.
    let count = 0;
    for (let j = i; j < traps.length; j++) if (traps[j].pushed) count++;
    traps.length = i;
    if (!count) return;
    swallow++;
    try {
      history.go(-count);
    } catch (_) {
      swallow--;
    }
  }

  function isTrapped(id) { return indexOf(id) !== -1; }

  App.backTrap = { opened: opened, closed: closed, isTrapped: isTrapped };

  // ── popstate ────────────────────────────────────────────────────────────
  // Close everything above the entry we landed on, innermost first. One press
  // closes one surface; a press with nothing trapped falls through to the
  // browser and leaves the site, which is the correct exit.
  window.addEventListener('popstate', function (e) {
    if (swallow > 0) {
      swallow--;
      // The traversal we were waiting on has landed; anything opened while it
      // was in flight can take its history entry now, in order.
      if (swallow === 0) flushPending();
      return;
    }
    if (!traps.length) return;        // nothing of ours is live — not our event

    const key = e && e.state && e.state.yaab;
    let landed = -1;
    if (key) {
      for (let i = 0; i < traps.length; i++) {
        if (traps[i].key === key) { landed = i; break; }
      }
    }
    const orphaned = traps.splice(landed + 1);
    for (let i = orphaned.length - 1; i >= 0; i--) {
      try { orphaned[i].close(); } catch (_) {}
    }
  });

  // ── the mobile Details panel ────────────────────────────────────────────
  // pwa-install's setPanel() already announces every switch — including the tab
  // bar's own calls, which is exactly the path the old wrapper missed. Details
  // is a singleton trap: entering it once traps it, leaving by ANY route
  // releases it, so browsing units can't accumulate dead entries.
  const PANEL_TRAP = 'panel:detail';
  document.addEventListener('yaab:mobile-panel-change', function (e) {
    const panel = e && e.detail && e.detail.panel;
    if (panel === 'detail') {
      opened(PANEL_TRAP, function () {
        if (typeof App.setMobilePanel === 'function') App.setMobilePanel('units');
      });
    } else {
      closed(PANEL_TRAP);
    }
  });
})();
