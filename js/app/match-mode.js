// app/match-mode.js — full-screen game-day overlay (CP, turns, phases, wounds, VP).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const STORAGE_KEY = 'yaab_match_state';
  const MAX_TURN = 5;
  const PHASES = ['Command', 'Movement', 'Shooting', 'Charge', 'Fight', 'Morale'];
  const PRIMARY_CAP = 50;
  const SECONDARY_CAP = 15;
  const PRIMARY_INCR = [1, 2, 3, 5];

  // ── State ──────────────────────────────────────────────────────────────────

  let overlayRoot = null;
  let overlayOpen = false;
  let timerInterval = null;
  let keyHandler = null;
  let armySignature = null;

  const blankState = () => ({
    startedAt: null,
    turn: 0,                 // 0 = not started, 1..MAX_TURN active, MAX_TURN+1 = finished
    phase: 0,                // index into PHASES
    phaseDone: [],           // bool per phase; resets each round
    cp: 0,
    vp: { you: 0, opp: 0 },
    primaryHistory: [],      // [{turn, you, opp}]
    secondaries: [
      { label: 'Secondary 1', you: 0, opp: 0 },
      { label: 'Secondary 2', you: 0, opp: 0 },
    ],
    woundsByEntryIndex: {},  // { '0': [currentW, currentW, ...], ... }
    timer: { elapsedMs: 0, running: false, startedAt: 0 },
    armySig: '',             // hash of currentArmy to detect invalidation
    gameOverShown: false,
  });

  let match = blankState();

  // ── Persistence ────────────────────────────────────────────────────────────

  function save() {
    try {
      // Snapshot timer elapsed so a reload preserves accurate time.
      const snap = JSON.parse(JSON.stringify(match));
      if (snap.timer.running) {
        snap.timer.elapsedMs = computeElapsed();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (_) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function wipe() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  // ── Army signature (detects new/edited army) ───────────────────────────────

  function computeArmySig(army) {
    if (!army || !Array.isArray(army.entries)) return '';
    return (army.id || '') + '|' + army.entries.map(e =>
      `${e.unitId || e.unitName}:${e.count || 1}:${e.selectedPts || 0}`
    ).join(',');
  }

  function currentArmy() {
    return (App.state && App.state.currentArmy) || null;
  }

  // ── Stats helpers ──────────────────────────────────────────────────────────

  function statNum(stats, key) {
    if (!stats) return 0;
    const raw = stats[key] != null ? stats[key] : stats[key.toLowerCase()];
    const m = String(raw || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function modelsPerSquad(entry) {
    const opts = (entry.unitData && entry.unitData.squadOptions) || [];
    if (!opts.length) return 1;
    let chosen = opts.find(o => o.pts === entry.selectedPts) || opts[0];
    return (chosen && chosen.models) || 1;
  }

  function startingWoundsPerModel(entry) {
    return statNum(entry.unitData && entry.unitData.stats, 'W') || 1;
  }

  function totalModelsForEntry(entry) {
    return (entry.count || 1) * modelsPerSquad(entry);
  }

  // Ensures the wound array exists for an entry and matches model count.
  function ensureWoundArray(idx, entry) {
    const maxW = startingWoundsPerModel(entry);
    const models = totalModelsForEntry(entry);
    let arr = match.woundsByEntryIndex[idx];
    if (!Array.isArray(arr) || arr.length !== models) {
      arr = new Array(models).fill(maxW);
      match.woundsByEntryIndex[idx] = arr;
    }
    return arr;
  }

  // ── Match lifecycle ────────────────────────────────────────────────────────

  function startFresh() {
    match = blankState();
    match.startedAt = Date.now();
    match.turn = 1;
    match.phase = 0;
    match.phaseDone = PHASES.map(() => false);
    match.armySig = computeArmySig(currentArmy());
    armySignature = match.armySig;
    save();
  }

  function tryResume() {
    const saved = load();
    if (!saved || !saved.turn || saved.turn < 1) return false;
    match = Object.assign(blankState(), saved);
    if (!Array.isArray(match.phaseDone) || match.phaseDone.length !== PHASES.length) {
      match.phaseDone = PHASES.map(() => false);
    }
    if (!match.timer) match.timer = { elapsedMs: 0, running: false, startedAt: 0 };
    // Don't auto-resume the stopwatch tick; player can re-start it.
    match.timer.running = false;
    armySignature = match.armySig;
    return true;
  }

  function endMatch() {
    stopTimer();
    match = blankState();
    wipe();
  }

  // ── Turn / phase ops ───────────────────────────────────────────────────────

  function advancePhase() {
    if (match.phase < PHASES.length - 1) {
      match.phaseDone[match.phase] = true;
      match.phase += 1;
    } else {
      match.phaseDone[match.phase] = true;
    }
    save(); render();
  }

  function jumpToPhase(i) {
    if (i === match.phase) {
      match.phaseDone[i] = !match.phaseDone[i];
    } else {
      match.phase = i;
    }
    save(); render();
  }

  function endRound() {
    if (match.turn >= MAX_TURN) {
      match.turn = MAX_TURN + 1;
      match.phase = PHASES.length - 1;
      match.phaseDone = PHASES.map(() => true);
      if (!match.gameOverShown) {
        match.gameOverShown = true;
        showGameOver();
      }
      save(); render();
      return;
    }
    match.turn += 1;
    match.phase = 0;
    match.phaseDone = PHASES.map(() => false);
    save(); render();
  }

  function showGameOver() {
    const totalYou = match.vp.you + match.secondaries.reduce((s, x) => s + x.you, 0);
    const totalOpp = match.vp.opp + match.secondaries.reduce((s, x) => s + x.opp, 0);
    if (window.UI && UI.toast) {
      UI.toast(`Game over: You ${totalYou} / Opponent ${totalOpp}`, 'success', 8000);
    }
  }

  // ── CP ops ─────────────────────────────────────────────────────────────────

  function bumpCp(delta) {
    match.cp = Math.max(0, Math.min(99, match.cp + delta));
    save(); renderTopBar();
  }

  // ── Wounds ops ─────────────────────────────────────────────────────────────

  function damageModel(entryIdx, delta) {
    const army = currentArmy();
    if (!army || !army.entries[entryIdx]) return;
    const entry = army.entries[entryIdx];
    const arr = ensureWoundArray(entryIdx, entry);
    const maxW = startingWoundsPerModel(entry);
    // Damage drains the first non-zero model; healing tops up the last damaged model.
    if (delta < 0) {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] > 0) {
          arr[i] = Math.max(0, arr[i] + delta);
          break;
        }
      }
    } else {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] < maxW) {
          arr[i] = Math.min(maxW, arr[i] + delta);
          break;
        }
      }
    }
    save(); renderArmyPanel();
  }

  function resetAllWounds() {
    match.woundsByEntryIndex = {};
    save(); renderArmyPanel();
  }

  // ── VP ops ─────────────────────────────────────────────────────────────────

  function addPrimary(side, amount) {
    match.vp[side] = Math.min(PRIMARY_CAP, match.vp[side] + amount);
    // Record per-turn history entry.
    const last = match.primaryHistory[match.primaryHistory.length - 1];
    if (last && last.turn === match.turn) {
      last[side] += amount;
    } else {
      const rec = { turn: match.turn, you: 0, opp: 0 };
      rec[side] = amount;
      match.primaryHistory.push(rec);
    }
    save(); renderVpPad();
  }

  function addSecondary(slot, side, amount) {
    const s = match.secondaries[slot];
    if (!s) return;
    s[side] = Math.min(SECONDARY_CAP, s[side] + amount);
    save(); renderVpPad();
  }

  function setSecondaryLabel(slot, label) {
    const s = match.secondaries[slot];
    if (!s) return;
    s.label = (label || '').slice(0, 40);
    save();
  }

  // ── Timer ops ──────────────────────────────────────────────────────────────

  function computeElapsed() {
    if (!match.timer.running) return match.timer.elapsedMs;
    return match.timer.elapsedMs + (Date.now() - match.timer.startedAt);
  }

  function startTimer() {
    if (match.timer.running) return;
    match.timer.running = true;
    match.timer.startedAt = Date.now();
    tickTimer();
    save();
  }

  function pauseTimer() {
    if (!match.timer.running) return;
    match.timer.elapsedMs = computeElapsed();
    match.timer.running = false;
    stopTimerInterval();
    save(); renderTopBar();
  }

  function resetTimer() {
    match.timer.elapsedMs = 0;
    match.timer.startedAt = Date.now();
    save(); renderTopBar();
  }

  function stopTimer() {
    stopTimerInterval();
    if (match.timer && match.timer.running) {
      match.timer.elapsedMs = computeElapsed();
      match.timer.running = false;
    }
  }

  function stopTimerInterval() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function tickTimer() {
    stopTimerInterval();
    timerInterval = setInterval(() => {
      const el = overlayRoot && overlayRoot.querySelector('#mm-timer-display');
      if (el) el.textContent = fmtTime(computeElapsed());
    }, 500);
  }

  function fmtTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ── DOM build ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function buildOverlay() {
    if (overlayRoot) return overlayRoot;
    const root = document.createElement('div');
    root.className = 'mm-backdrop';
    root.setAttribute('hidden', '');
    root.innerHTML = `
      <div class="mm-shell" role="dialog" aria-label="Match mode">
        <div class="mm-topbar" id="mm-topbar"></div>
        <div class="mm-phases" id="mm-phases"></div>
        <div class="mm-grid">
          <section class="mm-col mm-col-army" id="mm-army"></section>
          <section class="mm-col mm-col-vp"   id="mm-vp"></section>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    overlayRoot = root;

    // Event delegation
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);

    return root;
  }

  function onClick(e) {
    const t = e.target;
    const act = t.closest('[data-mm-act]');
    if (!act) return;
    const kind = act.dataset.mmAct;
    const arg = act.dataset.mmArg;
    const arg2 = act.dataset.mmArg2;
    switch (kind) {
      case 'close':          requestClose(); break;
      case 'cp-inc':         bumpCp(+1); break;
      case 'cp-dec':         bumpCp(-1); break;
      case 'advance-turn':   /* tap turn chip */ advancePhase(); break;
      case 'end-round':      endRound(); break;
      case 'timer-start':    match.timer.running ? pauseTimer() : startTimer(); renderTopBar(); break;
      case 'timer-reset':    resetTimer(); break;
      case 'phase':          jumpToPhase(parseInt(arg, 10)); break;
      case 'wound':          damageModel(parseInt(arg, 10), parseInt(arg2, 10)); break;
      case 'reset-wounds':   if (confirm('Reset every unit to full wounds?')) resetAllWounds(); break;
      case 'vp-primary':     addPrimary(arg, parseInt(arg2, 10)); break;
      case 'vp-secondary':   addSecondary(parseInt(arg, 10), arg2.split(':')[0], parseInt(arg2.split(':')[1], 10)); break;
      case 'end-match':      if (confirm('End the match and wipe tracking?')) { endMatch(); requestClose(true); } break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-mm-sec-label]')) {
      setSecondaryLabel(parseInt(t.dataset.mmSecLabel, 10), t.value);
    }
  }

  function onChange() { /* reserved */ }

  // ── Renderers ──────────────────────────────────────────────────────────────

  function render() {
    if (!overlayRoot) return;
    renderTopBar();
    renderPhases();
    renderArmyPanel();
    renderVpPad();
  }

  function renderTopBar() {
    const el = overlayRoot && overlayRoot.querySelector('#mm-topbar');
    if (!el) return;
    const timerLabel = match.timer.running ? 'Pause' : 'Start';
    const turnText = match.turn > MAX_TURN
      ? 'Game over'
      : `Turn ${match.turn} of ${MAX_TURN}`;
    el.innerHTML = `
      <div class="mm-cp">
        <div class="mm-cp-label">CP</div>
        <button class="mm-btn mm-btn-round" data-mm-act="cp-dec" aria-label="CP minus one">&minus;</button>
        <div class="mm-cp-val" id="mm-cp-val">${match.cp}</div>
        <button class="mm-btn mm-btn-round" data-mm-act="cp-inc" aria-label="CP plus one">+</button>
      </div>
      <div class="mm-turn">
        <button class="mm-btn mm-turn-chip" data-mm-act="advance-turn" title="Click to advance phase">${esc(turnText)}</button>
        <button class="mm-btn mm-btn-accent" data-mm-act="end-round" title="Complete the round and advance the turn">End Round</button>
      </div>
      <div class="mm-timer">
        <span id="mm-timer-display" class="mm-timer-display">${fmtTime(computeElapsed())}</span>
        <button class="mm-btn mm-btn-sm" data-mm-act="timer-start">${timerLabel}</button>
        <button class="mm-btn mm-btn-sm mm-btn-ghost" data-mm-act="timer-reset">Reset</button>
      </div>
      <div class="mm-top-actions">
        <button class="mm-btn mm-btn-ghost" data-mm-act="end-match" title="End the match and wipe tracking">End match</button>
        <button class="mm-btn mm-btn-close" data-mm-act="close" aria-label="Exit match">&times;</button>
      </div>
    `;
  }

  function renderPhases() {
    const el = overlayRoot && overlayRoot.querySelector('#mm-phases');
    if (!el) return;
    el.innerHTML = PHASES.map((p, i) => {
      const active = i === match.phase ? 'mm-phase-active' : '';
      const done = match.phaseDone[i] ? 'mm-phase-done' : '';
      return `
        <button class="mm-phase ${active} ${done}" data-mm-act="phase" data-mm-arg="${i}" title="Jump to ${esc(p)} phase">
          <span class="mm-phase-idx">${i + 1}</span>
          <span class="mm-phase-name">${esc(p)}</span>
          <span class="mm-phase-check" aria-hidden="true">${match.phaseDone[i] ? '✓' : ''}</span>
        </button>
      `;
    }).join('');
  }

  function renderArmyPanel() {
    const el = overlayRoot && overlayRoot.querySelector('#mm-army');
    if (!el) return;
    const army = currentArmy();
    const entries = (army && army.entries) || [];

    if (!entries.length) {
      el.innerHTML = `
        <header class="mm-col-head"><h3>Your army</h3></header>
        <div class="mm-empty">No units in the current army. Add units in the builder first.</div>
      `;
      return;
    }

    const rows = entries.map((entry, idx) => {
      const arr = ensureWoundArray(idx, entry);
      const maxW = startingWoundsPerModel(entry);
      const models = arr.length;
      const aliveCount = arr.filter(v => v > 0).length;
      const totalMax = models * maxW;
      const totalCur = arr.reduce((s, v) => s + v, 0);
      const destroyed = aliveCount === 0;
      const name = entry.unitName || (entry.unitData && entry.unitData.name) || 'Unit';
      const squadLabel = entry.squadLabel ? ` (${esc(entry.squadLabel)})` : '';
      return `
        <div class="mm-unit ${destroyed ? 'mm-unit-dead' : ''}">
          <div class="mm-unit-head">
            <div class="mm-unit-name">${esc(name)}${squadLabel}</div>
            <div class="mm-unit-meta">${aliveCount}/${models} models &middot; ${totalCur}/${totalMax} W</div>
          </div>
          <div class="mm-wound-widget">
            <button class="mm-btn mm-btn-round" data-mm-act="wound" data-mm-arg="${idx}" data-mm-arg2="-1" aria-label="Take one wound">&minus;</button>
            <div class="mm-wound-readout"><span class="mm-wound-cur">${totalCur}</span><span class="mm-wound-sep">/</span><span class="mm-wound-max">${totalMax}</span></div>
            <button class="mm-btn mm-btn-round" data-mm-act="wound" data-mm-arg="${idx}" data-mm-arg2="1" aria-label="Heal one wound">+</button>
          </div>
        </div>
      `;
    }).join('');

    el.innerHTML = `
      <header class="mm-col-head">
        <h3>Your army</h3>
        <button class="mm-btn mm-btn-ghost mm-btn-sm" data-mm-act="reset-wounds">Reset all wounds</button>
      </header>
      <div class="mm-unit-list">${rows}</div>
    `;
  }

  function renderVpPad() {
    const el = overlayRoot && overlayRoot.querySelector('#mm-vp');
    if (!el) return;

    const secTotalYou = match.secondaries.reduce((s, x) => s + x.you, 0);
    const secTotalOpp = match.secondaries.reduce((s, x) => s + x.opp, 0);
    const totalYou = match.vp.you + secTotalYou;
    const totalOpp = match.vp.opp + secTotalOpp;

    const primaryBtns = side => PRIMARY_INCR.map(n =>
      `<button class="mm-btn mm-btn-sm mm-vp-inc" data-mm-act="vp-primary" data-mm-arg="${side}" data-mm-arg2="${n}">+${n}</button>`
    ).join('');

    const secondaryRow = (slot, s) => `
      <div class="mm-secondary">
        <input class="mm-sec-label" type="text" value="${esc(s.label)}" data-mm-sec-label="${slot}" maxlength="40" aria-label="Secondary ${slot + 1} label" />
        <div class="mm-sec-side mm-sec-you">
          <span class="mm-sec-score">${s.you}</span>
          <button class="mm-btn mm-btn-sm" data-mm-act="vp-secondary" data-mm-arg="${slot}" data-mm-arg2="you:1">+1</button>
          <button class="mm-btn mm-btn-sm" data-mm-act="vp-secondary" data-mm-arg="${slot}" data-mm-arg2="you:2">+2</button>
        </div>
        <div class="mm-sec-side mm-sec-opp">
          <span class="mm-sec-score">${s.opp}</span>
          <button class="mm-btn mm-btn-sm mm-btn-ghost" data-mm-act="vp-secondary" data-mm-arg="${slot}" data-mm-arg2="opp:1">+1</button>
          <button class="mm-btn mm-btn-sm mm-btn-ghost" data-mm-act="vp-secondary" data-mm-arg="${slot}" data-mm-arg2="opp:2">+2</button>
        </div>
      </div>
    `;

    const history = match.primaryHistory.length
      ? match.primaryHistory.slice().reverse().map(h =>
          `<li>Turn ${h.turn} &mdash; You ${h.you} / Opp ${h.opp}</li>`
        ).join('')
      : '<li class="mm-hist-empty">No primary scores recorded yet.</li>';

    el.innerHTML = `
      <header class="mm-col-head"><h3>Objectives &amp; VP</h3></header>
      <div class="mm-primary">
        <div class="mm-primary-row mm-row-you">
          <div class="mm-primary-side">You</div>
          <div class="mm-primary-score">${match.vp.you}<span class="mm-primary-cap">/${PRIMARY_CAP}</span></div>
          <div class="mm-primary-btns">${primaryBtns('you')}</div>
        </div>
        <div class="mm-primary-row mm-row-opp">
          <div class="mm-primary-side">Opponent</div>
          <div class="mm-primary-score">${match.vp.opp}<span class="mm-primary-cap">/${PRIMARY_CAP}</span></div>
          <div class="mm-primary-btns">${primaryBtns('opp')}</div>
        </div>
      </div>
      <div class="mm-vp-sub">
        <div class="mm-vp-subhead">Secondaries (cap ${SECONDARY_CAP} each)</div>
        ${match.secondaries.map((s, i) => secondaryRow(i, s)).join('')}
      </div>
      <div class="mm-vp-totals">
        <div class="mm-total mm-total-you"><span>You total</span><strong>${totalYou}</strong></div>
        <div class="mm-total mm-total-opp"><span>Opponent total</span><strong>${totalOpp}</strong></div>
      </div>
      <div class="mm-history">
        <div class="mm-hist-head">Primary history</div>
        <ul class="mm-hist-list">${history}</ul>
      </div>
    `;
  }

  // ── Open / close ───────────────────────────────────────────────────────────

  function openMatch() {
    // Start fresh unless a persisted match is already running.
    if (!match.turn || match.turn < 1) {
      startFresh();
    } else {
      // Signature check: if army changed since last save, prompt reset.
      const sigNow = computeArmySig(currentArmy());
      if (match.armySig && sigNow && match.armySig !== sigNow) {
        if (confirm('Your army has changed since the last match. Reset the match tracker?')) {
          startFresh();
        } else {
          match.armySig = sigNow;
        }
      }
    }
    buildOverlay();
    overlayRoot.removeAttribute('hidden');
    overlayOpen = true;
    document.body.classList.add('mm-open');
    installKeys();
    if (match.timer && match.timer.running) tickTimer();
    render();
  }

  function requestClose(skipConfirm) {
    if (!skipConfirm && match.turn > 1) {
      if (!confirm('Exit match? Your match state will be saved and you can resume later.')) return;
    }
    closeOverlay();
  }

  function closeOverlay() {
    if (!overlayOpen) return;
    pauseTimer();
    overlayRoot.setAttribute('hidden', '');
    overlayOpen = false;
    document.body.classList.remove('mm-open');
    uninstallKeys();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.isContentEditable;
  }

  function installKeys() {
    if (keyHandler) return;
    keyHandler = function (e) {
      if (!overlayOpen) return;
      if (isTypingTarget(e.target)) {
        if (e.key === 'Escape') { e.preventDefault(); requestClose(); }
        return;
      }
      switch (e.key) {
        case '+': case '=':
          e.preventDefault(); bumpCp(+1); break;
        case '-': case '_':
          e.preventDefault(); bumpCp(-1); break;
        case ' ':
          e.preventDefault(); advancePhase(); break;
        case 'Enter':
          e.preventDefault(); endRound(); break;
        case 'Escape':
          e.preventDefault(); requestClose(); break;
      }
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  function uninstallKeys() {
    if (!keyHandler) return;
    document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }

  // ── Hooks / registration ───────────────────────────────────────────────────

  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-match',
    region: 'primary',
    label: 'Match',
    title: 'Start a game-day match tracker',
    onClick: openMatch,
  });

  App.hooks.bootstrap.push(function () {
    // Offer to resume a persisted match.
    const saved = load();
    if (!saved || !saved.turn || saved.turn < 1) {
      // Nothing meaningful — discard stale data.
      if (saved) wipe();
      return;
    }
    // Preload into memory so openMatch picks it up without re-reading.
    match = Object.assign(blankState(), saved);
    if (!Array.isArray(match.phaseDone) || match.phaseDone.length !== PHASES.length) {
      match.phaseDone = PHASES.map(() => false);
    }
    if (!match.timer) match.timer = { elapsedMs: 0, running: false, startedAt: 0 };
    match.timer.running = false;
    armySignature = match.armySig;
    if (window.UI && UI.toast) {
      UI.toast(`Resume match? Turn ${match.turn}/${MAX_TURN}. Open via "Match" in the toolbar.`, 'info', 6000);
    }
  });

  App.hooks.armyChange.push(function (army, kind) {
    if (!match || !match.turn || match.turn < 1) return;
    const sigNow = computeArmySig(army);
    if (!match.armySig) { match.armySig = sigNow; return; }
    if (sigNow !== match.armySig) {
      // Invalidate wound tracking; the entry indices no longer line up.
      match.woundsByEntryIndex = {};
      match.armySig = sigNow;
      save();
      if (overlayOpen) renderArmyPanel();
      if (window.UI && UI.toast && (kind === 'load' || kind === 'new' || kind === 'import')) {
        UI.toast('Match tracker: army changed, wounds reset.', 'warning', 4000);
      }
    }
  });

  // Expose for command-palette integration.
  App.openMatchMode = openMatch;
})();
