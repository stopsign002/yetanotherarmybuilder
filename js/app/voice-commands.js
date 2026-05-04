// app/voice-commands.js — opt-in WebSpeech voice control with keyword intent matching.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  // Capability check — registering the toggle when the API is missing creates
  // a button that does nothing. Bail out early and surface to console.
  const SR_SUPPORTED = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR_SUPPORTED || !SR) {
    console.warn('[voice-commands] SpeechRecognition unsupported in this browser; toggle hidden.');
    return;
  }

  const STORAGE_KEY = 'yaab_voice_enabled';

  // ---------------------------------------------------------------------------
  // CSS injection (idempotent — links the shared voice-coach.css once)
  // ---------------------------------------------------------------------------
  function ensureStyles() {
    if (document.querySelector('link[data-yaab-voice-coach]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/voice-coach.css';
    link.setAttribute('data-yaab-voice-coach', '1');
    document.head.appendChild(link);
  }

  // ---------------------------------------------------------------------------
  // Floating mic indicator
  // ---------------------------------------------------------------------------
  let micEl = null;
  let transcriptEl = null;

  function ensureIndicator() {
    if (micEl) return micEl;
    micEl = document.createElement('div');
    micEl.className = 'yaab-voice-mic';
    micEl.setAttribute('role', 'status');
    micEl.setAttribute('aria-live', 'polite');
    micEl.innerHTML = `
      <div class="yaab-voice-mic-ring" aria-hidden="true"></div>
      <div class="yaab-voice-mic-glyph" aria-hidden="true">V</div>
      <div class="yaab-voice-transcript" hidden></div>
    `;
    document.body.appendChild(micEl);
    transcriptEl = micEl.querySelector('.yaab-voice-transcript');
    return micEl;
  }

  function showIndicator() {
    ensureIndicator();
    micEl.classList.add('yaab-voice-mic-active');
    micEl.removeAttribute('hidden');
  }

  function hideIndicator() {
    if (!micEl) return;
    micEl.classList.remove('yaab-voice-mic-active');
    micEl.setAttribute('hidden', '');
    setTranscript('');
  }

  function setTranscript(text) {
    if (!transcriptEl) return;
    if (text) {
      transcriptEl.textContent = text;
      transcriptEl.removeAttribute('hidden');
    } else {
      transcriptEl.textContent = '';
      transcriptEl.setAttribute('hidden', '');
    }
  }

  // ---------------------------------------------------------------------------
  // Intents
  // ---------------------------------------------------------------------------
  function clickIfPresent(id) {
    const el = document.getElementById(id);
    if (el) { el.click(); return true; }
    return false;
  }

  function toast(msg) {
    if (window.UI && typeof UI.toast === 'function') UI.toast(msg, 'info', 1800);
  }

  function fuzzyMatchUnit(needle) {
    const state = App.state || {};
    const all = state.allUnits || [];
    if (!all.length) return null;
    const n = needle.trim().toLowerCase();
    if (!n) return null;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < all.length; i++) {
      const u = all[i];
      const name = String(u.name || '').toLowerCase();
      if (!name) continue;
      let score = 0;
      if (name === n) score = 100;
      else if (name.startsWith(n)) score = 50;
      else if (name.indexOf(n) !== -1) score = 30;
      else {
        // token-overlap
        const toks = n.split(/\s+/).filter(Boolean);
        let hits = 0;
        for (const t of toks) if (name.indexOf(t) !== -1) hits++;
        if (hits === toks.length && toks.length) score = 10 + hits;
      }
      if (score > bestScore) { bestScore = score; best = u; }
    }
    return bestScore > 0 ? best : null;
  }

  function clickUnitCard(unit) {
    const grid = document.getElementById('unit-grid');
    if (!grid) return false;
    const card = grid.querySelector(`.unit-card[data-unit-id="${CSS.escape(String(unit.id))}"]`);
    if (!card) return false;
    card.click();
    // Find an "Add to Army" button in the detail panel afterward.
    setTimeout(() => {
      const addBtn = document.querySelector('#unit-detail-panel .btn-accent, #unit-detail-panel [data-add-to-army], #unit-detail-panel button[data-action="add"]');
      if (addBtn) addBtn.click();
    }, 60);
    return true;
  }

  function removeArmyEntryByName(needle) {
    const army = App.state && App.state.currentArmy;
    if (!army || !Array.isArray(army.entries)) return false;
    const n = needle.trim().toLowerCase();
    if (!n) return false;
    let idx = -1;
    for (let i = 0; i < army.entries.length; i++) {
      const name = String(army.entries[i].unitName || '').toLowerCase();
      if (name === n || name.indexOf(n) !== -1) { idx = i; break; }
    }
    if (idx < 0) return false;
    // Click the remove button on that row (army-list rendering uses a remove btn).
    const list = document.getElementById('army-entry-list');
    if (!list) return false;
    const rows = list.querySelectorAll('.army-entry, li[data-entry-index]');
    let target = null;
    rows.forEach(r => {
      const ridx = parseInt(r.dataset.entryIndex || r.getAttribute('data-index') || '-1', 10);
      if (ridx === idx) target = r;
    });
    if (!target) target = rows[idx];
    if (!target) return false;
    const rm = target.querySelector('.btn-remove, [data-action="remove"], .army-entry-remove, button[title*="Remove" i]');
    if (rm) { rm.click(); return true; }
    return false;
  }

  function selectFactionByName(needle) {
    const sel = document.getElementById('army-faction-select');
    if (!sel) return false;
    const n = needle.trim().toLowerCase();
    if (!n) return false;
    let match = null;
    for (let i = 0; i < sel.options.length; i++) {
      const v = String(sel.options[i].value || '').toLowerCase();
      const t = String(sel.options[i].textContent || '').toLowerCase();
      if (v === n || t === n) { match = sel.options[i]; break; }
      if (!match && (v.indexOf(n) !== -1 || t.indexOf(n) !== -1)) match = sel.options[i];
    }
    if (!match) return false;
    sel.value = match.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Returns { intent, label } or null. Order matters — check stop-listening first.
  function parseIntent(raw) {
    const t = String(raw || '').trim().toLowerCase();
    if (!t) return null;

    if (/\bstop listening\b|\bstop voice\b/.test(t)) return { intent: 'stop', label: 'stop listening' };
    if (/\bsave( army)?\b/.test(t)) return { intent: 'save', label: 'save army' };
    if (/\bnew army\b|\bstart over\b/.test(t)) return { intent: 'new', label: 'new army' };
    if (/\b(load|open) army\b|^load$|^open$/.test(t)) return { intent: 'load', label: 'load army' };
    if (/\bundo\b/.test(t)) return { intent: 'undo', label: 'undo' };
    if (/\bredo\b/.test(t)) return { intent: 'redo', label: 'redo' };
    if (/\b(show analytics|analyze|analyse)\b/.test(t)) return { intent: 'analytics', label: 'analytics' };
    if (/\bprint( army)?\b/.test(t)) return { intent: 'print', label: 'print' };
    if (/\bwhat next\b|\blist coach\b|\bcoach\b/.test(t)) return { intent: 'coach', label: 'list coach' };

    let m = t.match(/\b(?:switch to|play(?:ing)?)\s+(.+)$/);
    if (m) return { intent: 'faction', value: m[1].trim(), label: 'switch to ' + m[1].trim() };

    m = t.match(/\badd\s+(.+)$/);
    if (m) return { intent: 'add', value: m[1].trim(), label: 'add ' + m[1].trim() };

    m = t.match(/\b(?:remove|delete|drop)\s+(.+)$/);
    if (m) return { intent: 'remove', value: m[1].trim(), label: 'remove ' + m[1].trim() };

    return null;
  }

  function executeIntent(parsed) {
    if (!parsed) return false;
    let ok = false;
    switch (parsed.intent) {
      case 'stop':       deactivate(); ok = true; break;
      case 'save':       ok = clickIfPresent('btn-save-army'); break;
      case 'new':        ok = clickIfPresent('btn-new-army'); break;
      case 'load':       ok = clickIfPresent('btn-load-army'); break;
      case 'undo':       ok = clickIfPresent('yaab-btn-undo'); break;
      case 'redo':       ok = clickIfPresent('yaab-btn-redo'); break;
      case 'print':      ok = clickIfPresent('btn-data-cards'); break;
      case 'analytics': {
        if (typeof App.openAnalytics === 'function') { App.openAnalytics(); ok = true; }
        else if (window.UI && typeof UI.openAnalytics === 'function') { UI.openAnalytics(); ok = true; }
        else ok = clickIfPresent('yaab-btn-analytics');
        break;
      }
      case 'coach': {
        if (typeof App.toggleListCoach === 'function') { App.toggleListCoach(); ok = true; }
        else ok = clickIfPresent('yaab-btn-list-coach');
        break;
      }
      case 'faction': ok = selectFactionByName(parsed.value); break;
      case 'add': {
        const u = fuzzyMatchUnit(parsed.value);
        if (u) ok = clickUnitCard(u);
        break;
      }
      case 'remove': ok = removeArmyEntryByName(parsed.value); break;
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // Recognition lifecycle
  // ---------------------------------------------------------------------------
  let recognition = null;
  let active = false;
  let manualStop = false;

  // Detect Safari (where WebSpeech actually works on-device + reliably).
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  function buildRecognition() {
    const r = new SR();
    // Single-shot mode avoids many Chrome 'network' false-fail loops by not
    // forcing the recognizer to maintain a persistent cloud connection.
    // We re-start on onend instead. Safari handles continuous fine.
    r.continuous = isSafari;
    r.interimResults = true;
    r.lang = (navigator.language || 'en-US');

    r.onresult = function (event) {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) setTranscript(interim);
      if (finalText) {
        const parsed = parseIntent(finalText);
        if (parsed) {
          const ok = executeIntent(parsed);
          toast(ok ? 'Heard: ' + parsed.label : 'Heard but no match: ' + parsed.label);
        }
        setTranscript('');
      }
    };

    r.onerror = function (e) {
      const code = e && e.error;
      console.warn('[voice-commands] recognition error:', code, e && e.message);
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        if (window.UI && UI.toast) {
          UI.toast(
            'Microphone access required for voice commands. Click the toolbar mic button after granting permission.',
            'error',
            5000
          );
        }
        deactivate();
        return;
      }
      if (code === 'audio-capture') {
        if (window.UI && UI.toast) UI.toast('No microphone detected', 'error', 4000);
        deactivate();
        return;
      }
      if (code === 'network') {
        // WebSpeech in Chrome routes to Google's cloud recognizer, which
        // throttles unauthenticated calls — so 'network' fires even when
        // the user has working internet. Safari uses an on-device
        // recognizer and is far more reliable.
        if (window.UI && UI.toast) {
          const tip = isSafari
            ? 'Voice recognition failed. Check microphone permissions in Safari Settings.'
            : 'Voice recognition unreliable in Chrome (uses Google\'s rate-limited API). Try Safari for best results, or use Cmd/Ctrl+K instead. Disabled.';
          UI.toast(tip, 'warning', 7000);
        }
        deactivate();
        return;
      }
      // 'no-speech' / 'aborted' — ignore; onend will restart if still active.
    };

    r.onend = function () {
      // Auto-restart while user wants it active (unless they manually stopped).
      if (active && !manualStop) {
        try { r.start(); } catch (_) { /* already started */ }
      }
    };
    return r;
  }

  // Explicitly probe microphone permission via getUserMedia. This produces a
  // clearer browser-level prompt than the implicit one SpeechRecognition.start()
  // emits, and it lets us show a friendly toast on rejection rather than the
  // recognizer silently never producing results.
  async function ensureMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // No gUM available (e.g. http: origin). SpeechRecognition may still work
      // on its own; let the recognizer's onerror surface failures.
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We don't actually need the stream — SpeechRecognition opens its own.
      // Closing the tracks immediately keeps the OS mic light from staying on.
      stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      return true;
    } catch (err) {
      console.warn('[voice-commands] mic permission denied:', err && err.name, err && err.message);
      if (window.UI && UI.toast) {
        UI.toast(
          'Microphone access required for voice commands. Click the toolbar mic button after granting permission.',
          'error',
          5000
        );
      }
      return false;
    }
  }

  async function activate() {
    ensureStyles();
    // Request mic permission explicitly. start() must be in a user-gesture stack;
    // since toggle() is wired to the button click handler we're still inside one.
    const ok = await ensureMicPermission();
    if (!ok) {
      // Don't flip on the indicator if we never got permission.
      try { localStorage.setItem(STORAGE_KEY, '0'); } catch (_) {}
      return;
    }
    showIndicator();
    if (!recognition) recognition = buildRecognition();
    // Defensive: confirm continuous + interimResults are set even if a future
    // edit forgets — the symptom would be "voice fires once then stops".
    try {
      recognition.continuous = true;
      recognition.interimResults = true;
    } catch (_) {}
    active = true;
    manualStop = false;
    try { recognition.start(); }
    catch (e) {
      console.warn('[voice-commands] start() threw:', e && e.message);
      // Some browsers throw "already started" — that's fine.
    }
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
    if (window.UI && UI.toast) UI.toast('Voice control on. Say "stop listening" to disable.', 'info', 2400);
  }

  function deactivate() {
    active = false;
    manualStop = true;
    hideIndicator();
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
    try { localStorage.setItem(STORAGE_KEY, '0'); } catch (_) {}
    if (window.UI && UI.toast) UI.toast('Voice control off', 'info', 1500);
  }

  function toggle() {
    if (active) deactivate();
    else {
      // activate is async (mic permission probe); ignore the returned promise —
      // any failure shows its own toast.
      activate().catch(err => console.warn('[voice-commands] activate failed:', err));
    }
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------
  App.hooks.armyToolbarActions.push({
    id: 'yaab-btn-voice',
    region: 'icon',
    label: 'V',
    ariaLabel: 'Voice commands',
    title: 'Toggle voice control',
    onClick: toggle,
  });

  App.hooks.bootstrap.push(function () {
    let wantsOn = false;
    try { wantsOn = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
    if (wantsOn) {
      // Defer until first user interaction — most browsers block recognition
      // start without a gesture. Wait for ANY click, then auto-activate.
      const onGesture = function () {
        document.removeEventListener('pointerdown', onGesture, true);
        document.removeEventListener('keydown', onGesture, true);
        activate();
      };
      document.addEventListener('pointerdown', onGesture, true);
      document.addEventListener('keydown', onGesture, true);
    }
  });

  App.toggleVoice = toggle;
  App.activateVoice = activate;
  App.deactivateVoice = deactivate;
})();
