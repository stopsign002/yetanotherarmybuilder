# SYNC.md

Reference for the offline-first cloud sync layer (rewritten for the 2026-10-30 fix batch: owner gate, pull abort, parking, per-key bag merge, quota-safe saves). Frontend lives in [sync.js](../js/app/sync.js); the server side it talks to is [armies.js](../../api/armies.js) and [state.js](../../api/state.js). Read this before debugging or extending sync.

The system is *offline-first*: every write hits localStorage first and the network is only an eventually-consistent best-effort second hop. The whole layer revolves around an idempotent op queue, debounced flushes, and last-write-wins reconciliation against the server.

## 1. What syncs and what doesn't

### Synced

- **`yaab_armies`** — pushed *per id* as a full payload, not as a single bag. Every army is its own server row keyed by the client-generated `id`. See `runOp` in [sync.js](../js/app/sync.js) and the `payload` column in [armies.js#L65](../../api/armies.js#L65).
- **The "synced bag"** — a small allowlist of localStorage keys that get pushed together as one opaque blob to `/api/state`. Currently:
  - `yaab_favorites`
  - `yaab_recents`
  - `yaab_collection`
  - `yaab_reserves`
  - `yaab_requisitions`
  - `yaab_crusade_rosters`
  - `yaab_deployments`
  - `yaab_points_overrides`
  - `yaab_cards_prefs`
  - `yaab_cards_presets`
  - `yaab_custom_names`
  - `yaab_theme`

  See `SYNCED_BAG_KEYS` in [sync.js](../js/app/sync.js) — that list is
  the authority; this one has drifted from it before.

### NOT synced (intentional)

  **`yaab_theme` is the deliberate exception** and is bag-synced: it is chosen under *Account* in the Settings drawer, and a theme that only applied on the laptop would not be what "my account looks like this" means. `themes.js` listens for the synthetic `storage` event the bag pull fires (section 5) so a second device repaints without a reload.
- **`yaab_current_army_id`** — which army this device has open. Deliberately device-local: two devices can sit on different armies, and syncing it would yank one of them. Written by the `App.state.currentArmy` accessor in [state.js](../js/app/state.js); see section 6.4.
- **Faction game data** — comes from the embedded 40kdc bundle (`window.DC`, via `js/data/dc-adapter.js`), rebuilt locally each load. It's a deterministic function of the dataset, never user data, so it's never synced. (Sync is data-source-agnostic regardless.)
- **Auth hint** — `yaab_auth_session_hint` is a UI hint, not user data. The cookie is the truth.

If you add a new feature with a `yaab_*` localStorage key, decide deliberately: bag-synced (add to `SYNCED_BAG_KEYS`) or device-local (don't).

## 2. Storage keys owned by sync

| Key | Holds | Written by |
|---|---|---|
| `yaab_sync_queue` | FIFO array of op envelopes `{op, id?, ts, mutationId}` | `enqueue` ([sync.js](../js/app/sync.js)), `setQueue` |
| `yaab_sync_known` | Object `{ armyId -> updated_at }`, the server timestamp we believe is current for each id | `runOp` after a successful PUT ([sync.js](../js/app/sync.js)), `pullAll` adoptions ([sync.js](../js/app/sync.js)) |
| `yaab_sync_state_at` | ISO string: the server's `updated_at` for the bag as of our last sync. Only a shortcut now (pull skips the bag merge when it is unchanged and nothing is dirty) — the merge itself is per key | `runOp` `putState`, `pullAll` |
| `yaab_sync_owner` | Username the account-scoped local data belongs to (raw string) | `gateOwner` at sign-in / boot, `pullAll` if missing, the account-switch choices |
| `yaab_sync_parked` | Array `{ op, id, name, status, reason: 'rejected'\|'owner', owner?, armyTs?, at }` — ops the server refused permanently, and armies kept as local-only copies after an account switch | `parkOp`, `keepAsLocalCopies`, `diffAndEnqueueArmies` (prunes / re-arms), `retryParked` |
| `yaab_sync_bag_meta` | `{ t: {bagKey → ISO of last local change}, dirty: {bagKey → true} }` for the per-key bag merge (section 7) | the localStorage monkey-patch (`noteLocalBagChange`), `applyCloudWinners`, `clearPushedDirty`, `migrateBagMeta` |

All of them are written through `jsonSet` / `rawSet` / `rawRemove` which flip `_suppressMonkeyPatch` so sync's own writes don't recursively re-trigger sync. All of them are in `ACCOUNT_LOCAL_KEYS`, so "Remove local data" wipes them.

## 3. Op queue

Op shapes (see comment block at [sync.js](../js/app/sync.js)):

```js
{ op: 'putArmy',    id, mutationId, ts }
{ op: 'deleteArmy', id, mutationId, ts }
{ op: 'putState',       mutationId, ts }
```

**Coalescing.** `enqueue` ([sync.js](../js/app/sync.js)) filters out any prior op with the same `op` *and* same `id` before appending the new one — so 50 rapid edits to one army collapse to a single trailing `putArmy` for that id, and likewise repeated `putState` ops collapse. `id == null` matches `id == null` so `putState` coalesces against itself.

**Cap.** `QUEUE_MAX = 200`. If the queue overflows we drop the oldest and toast a warning ([sync.js](../js/app/sync.js)).

**mutationId.** A UUIDv4-ish string built from `crypto.getRandomValues`. It is client-only: the "is this still the entry I ran?" sentinel inside `drainQueue` (a concurrent enqueue may coalesce the op we just ran into a newer one with a new mutationId, which must stay). It is **not** sent to the server any more — the API never read it and has no dedup (yetanotherarmybuilder-api#1).

**Pop on success only.** `drainQueue` reads `q[0]`, awaits `runOp`, then removes the entry by its `mutationId` (`removeOp`) — a no-op if it was coalesced away meanwhile. On a retryable failure the head stays and we back off; on a permanent one it is parked (section 11).

## 4. Debounce + flush

Two debounces, two paths:

- `notifyArmiesChanged` → diff against `known` → enqueue `putArmy`/`deleteArmy` → drain. Debounce **`ARMY_DEBOUNCE = 500ms`**. See [sync.js](../js/app/sync.js).
- `notifyKeyChanged(key)` → enqueue `putState` → drain. Debounce **`BAG_DEBOUNCE = 1500ms`**. See [sync.js](../js/app/sync.js).

The army path is invoked from `ArmyManager.save()` — only when the localStorage write succeeded (a quota failure returns `false`, toasts once, and sets `mgr.lastSaveOk = false`; see section 11). The bag path is invoked by the localStorage monkey-patch on an allowlisted key write **that changes the value** (re-persisting identical state is not an edit); each such write also stamps the key's change time in `yaab_sync_bag_meta`.

### `flushPendingNow()` and pagehide — load-bearing

`flushPendingNow` ([sync.js](../js/app/sync.js)) cancels both pending timers and runs their work *synchronously* so the queue ends up persisted in localStorage before navigation. It's wired to the `pagehide` event ([sync.js](../js/app/sync.js)).

History: without this, the sequence "edit → Save → reload within 500ms" would let the page tear down before the debounce timer fired, the diff never ran, no `putArmy` op was ever enqueued, and the edit silently never reached cloud. (Commit `64e7f3b`.) `pagehide` is used instead of `beforeunload` because it fires reliably on mobile bfcache and tab-close.

## 5. Push direction (`drainQueue` → `runOp`)

Happy path is dull: pop op, hit the API, update `known`, repeat. The interesting branches all live in `runOp` ([sync.js](../js/app/sync.js)).

### LWW response handling — "the server's row was newer than what we sent"

The server does last-write-wins via a single-statement `INSERT … ON CONFLICT … DO UPDATE` that only writes when `EXCLUDED.updated_at >= armies.updated_at`, with the incoming ts clamped to the server clock first. The response carries **`applied`**: `true` when our write landed, `false` when the row kept a newer write. (Builds without `applied` are handled by comparing the echoed `updated_at` with the one we sent.) `applied: true` with a different `updated_at` means our clock was ahead and got clamped — we pin the army's `updatedAt` to the echo, no conflict.

On `applied: false`:

1. GET the cloud row.
2. Decode the payload via `Army.fromJSON` (preserves timestamps — see section 8).
3. Splice into `mgr.armies` at the same index.
4. If this id is `App.state.currentArmy`, swap `App.state.currentArmy` *and* `mgr.currentArmy` and toast.
5. `mgr.save()` + `App.renderAll()`.

Then we update `known[id]` to the cloud ts — **only if `mgr.lastSaveOk` is not false**. `known` means "on the server AND on this device"; recording it for an army that only exists in memory (quota) is how a full localStorage used to become a cloud delete after the next reload (section 6.1's discriminator reads "known but missing locally" as a local deletion). Left unrecorded, the next pull simply adopts the army back from the cloud.

**Request shaping.** The name is truncated to 200 chars (the API's cap — an over-long name used to 400 and wedge the queue); a payload over 1,000,000 chars is parked as 413 without a round trip.

### `putState` — merge before push

The bag is never pushed blind. `runOp` `putState`: `GET /state` → `mergeBag` (section 7) → write the keys the cloud won locally (`applyCloudWinners`, which fires `yaab-bag-pulled` + a synthetic `storage` event per key) → if anything of ours still differs from the cloud, `PUT` the merged bag stamped `max(now, cloud.updated_at + 1ms)` (a device with a slow clock can still supersede the version it just merged). On `applied: false` another device wrote in between: refetch and merge again, up to 3 times, then a 409-style error backs off. The echo of a lost write is never recorded as pushed.

If we *didn't* do this adopt step, the next `diffAndEnqueueArmies` would compare local's `updatedAt` (still stale) against `known[id]` (now the server ts) — they wouldn't match, so we'd enqueue another `putArmy`, which the server would reject again with the same response, looping forever. (Commit `3ecc859`.)

### Convert-to-delete

If a `putArmy` op fires for an id that's no longer in `mgr.armies` (the user deleted it locally between enqueue and drain), and we have it in `known`, we convert the op to a DELETE on the wire ([sync.js](../js/app/sync.js)). The queue entry is consumed either way.

## 6. Pull direction (`pullAll`)

`pullAll` is the merge engine. It runs:

- on sign-in (`App.Auth.onChange` with a user) and on boot when already signed in — both **after the owner gate** (section 9),
- on `visibilitychange → visible` and on `online` (pull first, then drain — so a device coming back online with queued edits for an army deleted elsewhere does not re-create it),
- on **Load army** (events.js) and **Sync now** (`syncNow`, which also re-arms parked ops).

It's gated by `_pulling` so concurrent triggers don't pile on, and by `syncAllowed()` (signed in, owner matches, no account-switch dialog up). `drainQueue` bails while `_pulling` is true; `pullAll` releases `_pulling` before its own closing `drainQueue()` (until 2026-10-30 that closing drain silently never ran).

**It returns `null` and changes nothing** when offline, when either GET fails for any reason other than 401 (logged once per failure streak, no toast), when `GET /armies` is not an array or `GET /state` is neither an object nor the literal `null`, or when the session changed while it waited. A failed `GET /armies` used to be read as "the cloud has no armies", and section 6.2 then deleted every synced army on the device (#108); a failed `GET /state` used to queue a `putState` over a newer cloud bag.

It fetches `GET /armies` (summaries only) and `GET /state` in parallel, then runs four sections in order:

### 6.1. Cloud-only ids → fetch full + adopt

For each id present in cloud but not local: if `known` has it, the user deleted it here and the delete has not drained — enqueue `deleteArmy`. Otherwise GET the full payload, decode, push onto `mgr.armies` (an army that fails the keep guard — unnamed AND empty — is deleted from the cloud instead of adopted).

### 6.2. Both sides have it → compare timestamps

For each local army with a cloud counterpart ([sync.js](../js/app/sync.js)):

- **Parked** (refused by the server, or another account's local-only copy) → skipped entirely.
- **Local-only** (no cloud counterpart) → if `known` has it, another device deleted it: remove it here ("deleted elsewhere"). Otherwise it is new on this device → enqueue `putArmy`.
- **`localTs > cloudTs`** → enqueue `putArmy`. `drainQueue` will push it.
- **`cloudTs > localTs`** → fetch + adopt. **Including when this is the active `currentArmy`** — swap `App.state.currentArmy` and `mgr.currentArmy` to the new object and toast `"Army updated from another device."` (Commit `143de8f` — earlier the active army was protected from cloud-newer pulls and *uploaded local instead*, which silently clobbered fresh saves from another device.)
- **Equal timestamps** — already in sync, just refresh `known[id]`.

Cloud-only adoptions and cloud-newer adoptions are kicked off as parallel promises and `await Promise.all`'d. Every `known` change from 6.1/6.2 is **collected and written only after `mgr.save()` succeeds** (step 4) — same reason as section 5.

### 6.3. State bag (KV)

Skipped when the cloud bag's `updated_at` equals `yaab_sync_state_at` and no key is dirty. Otherwise `mergeBag` (section 7): keys the cloud wins are written locally via `rawSet` / `rawRemove` (suppressing the monkey-patch) and announced with `yaab-bag-pulled` + a synthetic `storage` event per key; if any key of ours wins and differs from the cloud (or there is no cloud bag and we have one), enqueue `putState`.

### 6.4. Promote untouched currentArmy

If, after section 2, `App.state.currentArmy` is still the *fresh boot placeholder* — empty `entries`, name `'New Army'` (or empty), and not in `mgr.armies` — promote a stored army to `currentArmy` ([sync.js](../js/app/sync.js)). The pick is `yaab_current_army_id` (the army this device last had open) if that id is still present, else most-recently-updated.

**Once per page load only**, guarded by `_promotedPlaceholder`. `pullAll` also runs on every `visibilitychange → visible`, and ungated the block would seize a placeholder the user had *deliberately* opened: click New Army, walk away, come back, and the app has swapped you onto an old list. Deliberately starting a new army is not "untouched" — only the boot-time placeholder is.

History: without the promote at all, signing in on a fresh device would pull the user's armies into `mgr.armies` but leave `App.state.currentArmy` as the empty placeholder created at boot, so the user saw their list of saved armies but the main view showed an empty new-army screen. (Commit `86942bb`.) Without the once-per-load gate and the remembered-id preference, returning to the tab after a while silently changed which army was loaded.

After all four sections: `mgr.save()` then (if it worked) the `known` writes, record `yaab_sync_owner` if missing, `App.renderAll()`, re-apply the dropdown selections, toast a summary, release `_pulling`, `drainQueue`.

## 7. Conflict semantics

- **Armies: most-recent timestamp wins**, full-army replace. No field-level merge, no three-way diff.
- The active army on this device is **not** protected from a newer cloud copy. It will be replaced in place and the user gets a toast. This is deliberate (see section 6.2 history).
- **The state bag merges per key.** It used to be whole-blob last-write-wins stamped at push time and pushed without pulling first, which stopped being acceptable once the bag carried collection, reserves, requisitions, custom names and card presets: a desktop tab left open, starring one favourite, pushed its stale snapshot over reserves logged on the phone. Now each key is decided on its own (`mergeBag`):
  1. both sides carry a change time for the key → the newer wins;
  2. else the key is dirty here (changed while signed in, not yet pushed) → ours;
  3. else the cloud has the key (a value, or a deletion time) → the cloud's;
  4. else → ours.

  Change times come from `yaab_sync_bag_meta.t` locally and from a reserved `__ts` object inside the pushed payload (`{ bagKey → ISO }`). A key the winner deleted travels as a time with no value, so a removal propagates instead of being re-pushed. Older clients ignore `__ts` on pull and drop it on push; their keys then simply have no time and fall to rules 2-4. Within one key it is still last-write-wins on the whole value. Keys this device has not touched since its last push always take the cloud's copy, which is what fixes the stale-tab case. `migrateBagMeta` marks every present key dirty on the first run after this shipped *if* a `putState` was still queued, so those unpushed edits are not lost to rule 3.

## 8. Timestamps — the load-bearing invariant

`Army.updatedAt` is **the** contract that drives every conflict decision in this layer. It is set at construction and bumped on every mutating method (`addUnit`, `removeEntry`, `updateCount`, `setEnhancements` — see [army.js](../js/army.js)).

The `Army` constructor preserves `createdAt` and `updatedAt` when they're passed in — i.e. when rehydrating from `Army.fromJSON` ([army.js](../js/army.js)) which forwards both fields from the persisted JSON ([army.js](../js/army.js)):

```js
this.createdAt = createdAt || new Date().toISOString();
this.updatedAt = updatedAt || new Date().toISOString();
```

The `||` fallback only fires for *brand new* armies. Round-trip through `toJSON` / `fromJSON` is lossless.

History: an earlier version of the constructor unconditionally set `updatedAt = new Date().toISOString()` on every load. That made every device's local copy look "newer" than cloud the instant the page loaded, every diff turned into a `putArmy`, and every save on another device got clobbered the next time this device drained. **Don't undo this.** The comment in [army.js](../js/army.js) calls it out — leave it alone.

## 9. Auth integration

- Sync only runs when `syncAllowed()`: signed in, **the stored owner matches the session** (or no owner is recorded yet), and no account-switch dialog is up. Every entry point (`notifyArmiesChanged`, `notifyKeyChanged`, `drainQueue`, `pullAll`, `flushPendingNow`) early-returns otherwise.
- Init wires `App.Auth.onChange`. Sign-in (and boot when signed in) runs `onSignedIn` → `gateOwner` → `pullAll`. Sign-out is a no-op for sync: the queue is kept so the **same** account can pick it up on its next sign-in here. A different account never drains it, because of the owner gate.

### Account ownership (`yaab_sync_owner`, #109)

Local account data is tagged with the username it belongs to. `gateOwner` at sign-in / boot:

- **owner matches** → proceed.
- **no owner recorded** → this account claims the data (legacy devices from before the tag, and data made while signed out — the long-standing "sign in to sync your armies" behaviour). Unavoidable gap: a legacy device holding user A's data with no tag yet is claimed by whoever signs in first after the deploy; every device that boots signed in gets tagged on its first pull.
- **owner differs, but nothing of theirs worth asking about** (no armies, empty queue, no bag key besides theme/recents) → reset the sync bookkeeping (`queue`, `known`, `state_at`, bag meta) and claim.
- **owner differs and there is data** → block sync and ask, in a non-dismissible styled dialog (`UI.showAuthChoice`), *before* the first pull:
  - **Keep as local copies** — every stored army is parked with `reason: 'owner', owner: <previous>` (never uploaded from here; "Save as…" copies one into the new account, since that mints a new id). An army parked earlier whose owner IS the account signing in is unparked — it is theirs again. The queue, `known`, `state_at`, bag meta and every bag key are cleared (the bag cannot be kept apart from the new account's), owner := new user, page reloads.
  - **Remove them** — `wipeAccountData()` (memory + every `ACCOUNT_LOCAL_KEYS` key), owner := new user, page reloads.
  - **Sign out instead** — `Auth.logout()`; nothing changes.

  Both data choices reload, because that is the only reset that reaches every module's in-memory copy of the previous account's bag.

### Sign-out (`App.Auth.signOut()`)

Keep / Remove / Cancel dialog (`docs/AUTH.md` §8a). **Remove** runs, in order: `drainNow(8000)` while still signed in (flush the debounces, cut any backoff, drain; gives up early on an error or offline) → `logout()` → `wipeAccountData()` → reload. **Keep** just signs out; the data stays tagged with this account.
- **401 handling.** Any `apiFetch` that gets a 401 invokes `App.Auth.handleSessionExpired()` ([sync.js](../js/app/sync.js)) which flips local state to signed-out and toasts. The fetch itself rejects with a 401 error which `drainQueue` catches and bails on ([sync.js](../js/app/sync.js)) — no backoff, no retry, the auth layer takes it from here.
- See [auth.js](../js/app/auth.js) for `handleSessionExpired`.

## 10. Cross-tab + connectivity

Listeners are installed in `installListeners` ([sync.js](../js/app/sync.js)):

| Event | Behavior |
|---|---|
| `online` | `kickRetry()` (cancel a pending backoff), then `pullAll` → which drains at the end; `drainQueue` directly if the pull could not run. |
| `offline` | No-op (placeholder for a future offline pip). |
| `pagehide` | `flushPendingNow` — see section 4. |
| `storage` (cross-tab) | If the changed key is `yaab_armies`, reload `mgr.armies` from `mgr._load()`, **re-point `App.state.currentArmy` at the reloaded object with the same id**, and re-render. `_load()` builds brand-new `Army` objects, so without the re-point the active army becomes a detached copy: the other tab's edits never appear, and this tab's next save writes its pre-reload content back over them. We deliberately don't react to `yaab_sync_queue` — the originating tab is already draining, and the listener tab would just race. |
| `visibilitychange → visible` | `pullAll` (drains at the end); `drainQueue` directly if the pull could not run. Pull-first, for the same tombstone reason as `online`. |

`BroadcastChannel('yaab-sync')` is allocated when available ([sync.js](../js/app/sync.js)) and `bcPost` is called from `drainQueue` after each successful push, but the receive handler is a no-op placeholder. Reserved for future cross-tab coordination (e.g. "stop draining, the other tab already has it").

## 11. Failure modes

- **Network errors, 5xx, a lost bag race (409)** during `drainQueue` → exponential backoff via `_backoffMs`, capped at `BACKOFF_MAX_MS = 30000`. The head op stays in the queue; one retry is scheduled. **`_draining` stays true for the whole backoff**, so only one retry loop exists — it used to drop in the `finally` of the iteration that scheduled the retry, and every edit / online / visibility event during the wait started another perpetual loop. `kickRetry()` (online, Sync now, sign-out drain) is the only way to cut the wait short.
- **400 / 403 / 404 / 413** → permanent: the op is **parked** — removed from the queue, recorded in `yaab_sync_parked`, one toast naming the army (once per op/id/status per page load) — and the drain carries on with the next op. A parked `putArmy` is skipped by the diff until the army is edited again (its `updatedAt` moves past `armyTs`), and **Sync now** re-arms everything parked (`retryParked`). A parked `deleteArmy` also drops the id from `known`, so it is not re-enqueued. Before this, one permanent 4xx at the head blocked every later op forever with no message.
- **401** → bail and let the auth layer take over (see section 9). No backoff — we'd just hit it again.
- **`pullAll` cannot read the cloud** → returns `null`, merges nothing (section 6).
- **localStorage full** → `ArmyManager.save()` returns false, toasts once per failure streak, sets `lastSaveOk = false`; sync is not notified and writes no `known` entries until a save succeeds. Autosave keeps the change pending and the browser's leave-page prompt appears only while it is still not on disk.
- **Unparseable cloud payload** in `pullAll` adoptions → swallowed in a `catch (_) {}`. The local copy is kept. An unreadable cloud **bag** is treated as empty, so the next push repairs it.
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
- **No `mutation_id` in the PUT body.** It was removed (the API never read it and has no dedup — yetanotherarmybuilder-api#1). Add it back only together with server support.
- **The owner gate.** Never drain, merge or pull while `yaab_sync_owner` names a different account than the session. Every new entry point goes through `syncAllowed()`.
- **`known` only after `yaab_armies` is saved.** See section 5.
- **`pullAll` aborts on any failed GET.** Never treat a failed or malformed response as an empty cloud.
- **`__ts` inside the bag payload** is reserved for per-key change times. Don't add a synced key called `__ts`.
- **Sync owns the `Storage.prototype.setItem` / `removeItem` monkey-patch** ([sync.js](../js/app/sync.js)). Don't restore originals from another module, and don't add another monkey-patch — they would compose unpredictably. If you need to write a synced key without triggering a push (for example, while adopting cloud state), use the `_suppressMonkeyPatch`-aware helpers exposed inside `sync.js` rather than reaching for `localStorage` directly. New code outside `sync.js` should just write normally; the patch handles routing.
- **Don't add a synced key without adding it to `SYNCED_BAG_KEYS`.** Conversely, don't add a key to that allowlist that contains device-specific or game-day-ephemeral data — see section 1.
- **Don't pull `yaab_sync_queue` writes through user-visible save flows.** The queue is sync's private journal. The cross-tab `storage` handler explicitly ignores it.
