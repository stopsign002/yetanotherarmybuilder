// app/mobile-shell.js — mobile-only chrome: sticky points pill at top of
// Army panel (and a copy beside the Units view toggle), dynamic page-title in topbar, back-arrow in Detail panel
// header. Pure additive — desktop is untouched.
//
// Activation: only injects DOM when window.matchMedia('(max-width: 820px)')
// matches at boot. Re-evaluates on resize so DevTools / orientation changes
// keep working. No new persistence keys.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MOBILE_QUERY = '(max-width: 820px)';
  function isMobile() {
    try { return window.matchMedia && window.matchMedia(MOBILE_QUERY).matches; }
    catch (_) { return false; }
  }

  const PILL_HTML =
    '<span class="mobile-pts-pill-faction" data-role="faction">No faction</span>' +
    '<span class="mobile-pts-pill-spacer"></span>' +
    '<span class="mobile-pts-pill-bar"><span class="mobile-pts-pill-bar-fill" data-role="bar"></span></span>' +
    '<span class="mobile-pts-pill-value" data-role="value">0 / 2000</span>';

  // ── 1. Sticky points pill in Army panel ──────────────────────────────
  // Mounts at top of #panel-left .panel-body. Reads state.currentArmy on
  // every armyChange and reflects faction + current/limit + bar.
  function ensurePtsPill() {
    const body = document.querySelector('#panel-left .panel-body');
    if (!body) return null;
    let pill = body.querySelector('.mobile-pts-pill');
    if (pill) return pill;
    pill = document.createElement('div');
    pill.className = 'mobile-pts-pill';
    pill.innerHTML = PILL_HTML;
    body.insertBefore(pill, body.firstChild);
    return pill;
  }

  // Second copy of the pill in the Units panel, on the blank right half of
  // the view-toggle row, so the points left are visible while browsing
  // units. Same markup and the same update as the Army one (owner request
  // 2026-10-31). The toggle is built lazily by reserves.js on first roster
  // render, so this is attempted on every update and once more when the
  // panel mutates; it wraps the toggle and the pill in one flex row and
  // unwraps again on desktop.
  function ensureUnitsPill() {
    const toggle = document.getElementById('reserves-view-toggle');
    if (!toggle) return null;
    let head = toggle.closest('.mobile-units-head');
    if (head) return head.querySelector('.mobile-pts-pill');
    head = document.createElement('div');
    head.className = 'mobile-units-head';
    toggle.parentNode.insertBefore(head, toggle);
    head.appendChild(toggle);
    const pill = document.createElement('div');
    pill.className = 'mobile-pts-pill mobile-pts-pill-units';
    pill.innerHTML = PILL_HTML;
    head.appendChild(pill);
    return pill;
  }

  function removePtsPill() {
    document.querySelectorAll('.mobile-pts-pill').forEach(pill => {
      if (pill.parentNode) pill.parentNode.removeChild(pill);
    });
    document.querySelectorAll('.mobile-units-head').forEach(head => {
      const toggle = head.querySelector('#reserves-view-toggle');
      if (toggle) head.parentNode.insertBefore(toggle, head);
      head.remove();
    });
  }

  function updatePtsPill() {
    if (!isMobile()) return;
    ensurePtsPill();
    ensureUnitsPill();
    const pills = document.querySelectorAll('.mobile-pts-pill');
    if (!pills.length) return;
    const army = App.state && App.state.currentArmy;
    let factionLabel = 'No faction';
    let pts = 0;
    let limit = 0;
    try {
      if (army) {
        // Army's API is `getTotalPoints()`, not `totalPoints()`. The
        // older name check left this function falling through to a
        // non-existent `army.pts` field, so the mobile pill always
        // displayed 0 / <limit> regardless of what was in the army.
        if (typeof army.getTotalPoints === 'function')      pts = army.getTotalPoints();
        else if (typeof army.totalPoints === 'function')    pts = army.totalPoints();
        else                                                pts = army.pts || 0;
        limit = army.pointsLimit || 0;
      }
      const sel = App.state && App.state.factionFilter;
      if (sel && sel !== 'all') {
        factionLabel = UI.factionShort(sel);
      }
    } catch (_) {}

    pills.forEach(pill => {
      const factionEl = pill.querySelector('[data-role="faction"]');
      const valueEl   = pill.querySelector('[data-role="value"]');
      const barEl     = pill.querySelector('[data-role="bar"]');
      // The Units copy has no room for a faction name on a phone (it
      // truncated to "DEATH …"); it shows the points left instead, which is
      // what that copy exists for.
      if (factionEl) {
        factionEl.textContent = !pill.classList.contains('mobile-pts-pill-units') ? factionLabel
          : limit <= 0 ? '' : pts > limit ? (pts - limit) + ' over' : (limit - pts) + ' left';
        factionEl.classList.toggle('over', pill.classList.contains('mobile-pts-pill-units') && limit > 0 && pts > limit);
      }
      if (valueEl) {
        valueEl.textContent = pts + ' / ' + (limit || '—');
        valueEl.classList.toggle('over', limit > 0 && pts > limit);
      }
      if (barEl) {
        const pct = limit > 0 ? Math.min(120, Math.round((pts / limit) * 100)) : 0;
        barEl.style.width = Math.min(100, pct) + '%';
        barEl.classList.toggle('over', limit > 0 && pts > limit);
        barEl.classList.toggle('near', limit > 0 && pts > limit * 0.85 && pts <= limit);
      }
    });
  }

  // The Units pill needs #reserves-view-toggle, which may appear after the
  // first armyChange; watch the centre panel until it does.
  function watchForToggle() {
    if (document.getElementById('reserves-view-toggle')) { updatePtsPill(); return; }
    const center = document.getElementById('panel-center');
    if (!center) return;
    const obs = new MutationObserver(() => {
      if (!document.getElementById('reserves-view-toggle')) return;
      obs.disconnect();
      updatePtsPill();
    });
    obs.observe(center, { childList: true, subtree: true });
  }

  // ── 2. Init + listeners ──────────────────────────────────────────────
  // Back-arrow is no longer injected — the bottom tab bar is the sole
  // navigation surface, so users return to Units by tapping the tab.
  function rebuild() {
    if (isMobile()) {
      ensurePtsPill();
      updatePtsPill();
      watchForToggle();
    } else {
      removePtsPill();
    }
  }

  App.hooks.bootstrap.push(function () {
    rebuild();
  });

  // armyChange → refresh pts pill (faction may have changed via load).
  if (App.hooks.armyChange && Array.isArray(App.hooks.armyChange)) {
    App.hooks.armyChange.push(updatePtsPill);
  }

  // selectionChange → refresh pts pill faction line.
  if (App.hooks.selectionChange && Array.isArray(App.hooks.selectionChange)) {
    App.hooks.selectionChange.push(updatePtsPill);
  }

  // Resize / orientation: rebuild as we cross the 820px threshold.
  if (window.matchMedia) {
    try {
      window.matchMedia(MOBILE_QUERY).addEventListener('change', rebuild);
    } catch (_) {
      // Older Safari: fallback to resize.
      window.addEventListener('resize', rebuild);
    }
  }
})();
