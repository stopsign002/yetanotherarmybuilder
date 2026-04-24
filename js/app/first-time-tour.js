// app/first-time-tour.js — one-shot 3-step guided tour for first-time visitors.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const SEEN_KEY = 'yaab_tour_seen';

  function isMac() {
    try {
      const uad = navigator.userAgentData;
      if (uad && uad.platform) return /mac/i.test(uad.platform);
    } catch (_) {}
    return /mac|iphone|ipad|ipod/i.test(
      (navigator.platform || '') + ' ' + (navigator.userAgent || '')
    );
  }
  const SHORTCUT_LABEL = isMac() ? '⌘K' : 'Ctrl K';

  const STEPS = [
    {
      target: '#panel-left',
      title:  'Your army',
      body:   'This is your army. Add units, set a points limit, save and share lists.',
      side:   'right',
    },
    {
      target: '#panel-center',
      title:  'Browse units',
      body:   'Browse units here. Use ' + SHORTCUT_LABEL + ' to find anything fast.',
      side:   'right',
    },
    {
      target: '#panel-right',
      title:  'Unit details',
      body:   'Click any unit to see its full datasheet, stats, and abilities.',
      side:   'left',
    },
  ];

  let backdrop  = null;
  let tooltip   = null;
  let highlight = null;
  let stepIdx   = 0;
  let active    = false;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildDom() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'yaab-tour-backdrop';
    backdrop.setAttribute('hidden', '');
    backdrop.innerHTML =
      '<div class="yaab-tour-highlight" id="yaab-tour-highlight" aria-hidden="true"></div>' +
      '<div class="yaab-tour-tooltip" id="yaab-tour-tooltip" role="dialog" aria-modal="true" aria-labelledby="yaab-tour-title">' +
        '<div class="yaab-tour-step" id="yaab-tour-step"></div>' +
        '<div class="yaab-tour-title" id="yaab-tour-title"></div>' +
        '<div class="yaab-tour-body" id="yaab-tour-body"></div>' +
        '<div class="yaab-tour-actions">' +
          '<button type="button" class="yaab-tour-btn yaab-tour-skip" id="yaab-tour-skip">Skip</button>' +
          '<button type="button" class="yaab-tour-btn yaab-tour-next" id="yaab-tour-next">Next</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    highlight = backdrop.querySelector('#yaab-tour-highlight');
    tooltip   = backdrop.querySelector('#yaab-tour-tooltip');

    backdrop.querySelector('#yaab-tour-skip').addEventListener('click', endTour);
    backdrop.querySelector('#yaab-tour-next').addEventListener('click', nextStep);
    backdrop.addEventListener('click', e => {
      // Click on the dimmed backdrop (not the tooltip/highlight) skips.
      if (e.target === backdrop) endTour();
    });
  }

  function positionFor(step) {
    const targetEl = document.querySelector(step.target);
    if (!targetEl || !tooltip || !highlight) return;
    const rect = targetEl.getBoundingClientRect();

    // Highlight cutout — sit on top of the target.
    highlight.style.left   = rect.left   + 'px';
    highlight.style.top    = rect.top    + 'px';
    highlight.style.width  = rect.width  + 'px';
    highlight.style.height = rect.height + 'px';

    // Tooltip placement. Measure tooltip after content is set so we can clamp.
    const tipRect = tooltip.getBoundingClientRect();
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left, top;
    if (step.side === 'right') {
      left = rect.right + margin;
      top  = rect.top + Math.max(0, (rect.height - tipRect.height) / 2);
      // If tooltip would overflow the right edge, fall back to inside-target.
      if (left + tipRect.width + margin > vw) {
        left = clamp(rect.left + margin, margin, vw - tipRect.width - margin);
      }
    } else if (step.side === 'left') {
      left = rect.left - tipRect.width - margin;
      top  = rect.top + Math.max(0, (rect.height - tipRect.height) / 2);
      if (left < margin) {
        left = clamp(rect.right - tipRect.width - margin, margin, vw - tipRect.width - margin);
      }
    } else {
      left = rect.left + Math.max(0, (rect.width - tipRect.width) / 2);
      top  = rect.bottom + margin;
    }

    left = clamp(left, margin, vw - tipRect.width  - margin);
    top  = clamp(top,  margin, vh - tipRect.height - margin);

    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  function renderStep() {
    const step = STEPS[stepIdx];
    if (!step) return endTour();
    buildDom();
    backdrop.removeAttribute('hidden');

    const stepEl = backdrop.querySelector('#yaab-tour-step');
    const titleEl = backdrop.querySelector('#yaab-tour-title');
    const bodyEl  = backdrop.querySelector('#yaab-tour-body');
    const nextBtn = backdrop.querySelector('#yaab-tour-next');

    stepEl.textContent  = 'Step ' + (stepIdx + 1) + ' of ' + STEPS.length;
    titleEl.textContent = step.title;
    bodyEl.textContent  = step.body;
    nextBtn.textContent = (stepIdx === STEPS.length - 1) ? 'Got it' : 'Next';

    // Wait a frame so the tooltip's measured rect is current before positioning.
    requestAnimationFrame(() => positionFor(step));
  }

  function nextStep() {
    if (stepIdx < STEPS.length - 1) {
      stepIdx++;
      renderStep();
    } else {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) {}
      endTour();
    }
  }

  function endTour() {
    if (!active) return;
    active = false;
    if (backdrop) backdrop.setAttribute('hidden', '');
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onResize() {
    if (!active) return;
    const step = STEPS[stepIdx];
    if (step) positionFor(step);
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      endTour();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      nextStep();
    }
  }

  function startTour() {
    if (active) return;
    active = true;
    stepIdx = 0;
    buildDom();
    renderStep();
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function replayTour() {
    try { localStorage.removeItem(SEEN_KEY); } catch (_) {}
    startTour();
  }

  function alreadySeen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; }
    catch (_) { return true; } // treat storage failure as "don't bug them"
  }

  function factionsLoaded(state) {
    return state && Array.isArray(state.factions) && state.factions.length > 0;
  }

  // ── Trigger ───────────────────────────────────────────────────
  let waitingForFactions = false;

  App.hooks.bootstrap.push(function (state) {
    if (alreadySeen()) return;
    if (factionsLoaded(state)) {
      // Defer to next paint so layout has settled.
      requestAnimationFrame(() => requestAnimationFrame(startTour));
    } else {
      waitingForFactions = true;
    }
  });

  App.hooks.armyChange.push(function () {
    if (!waitingForFactions) return;
    if (alreadySeen()) { waitingForFactions = false; return; }
    if (factionsLoaded(App.state)) {
      waitingForFactions = false;
      requestAnimationFrame(() => requestAnimationFrame(startTour));
    }
  });

  // Replay entry-point in the Tools menu.
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-replay-tour',
    region: 'tools-menu',
    label: 'Replay Tour',
    title: 'Show the first-time walkthrough again',
    category: 'other',
    onClick: replayTour,
  });

  // Public API — useful for "Show tour" entries elsewhere.
  App.replayTour = replayTour;
  App.startTour  = startTour;
})();
