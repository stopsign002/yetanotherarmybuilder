// app/sync.js — App.Sync: cloud sync layer for armies + the synced KV bag.
//
// HEAVY MAGIC WARNING: this module monkey-patches `localStorage.setItem` and
// `localStorage.removeItem` so that writes to a small allowlist of keys
// (favorites/recents/collection/crusade_rosters/deployments/points_overrides)
// trigger a debounced sync push without each owning module having to know
// about the cloud. yaab_armies is NOT in that allowlist — armies are pushed
// per-id from inside ArmyManager.save() (see js/army.js) so we can do
// per-army diffing instead of pushing the whole bag.
//
// Storage keys:
//   yaab_sync_queue     — FIFO of {op, id?, ts, mutationId}; coalesced on enqueue
//   yaab_sync_known     — { armyId -> updated_at } known on the server
//   yaab_sync_state_at  — last successful state-bag push timestamp
//
// State machine: see /root/.claude/plans/i-dont-want-to-misty-shannon.md.
(function () {
  const App = window.App = window.App || {};

  // ── Configuration ────────────────────────────────────────────────────
  const SYNCED_BAG_KEYS = [
    'yaab_favorites',
    'yaab_recents',
    'yaab_collection',
    'yaab_crusade_rosters',
    'yaab_deployments',
    'yaab_points_overrides',
  ];
  const BAG_KEY_SET = new Set(SYNCED_BAG_KEYS);

  const QUEUE_KEY      = 'yaab_sync_queue';
  const KNOWN_KEY      = 'yaab_sync_known';
  const STATE_BAG_TS   = 'yaab_sync_state_at';
  const QUEUE_MAX      = 200;
  const ARMY_DEBOUNCE  = 500;
  const BAG_DEBOUNCE   = 1500;
  const BACKOFF_MAX_MS = 30000;

  const API_ARMIES = '/api/armies';
  const API_STATE  = '/api/state';

  // ── Internal state ───────────────────────────────────────────────────
  let _suppressMonkeyPatch = false; // set when we're writing localStorage from sync itself
  let _pulling = false;
  let _draining = false;
  let _backoffMs = 0;
  let _armyTimer = null;
  let _bagTimer = null;
  let _bc = null;                   // BroadcastChannel('yaab-sync')

  // ── Helpers ──────────────────────────────────────────────────────────
  function nowIso() { return new Date().toISOString(); }
  function uuid() {
    // RFC4122-ish v4
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  function jsonGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function jsonSet(key, value) {
    _suppressMonkeyPatch = true;
    try { localStorage.setItem(key, JSON.stringify(value)); }
    finally { _suppressMonkeyPatch = false; }
  }
  function rawSet(key, value) {
    _suppressMonkeyPatch = true;
    try { localStorage.setItem(key, value); }
    finally { _suppressMonkeyPatch = false; }
  }
  function rawRemove(key) {
    _suppressMonkeyPatch = true;
    try { localStorage.removeItem(key); }
    finally { _suppressMonkeyPatch = false; }
  }

  function queue() { return jsonGet(QUEUE_KEY, []); }
  function setQueue(q) { jsonSet(QUEUE_KEY, q); }
  function known() { return jsonGet(KNOWN_KEY, {}); }
  function setKnown(k) { jsonSet(KNOWN_KEY, k); }

  function authReady() {
    return !!(App.Auth && App.Auth.isSignedIn && App.Auth.isSignedIn());
  }

  function bcPost(msg) {
    if (_bc) { try { _bc.postMessage(msg); } catch (_) {} }
  }

  function bagSnapshot() {
    const out = {};
    for (const k of SYNCED_BAG_KEYS) {
      try {
        const raw = localStorage.getItem(k);
        if (raw != null) out[k] = raw;
      } catch (_) {}
    }
    return out;
  }

  // ── Queue management with coalescing ─────────────────────────────────
  // Op shapes:
  //   { op: 'putArmy',    id, mutationId, ts }
  //   { op: 'deleteArmy', id, mutationId, ts }
  //   { op: 'putState',                  mutationId, ts }
  function enqueue(op) {
    const q = queue();
    // Coalesce: same op + same id collapses to a single trailing entry.
    const filtered = q.filter(e => !(
      e.op === op.op &&
      ((op.id == null && e.id == null) || e.id === op.id)
    ));
    filtered.push(Object.assign({ ts: Date.now(), mutationId: uuid() }, op));
    if (filtered.length > QUEUE_MAX) {
      // Drop the oldest entries; surface a warning.
      filtered.splice(0, filtered.length - QUEUE_MAX);
      if (window.UI && UI.toast) {
        UI.toast('Sync queue is full — some older edits may not sync.', 'warning', 5000);
      }
    }
    setQueue(filtered);
  }

  // ── Diff against known-set, build putArmy/deleteArmy ops ─────────────
  function diffAndEnqueueArmies() {
    if (!authReady()) return;
    const armies = (App.state && App.state.armyManager && App.state.armyManager.armies) || [];
    const k = known();
    const seen = new Set();

    for (const a of armies) {
      seen.add(a.id);
      const localTs = a.updatedAt || nowIso();
      if (k[a.id] !== localTs) {
        enqueue({ op: 'putArmy', id: a.id });
      }
    }
    for (const id of Object.keys(k)) {
      if (!seen.has(id)) enqueue({ op: 'deleteArmy', id });
    }
  }

  // ── Public notify hooks (called from outside) ────────────────────────
  function notifyArmiesChanged() {
    if (!authReady()) return;
    if (_armyTimer) clearTimeout(_armyTimer);
    _armyTimer = setTimeout(() => {
      _armyTimer = null;
      diffAndEnqueueArmies();
      drainQueue();
    }, ARMY_DEBOUNCE);
  }

  function notifyKeyChanged(key) {
    if (!authReady()) return;
    if (!BAG_KEY_SET.has(key)) return;
    if (_bagTimer) clearTimeout(_bagTimer);
    _bagTimer = setTimeout(() => {
      _bagTimer = null;
      enqueue({ op: 'putState' });
      drainQueue();
    }, BAG_DEBOUNCE);
  }

  // ── Network ──────────────────────────────────────────────────────────
  async function apiFetch(path, opts) {
    const init = Object.assign({
      method: 'GET',
      credentials: 'same-origin',
    }, opts || {});
    if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
    // Only declare a JSON content-type when there's actually a body. Sending
    // Content-Type: application/json on a bodyless DELETE makes Fastify's
    // JSON parser reject the request with FST_ERR_CTP_EMPTY_JSON_BODY → 400.
    const headers = Object.assign({ 'Accept': 'application/json' }, init.headers || {});
    if (init.body) headers['Content-Type'] = 'application/json';
    init.headers = headers;
    const resp = await fetch(path, init);
    if (resp.status === 401) {
      if (App.Auth && typeof App.Auth.handleSessionExpired === 'function') {
        App.Auth.handleSessionExpired();
      }
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    if (resp.status === 204) return null;
    try { return await resp.json(); } catch (_) { return null; }
  }

  // ── Drain ────────────────────────────────────────────────────────────
  async function drainQueue() {
    if (_draining) return;
    if (!navigator.onLine) return;
    if (_pulling) return;
    if (!authReady()) return;
    _draining = true;
    try {
      while (true) {
        const q = queue();
        if (!q.length) break;
        const op = q[0];
        try {
          await runOp(op);
          // Pop only after success.
          const cur = queue();
          if (cur[0] && cur[0].mutationId === op.mutationId) {
            cur.shift();
            setQueue(cur);
          }
          _backoffMs = 0;
          bcPost({ type: 'pushed', op: op.op, id: op.id });
        } catch (err) {
          if (err && err.status === 401) return;
          // Network or 5xx — back off and retry later.
          _backoffMs = Math.min(BACKOFF_MAX_MS, _backoffMs ? _backoffMs * 2 : 2000);
          setTimeout(() => { _draining = false; drainQueue(); }, _backoffMs);
          return;
        }
      }
    } finally {
      _draining = false;
    }
  }

  async function runOp(op) {
    const k = known();
    if (op.op === 'putArmy') {
      const armies = (App.state && App.state.armyManager && App.state.armyManager.armies) || [];
      const army = armies.find(a => a.id === op.id);
      if (!army) {
        // Army no longer exists locally — convert to delete if known.
        if (k[op.id]) {
          await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
          delete k[op.id];
          setKnown(k);
        }
        return;
      }
      const payload = encodeArmy(army);
      const body = {
        name: army.name || '',
        payload,
        updated_at: army.updatedAt || nowIso(),
        mutation_id: op.mutationId,
      };
      const resp = await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`, {
        method: 'PUT', body,
      });
      const newTs = (resp && resp.updated_at) || body.updated_at;
      // Server does last-write-wins on updated_at: if our incoming ts was
      // older than the row's, the row is unchanged and the response echoes
      // the *cloud's* ts (newer than ours). Detect that mismatch and pull
      // cloud's actual content, otherwise the diff loop will keep re-PUT-ing
      // our stale local until the heat death of the universe.
      if (newTs !== body.updated_at) {
        try {
          const full = await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`);
          const newArmy = full && full.payload ? decodeArmy(full.payload) : null;
          const mgr = App.state && App.state.armyManager;
          if (newArmy && mgr) {
            const idx = mgr.armies.findIndex(a => a.id === op.id);
            if (idx >= 0) mgr.armies[idx] = newArmy;
            if (App.state.currentArmy && App.state.currentArmy.id === op.id) {
              App.state.currentArmy = newArmy;
              mgr.currentArmy = newArmy;
              if (window.UI && UI.toast) {
                UI.toast('Army updated from another device.', 'info', 3500);
              }
            }
            mgr.save();
            if (typeof App.renderAll === 'function') App.renderAll();
          }
        } catch (_) {}
      }
      k[op.id] = newTs;
      setKnown(k);
      return;
    }
    if (op.op === 'deleteArmy') {
      await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
      delete k[op.id];
      setKnown(k);
      return;
    }
    if (op.op === 'putState') {
      const bag = bagSnapshot();
      const body = {
        payload: JSON.stringify(bag),
        updated_at: nowIso(),
      };
      const resp = await apiFetch(API_STATE, { method: 'PUT', body });
      jsonSet(STATE_BAG_TS, (resp && resp.updated_at) || body.updated_at);
      return;
    }
  }

  // We store the full army as JSON. Server treats it as opaque text, so this
  // is lossless and round-trips trivially. (We don't use the YAAB1 compact
  // encoder here because it's async and depends on the live faction
  // catalogue — fine for URL share, overkill for sync.)
  function encodeArmy(army) {
    try { return JSON.stringify(army.toJSON ? army.toJSON() : army); }
    catch (_) { return ''; }
  }
  function decodeArmy(payload) {
    try {
      const data = JSON.parse(payload);
      return (window.Army && typeof Army.fromJSON === 'function')
        ? Army.fromJSON(data)
        : data;
    } catch (_) { return null; }
  }

  // ── Pull / claim flow ────────────────────────────────────────────────
  // On login (or first boot when signed in): pull cloud summaries and the
  // state bag, merge with local by per-army updated_at, push anything that's
  // locally-newer or new, adopt anything cloud-newer (except for the
  // currently-edited army — for that one we prompt).
  async function pullAll() {
    if (!authReady()) return null;
    if (_pulling) return null;
    _pulling = true;
    try {
      const [cloudSummaries, cloudState] = await Promise.all([
        apiFetch(API_ARMIES).catch(e => { if (e.status === 401) throw e; return []; }),
        apiFetch(API_STATE).catch(e => { if (e.status === 401) throw e; return null; }),
      ]);
      const summary = Array.isArray(cloudSummaries) ? cloudSummaries : [];
      const cloudIndex = new Map();
      for (const s of summary) cloudIndex.set(s.id, s);

      const mgr = App.state && App.state.armyManager;
      const localArmies = mgr ? mgr.armies.slice() : [];
      const localIndex = new Map();
      for (const a of localArmies) localIndex.set(a.id, a);

      const currentId = (App.state && App.state.currentArmy) ? App.state.currentArmy.id : null;
      let mergedFromCloud = 0;
      let uploadedLocal = 0;
      const adoptions = [];

      // 1. Cloud-only ids → either adopt (new from another device) or
      // propagate a local deletion (user deleted on this device, but the
      // DELETE op hasn't drained to cloud yet). The `known` map is the
      // discriminator: if we've previously synced this id to this device
      // and it's now missing locally, the user must have deleted it —
      // don't resurrect. Without this guard, a pullAll firing inside the
      // 500ms diff debounce after a delete races the deleteArmy op into
      // the queue and re-pushes the army into mgr.armies.
      const knownAtPull = known();
      for (const [id, summ] of cloudIndex.entries()) {
        if (localIndex.has(id)) continue;
        if (knownAtPull[id]) {
          enqueue({ op: 'deleteArmy', id });
          continue;
        }
        adoptions.push((async () => {
          try {
            const full = await apiFetch(`${API_ARMIES}/${encodeURIComponent(id)}`);
            const army = full && full.payload ? decodeArmy(full.payload) : null;
            // Name guard: a cloud-only army that fails the local name guard
            // (still on the "New Army" placeholder, blank, etc.) is residue
            // from before the guard existed. Don't adopt it locally; queue
            // a delete so the cloud copy goes away too.
            if (army && window.ArmyManager && !ArmyManager.isNamed(army)) {
              enqueue({ op: 'deleteArmy', id });
              return;
            }
            if (army && mgr) {
              mgr.armies.push(army);
              mergedFromCloud++;
              const k = known();
              k[id] = full.updated_at || summ.updated_at || nowIso();
              setKnown(k);
            }
          } catch (_) {}
        })());
      }

      // 2. Both sides have it → compare timestamps.
      for (const local of localArmies) {
        const summ = cloudIndex.get(local.id);
        if (!summ) {
          // Local-only → enqueue putArmy.
          enqueue({ op: 'putArmy', id: local.id });
          uploadedLocal++;
          continue;
        }
        const localTs = local.updatedAt || '';
        const cloudTs = summ.updated_at || '';
        if (localTs > cloudTs) {
          enqueue({ op: 'putArmy', id: local.id });
          uploadedLocal++;
        } else if (cloudTs > localTs) {
          // Cloud is newer — pull it. Previously we made an exception for
          // the currently-active army and pushed local up instead, which
          // meant a save on device A was clobbered when device B (still
          // viewing the same army from before A's save) next polled. The
          // user expects "the latest save wins, no matter where I'm
          // looking." Pull cloud and, if this is the active army on this
          // device, swap App.state.currentArmy too so the render picks up
          // the new content. Toast so the swap isn't surprising.
          adoptions.push((async () => {
            try {
              const full = await apiFetch(`${API_ARMIES}/${encodeURIComponent(local.id)}`);
              const newArmy = full && full.payload ? decodeArmy(full.payload) : null;
              // If cloud's newer version is unnamed (legacy state from
              // before the guard), don't pull it down — queue a delete.
              // Local copy is presumably also unnamed (the diff loop only
              // pulls when local has the same id), so removing both is
              // the right move.
              if (newArmy && window.ArmyManager && !ArmyManager.isNamed(newArmy)) {
                enqueue({ op: 'deleteArmy', id: local.id });
                return;
              }
              if (newArmy && mgr) {
                const idx = mgr.armies.findIndex(a => a.id === local.id);
                if (idx >= 0) mgr.armies[idx] = newArmy;
                if (local.id === currentId && App.state) {
                  App.state.currentArmy = newArmy;
                  mgr.currentArmy = newArmy;
                  if (window.UI && UI.toast) {
                    UI.toast('Army updated from another device.', 'info', 3500);
                  }
                }
                mergedFromCloud++;
                const k = known();
                k[local.id] = full.updated_at || cloudTs;
                setKnown(k);
              }
            } catch (_) {}
          })());
        } else {
          // Equal timestamps — already in sync. Make sure known has it.
          const k = known();
          k[local.id] = cloudTs || localTs;
          setKnown(k);
        }
      }

      await Promise.all(adoptions);

      // 3. State bag merge.
      const localBagTs = jsonGet(STATE_BAG_TS, '');
      const cloudBagTs = (cloudState && cloudState.updated_at) || '';
      if (cloudState && cloudState.payload && cloudBagTs && cloudBagTs > localBagTs) {
        try {
          const cloudBag = JSON.parse(cloudState.payload);
          for (const k of SYNCED_BAG_KEYS) {
            if (Object.prototype.hasOwnProperty.call(cloudBag, k)) {
              if (cloudBag[k] == null) rawRemove(k);
              else rawSet(k, cloudBag[k]);
            }
          }
          jsonSet(STATE_BAG_TS, cloudBagTs);
        } catch (_) {}
      } else if (!cloudState || !cloudBagTs) {
        // Cloud has nothing — push our local bag if there's anything.
        const bag = bagSnapshot();
        if (Object.keys(bag).length) {
          enqueue({ op: 'putState' });
        }
      }

      // 4. Persist locally + re-render. If the user is sitting on the
      // empty default "New Army" placeholder (created at boot before
      // sign-in), switch them to the most-recently-updated stored army
      // so the synced content actually shows. Skip if they've already
      // started editing — entries.length > 0 or non-default name.
      if (mgr) mgr.save();
      const cur = App.state && App.state.currentArmy;
      const curIsUntouched = !!cur
        && (!cur.entries || cur.entries.length === 0)
        && (cur.name === 'New Army' || !cur.name)
        && !mgr.armies.some(a => a.id === cur.id);
      if (mgr.armies.length > 0 && curIsUntouched) {
        const sorted = [...mgr.armies].sort((a, b) =>
          new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
        );
        App.state.currentArmy = sorted[0];
        mgr.currentArmy = sorted[0];
      }
      if (App && typeof App.renderAll === 'function') App.renderAll();

      // 5. Toast + drain.
      if (window.UI && UI.toast) {
        const parts = [];
        if (mergedFromCloud) parts.push(`${mergedFromCloud} from cloud`);
        if (uploadedLocal)   parts.push(`${uploadedLocal} uploading`);
        if (parts.length) UI.toast(`Synced: ${parts.join(', ')}.`, 'info', 3500);
      }
      drainQueue();
      return { mergedFromCloud, uploadedLocal };
    } finally {
      _pulling = false;
    }
  }

  // ── Monkey-patch localStorage for the bag-key allowlist ──────────────
  function installStoragePatch() {
    const proto = Object.getPrototypeOf(localStorage) || Storage.prototype;
    const origSet = proto.setItem.bind(localStorage);
    const origRemove = proto.removeItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      origSet(key, value);
      if (_suppressMonkeyPatch) return;
      if (BAG_KEY_SET.has(key)) notifyKeyChanged(key);
    };
    localStorage.removeItem = function (key) {
      origRemove(key);
      if (_suppressMonkeyPatch) return;
      if (BAG_KEY_SET.has(key)) notifyKeyChanged(key);
    };
  }

  // ── Flush any pending debounce timers immediately ────────────────────
  // Edits trigger notifyArmiesChanged with a 500ms debounce. If the user
  // reloads (or closes the tab) before the timer fires, the diff never
  // runs and the queue never gets the putArmy op — so the edit never
  // makes it to cloud. Call this from pagehide / visibility-hidden so
  // the queue is up-to-date in localStorage before navigation; the next
  // page load's drainQueue will then push it.
  function flushPendingNow() {
    if (_armyTimer) {
      clearTimeout(_armyTimer);
      _armyTimer = null;
      if (authReady()) diffAndEnqueueArmies();
    }
    if (_bagTimer) {
      clearTimeout(_bagTimer);
      _bagTimer = null;
      if (authReady()) enqueue({ op: 'putState' });
    }
  }

  // ── Cross-tab + connectivity listeners ───────────────────────────────
  function installListeners() {
    window.addEventListener('online',  () => { _backoffMs = 0; drainQueue(); });
    window.addEventListener('offline', () => { /* UI offline pip if added */ });

    // pagehide fires on reload, navigation, and tab close (more reliable
    // than beforeunload, especially on mobile bfcache). Flush the
    // debounce so pending edits aren't lost on quick reload.
    window.addEventListener('pagehide', flushPendingNow);

    window.addEventListener('storage', (e) => {
      if (!e || !e.key) return;
      if (e.key === 'yaab_armies') {
        const mgr = App.state && App.state.armyManager;
        if (mgr) {
          mgr.armies = mgr._load();
          if (typeof App.renderAll === 'function') App.renderAll();
        }
      }
      // We don't react to yaab_sync_queue cross-tab — we'd just re-attempt
      // on our own. The other tab is already draining.
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && authReady()) {
        // Lightweight: just attempt to drain and pull a fresh summary.
        drainQueue();
        // Light pull: only refetch summaries to spot cross-device updates.
        pullAll().catch(() => {});
      }
    });

    if (typeof BroadcastChannel === 'function') {
      _bc = new BroadcastChannel('yaab-sync');
      _bc.onmessage = (e) => {
        // Reserved for future cross-tab coordination.
        void e;
      };
    }
  }

  // ── Init / Auth wiring ───────────────────────────────────────────────
  function init() {
    installStoragePatch();
    installListeners();
    if (App.Auth && typeof App.Auth.onChange === 'function') {
      App.Auth.onChange((user) => {
        if (user) {
          // Just signed in — claim local + pull, then drain.
          pullAll().catch(() => {});
        }
        // Sign-out: keep the queue around in case the user signs back in.
      });
    }
    // If we already booted signed in, kick a pull now.
    if (authReady()) {
      pullAll().catch(() => {});
      drainQueue();
    }
  }

  App.Sync = {
    init,
    notifyArmiesChanged,
    notifyKeyChanged,
    pullAll,
    drainQueue,
    status() {
      return {
        signedIn: authReady(),
        queueLength: queue().length,
        backoffMs: _backoffMs,
        pulling: _pulling,
        draining: _draining,
      };
    },
  };
})();
