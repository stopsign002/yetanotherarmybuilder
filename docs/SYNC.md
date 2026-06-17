# SYNC.md

Reference for the offline-first cloud sync layer. Frontend lives in [sync.js](../js/app/sync.js); the server side it talks to is [armies.js](../../api/armies.js) and [state.js](../../api/state.js). Read this before debugging or extending sync.

The system is *offline-first*: every write hits localStorage first and the network is only an eventually-consistent best-effort second hop. The whole layer revolves around an idempotent op queue, debounced flushes, and last-write-wins reconciliation against the server.

## 1. What syncs and what doesn't

### Synced

- **`yaab_armies`** — pushed *per id* as a full payload, not as a single bag. Every army is its own server row keyed by the client-generated `id`. See `runOp` in [sync.js#L228](../js/app/sync.js#L228) and the `payload` column in [armies.js#L65](../../api/armies.js#L65).
- **The "synced bag"** — a small allowlist of localStorage keys that get pushed together as one opaque blob to `/api/state`. Currently:
  - `yaab_favorites`
  - `yaab_recents`
  - `yaab_collection`
  - `yaab_crusade_rosters`
  - `yaab_deployments`
  - `yaab_points_overrides`

  See `SYNCED_BAG_KEYS` in [sync.js#L21](../js/app/sync.js#L21).

### NOT synced (intentional)

- **Device prefs** — `yaab_sound_enabled`, `yaab_voice_enabled`, `yaab_reduced_motion` (if any), `yaab_pwa_dismissed`, `yaab_mobile_panel`. These are per-device by design.
- **Ephemeral game-day state** — `yaab_match_state`, `yaab_opponent`. Live for one game and shouldn't bleed across devices.
- **Faction game data** — comes from the embedded 40kdc bundle (`window.DC`, via `js/data/dc-adapter.js`), rebuilt locally each load. It's a deterministic function of the dataset, never user data, so it's never synced. (Sync is data-source-agnostic regardless.)
- **Auth hint** — `yaab_auth_session_hint` is a UI hint, not user data. The cookie is the truth.

If you add a new feature with a `yaab_*` localStorage key, decide deliberately: bag-synced (add to `SYNCED_BAG_KEYS`) or device-local (don't).

## 2. Storage keys owned by sync

| Key | Holds | Written by |
|---|---|---|
| `yaab_sync_queue` | FIFO array of op envelopes `{op, id?, ts, mutationId}` | `enqueue` ([sync.js#L108](../js/app/sync.js#L108)), `setQueue` |
| `yaab_sync_known` | Object `{ armyId -> updated_at }`, the server timestamp we believe is current for each id | `runOp` after a successful PUT ([sync.js#L278](../js/app/sync.js#L278)), `pullAll` adoptions ([sync.js#L355](../js/app/sync.js#L355)) |
| `yaab_sync_state_at` | ISO string, last successful state-bag push timestamp | `runOp` `putState` branch ([sync.js#L295](../js/app/sync.js#L295)), `pullAll` after a cloud-newer adopt ([sync.js#L429](../js/app/sync.js#L429)) |

All three are written through `jsonSet` / `rawSet` which flip `_suppressMonkeyPatch` so sync's own writes don't recursively re-trigger sync.

## 3. Op queue

Op shapes (see comment block at [sync.js#L104](../js/app/sync.js#L104)):

```js
{ op: 'putArmy',    id, mutationId, ts }
{ op: 'deleteArmy', id, mutationId, ts }
{ op: 'putState',       mutationId, ts }
```

**Coalescing.** `enqueue` ([sync.js#L108](../js/app/sync.js#L108)) filters out any prior op with the same `op` *and* same `id` before appending the new one — so 50 rapid edits to one army collapse to a single trailing `putArmy` for that id, and likewise repeated `putState` ops collapse. `id == null` matches `id == null` so `putState` coalesces against itself.

**Cap.** `QUEUE_MAX = 200`. If the queue overflows we drop the oldest and toast a warning ([sync.js#L116](../js/app/sync.js#L116)).

**mutationId.** A UUIDv4-ish string built from `crypto.getRandomValues` ([sync.js#L53](../js/app/sync.js#L53)). The client uses it as a "did we already pop this entry?" sentinel inside `drainQueue` (a concurrent enqueue could change index 0 mid-await; we only pop if the head still matches). The server *receives* it as `mutation_id` in the PUT body but doesn't currently use it — see section 13.

**Pop on success only.** `drainQueue` ([sync.js#L194](../js/app/sync.js#L194)) reads `q[0]`, awaits `runOp`, then re-reads the queue and shifts only if the head's `mutationId` still matches. On failure we leave the head in place and back off.

## 4. Debounce + flush

Two debounces, two paths:

- `notifyArmiesChanged` → diff against `known` → enqueue `putArmy`/`deleteArmy` → drain. Debounce **`ARMY_DEBOUNCE = 500ms`**. See [sync.js#L146](../js/app/sync.js#L146).
- `notifyKeyChanged(key)` → enqueue `putState` → drain. Debounce **`BAG_DEBOUNCE = 1500ms`**. See [sync.js#L156](../js/app/sync.js#L156).

The army path is invoked from `ArmyManager.save()` ([army.js#L115](../js/army.js#L115)). The bag path is invoked by the localStorage monkey-patch ([sync.js#L478](../js/app/sync.js#L478)) on any allowlisted key write.

### `flushPendingNow()` and pagehide — load-bearing

`flushPendingNow` ([sync.js#L497](../js/app/sync.js#L497)) cancels both pending timers and runs their work *synchronously* so the queue ends up persisted in localStorage before navigation. It's wired to the `pagehide` event ([sync.js#L518](../js/app/sync.js#L518)).

History: without this, the sequence "edit → Save → reload within 500ms" would let the page tear down before the debounce timer fired, the diff never ran, no `putArmy` op was ever enqueued, and the edit silently never reached cloud. (Commit `64e7f3b`.) `pagehide` is used instead of `beforeunload` because it fires reliably on mobile bfcache and tab-close.

## 5. Push direction (`drainQueue` → `runOp`)

Happy path is dull: pop op, hit the API, update `known`, repeat. The interesting branches all live in `runOp` ([sync.js#L228](../js/app/sync.js#L228)).

### LWW response handling — "the server's row was newer than what we sent"

The server does last-write-wins via a single-statement `INSERT … ON CONFLICT … DO UPDATE` that only writes when `EXCLUDED.updated_at >= armies.updated_at` ([armies.js#L83](../../api/armies.js#L83)). On a stale-incoming-ts the row is unchanged and the response echoes the *cloud's* current `updated_at`, which won't match the `updated_at` we sent up.

That's the signal. In `runOp` `putArmy` we compare `newTs` vs `body.updated_at` ([sync.js#L258](../js/app/sync.js#L258)). If they differ:

1. GET the cloud row.
2. Decode the payload via `Army.fromJSON` (preserves timestamps — see section 8).
3. Splice into `mgr.armies` at the same index.
4. If this id is `App.state.currentArmy`, swap `App.state.currentArmy` *and* `mgr.currentArmy` and toast.
5. `mgr.save()` + `App.renderAll()`.

Then we update `known[id]` to the cloud ts.

If we *didn't* do this adopt step, the next `diffAndEnqueueArmies` would compare local's `updatedAt` (still stale) against `known[id]` (now the server ts) — they wouldn't match, so we'd enqueue another `putArmy`, which the server would reject again with the same response, looping forever. (Commit `3ecc859`.)

### Convert-to-delete

If a `putArmy` op fires for an id that's no longer in `mgr.armies` (the user deleted it locally between enqueue and drain), and we have it in `known`, we convert the op to a DELETE on the wire ([sync.js#L233](../js/app/sync.js#L233)). The queue entry is consumed either way.

## 6. Pull direction (`pullAll`)

`pullAll` ([sync.js#L322](../js/app/sync.js#L322)) is the merge engine. It runs:

- on `App.Auth.onChange` when `user` becomes truthy (sign-in),
- on initial boot if already signed in,
- on `visibilitychange → visible` (a light pull to spot cross-device updates).

It's gated by `_pulling` so concurrent `visibilitychange` events don't pile on. `drainQueue` also bails while `_pulling` is true ([sync.js#L197](../js/app/sync.js#L197)).

It fetches `GET /armies` (summaries only) and `GET /state` in parallel, then runs four sections in order:

### 6.1. Cloud-only ids → fetch full + adopt

For each id present in cloud but not local: GET the full payload, decode, push onto `mgr.armies`, set `known[id]` ([sync.js#L346](../js/app/sync.js#L346)).

### 6.2. Both sides have it → compare timestamps

For each local army with a cloud counterpart ([sync.js#L364](../js/app/sync.js#L364)):

- **Local-only** (no cloud counterpart) → enqueue `putArmy`.
- **`localTs > cloudTs`** → enqueue `putArmy`. `drainQueue` will push it.
- **`cloudTs > localTs`** → fetch + adopt. **Including when this is the active `currentArmy`** — swap `App.state.currentArmy` and `mgr.currentArmy` to the new object and toast `"Army updated from another device."` (Commit `143de8f` — earlier the active army was protected from cloud-newer pulls and *uploaded local instead*, which silently clobbered fresh saves from another device.)
- **Equal timestamps** — already in sync, just refresh `known[id]`.

Cloud-only adoptions and cloud-newer adoptions are kicked off as parallel promises and `await Promise.all`'d ([sync.js#L415](../js/app/sync.js#L415)).

### 6.3. State bag (KV)

Three branches at [sync.js#L417](../js/app/sync.js#L417):

- **Cloud-newer** (`cloudBagTs > localBagTs` and cloud has a payload) — parse the bag, then for each allowlisted key write through `rawSet` / `rawRemove` (which flip `_suppressMonkeyPatch` to keep these adopt-writes from re-triggering `notifyKeyChanged`). Update `yaab_sync_state_at`.
- **Cloud-empty / no cloud row** — if our local bag has anything, enqueue `putState`.
- **Local-newer** — falls through; the running app will already enqueue `putState` whenever a synced key gets written.

### 6.4. Promote untouched currentArmy

If, after section 2, `App.state.currentArmy` is still the *fresh boot placeholder* — empty `entries`, name `'New Army'` (or empty), and not in `mgr.armies` — promote the most-recently-updated stored army to `currentArmy` ([sync.js#L444](../js/app/sync.js#L444)).

History: without this, signing in on a fresh device would pull the user's armies into `mgr.armies` but leave `App.state.currentArmy` as the empty placeholder created at boot, so the user saw their list of saved armies but the main view showed an empty new-army screen. (Commit `86942bb`.)

After all four sections: `mgr.save()`, `App.renderAll()`, toast a summary, kick `drainQueue`.

## 7. Conflict semantics

- **Most-recent timestamp wins**, full-blob replace. No field-level merge, no three-way diff.
- The active army on this device is **not** protected from a newer cloud copy. It will be replaced in place and the user gets a toast. This is deliberate (see section 6.2 history).
- The state bag is a single opaque blob — there's no per-key timestamp. If both devices edited the bag offline, the most recent push wins the entire bag. Acceptable because the bag is small and rarely loses anything important (favorites, recents, etc.).

## 8. Timestamps — the load-bearing invariant

`Army.updatedAt` is **the** contract that drives every conflict decision in this layer. It is set at construction and bumped on every mutating method (`addUnit`, `removeEntry`, `updateCount`, `setEnhancements` — see [army.js#L48](../js/army.js#L48)).

The `Army` constructor preserves `createdAt` and `updatedAt` when they're passed in — i.e. when rehydrating from `Army.fromJSON` ([army.js#L94](../js/army.js#L94)) which forwards both fields from the persisted JSON ([army.js#L80](../js/army.js#L80)):

```js
this.createdAt = createdAt || new Date().toISOString();
this.updatedAt = updatedAt || new Date().toISOString();
```

The `||` fallback only fires for *brand new* armies. Round-trip through `toJSON` / `fromJSON` is lossless.

History: an earlier version of the constructor unconditionally set `updatedAt = new Date().toISOString()` on every load. That made every device's local copy look "newer" than cloud the instant the page loaded, every diff turned into a `putArmy`, and every save on another device got clobbered the next time this device drained. **Don't undo this.** The comment in [army.js#L14](../js/army.js#L14) calls it out — leave it alone.

## 9. Auth integration

- Sync only runs when `App.Auth.isSignedIn()` returns true. Every entry point (`notifyArmiesChanged`, `notifyKeyChanged`, `drainQueue`, `pullAll`) early-returns otherwise — see `authReady` at [sync.js#L84](../js/app/sync.js#L84).
- Init wires `App.Auth.onChange` ([sync.js#L555](../js/app/sync.js#L555)). Sign-in triggers a `pullAll`. Sign-out is a no-op for sync — we deliberately keep the queue around in case the user signs back into the same account on this device.
- **401 handling.** Any `apiFetch` that gets a 401 invokes `App.Auth.handleSessionExpired()` ([sync.js#L176](../js/app/sync.js#L176)) which flips local state to signed-out and toasts. The fetch itself rejects with a 401 error which `drainQueue` catches and bails on ([sync.js#L216](../js/app/sync.js#L216)) — no backoff, no retry, the auth layer takes it from here.
- See [auth.js#L175](../js/app/auth.js#L175) for `handleSessionExpired`.

## 10. Cross-tab + connectivity

Listeners are installed in `installListeners` ([sync.js#L511](../js/app/sync.js#L511)):

| Event | Behavior |
|---|---|
| `online` | Reset `_backoffMs`, `drainQueue`. |
| `offline` | No-op (placeholder for a future offline pip). |
| `pagehide` | `flushPendingNow` — see section 4. |
| `storage` (cross-tab) | If the changed key is `yaab_armies`, reload `mgr.armies` from `mgr._load()` and re-render. We deliberately don't react to `yaab_sync_queue` — the originating tab is already draining, and the listener tab would just race. |
| `visibilitychange → visible` | `drainQueue` + `pullAll` to spot cross-device updates. |

`BroadcastChannel('yaab-sync')` is allocated when available ([sync.js#L542](../js/app/sync.js#L542)) and `bcPost` is called from `drainQueue` after each successful push, but the receive handler is a no-op placeholder. Reserved for future cross-tab coordination (e.g. "stop draining, the other tab already has it").

## 11. Failure modes

- **Network errors / 5xx** during `drainQueue` → exponential backoff via `_backoffMs`, capped at `BACKOFF_MAX_MS = 30000` ([sync.js#L218](../js/app/sync.js#L218)). The head op stays in the queue; we resume after the timeout.
- **401** → bail and let the auth layer take over (see section 9). No backoff — we'd just hit it again.
- **Unparseable cloud payload** in `pullAll` adoptions → swallowed in a `catch (_) {}`. The local copy is kept. Logged-warnings could be added later but currently aren't.
- **Queue overflow** at `QUEUE_MAX = 200` → drop oldest, toast.

## 12. What the server enforces

See [armies.js](../../api/armies.js) and [state.js](../../api/state.js). The relevant invariants:

- **Last-write-wins** is implemented in SQL. Both `armies` PUT ([armies.js#L83](../../api/armies.js#L83)) and `state` PUT ([state.js#L44](../../api/state.js#L44)) are single-statement `INSERT … ON CONFLICT … DO UPDATE` with a `CASE WHEN EXCLUDED.updated_at >= row.updated_at` guard. Stale writes are discarded silently and the response echoes the current row's `updated_at` so the client can detect the discard (section 5).
- **Cross-user PUT** on an existing army id returns **403** (`"Army belongs to another user."` — [armies.js#L94](../../api/armies.js#L94)). The PK collision goes through the `DO UPDATE` branch but the `CASE` only updates if `armies.user_id = EXCLUDED.user_id`, then the route compares the returned `user_id` to the caller's. We never silently overwrite someone else's army.
- **Validation** — id matches `^[A-Za-z0-9_-]{1,128}$`, name ≤ 200 chars, payload ≤ 1 MB, timestamps parsed via `Date.parse`. Any failure is a 400.

For the broader endpoint shape (auth cookies, rate-limit, schema), see the project root [CLAUDE.md](../../CLAUDE.md) and the source files directly.

## 13. Don't break

- **`Army.toJSON()` / `Army.fromJSON()` shape.** Cloud payloads are JSON of `toJSON()`. Any field you add must round-trip; any field you rename or drop will break previously-saved cloud rows. Bump payload format with care.
- **The `Army` constructor preserving `createdAt` / `updatedAt`.** See section 8. This is the single most subtle invariant in the system.
- **`mutation_id` in the PUT body.** The client always sends it ([sync.js#L247](../js/app/sync.js#L247)); the server currently ignores it but the field is reserved for planned dedup (idempotent retries when a request succeeded server-side but the response didn't reach us). Leave the field in place. When the server starts tracking it, the client side is already correct.
- **Sync owns the `Storage.prototype.setItem` / `removeItem` monkey-patch** ([sync.js#L474](../js/app/sync.js#L474)). Don't restore originals from another module, and don't add another monkey-patch — they would compose unpredictably. If you need to write a synced key without triggering a push (for example, while adopting cloud state), use the `_suppressMonkeyPatch`-aware helpers exposed inside `sync.js` rather than reaching for `localStorage` directly. New code outside `sync.js` should just write normally; the patch handles routing.
- **Don't add a synced key without adding it to `SYNCED_BAG_KEYS`.** Conversely, don't add a key to that allowlist that contains device-specific or game-day-ephemeral data — see section 1.
- **Don't pull `yaab_sync_queue` writes through user-visible save flows.** The queue is sync's private journal. The cross-tab `storage` handler explicitly ignores it.
