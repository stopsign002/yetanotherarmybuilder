// ui/cold-start.js — first-visit splash overlay + cold/warm-start detection while BSData loads.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks || !App.hooks.bootstrap) return;

  // ── Tunables ──────────────────────────────────────────────────────────
  const EXPECTED_TOTAL    = 32;     // approximate catalogue count for percentage
  const POLL_INTERVAL_MS  = 250;
  const SKIP_DELAY_MS     = 4000;
  const FAILURE_TIMEOUT_MS = 60000;
  const RECENT_MAX        = 5;
  const FADE_DURATION_MS  = 1000;

  // ── Markup ────────────────────────────────────────────────────────────
  const CREST_SVG =
    '<svg class="cold-start-crest" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M50 6 L86 26 L86 74 L50 94 L14 74 L14 26 Z" stroke-opacity="0.85"/>' +
        '<path d="M50 22 L72 35 L72 65 L50 78 L28 65 L28 35 Z" stroke-opacity="0.45"/>' +
        '<g class="cold-start-crest-rotor" stroke-opacity="0.75">' +
          '<line x1="50" y1="14" x2="50" y2="22"/>' +
          '<line x1="80" y1="32" x2="73" y2="36"/>' +
          '<line x1="80" y1="68" x2="73" y2="64"/>' +
          '<line x1="50" y1="86" x2="50" y2="78"/>' +
          '<line x1="20" y1="68" x2="27" y2="64"/>' +
          '<line x1="20" y1="32" x2="27" y2="36"/>' +
        '</g>' +
        '<g class="cold-start-crest-pulse">' +
          '<path d="M38 56 L50 44 L62 56" stroke-opacity="0.95"/>' +
          '<circle cx="50" cy="62" r="2.4" fill="currentColor" stroke="none"/>' +
        '</g>' +
      '</g>' +
    '</svg>';

  function buildSplash() {
    const root = document.createElement('div');
    root.className = 'cold-start-root';
    root.id = 'cold-start-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'cold-start-title');

    root.innerHTML =
      '<div class="cold-start-inner">' +
        CREST_SVG +
        '<h1 class="cold-start-title" id="cold-start-title">Yet Another Army Builder</h1>' +
        '<p class="cold-start-tagline">Forging your dataslate. Stand by.</p>' +
        '<div class="cold-start-progress" role="status" aria-live="polite">' +
          '<div class="cold-start-bar-track" aria-hidden="true">' +
            '<div class="cold-start-bar-fill" id="cold-start-bar"></div>' +
          '</div>' +
          '<div class="cold-start-status">' +
            '<span class="cold-start-status-name" id="cold-start-status-name">Reaching BSData</span>' +
            '<span class="cold-start-status-count" id="cold-start-status-count">0 / ' + EXPECTED_TOTAL + '</span>' +
          '</div>' +
        '</div>' +
        '<ul class="cold-start-recent" id="cold-start-recent" aria-hidden="true"></ul>' +
        '<button type="button" class="cold-start-skip" id="cold-start-skip">' +
          'Skip — load with what we have so far' +
        '</button>' +
        '<div class="cold-start-error" id="cold-start-error" role="alert">' +
          '<h2 class="cold-start-error-title">Could not reach BSData.</h2>' +
          '<ul class="cold-start-error-list">' +
            '<li>Your network may be offline.</li>' +
            '<li>GitHub may be rate-limited (try again in 15 minutes).</li>' +
            '<li>Try refreshing or check your connection.</li>' +
          '</ul>' +
          '<div class="cold-start-error-actions">' +
            '<button type="button" class="cold-start-btn-retry" id="cold-start-btn-retry">Retry</button>' +
            '<button type="button" class="cold-start-btn-offline" id="cold-start-btn-offline">Continue offline</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    return root;
  }

  // ── Controller ────────────────────────────────────────────────────────
  function start() {
    const root = buildSplash();
    document.body.appendChild(root);

    const barEl     = root.querySelector('#cold-start-bar');
    const nameEl    = root.querySelector('#cold-start-status-name');
    const countEl   = root.querySelector('#cold-start-status-count');
    const recentEl  = root.querySelector('#cold-start-recent');
    const skipBtn   = root.querySelector('#cold-start-skip');
    const retryBtn  = root.querySelector('#cold-start-btn-retry');
    const offlineBtn = root.querySelector('#cold-start-btn-offline');

    let dismissed = false;
    let pollTimer = null;
    let skipTimer = null;
    let failureTimer = null;
    let lastSeenCount = 0;
    let lastProgressAt = Date.now();
    let lastNameShown = '';
    const seenNames = new Set();

    function dismiss(opts) {
      if (dismissed) return;
      dismissed = true;
      clearInterval(pollTimer);
      clearTimeout(skipTimer);
      clearTimeout(failureTimer);
      const fade = !opts || opts.fade !== false;
      if (fade) {
        root.classList.add('is-fading');
        setTimeout(() => { if (root.parentNode) root.parentNode.removeChild(root); }, FADE_DURATION_MS + 60);
      } else {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    }

    function applyAccent() {
      // The splash inherits faction color via CSS variables on :root. If a
      // faction has been auto-selected from a saved army, the variable is
      // already set by App.applyFactionColor; no work needed here.
    }

    function updateRecent(name) {
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);
      const li = document.createElement('li');
      li.className = 'cold-start-recent-item';
      const tick = document.createElement('span');
      tick.className = 'cold-start-recent-tick';
      tick.textContent = '✓';
      tick.setAttribute('aria-hidden', 'true');
      const nm = document.createElement('span');
      nm.className = 'cold-start-recent-name';
      nm.textContent = name;
      li.appendChild(tick);
      li.appendChild(nm);
      // Newest at top.
      recentEl.insertBefore(li, recentEl.firstChild);
      // Trim + age existing.
      const items = recentEl.querySelectorAll('.cold-start-recent-item');
      for (let i = 0; i < items.length; i++) {
        items[i].classList.remove('is-aged', 'is-faded');
        if (i === RECENT_MAX - 2) items[i].classList.add('is-aged');
        if (i >= RECENT_MAX - 1) items[i].classList.add('is-faded');
        if (i >= RECENT_MAX) items[i].parentNode.removeChild(items[i]);
      }
    }

    function setCurrentName(text) {
      if (!text || text === lastNameShown) return;
      lastNameShown = text;
      nameEl.classList.add('is-swapping');
      setTimeout(() => {
        nameEl.textContent = text;
        nameEl.classList.remove('is-swapping');
      }, 180);
    }

    function tick() {
      if (dismissed) return;

      // Dismiss as soon as all catalogue files are processed, regardless of
      // how many produced faction objects (some files have 0 units and are
      // never pushed to state.factions, so count never reaches the file total).
      if (UI.loadingComplete) { dismiss({ fade: true }); return; }

      const state = App.state;
      const factions = (state && state.factions) || [];
      const count = factions.length;

      // Track progress for failure detection + recent-list.
      if (count > lastSeenCount) {
        lastProgressAt = Date.now();
        for (let i = lastSeenCount; i < count; i++) {
          const f = factions[i];
          if (f && f.factionName) updateRecent(f.factionName);
        }
        lastSeenCount = count;
      }

      // Latest in-flight: best-effort read of the existing #load-status-text.
      // We don't poke that DOM, just observe what bsdata-load.js wrote there.
      const liveName = readLiveName();
      if (liveName) setCurrentName(liveName);
      else if (count === 0) setCurrentName('Reaching BSData');
      else if (factions[count - 1]) setCurrentName(factions[count - 1].factionName || '');

      // Total: prefer the reported total from the existing widget if present.
      const reportedTotal = readReportedTotal();
      const total = reportedTotal && reportedTotal > 0 ? reportedTotal : EXPECTED_TOTAL;
      const visible = Math.min(count, total);
      const pct = Math.min(100, Math.round((visible / total) * 100));

      barEl.style.width = pct + '%';
      countEl.textContent = visible + ' / ' + total;

      if (count > 0 && count >= total) {
        dismiss({ fade: true });
      }
    }

    function readLiveName() {
      // bsdata.js's onProgress writes into #load-status-count "done / total"
      // and the status text is "Loading factions". The faction name itself
      // isn't in the DOM, so we use the most-recent state.factions entry as
      // the visible currently-loaded label.
      return null;
    }

    function readReportedTotal() {
      const el = document.getElementById('load-status-count');
      if (!el) return null;
      const txt = (el.textContent || '').trim();
      const m = txt.match(/\/\s*(\d+)/) || txt.match(/^\((\d+)\)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    }

    function checkFailure() {
      if (dismissed) return;
      const count = ((App.state && App.state.factions) || []).length;
      const stalled = (Date.now() - lastProgressAt) >= FAILURE_TIMEOUT_MS;
      if (count === 0 && stalled) {
        showError();
      } else {
        // Re-arm: check again in another window.
        failureTimer = setTimeout(checkFailure, FAILURE_TIMEOUT_MS);
      }
    }

    function showError() {
      root.classList.add('is-error');
      // Move focus to retry for keyboard users.
      try { retryBtn.focus(); } catch (_) {}
    }

    function hideError() {
      root.classList.remove('is-error');
    }

    // ── Wire interactions ──────────────────────────────────────────────
    skipBtn.addEventListener('click', () => dismiss({ fade: true }));
    offlineBtn.addEventListener('click', () => dismiss({ fade: true }));
    retryBtn.addEventListener('click', () => {
      hideError();
      lastProgressAt = Date.now();
      // Clear sessionStorage filelist so fetchFileList will retry the API call.
      try { sessionStorage.removeItem('yaab_bsdata_filelist_10e_v1'); } catch (_) {}
      try {
        if (typeof App.autoLoadFromBSData === 'function') {
          App.autoLoadFromBSData();
        }
      } catch (_) {}
      // Re-arm failure detection.
      clearTimeout(failureTimer);
      failureTimer = setTimeout(checkFailure, FAILURE_TIMEOUT_MS);
    });

    // Show skip after a short delay so it doesn't flash on quick loads.
    skipTimer = setTimeout(() => {
      if (!dismissed) skipBtn.classList.add('is-visible');
    }, SKIP_DELAY_MS);

    // Failure detection.
    failureTimer = setTimeout(checkFailure, FAILURE_TIMEOUT_MS);

    // Polling loop.
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    applyAccent();
  }

  // ── Bootstrap detection ───────────────────────────────────────────────
  // bootstrap fires synchronously; we kick off an async detect that decides
  // whether to overlay. Warm starts (factions already in IDB) skip entirely.
  App.hooks.bootstrap.push(function () {
    let decided = false;

    // Pre-paint guard: if there is no cached filelist AND no IDB yet, the
    // user is almost certainly cold-starting. Show the splash immediately
    // (no flash of 3-panel layout) and let the async check tear it down if
    // we were wrong.
    let preRoot = null;
    const hasFilelistCache =
      (() => { try { return !!sessionStorage.getItem('yaab_bsdata_filelist_10e_v1'); } catch (_) { return false; } })();

    if (!hasFilelistCache) {
      preRoot = buildSplash();
      // Hide the inner controls until we confirm cold-start; show only crest
      // + title to avoid showing "0 / 32" if it turns out to be warm.
      preRoot.style.opacity = '0';
      document.body.appendChild(preRoot);
      // Fade in after one frame for a softer entry.
      requestAnimationFrame(() => {
        if (preRoot && !decided) preRoot.style.opacity = '1';
      });
    }

    (async function detect() {
      let cached = [];
      try {
        if (window.YaabDB && typeof YaabDB.getAllFactions === 'function') {
          cached = await YaabDB.getAllFactions();
        }
      } catch (_) { cached = []; }

      decided = true;
      const isCold = !Array.isArray(cached) || cached.length === 0;

      if (preRoot && preRoot.parentNode) {
        preRoot.parentNode.removeChild(preRoot);
      }

      if (isCold) start();
      // Warm: no splash. App is already rendering with cached factions.
    })();
  });
})();
