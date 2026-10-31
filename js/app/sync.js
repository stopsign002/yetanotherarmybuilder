// app/sync.js — App.Sync: cloud sync layer for armies + the synced KV bag.
//
// HEAVY MAGIC WARNING: this module monkey-patches `localStorage.setItem` and
// `localStorage.removeItem` so that writes to a small allowlist of keys
// (SYNCED_BAG_KEYS below) trigger a debounced sync push without each owning
// module having to know about the cloud. yaab_armies is NOT in that
// allowlist — armies are pushed per-id from inside ArmyManager.save() (see
// js/army.js) so we can do per-army diffing instead of pushing the whole bag.
//
// Storage keys (all account-scoped, all in ACCOUNT_LOCAL_KEYS):
//   yaab_sync_queue     — FIFO of {op, id?, ts, mutationId}; coalesced on enqueue
//   yaab_sync_known     — { armyId -> updated_at } known on the server
//   yaab_sync_state_at  — server updated_at of the bag as of our last sync
//   yaab_sync_owner     — username the local account data belongs to
//   yaab_sync_parked    — ops the server refused permanently (400/403/404/413)
//                         plus armies kept as local-only copies on an
//                         account switch; never retried automatically
//   yaab_sync_bag_meta  — { t: {key -> iso of last local change},
//                           dirty: {key -> true} } for the per-key bag merge
//
// The whole design, its invariants and its history are in docs/SYNC.md.
(function () {
  const App = window.App = window.App || {};

  // ── Configuration ────────────────────────────────────────────────────
  const SYNCED_BAG_KEYS = [
    'yaab_favorites',
    'yaab_recents',
    'yaab_collection',
    'yaab_reserves',
    'yaab_requisitions',
    'yaab_crusade_rosters',
    'yaab_deployments',
    'yaab_points_overrides',
    'yaab_cards_prefs',
    'yaab_cards_presets',
    // Named Reserves instances. (Custom names on ARMY entries need no key here
    // — they ride entry.customName through Army.toJSON on the army sync path.)
    'yaab_custom_names',
    // Chosen visual theme (js/app/themes.js). Bag-synced so the choice made in
    // Settings follows the account to a second device rather than being a
    // per-browser preference. Pulling it fires the synthetic `storage` event
    // below, which is what themes.js listens on to repaint without a reload.
    'yaab_theme',
  ];
  const BAG_KEY_SET = new Set(SYNCED_BAG_KEYS);

  const QUEUE_KEY      = 'yaab_sync_queue';
  const KNOWN_KEY      = 'yaab_sync_known';
  const STATE_BAG_TS   = 'yaab_sync_state_at';
  const OWNER_KEY      = 'yaab_sync_owner';
  const PARKED_KEY     = 'yaab_sync_parked';
  const BAG_META_KEY   = 'yaab_sync_bag_meta';
  // Reserved field inside the pushed bag payload carrying the per-key change
  // times. Older clients iterate SYNCED_BAG_KEYS only, so they ignore it on
  // pull and drop it on push (a bag without it just means "no timestamps").
  const BAG_TS_FIELD   = '__ts';
  const QUEUE_MAX      = 200;
  const PARKED_MAX     = 200;
  const ARMY_DEBOUNCE  = 500;
  const BAG_DEBOUNCE   = 1500;
  const BACKOFF_MAX_MS = 30000;
  // Server caps (api/armies.js, api/state.js). Mirrored so an over-long name
  // is truncated instead of 400-ing, and an oversize payload is parked
  // without a round trip.
  const NAME_MAX       = 200;
  const PAYLOAD_MAX    = 1000000;
  // A refusal the server will repeat for the same request forever. These are
  // parked instead of retried — before this, one 400 at the head of the
  // queue blocked every later op for good (#109 review, queue hygiene).
  const PARK_STATUSES  = new Set([400, 403, 404, 413]);

  // Every localStorage key that holds data belonging to the signed-in
  // ACCOUNT rather than to this device. This is exactly what "Sign out → also
  // remove data" wipes, and it is DERIVED from SYNCED_BAG_KEYS instead of
  // being hand-written, so adding a synced bag key can never silently open a
  // new cross-account leak.
  //
  // Why it lives here and is exported: there used to be two hand-copied
  // literals — js/ui/auth-button.js and js/app/settings-drawer.js — and they
  // drifted. The drawer's copy was missing yaab_sync_queue, so signing out
  // there with "also remove data" left user A's pending putArmy/putState ops
  // in the queue; when user B signed in on the same device drainQueue()
  // pushed A's armies and A's entire state bag up into B's cloud account. It
  // was also missing four SYNCED_BAG_KEYS entries (reserves, requisitions,
  // cards prefs, cards presets), which leaked the same way. See issue #51.
  //
  // Both sign-out paths now go through App.Auth.signOut(), which reads THIS
  // list (via wipeAccountData below). Do not re-inline it at a call site.
  const ACCOUNT_LOCAL_KEYS = Object.freeze([
    // Not bag-synced — armies are pushed per-id from ArmyManager.save() (see
    // the header comment) — but just as account-scoped, so it wipes too.
    'yaab_armies',
    ...SYNCED_BAG_KEYS,
    KNOWN_KEY,     // yaab_sync_known
    STATE_BAG_TS,  // yaab_sync_state_at
    QUEUE_KEY,     // yaab_sync_queue — the one whose absence caused #51
    OWNER_KEY,     // yaab_sync_owner — wiped data has no owner any more
    PARKED_KEY,    // yaab_sync_parked
    BAG_META_KEY,  // yaab_sync_bag_meta
  ]);

  const API_ARMIES = '/api/armies';
  const API_STATE  = '/api/state';

  // ── Internal state ───────────────────────────────────────────────────
  let _suppressMonkeyPatch = false; // set when we're writing localStorage from sync itself
  let _pulling = false;
  // True while a drain loop is running OR while its backoff retry is
  // scheduled. Held across the backoff on purpose: it used to drop in the
  // `finally` of the very iteration that scheduled the retry, so every edit
  // / online / visibility event during the wait started its own perpetual
  // retry loop. kickRetry() is the one way to cut a wait short.
  let _draining = false;
  let _retryTimer = null;
  let _backoffMs = 0;
  let _armyTimer = null;
  let _bagTimer = null;
  let _bc = null;                   // BroadcastChannel('yaab-sync')
  // One-shot per page load: pullAll may promote a boot-time "New Army"
  // placeholder to a real stored army, but only on its first run — see the
  // comment at the promote block in pullAll.
  let _promotedPlaceholder = false;
  // Set while the account-switch dialog is up (or after a choice, until the
  // page reloads). Nothing reads, writes or drains while it is set.
  let _ownerBlocked = false;
  // One console line per failure streak of pullAll's GETs, not one per
  // visibility change.
  let _pullFailLogged = false;
  // Park toasts already shown this page load, keyed op:id:status.
  const _parkToasted = new Set();

  // ── Helpers ──────────────────────────────────────────────────────────
  function nowIso() { return new Date().toISOString(); }
  function uuid() {
    // RFC4122-ish v4
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function hasOwn(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  const lsGet = App.store.getRaw;
  const jsonGet = App.store.get;
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
  function httpError(status, msg) {
    const err = new Error(msg || `HTTP ${status}`);
    err.status = status;
    return err;
  }
  function toast(msg, type, ms) {
    if (window.UI && typeof UI.toast === 'function') UI.toast(msg, type || 'info', ms || 3500);
  }
  function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  function queue() { const q = jsonGet(QUEUE_KEY, []); return Array.isArray(q) ? q : []; }
  function setQueue(q) {
    jsonSet(QUEUE_KEY, q);
    // Every write to the queue (enqueue, a drained op popped off, a queue
    // trim) is a state change the offline pip (js/ui/offline-pip.js) cares
    // about. Fire-and-forget: no listener is required for this to be safe.
    try { window.dispatchEvent(new CustomEvent('yaab:sync-queue')); } catch (_) {}
  }
  function queueLength() { return queue().length; }
  function known() { const k = jsonGet(KNOWN_KEY, {}); return (k && typeof k === 'object') ? k : {}; }
  function setKnown(k) { jsonSet(KNOWN_KEY, k); }

  function parked() { const p = jsonGet(PARKED_KEY, []); return Array.isArray(p) ? p : []; }
  function setParked(p) {
    jsonSet(PARKED_KEY, p.slice(-PARKED_MAX));
    try { window.dispatchEvent(new CustomEvent('yaab:sync-queue')); } catch (_) {}
  }

  function bagMeta() {
    const m = jsonGet(BAG_META_KEY, null);
    return {
      t: (m && m.t && typeof m.t === 'object') ? m.t : {},
      dirty: (m && m.dirty && typeof m.dirty === 'object') ? m.dirty : {},
    };
  }
  function setBagMeta(m) { jsonSet(BAG_META_KEY, m); }

  function mgrOf() { return (App.state && App.state.armyManager) || null; }
  function findArmy(id) {
    const mgr = mgrOf();
    return (mgr && Array.isArray(mgr.armies)) ? (mgr.armies.find(a => a.id === id) || null) : null;
  }
  // False while ArmyManager.save() is failing (quota). `known` is the
  // record of "this id exists on the server AND on this device"; writing it
  // for an army that is only in memory is how a quota error used to turn
  // into a cloud delete after reload (loop 1 reads "known but missing
  // locally" as a local deletion). See ArmyManager.save in js/army.js.
  function localSaveOk() {
    const mgr = mgrOf();
    return !(mgr && mgr.lastSaveOk === false);
  }

  function authReady() {
    return !!(App.Auth && App.Auth.isSignedIn && App.Auth.isSignedIn());
  }
  function currentUsername() {
    const u = App.Auth && typeof App.Auth.getCurrentUser === 'function' && App.Auth.getCurrentUser();
    return (u && typeof u.username === 'string') ? u.username : null;
  }
  function storedOwner() { return lsGet(OWNER_KEY) || null; }
  // No owner recorded = legacy device or never-synced data: allowed (the
  // gate claims it at sign-in). A recorded owner must match the session.
  function ownerMatches() {
    const o = storedOwner();
    return !o || o === currentUsername();
  }
  // The one gate for every read, write and drain against the cloud.
  function syncAllowed() {
    return authReady() && !_ownerBlocked && ownerMatches();
  }

  function bcPost(msg) {
    if (_bc) { try { _bc.postMessage(msg); } catch (_) {} }
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
      toast('Sync queue is full — some older edits may not sync.', 'warning', 5000);
    }
    setQueue(filtered);
  }
  // Remove one op by its mutationId. This is the "pop only if it is still
  // the same entry" guard: a concurrent enqueue may have coalesced the op we
  // just ran into a newer one (new mutationId), and that newer one must stay.
  function removeOp(mutationId) {
    const cur = queue();
    const next = cur.filter(e => e.mutationId !== mutationId);
    if (next.length !== cur.length) setQueue(next);
  }

  // ── Parking ─────────────────────────────────────────────────────────
  // Entries: { op, id, name, status, reason: 'rejected'|'owner', owner?,
  //            armyTs?, at }
  //   'rejected' — the server refused the op with a status it will repeat.
  //                Re-armed automatically when the army is edited again
  //                (armyTs moves) and by "Sync now" (retryParked).
  //   'owner'    — an army kept as a local-only copy when another account
  //                signed in on this device. Never uploaded from here.
  function parkedArmyIds() {
    const s = new Set();
    for (const e of parked()) if (e && e.op === 'putArmy' && e.id) s.add(e.id);
    return s;
  }
  function unparkOne(op, id) {
    const p = parked();
    const next = p.filter(e => !(e && e.op === op && e.reason !== 'owner' && (e.id || null) === (id || null)));
    if (next.length !== p.length) setParked(next);
  }
  function parkReason(status) {
    if (status === 403) return 'it belongs to another account';
    if (status === 413) return 'too large';
    if (status === 404) return 'not found on the server';
    return 'the server rejected it';
  }
  function parkOp(op, status) {
    removeOp(op.mutationId);
    const army = op.id ? findArmy(op.id) : null;
    const name = army ? String(army.name || '') : '';
    const p = parked().filter(e => !(e && e.op === op.op && (e.id || null) === (op.id || null) && e.reason !== 'owner'));
    p.push({
      op: op.op, id: op.id || null, name, status, reason: 'rejected',
      armyTs: army ? (army.updatedAt || null) : null, at: nowIso(),
    });
    setParked(p);
    if (op.op === 'deleteArmy' && op.id) {
      // A delete the server refuses (bad id) would be re-enqueued by every
      // diff while the id stays in `known`. There is nothing to delete.
      const k = known();
      if (hasOwn(k, op.id)) { delete k[op.id]; setKnown(k); }
    }
    try { console.warn('[sync] parked', op.op, op.id || '', 'HTTP', status); } catch (_) {}
    const sig = op.op + ':' + (op.id || '') + ':' + status;
    if (_parkToasted.has(sig)) return;
    _parkToasted.add(sig);
    const why = parkReason(status);
    if (op.op === 'putArmy') {
      toast(`Couldn't sync "${name || 'an army'}" — ${why}. It is still saved on this device.`, 'error', 7000);
    } else if (op.op === 'putState') {
      toast(`Couldn't sync your collection and settings — ${why}. They are still saved on this device.`, 'error', 7000);
    } else {
      toast(`Couldn't delete an army from the cloud — ${why}.`, 'warning', 6000);
    }
  }
  // "Sync now": re-arm everything the server refused (not the local-only
  // copies of another account's armies).
  function retryParked() {
    const p = parked();
    const keep = p.filter(e => e && e.reason === 'owner');
    const retry = p.filter(e => e && e.reason !== 'owner');
    if (!retry.length) return 0;
    setParked(keep);
    _parkToasted.clear();
    if (syncAllowed()) {
      for (const e of retry) {
        if (e.op === 'putArmy' && e.id && findArmy(e.id)) enqueue({ op: 'putArmy', id: e.id });
        else if (e.op === 'putState') enqueue({ op: 'putState' });
      }
    }
    return retry.length;
  }

  // ── Diff against known-set, build putArmy/deleteArmy ops ─────────────
  function diffAndEnqueueArmies() {
    if (!syncAllowed()) return;
    const mgr = mgrOf();
    const armies = (mgr && mgr.armies) || [];
    const byId = new Map();
    for (const a of armies) byId.set(a.id, a);

    // Parked armies are skipped. A 'rejected' park re-arms once the army has
    // been edited since it was parked; a park for an army that no longer
    // exists is dropped.
    const p = parked();
    const keep = [];
    const skip = new Set();
    let pChanged = false;
    for (const e of p) {
      if (!e || e.op !== 'putArmy') { keep.push(e); continue; }
      const a = byId.get(e.id);
      if (!a) { pChanged = true; continue; }
      if (e.reason !== 'owner' && (a.updatedAt || null) !== (e.armyTs || null)) { pChanged = true; continue; }
      keep.push(e);
      skip.add(e.id);
    }
    if (pChanged) setParked(keep);

    const k = known();
    for (const a of armies) {
      if (skip.has(a.id)) continue;
      const localTs = a.updatedAt || nowIso();
      if (k[a.id] !== localTs) enqueue({ op: 'putArmy', id: a.id });
    }
    for (const id of Object.keys(k)) {
      if (!byId.has(id)) enqueue({ op: 'deleteArmy', id });
    }
  }

  // ── Public notify hooks (called from outside) ────────────────────────
  function notifyArmiesChanged() {
    if (!syncAllowed()) return;
    if (_armyTimer) clearTimeout(_armyTimer);
    _armyTimer = setTimeout(() => {
      _armyTimer = null;
      diffAndEnqueueArmies();
      drainQueue();
    }, ARMY_DEBOUNCE);
  }

  function notifyKeyChanged(key) {
    if (!syncAllowed()) return;
    if (!BAG_KEY_SET.has(key)) return;
    if (_bagTimer) clearTimeout(_bagTimer);
    _bagTimer = setTimeout(() => {
      _bagTimer = null;
      if (!syncAllowed()) return;
      enqueue({ op: 'putState' });
      drainQueue();
    }, BAG_DEBOUNCE);
  }

  // Recorded for every local write of a bag key (signed in or not): the
  // change time drives the per-key merge. `dirty` — "changed on this device
  // and not yet pushed" — is only recorded while signed in, so a first
  // sign-in on a device used anonymously behaves as it always did (the
  // cloud's copy wins keys the cloud has no timestamp for).
  function noteLocalBagChange(key) {
    const m = bagMeta();
    m.t[key] = nowIso();
    if (authReady()) m.dirty[key] = true;
    setBagMeta(m);
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
      throw httpError(401, 'Unauthorized');
    }
    if (!resp.ok) throw httpError(resp.status);
    if (resp.status === 204) return null;
    try { return await resp.json(); } catch (_) { return null; }
  }

  // ── Drain ────────────────────────────────────────────────────────────
  // Cut a pending backoff short (online event, Sync now, sign-out drain).
  // Only ever clears a SCHEDULED retry: _retryTimer is set only after the
  // loop that scheduled it has returned, so no live loop is cut off.
  function kickRetry() {
    if (_retryTimer) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
      _draining = false;
    }
    _backoffMs = 0;
  }

  async function drainQueue() {
    if (_draining) return;
    if (isOffline()) return;
    if (_pulling) return;
    if (!syncAllowed()) return;
    _draining = true;
    let retryScheduled = false;
    try {
      while (true) {
        if (!syncAllowed()) break;
        const q = queue();
        if (!q.length) break;
        const op = q[0];
        try {
          await runOp(op);
          removeOp(op.mutationId);
          _backoffMs = 0;
          bcPost({ type: 'pushed', op: op.op, id: op.id });
        } catch (err) {
          const status = err && err.status;
          if (status === 401) return;
          if (PARK_STATUSES.has(status)) {
            // Permanent: move it out of the way and carry on with the rest.
            parkOp(op, status);
            continue;
          }
          // Network, 5xx, 409 (lost the state-bag race 3 times) — back off.
          _backoffMs = Math.min(BACKOFF_MAX_MS, _backoffMs ? _backoffMs * 2 : 2000);
          retryScheduled = true;
          _retryTimer = setTimeout(() => {
            _retryTimer = null;
            _draining = false;
            drainQueue();
          }, _backoffMs);
          return;
        }
      }
    } finally {
      if (!retryScheduled) _draining = false;
    }
  }

  // Drain everything now and report whether the queue emptied. Used by
  // sign-out → "Remove local data", which must not wipe edits that could
  // still have reached the cloud. Gives up early on an error (does not sit
  // out a backoff) and at the deadline.
  async function drainNow(timeoutMs) {
    flushPendingNow();
    kickRetry();
    const deadline = Date.now() + (timeoutMs || 8000);
    while (Date.now() < deadline) {
      if (!queue().length) return true;
      if (isOffline() || !syncAllowed()) return false;
      if (!_draining && !_pulling) {
        await drainQueue();
        if (!queue().length) return true;
        if (_retryTimer) return false;
      } else {
        await sleep(200);
      }
    }
    return !queue().length;
  }

  async function runOp(op) {
    if (op.op === 'putArmy') {
      const army = findArmy(op.id);
      if (!army) {
        // Army no longer exists locally — convert to delete if known.
        const k = known();
        if (k[op.id]) {
          await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
          const k2 = known();
          delete k2[op.id];
          setKnown(k2);
        }
        return;
      }
      const payload = encodeArmy(army);
      if (payload.length > PAYLOAD_MAX) throw httpError(413);
      const body = {
        // The API caps names at 200 chars and 400s anything longer, which
        // used to wedge the whole queue. Truncate rather than refuse: the
        // local name is untouched, only the server's summary column is cut.
        name: String(army.name || '').slice(0, NAME_MAX),
        payload,
        updated_at: army.updatedAt || nowIso(),
        // mutation_id used to be sent here; the API never read it and has
        // no dedup, so it was replay protection that did not exist
        // (yetanotherarmybuilder-api#1). Add it back only with server support.
      };
      const resp = await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`, {
        method: 'PUT', body,
      });
      const newTs = (resp && resp.updated_at) || body.updated_at;
      // Server does last-write-wins on updated_at: if our incoming ts was
      // older than the row's, the row is unchanged and the response echoes
      // the *cloud's* ts (newer than ours). The API says explicitly whether
      // our write landed (`applied`); older API builds only echoed the ts,
      // so fall back to comparing it. On a lost write pull the cloud's
      // actual content, otherwise the diff loop will keep re-PUT-ing our
      // stale local until the heat death of the universe.
      const applied = (resp && typeof resp.applied === 'boolean')
        ? resp.applied
        : newTs === body.updated_at;
      const mgr = mgrOf();
      if (applied && newTs !== body.updated_at) {
        // Our write won, but the server clamped our timestamp to its own
        // clock — this device's clock is ahead. Pin the army's updatedAt to
        // the row's ts so pullAll's local > cloud comparison doesn't re-push
        // (and get re-clamped) forever. Not a conflict, so no toast.
        army.updatedAt = newTs;
        if (mgr && typeof mgr.save === 'function') mgr.save();
      }
      if (!applied) {
        try {
          const full = await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`);
          const newArmy = full && full.payload ? decodeArmy(full.payload) : null;
          if (newArmy && mgr) {
            // Pin the in-memory army's updatedAt to the server's row
            // timestamp so the next pullAll comparison is equal and
            // doesn't re-pull → re-toast forever (clock skew between
            // the payload-internal "saved at" stamp and the row's
            // upsert timestamp would otherwise loop).
            if (full.updated_at) newArmy.updatedAt = full.updated_at;
            const idx = mgr.armies.findIndex(a => a.id === op.id);
            if (idx >= 0) mgr.armies[idx] = newArmy;
            if (App.state.currentArmy && App.state.currentArmy.id === op.id) {
              App.state.currentArmy = newArmy;
              mgr.currentArmy = newArmy;
              toast('Army updated from another device.', 'info', 3500);
            }
            mgr.save();
            if (typeof App.renderAll === 'function') App.renderAll();
          }
        } catch (_) {}
      }
      unparkOne('putArmy', op.id);
      if (localSaveOk()) {
        const k = known();
        k[op.id] = newTs;
        setKnown(k);
      }
      return;
    }
    if (op.op === 'deleteArmy') {
      await apiFetch(`${API_ARMIES}/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
      const k = known();
      delete k[op.id];
      setKnown(k);
      return;
    }
    if (op.op === 'putState') {
      // Never push the bag blind. Pull the cloud's current bag, merge it per
      // key with ours, apply the keys the cloud wins, then push the merged
      // bag stamped just after the cloud's version. A lost race
      // (`applied: false`) means another device wrote in between: refetch and
      // merge again rather than recording the echo as pushed.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!syncAllowed()) return;
        const cloud = await apiFetch(API_STATE);
        const m = mergeBag(cloud);
        applyCloudWinners(m);
        if (!m.needPush) {
          if (cloud && cloud.updated_at) jsonSet(STATE_BAG_TS, cloud.updated_at);
          clearPushedDirty(m.bag);
          unparkOne('putState', null);
          return;
        }
        const payload = JSON.stringify(m.bag);
        if (payload.length > PAYLOAD_MAX) throw httpError(413);
        let ts = nowIso();
        const cloudTs = cloud && typeof cloud.updated_at === 'string' ? cloud.updated_at : '';
        if (cloudTs && cloudTs >= ts) {
          // This device's clock is behind the version we just merged.
          // Our bag supersedes it, so stamp it just after it.
          const t = Date.parse(cloudTs);
          if (Number.isFinite(t)) ts = new Date(t + 1).toISOString();
        }
        const resp = await apiFetch(API_STATE, { method: 'PUT', body: { payload, updated_at: ts } });
        const applied = (resp && typeof resp.applied === 'boolean') ? resp.applied : true;
        if (applied) {
          jsonSet(STATE_BAG_TS, (resp && resp.updated_at) || ts);
          clearPushedDirty(m.bag);
          unparkOne('putState', null);
          return;
        }
      }
      throw httpError(409, 'State bag kept changing under us');
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
  // Same rule as the local name guard in ArmyManager, widened by #113: an
  // army is worth keeping when it is named OR has entries.
  function isKeepable(army) {
    if (!window.ArmyManager) return true;
    if (typeof ArmyManager.isPersistable === 'function') return ArmyManager.isPersistable(army);
    return ArmyManager.isNamed(army);
  }

  // ── State bag: per-key merge ─────────────────────────────────────────
  function parseCloudBag(cloud) {
    if (!cloud || typeof cloud !== 'object') return { bag: {}, ts: {}, exists: false };
    try {
      const b = typeof cloud.payload === 'string' ? JSON.parse(cloud.payload) : null;
      if (b && typeof b === 'object') {
        const ts = (b[BAG_TS_FIELD] && typeof b[BAG_TS_FIELD] === 'object') ? b[BAG_TS_FIELD] : {};
        return { bag: b, ts, exists: true };
      }
    } catch (_) {}
    // Unreadable cloud bag: treat as empty, so ours wins every key and the
    // push repairs it.
    return { bag: {}, ts: {}, exists: true };
  }

  // Decide each key independently:
  //   1. both sides carry a change time → the newer one wins;
  //   2. else, changed on this device and not yet pushed (dirty) → ours;
  //   3. else, the cloud has the key (a value, or a deletion time) → cloud's;
  //   4. else → ours.
  // A key the winning side deleted is carried as a timestamp with no value,
  // so a removal propagates instead of being resurrected by the next push.
  function mergeBag(cloud) {
    const c = parseCloudBag(cloud);
    const meta = bagMeta();
    const bag = {};
    const outTs = {};
    const toApply = {};      // key -> raw string | null (remove)
    const adoptTs = {};      // key -> cloud ts | null, for keys the cloud won
    let needPush = false;
    for (const k of SYNCED_BAG_KEYS) {
      const lRaw = lsGet(k);
      const lT = typeof meta.t[k] === 'string' ? meta.t[k] : null;
      const dirty = !!meta.dirty[k];
      const cHas = hasOwn(c.bag, k) && c.bag[k] != null;
      const cRaw = cHas ? String(c.bag[k]) : null;
      const cT = typeof c.ts[k] === 'string' ? c.ts[k] : null;
      let useLocal;
      if (lT && cT) useLocal = lT >= cT;
      else if (dirty) useLocal = true;
      else if (cHas || cT) useLocal = false;
      else useLocal = true;
      const val = useLocal ? lRaw : cRaw;
      const t = useLocal ? lT : cT;
      if (val != null) bag[k] = val;
      if (t) outTs[k] = t;
      if (useLocal) {
        if (lRaw !== cRaw) needPush = true;
      } else {
        adoptTs[k] = cT;
        if (cRaw !== lRaw) toApply[k] = cRaw;
      }
    }
    bag[BAG_TS_FIELD] = outTs;
    return { bag, toApply, adoptTs, needPush };
  }

  // Write the keys the cloud won, then tell the modules. rawSet/rawRemove
  // suppress the localStorage monkey-patch (so we don't loop the writes back
  // into the queue), and same-tab writes don't fire the native `storage`
  // event either. Modules hydrating from these keys would otherwise have no
  // way to know the bag just changed under them. The reserves /
  // requisitions / favorites / collection / … modules each keep an
  // in-memory copy of their key's contents and their next write would
  // clobber the freshly-pulled cloud bag with the stale memory copy. So we:
  //   · dispatch a custom yaab-bag-pulled event for modules that opted into
  //     the new event,
  //   · ALSO fire a synthetic `storage` event for each updated key so the
  //     per-module storage listeners (which already handle cross-tab
  //     cloud-sync correctly) re-hydrate in this same tab. This is the
  //     surgical fix for "reserves / wishlist got wiped after a sync" —
  //     without it, the module's in-memory state stayed stale and the next
  //     mutation persisted only that stale slice to localStorage, then
  //     pushed the shrunken bag to cloud.
  function applyCloudWinners(m) {
    const meta = bagMeta();
    for (const k of Object.keys(m.adoptTs)) {
      if (m.adoptTs[k]) meta.t[k] = m.adoptTs[k];
      else delete meta.t[k];
      delete meta.dirty[k];
    }
    const keys = Object.keys(m.toApply);
    const old = {};
    for (const k of keys) {
      old[k] = lsGet(k);
      try {
        if (m.toApply[k] == null) rawRemove(k);
        else rawSet(k, m.toApply[k]);
      } catch (_) {}
    }
    setBagMeta(meta);
    if (!keys.length) return;
    try {
      window.dispatchEvent(new CustomEvent('yaab-bag-pulled', { detail: { keys } }));
    } catch (_) {}
    for (const k of keys) {
      try {
        window.dispatchEvent(new StorageEvent('storage', {
          key: k, oldValue: old[k], newValue: lsGet(k), storageArea: localStorage,
        }));
      } catch (_) {}
    }
  }

  // After a successful push (or a merge that needed none): a key is no
  // longer dirty once the value now on the server is the value we hold.
  function clearPushedDirty(pushedBag) {
    const meta = bagMeta();
    let changed = false;
    for (const k of Object.keys(meta.dirty)) {
      const pushed = hasOwn(pushedBag, k) ? pushedBag[k] : null;
      if (lsGet(k) === pushed) { delete meta.dirty[k]; changed = true; }
    }
    if (changed) setBagMeta(meta);
  }

  // ── Account ownership gate (#109) ────────────────────────────────────
  // Local account data is tagged with the username it belongs to. Before a
  // sign-in may pull, merge or drain, the tag must match the account signing
  // in. On a mismatch the previous owner's queue is never drained and
  // nothing is merged until the person chooses, in a dialog, what happens to
  // that data.
  function hasAccountData() {
    const armies = jsonGet('yaab_armies', []);
    if (Array.isArray(armies) && armies.length) return true;
    if (queue().length) return true;
    for (const k of SYNCED_BAG_KEYS) {
      if (k === 'yaab_theme' || k === 'yaab_recents') continue;
      const v = lsGet(k);
      if (v != null && v !== '' && v !== '{}' && v !== '[]') return true;
    }
    return false;
  }

  // Forget everything sync knows about the previous account's server state,
  // so the next pull treats the local copy as unclaimed rather than as the
  // new account's.
  function resetSyncMetadata() {
    setQueue([]);
    rawRemove(KNOWN_KEY);
    rawRemove(STATE_BAG_TS);
    rawRemove(BAG_META_KEY);
  }

  function cancelTimers() {
    if (_armyTimer) { clearTimeout(_armyTimer); _armyTimer = null; }
    if (_bagTimer) { clearTimeout(_bagTimer); _bagTimer = null; }
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; _draining = false; }
  }

  // Remove every account-scoped key and reset the in-memory army list. The
  // in-memory reset comes first and matters: autosave's beforeunload flush
  // would otherwise write the old armies straight back during the reload.
  // Callers reload the page afterwards, which is what resets every OTHER
  // module's in-memory copy (reserves QTY, favorites, collection, custom
  // names…) — removing keys alone left those to write the data back.
  function wipeAccountData() {
    try {
      const mgr = mgrOf();
      if (mgr) {
        mgr.armies = [];
        if (App.state) App.state.currentArmy = mgr.newArmy();
      }
    } catch (_) {}
    cancelTimers();
    for (const k of ACCOUNT_LOCAL_KEYS) {
      try { rawRemove(k); } catch (_) {}
    }
    try { window.dispatchEvent(new CustomEvent('yaab:sync-queue')); } catch (_) {}
  }

  // Reload with a toast to show on the other side. The key is the one
  // App.Auth.init() reads (js/app/auth.js FLASH_KEY).
  function reloadPage(flashText) {
    if (flashText) {
      try { sessionStorage.setItem('yaab_flash_toast', JSON.stringify({ text: flashText, type: 'info', ms: 5000 })); } catch (_) {}
    }
    try { window.location.reload(); } catch (_) {}
  }

  async function askOwnerChoice(owner, user) {
    if (!(window.UI && typeof UI.showAuthChoice === 'function')) return null;
    const pending = queue().length;
    const message = [
      `The armies and settings on this device belong to "${owner}". You are signed in as "${user}". Nothing will sync until you choose:`,
      `Keep as local copies — their armies stay on this device but never upload to your account (use Save as… to copy one into it). Their collection, reserves and settings here are replaced by yours.`,
      `Remove them — everything of theirs is deleted from this device. Whatever they had already synced is still in their account.`,
    ];
    if (pending) {
      message.push(`${pending} of their change${pending === 1 ? ' has' : 's have'} not synced yet and will not sync from here.`);
    }
    return UI.showAuthChoice({
      title: 'This device has another account’s data',
      message,
      dismissible: false,
      choices: [
        { id: 'keep',    label: 'Keep as local copies', className: 'btn btn-accent' },
        { id: 'remove',  label: 'Remove them',          className: 'btn btn-danger' },
        { id: 'signout', label: 'Sign out instead',     className: 'btn btn-outline' },
      ],
    });
  }

  function keepAsLocalCopies(prevOwner, user) {
    const stored = jsonGet('yaab_armies', []);
    const armies = Array.isArray(stored) ? stored.filter(d => d && typeof d.id === 'string') : [];
    const prevParks = new Map();
    for (const e of parked()) if (e && e.reason === 'owner' && e.id) prevParks.set(e.id, e);
    const next = [];
    for (const d of armies) {
      const prev = prevParks.get(d.id);
      const realOwner = (prev && prev.owner) || prevOwner;
      // An army parked from an earlier switch that belongs to the person
      // signing in now is theirs again: let it sync.
      if (realOwner === user) continue;
      next.push({
        op: 'putArmy', id: d.id, name: typeof d.name === 'string' ? d.name : '',
        status: null, reason: 'owner', owner: realOwner, at: nowIso(),
      });
    }
    setParked(next);
    resetSyncMetadata();
    for (const k of SYNCED_BAG_KEYS) rawRemove(k);
    rawSet(OWNER_KEY, user);
  }

  // Resolves true when sync may proceed for the signed-in user.
  async function gateOwner() {
    const user = currentUsername();
    if (!user || !authReady()) return false;
    if (_ownerBlocked) return false;          // dialog already up
    const owner = storedOwner();
    if (owner === user) return true;
    if (!owner) {
      // Legacy device (no tag yet) or data made while signed out: this
      // account claims it, which is the long-standing "sign in to sync your
      // armies" behaviour.
      rawSet(OWNER_KEY, user);
      return true;
    }
    if (!hasAccountData()) {
      // Nothing of the previous account's worth asking about — but its sync
      // bookkeeping must not be read as this account's.
      resetSyncMetadata();
      rawSet(OWNER_KEY, user);
      return true;
    }
    _ownerBlocked = true;
    cancelTimers();
    let choice = null;
    try { choice = await askOwnerChoice(owner, user); } catch (_) { choice = null; }
    // Both choices reload: it is the only reset that reaches every module's
    // in-memory copy of the previous account's bag (see wipeAccountData).
    if (choice === 'keep') {
      keepAsLocalCopies(owner, user);
      reloadPage(`Kept ${owner}'s armies on this device as local-only copies.`);
      return false;
    }
    if (choice === 'remove') {
      wipeAccountData();
      rawSet(OWNER_KEY, user);
      reloadPage(`Removed ${owner}'s data from this device.`);
      return false;
    }
    if (choice === 'signout') {
      try { if (App.Auth && typeof App.Auth.logout === 'function') await App.Auth.logout(); } catch (_) {}
      _ownerBlocked = false;
      toast('Signed out — nothing was synced.', 'info', 3500);
      return false;
    }
    // No dialog available: stay blocked for this page load rather than
    // guess. Sign-out still works; a reload asks again.
    return false;
  }

  async function onSignedIn() {
    const ok = await gateOwner();
    if (!ok) return;
    try { await pullAll(); } catch (_) {}
  }

  // ── Pull / claim flow ────────────────────────────────────────────────
  // On login (or first boot when signed in): pull cloud summaries and the
  // state bag, merge with local by per-army updated_at, push anything that's
  // locally-newer or new, adopt anything cloud-newer.
  //
  // Returns null — and touches nothing — when it cannot get a complete,
  // trustworthy picture of the cloud: offline, or either GET failed. A
  // failed GET /armies used to be read as "the cloud has no armies", which
  // made loop 2 delete every synced army on the device (#108).
  async function pullAll() {
    if (!syncAllowed()) return null;
    if (_pulling) return null;
    if (isOffline()) return null;
    _pulling = true;
    try {
      let cloudSummaries, cloudState;
      try {
        [cloudSummaries, cloudState] = await Promise.all([
          apiFetch(API_ARMIES),
          apiFetch(API_STATE),
        ]);
      } catch (e) {
        if (e && e.status === 401) throw e;
        if (!_pullFailLogged) {
          _pullFailLogged = true;
          try { console.warn('[sync] pull skipped — could not read the cloud:', (e && e.message) || e); } catch (_) {}
        }
        return null;
      }
      // GET /state answers a literal null when the account has no bag; GET
      // /armies always answers an array. Anything else is not a picture of
      // the cloud we can merge against.
      if (!Array.isArray(cloudSummaries) ||
          (cloudState !== null && (typeof cloudState !== 'object' || Array.isArray(cloudState)))) {
        if (!_pullFailLogged) {
          _pullFailLogged = true;
          try { console.warn('[sync] pull skipped — unexpected response shape'); } catch (_) {}
        }
        return null;
      }
      _pullFailLogged = false;
      // The session may have changed while we waited (sign-out, account
      // switch). Merging now would write into the wrong account's data.
      if (!syncAllowed()) return null;

      const cloudIndex = new Map();
      for (const s of cloudSummaries) if (s && s.id) cloudIndex.set(s.id, s);

      const mgr = mgrOf();
      const localArmies = mgr ? mgr.armies.slice() : [];
      const localIndex = new Map();
      for (const a of localArmies) localIndex.set(a.id, a);
      const parkedIds = parkedArmyIds();

      const currentId = (App.state && App.state.currentArmy) ? App.state.currentArmy.id : null;
      let mergedFromCloud = 0;
      let uploadedLocal = 0;
      const adoptions = [];
      // `known` changes are collected and written only after yaab_armies has
      // been saved (step 4). Writing known for an army that never reached
      // localStorage (quota) made the next pull queue a cloud delete for it.
      const knownPut = {};
      const knownDel = new Set();

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
            // Name guard: a cloud-only army that fails the local keep guard
            // (still on the "New Army" placeholder with no units) is residue
            // from before the guard existed. Don't adopt it locally; queue
            // a delete so the cloud copy goes away too.
            if (army && !isKeepable(army)) {
              enqueue({ op: 'deleteArmy', id });
              return;
            }
            if (army && mgr) {
              // Pin the army's updatedAt to the server's row
              // timestamp (same reason as the merge path below — keep
              // future pullAll comparisons equal).
              const newTs = full.updated_at || summ.updated_at || nowIso();
              army.updatedAt = newTs;
              mgr.armies.push(army);
              mergedFromCloud++;
              knownPut[id] = newTs;
            }
          } catch (_) {}
        })());
      }

      // 2. Both sides have it → compare timestamps.
      let deletedFromCloud = 0;
      for (const local of localArmies) {
        // Parked armies (refused by the server, or another account's local
        // copies) are left exactly as they are.
        if (parkedIds.has(local.id)) continue;
        const summ = cloudIndex.get(local.id);
        if (!summ) {
          // Local has it, cloud doesn't. Mirror of loop 1's known-set
          // discriminator: if we've previously synced this id to cloud
          // (knownAtPull has it) and cloud is now missing it, another
          // device deleted it — propagate the delete locally instead of
          // re-uploading. Without this, every pullAll after a remote
          // delete enqueues a putArmy that resurrects the army on cloud,
          // and on the next round-trip the other device adopts it back.
          // If it's NOT in known, it's genuinely new on this device
          // (created offline, etc.) and should be uploaded.
          if (knownAtPull[local.id]) {
            if (mgr) {
              const idx = mgr.armies.findIndex(a => a.id === local.id);
              if (idx >= 0) mgr.armies.splice(idx, 1);
              knownDel.add(local.id);
              if (local.id === currentId && App.state) {
                App.state.currentArmy = mgr.newArmy();
                mgr.currentArmy = App.state.currentArmy;
              }
              deletedFromCloud++;
            }
          } else {
            enqueue({ op: 'putArmy', id: local.id });
            uploadedLocal++;
          }
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
              // If cloud's newer version fails the keep guard (legacy
              // state from before the guard), don't pull it down — queue a
              // delete.
              if (newArmy && !isKeepable(newArmy)) {
                enqueue({ op: 'deleteArmy', id: local.id });
                return;
              }
              if (newArmy && mgr) {
                // Same pin as the runOp path — keep the army's
                // updatedAt aligned with the server's row timestamp so
                // the next pullAll's `cloudTs > localTs` check is
                // equal, not greater. Without this, a push from device
                // A whose row gets a server-clock timestamp slightly
                // ahead of the payload's "saved at" caused device B
                // to re-pull on every subsequent pullAll → repeating
                // "Army updated from another device" toasts.
                const newTs = full.updated_at || cloudTs;
                if (newTs) newArmy.updatedAt = newTs;
                const idx = mgr.armies.findIndex(a => a.id === local.id);
                if (idx >= 0) mgr.armies[idx] = newArmy;
                if (local.id === currentId && App.state) {
                  App.state.currentArmy = newArmy;
                  mgr.currentArmy = newArmy;
                  toast('Army updated from another device.', 'info', 3500);
                }
                mergedFromCloud++;
                knownPut[local.id] = newTs;
              }
            } catch (_) {}
          })());
        } else {
          // Equal timestamps — already in sync. Make sure known has it.
          knownPut[local.id] = cloudTs || localTs;
        }
      }

      await Promise.all(adoptions);
      if (!syncAllowed()) return null;

      // 3. State bag — per-key merge (see mergeBag). Skipped when the cloud
      // bag is the version we last synced and nothing here is dirty.
      const meta = bagMeta();
      const anyDirty = Object.keys(meta.dirty).length > 0;
      const lastBagTs = jsonGet(STATE_BAG_TS, '');
      const cloudBagTs = (cloudState && typeof cloudState.updated_at === 'string') ? cloudState.updated_at : '';
      if (!(cloudBagTs && cloudBagTs === lastBagTs && !anyDirty)) {
        const m = mergeBag(cloudState);
        applyCloudWinners(m);
        if (m.needPush) {
          enqueue({ op: 'putState' });
        } else if (cloudBagTs) {
          jsonSet(STATE_BAG_TS, cloudBagTs);
          clearPushedDirty(m.bag);
        }
      }

      // 4. Persist locally, then (only if that worked) the known-set.
      const saved = mgr ? (mgr.save() !== false) : true;
      if (saved && localSaveOk()) {
        const k = known();
        for (const id of Object.keys(knownPut)) k[id] = knownPut[id];
        for (const id of knownDel) delete k[id];
        setKnown(k);
      }
      if (!storedOwner()) rawSet(OWNER_KEY, currentUsername());

      // Re-render. If the user is sitting on the empty default "New Army"
      // placeholder (created at boot before sign-in), switch them to a
      // stored army so the synced content actually shows. Skip if they've
      // already started editing — entries.length > 0 or non-default name.
      //
      // Only ever on the FIRST pull of this page load. This exists for the
      // boot / just-signed-in case (commit 86942bb); pullAll also runs on
      // every `visibilitychange → visible`, and left ungated it would grab
      // a placeholder the user had deliberately opened — click New Army,
      // go away for a bit, come back, and the app has swapped you onto an
      // old army. Deliberately starting a new list is not "untouched".
      const cur = App.state && App.state.currentArmy;
      const curIsUntouched = !!cur && !!mgr
        && (!cur.entries || cur.entries.length === 0)
        && (cur.name === 'New Army' || !cur.name)
        && !mgr.armies.some(a => a.id === cur.id);
      if (!_promotedPlaceholder && mgr && mgr.armies.length > 0 && curIsUntouched) {
        _promotedPlaceholder = true;
        // Prefer whichever army this device last had open (state.js keeps
        // the id); most-recently-updated is only the fallback.
        const rememberedId = typeof App.getPersistedCurrentArmyId === 'function'
          ? App.getPersistedCurrentArmyId()
          : null;
        const sorted = [...mgr.armies].sort((a, b) =>
          new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
        );
        const pick = (rememberedId && mgr.armies.find(a => a.id === rememberedId)) || sorted[0];
        App.state.currentArmy = pick;
        mgr.currentArmy = pick;
      }
      if (App && typeof App.renderAll === 'function') App.renderAll();

      // Re-sync the Build-mode dropdowns (faction / chapter / detachment)
      // to the post-pull currentArmy. Without this, replacing currentArmy
      // with a newer-from-cloud copy that has different selections leaves
      // the dropdowns showing the OLD picks (or, more visibly, can leave
      // the detachment list empty if the visibility-change pull lands
      // while the user happens to be on the placeholder). Skip when the
      // selections module isn't ready yet.
      try {
        const cur2 = App.state && App.state.currentArmy;
        if (cur2 && typeof App.applyImportedSelections === 'function') {
          App.applyImportedSelections(cur2.factionName, cur2.chapter, cur2.detachmentNames);
        }
      } catch (_) { /* dropdown re-sync is best-effort */ }

      // 5. Toast + drain.
      const parts = [];
      if (mergedFromCloud) parts.push(`${mergedFromCloud} from cloud`);
      if (uploadedLocal)   parts.push(`${uploadedLocal} uploading`);
      if (deletedFromCloud) parts.push(`${deletedFromCloud} deleted elsewhere`);
      if (parts.length) toast(`Synced: ${parts.join(', ')}.`, 'info', 3500);
      // Released before the drain: drainQueue bails while _pulling is set.
      _pulling = false;
      drainQueue();
      return { mergedFromCloud, uploadedLocal };
    } finally {
      _pulling = false;
    }
  }

  // "Sync now": re-arm parked ops, cut any backoff short, pull, drain.
  async function syncNow() {
    retryParked();
    kickRetry();
    let res = null;
    try { res = await pullAll(); } catch (_) {}
    drainQueue();
    return res;
  }

  // ── Monkey-patch localStorage for the bag-key allowlist ──────────────
  function installStoragePatch() {
    const proto = Object.getPrototypeOf(localStorage) || Storage.prototype;
    const origSet = proto.setItem.bind(localStorage);
    const origRemove = proto.removeItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      const track = !_suppressMonkeyPatch && BAG_KEY_SET.has(key);
      const before = track ? lsGet(key) : null;
      origSet(key, value);
      if (!track) return;
      // Many modules re-persist unchanged state; only a real change is an
      // edit (it bumps the key's change time and queues a push).
      if (before === String(value)) return;
      noteLocalBagChange(key);
      notifyKeyChanged(key);
    };
    localStorage.removeItem = function (key) {
      const track = !_suppressMonkeyPatch && BAG_KEY_SET.has(key);
      const before = track ? lsGet(key) : null;
      origRemove(key);
      if (!track || before === null) return;
      noteLocalBagChange(key);
      notifyKeyChanged(key);
    };
  }

  // First run after the per-key merge shipped: there are no change times
  // yet. If a bag push was still queued from before, those edits are
  // unpushed — mark the keys dirty so the first merge keeps them instead of
  // letting the cloud win every key.
  function migrateBagMeta() {
    if (lsGet(BAG_META_KEY) != null) return;
    const meta = { t: {}, dirty: {} };
    if (queue().some(e => e && e.op === 'putState')) {
      for (const k of SYNCED_BAG_KEYS) if (lsGet(k) != null) meta.dirty[k] = true;
    }
    setBagMeta(meta);
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
      if (syncAllowed()) diffAndEnqueueArmies();
    }
    if (_bagTimer) {
      clearTimeout(_bagTimer);
      _bagTimer = null;
      if (syncAllowed()) enqueue({ op: 'putState' });
    }
  }

  // ── Cross-tab + connectivity listeners ───────────────────────────────
  function installListeners() {
    // Pull before draining: a device that comes back online with queued
    // edits for an army another device deleted meanwhile would otherwise
    // re-create it (PUT re-inserts a deleted row). pullAll drains at the end;
    // if the pull cannot run, drain anyway.
    window.addEventListener('online', () => {
      kickRetry();
      if (!syncAllowed()) return;
      pullAll().then(r => { if (r == null) drainQueue(); }).catch(() => {});
    });
    // No work needed here — drainQueue() already hard-returns while
    // offline, so ops just sit in the queue. The offline pip
    // (js/ui/offline-pip.js) listens for this event itself, plus 'online'
    // and 'yaab:sync-queue' (dispatched from setQueue above), to render.
    window.addEventListener('offline', () => {});

    // pagehide fires on reload, navigation, and tab close (more reliable
    // than beforeunload, especially on mobile bfcache). Flush the
    // debounce so pending edits aren't lost on quick reload.
    window.addEventListener('pagehide', flushPendingNow);

    window.addEventListener('storage', (e) => {
      if (!e || !e.key) return;
      if (e.key === 'yaab_armies') {
        const mgr = mgrOf();
        if (mgr) {
          mgr.armies = mgr._load();
          // _load() rebuilds every Army as a NEW object, so App.state
          // .currentArmy is now a detached copy of a row that's still in
          // the list — the other tab's edits don't show, and this tab's
          // next save writes the pre-reload content back over them.
          // Re-point at the reloaded object with the same id.
          const cur = App.state && App.state.currentArmy;
          if (cur) {
            const fresh = mgr.armies.find(a => a.id === cur.id);
            if (fresh && fresh !== cur) {
              App.state.currentArmy = fresh;
              mgr.currentArmy = fresh;
            }
          }
          if (typeof App.renderAll === 'function') App.renderAll();
        }
      }
      // We don't react to yaab_sync_queue cross-tab — we'd just re-attempt
      // on our own. The other tab is already draining.
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && syncAllowed()) {
        // Pull first (spots cross-device updates and deletes), which drains
        // at the end; drain directly only if the pull could not run.
        pullAll().then(r => { if (r == null) drainQueue(); }).catch(() => {});
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
    migrateBagMeta();
    installStoragePatch();
    installListeners();
    if (App.Auth && typeof App.Auth.onChange === 'function') {
      App.Auth.onChange((user) => {
        if (user) {
          // Just signed in — check whose data this is, then pull and drain.
          onSignedIn();
        }
        // Sign-out: keep the queue so the SAME account can pick it up on
        // its next sign-in here. A different account never drains it — the
        // owner gate (gateOwner) stops that.
      });
    }
    // If we already booted signed in, kick a pull now.
    if (authReady()) onSignedIn();
  }

  App.Sync = {
    init,
    // Exported for App.Auth.signOut() — see the comment on ACCOUNT_LOCAL_KEYS.
    // Frozen: callers read it, nobody mutates it.
    ACCOUNT_LOCAL_KEYS,
    SYNCED_BAG_KEYS: Object.freeze(SYNCED_BAG_KEYS.slice()),
    OWNER_KEY,
    notifyArmiesChanged,
    notifyKeyChanged,
    pullAll,
    drainQueue,
    drainNow,
    syncNow,
    retryParked,
    wipeAccountData,
    queueLength,
    parkedCount() { return parked().filter(e => e && e.reason !== 'owner').length; },
    status() {
      return {
        signedIn: authReady(),
        owner: storedOwner(),
        blocked: _ownerBlocked || (authReady() && !ownerMatches()),
        queueLength: queue().length,
        parked: parked().length,
        backoffMs: _backoffMs,
        pulling: _pulling,
        draining: _draining,
      };
    },
  };
})();
