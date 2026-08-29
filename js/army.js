/**
 * army.js - Army data model
 */

// Mint a short random id for an army-entry. Stable per-entry handle that
// drag-to-reorder + the attachment graph reference instead of array
// indexes (which shift on every reorder, breaking parent-pointers).
function _mintEntryId() {
  // 8 hex chars + a one-char counter for first-frame collision avoidance
  // when addUnit() is called repeatedly inside one microtask.
  _mintEntryId._n = (_mintEntryId._n || 0) + 1;
  return Math.random().toString(16).slice(2, 10) + _mintEntryId._n.toString(36);
}

window.Army = class Army {
  constructor({ id, name, factionName, chapter, detachmentName, detachmentNames, pointsLimit, entries, createdAt, updatedAt } = {}) {
    this.id = id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    this.name = name || 'New Army';
    this.factionName = factionName || '';
    this.chapter = chapter || null;
    // Detachments are now MULTI-select. `detachmentNames` is the canonical list;
    // `detachmentName` (singular) is kept as a mirror of the FIRST selected one,
    // so the many single-detachment readers (play mode, cards, tournament export,
    // QR/URL share, sync) keep working unchanged, and pre-multi saved armies
    // (which only have `detachmentName`) migrate to a 1-item list on load.
    const names = Array.isArray(detachmentNames) && detachmentNames.length
      ? detachmentNames.filter(n => typeof n === 'string' && n)
      : (detachmentName ? [detachmentName] : []);
    this.detachmentNames = names;
    this.detachmentName = names[0] || null;
    this.pointsLimit = pointsLimit || 2000;
    this.entries = entries || []; // [{unitId, unitName, unitData, count, entryId, attachedToEntryId?}]
    // Every entry must carry a stable entryId — minted on add, preserved
    // through fromJSON/toJSON, and used by the attachment graph
    // (attachedToEntryId points UP to a parent entry's entryId). Legacy
    // pre-feature armies have neither field; mint ids defensively here
    // so the rest of the codebase can assume every entry has one.
    this.entries.forEach(e => {
      if (e && typeof e === 'object' && !e.entryId) e.entryId = _mintEntryId();
    });
    // Preserve timestamps when rehydrating from JSON (localStorage or cloud).
    // Resetting these to "now" on every fromJSON breaks sync — every load
    // would mark this device's local copy as newer than cloud, triggering
    // an upload that clobbers fresh saves from other devices.
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
  }

  /**
   * @param {object} unitData
   * @param {number} count
   * @param {object|null} squadOption  — { pts, models } from parser squadOptions
   * @param {Array} enhancements       — [{name, pts, description}] selected enhancements
   * @param {Array} wargear            — [{optionId, choice, count, ...}] picker selections
   * @param {object} opts              — { customName } user-given name for this entry
   */
  addUnit(unitData, count = 1, squadOption = null, enhancements = [], wargear = [], opts = {}) {
    const selectedPts  = squadOption ? squadOption.pts  : (unitData.points || 0);
    const squadLabel   = squadOption && squadOption.models ? `${squadOption.models} models` : null;
    // A user-named entry ("Brother-Captain Gaius") is a UNIQUE unit, not a
    // stack — it never merges with anything, and nothing merges into it.
    // `unitName` stays the datasheet name so every existing consumer (Rule of
    // Three, voice commands, match-mode signatures) keeps working.
    const customName = (opts && typeof opts.customName === 'string' && opts.customName.trim())
      ? opts.customName.trim().slice(0, 60)
      : null;
    // Entries with enhancements, wargear selections, or a custom name are
    // always separate; plain entries can stack.
    const existing = !customName && !enhancements.length && !(wargear && wargear.length) && this.entries.find(
      e => e.unitId === unitData.id && e.selectedPts === selectedPts
        && !e.customName
        && !(e.enhancements && e.enhancements.length) && !(e.wargear && e.wargear.length)
    );
    if (existing) {
      existing.count += count;
    } else {
      this.entries.push({
        unitId: unitData.id,
        unitName: unitData.name,
        unitData,
        count,
        selectedPts,
        squadLabel,
        enhancements: enhancements || [],
        // Wargear selections from the picker: [{ optionId, choice, count,
        // label, items:[names], pts }] — pts per item, 0 until upstream
        // 40kdc ships 11e wargear costs.
        wargear: wargear || [],
        // User-given name for this specific unit. Undefined (not null) when
        // absent so it drops out of JSON.stringify entirely and saved armies
        // without the feature stay byte-identical.
        customName: customName || undefined,
        entryId: _mintEntryId(),
        attachedToEntryId: null,
      });
    }
    this.updatedAt = new Date().toISOString();
  }

  // Mark the army as edited. Every mutator above stamps `updatedAt` itself,
  // but fields written directly from the outside (name, pointsLimit — both in
  // toJSON, and `name` is its own server column) had no way to say so. That is
  // not cosmetic: sync's diff is `known[id] !== army.updatedAt`, so an edit
  // that leaves the stamp alone is never enqueued and never reaches the
  // server — and if another device later pushes anything, the unpushed edit is
  // overwritten when this one pulls. Call this after any direct field write.
  touch() {
    this.updatedAt = new Date().toISOString();
  }

  // Convenience accessor for the attachment graph.
  findByEntryId(entryId) {
    if (!entryId) return null;
    return this.entries.find(e => e && e.entryId === entryId) || null;
  }

  // Set the selected detachments (array of names). Keeps `detachmentName` in
  // sync as the first entry for single-detachment readers. Pass { touch: false }
  // for programmatic load/reset so a restore doesn't advance updatedAt (which
  // would make every load look newer than cloud and clobber other devices).
  setDetachments(names, opts) {
    const list = Array.isArray(names) ? names.filter(n => typeof n === 'string' && n) : [];
    this.detachmentNames = list;
    this.detachmentName = list[0] || null;
    if (!opts || opts.touch !== false) this.updatedAt = new Date().toISOString();
  }

  setWargear(index, wargear) {
    if (this.entries[index]) {
      this.entries[index].wargear = wargear || [];
      this.updatedAt = new Date().toISOString();
    }
  }

  setEnhancements(index, enhancements) {
    if (this.entries[index]) {
      this.entries[index].enhancements = enhancements || [];
      this.updatedAt = new Date().toISOString();
    }
  }

  // Name (or un-name) a single army entry. The custom name becomes the
  // primary display name everywhere; `unitName` keeps the datasheet name and
  // is shown as a subtitle. Passing an empty string clears it.
  // Stamps updatedAt, which is what makes cards-mode's render signature and
  // sync's dirty-check both notice the change.
  setCustomName(index, name) {
    const entry = this.entries[index];
    if (!entry) return;
    const next = (typeof name === 'string' && name.trim())
      ? name.trim().slice(0, 60)
      : undefined;
    if (entry.customName === next) return;
    if (next) entry.customName = next;
    else delete entry.customName;
    this.updatedAt = new Date().toISOString();
  }

  removeEntry(index) {
    const victim = this.entries[index];
    this.entries.splice(index, 1);
    // Re-root any children whose parent we just removed. Without this,
    // saved-army JSON would carry orphaned attachedToEntryId pointers
    // and the renderer would silently drop those entries (they'd
    // neither render as roots nor under any visible parent).
    if (victim && victim.entryId) {
      this.entries.forEach(e => {
        if (e && e.attachedToEntryId === victim.entryId) e.attachedToEntryId = null;
      });
    }
    this.updatedAt = new Date().toISOString();
  }

  // Peel ONE copy off a stacked entry into its own entry, spliced in directly
  // after the original. This is the only way to give two copies of the same
  // datasheet separate identities: `addUnit` merges plain duplicates into a
  // single entry with `count: N` (see the merge at the top of this class), and
  // everything that makes a unit distinct — the attachment graph
  // (`attachedToEntryId` points at ONE `entryId`), a custom name, an
  // enhancement — hangs off the entry, not off a copy inside it. So a stacked
  // squad cannot be told apart from its twin: a leader dragged onto the card
  // attaches to the whole stack, and the list/export shows one line either way.
  //
  // Points are unchanged by design, and that is load-bearing rather than a
  // happy accident. `getEntryOrdinalSurcharge` is exactly F(before + count) -
  // F(before) for F(x) = max(0, x - threshold), so the per-entry surcharges
  // telescope in array order and sum to F(totalCopies) no matter how the copies
  // are partitioned. `selectedPts` and wargear are both billed per-copy, so
  // N-1 + 1 bills the same as N. Enhancements are billed once per ENTRY and are
  // deliberately NOT copied (an enhancement is unique per army in 11e), so they
  // stay on the original and the total still matches.
  //
  // Returns the new entry, or null when the entry can't be split.
  splitEntry(index) {
    const src = this.entries[index];
    if (!src) return null;
    const count = Number.isFinite(src.count) ? src.count : 0;
    if (count < 2) return null;

    const copy = {
      unitId:   src.unitId,
      unitName: src.unitName,
      // Shared by REFERENCE on purpose — do not deep-copy this.
      // `entry-rehydrate.js` decides whether to refresh an entry with
      // `fresh !== prevUnit`, and `attachments.js` identity-compares unit
      // objects against its prose reverse-index. A cloned unitData would be
      // "not the loaded unit" to both and would silently stop matching.
      // `addUnit` already shares one unitData across every entry of a
      // datasheet, so this is the existing invariant, not a new shortcut.
      unitData: src.unitData,
      count: 1,
      selectedPts: src.selectedPts,
      // Copied because `getEntryWargearBasePts` derives the squad size from
      // squadLabel first and selectedPts second; dropping either would reprice
      // the peeled copy at a different tier than the squad it came from.
      squadLabel: src.squadLabel,
      // Not copied: an enhancement may only be taken once per army.
      enhancements: [],
      // Deep-copied so a later setWargear on one entry cannot mutate the array
      // the other is still reading.
      wargear: (src.wargear || []).map(w => ({
        optionId: w.optionId,
        choice:   w.choice,
        count:    w.count,
        label:    w.label,
        items:    Array.isArray(w.items) ? w.items.slice() : [],
        pts:      w.pts,
      })),
      // Not copied: a custom name denotes one specific named model. Splitting a
      // named stack is in fact the way to make it coherent — the name stays on
      // a now-single model and the peeled copy is anonymous.
      customName: undefined,
      entryId: _mintEntryId(),
      // Inherited, so a split is "one copy peeled off, identical in every other
      // respect". If the source was a root the copy is a root; if the source was
      // itself attached to a leader the copy is too. Nothing here enforces one
      // child per parent (flip-animations.js assigns the pointer with no
      // uniqueness check), so inheriting creates no state the user could not
      // already reach by dragging — and dropping the copy in a gap detaches it.
      attachedToEntryId: src.attachedToEntryId || null,
    };

    src.count = count - 1;
    this.entries.splice(index + 1, 0, copy);
    this.updatedAt = new Date().toISOString();
    return copy;
  }

  updateCount(index, count) {
    if (count <= 0) {
      this.removeEntry(index);
    } else {
      this.entries[index].count = count;
      this.updatedAt = new Date().toISOString();
    }
  }

  getTotalPoints() {
    // Sum the per-entry points so the army total always reconciles with what
    // each line in the army list shows.
    return this.entries.reduce((t, _e, i) => t + this.getEntryPoints(i), 0);
  }

  // Points for one entry: squad-size cost × count + enhancements + this entry's
  // share of the 11e per-army-ordinal surcharge.
  getEntryPoints(index) {
    const entry = this.entries[index];
    if (!entry) return 0;
    const pts    = (entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData && entry.unitData.points || 0));
    const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
    // 11e wargear cost, per squad copy: the DEFAULT loadout's priced items
    // (base, from the MFM overlay via wargearProfile) plus each selection's
    // NET delta (w.pts from the picker — negative when a swap sheds a priced
    // default, e.g. thunder hammer → free lightning claws). Floored at 0: a
    // loadout can't refund more than its priced defaults.
    const wgSel  = (entry.wargear || []).reduce((s, w) => s + (w.pts || 0) * (w.count || 0), 0);
    const wgPts  = Math.max(0, this.getEntryWargearBasePts(index) + wgSel);
    return pts * (entry.count || 0) + enhPts + wgPts * (entry.count || 0) + this.getEntryOrdinalSurcharge(index);
  }

  // Points the entry's DEFAULT loadout owes for MFM-priced wargear at its
  // squad size (before selections), plus any flat always-carried priced items
  // (ability-modelled wargear). 0 for units with nothing priced.
  getEntryWargearBasePts(index) {
    const entry = this.entries[index];
    const prof = entry && entry.unitData && entry.unitData.wargearProfile;
    if (!prof || (!prof.defaultCostBySize && !prof.alwaysCost)) return 0;
    let base = prof.alwaysCost || 0;
    const bySize = prof.defaultCostBySize;
    if (bySize) {
      // Squad size: parse "N models" off squadLabel, else match selectedPts
      // to a squad option, else fall back to the smallest tier. Same
      // nearest-below tier pick as the picker's defaultsFor().
      let models = null;
      const m = /^(\d+)\s+model/.exec(entry.squadLabel || '');
      if (m) models = parseInt(m[1], 10);
      if (models == null && entry.unitData && Array.isArray(entry.unitData.squadOptions)) {
        const so = entry.unitData.squadOptions.find(o => o.pts === entry.selectedPts);
        if (so) models = so.models;
      }
      const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
      if (sizes.length) {
        let pick = sizes[0];
        sizes.forEach((s) => { if (models != null && s <= models) pick = s; });
        base += bySize[pick] || 0;
      }
    }
    return base;
  }

  // 11e per-army-ordinal pricing: copies of a datasheet at/after its threshold
  // count cost `surcharge` more (flat). The ordinal is per-DATASHEET, so we
  // count copies of the same unit in EARLIER entries first; this entry pays the
  // surcharge only on its copies that fall in the pricier band. Summed across a
  // datasheet's entries this equals max(0, totalCopies - (fromCount-1)) × surcharge.
  getEntryOrdinalSurcharge(index) {
    const entry = this.entries[index];
    const ord = entry && entry.unitData && entry.unitData.ordinal;
    if (!ord || !ord.surcharge || !entry.count) return 0;
    let before = 0;
    for (let i = 0; i < index; i++) {
      if (this.entries[i] && this.entries[i].unitId === entry.unitId) before += (this.entries[i].count || 0);
    }
    const threshold = ord.fromCount - 1;   // first `threshold` copies stay at base price
    const surcharged = Math.max(0, (before + entry.count) - Math.max(before, threshold));
    return surcharged * ord.surcharge;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      factionName: this.factionName,
      chapter: this.chapter,
      detachmentNames: this.detachmentNames,
      detachmentName: this.detachmentName,   // mirror of detachmentNames[0] for old readers
      pointsLimit: this.pointsLimit,
      entries: this.entries,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromJSON(data) {
    // Untrusted-input gate. Reachable from URL share (`?a=YAAB1:`),
    // QR-share, cloud sync, and localStorage rehydration. Top-level keys
    // are already filtered by the constructor's destructuring, but
    // `entries` previously flowed through verbatim — a crafted payload
    // could have set `entries` to a non-array (crash on render) or
    // smuggled prototype-chain objects through `entries[i]`. Rebuild
    // each entry from a fixed shape using only own-property reads.
    if (!data || typeof data !== 'object') data = {};
    const safeEntries = Array.isArray(data.entries)
      ? data.entries
          .filter(e => e && typeof e === 'object')
          .map(e => ({
            unitId:      typeof e.unitId === 'string' ? e.unitId : String(e.unitId == null ? '' : e.unitId),
            unitName:    typeof e.unitName === 'string' ? e.unitName : String(e.unitName == null ? '' : e.unitName),
            unitData:    e.unitData && typeof e.unitData === 'object' ? e.unitData : {},
            count:       Number.isFinite(e.count) ? e.count : 1,
            selectedPts: Number.isFinite(e.selectedPts) ? e.selectedPts : undefined,
            squadLabel:  typeof e.squadLabel === 'string' ? e.squadLabel : null,
            // User-given name for this entry. Clamped like every other
            // untrusted string here; `undefined` when absent so pre-feature
            // armies round-trip unchanged.
            customName:  (typeof e.customName === 'string' && e.customName.trim())
              ? e.customName.trim().slice(0, 60)
              : undefined,
            enhancements: Array.isArray(e.enhancements) ? e.enhancements : [],
            // Wargear picker selections — rebuild each from a fixed shape
            // (same untrusted-input policy as the rest of the entry).
            wargear: Array.isArray(e.wargear)
              ? e.wargear
                  .filter(w => w && typeof w === 'object')
                  .map(w => ({
                    optionId: typeof w.optionId === 'string' ? w.optionId : '',
                    choice:   Number.isFinite(w.choice) ? w.choice : null,
                    count:    Number.isFinite(w.count) ? w.count : 0,
                    label:    typeof w.label === 'string' ? w.label : '',
                    items:    Array.isArray(w.items) ? w.items.filter(x => typeof x === 'string') : [],
                    pts:      Number.isFinite(w.pts) ? w.pts : 0,
                  }))
                  .filter(w => w.optionId && w.count > 0)
              : [],
            // entryId / attachedToEntryId carry the attachment graph.
            // Missing entryId on a legacy entry is fine — the Army
            // constructor mints one on rehydration. attachedToEntryId
            // null/missing means "root-level", which is the safe
            // default for any pre-feature saved army.
            entryId:            typeof e.entryId === 'string' && e.entryId ? e.entryId : undefined,
            attachedToEntryId:  typeof e.attachedToEntryId === 'string' && e.attachedToEntryId ? e.attachedToEntryId : null,
          }))
      : [];
    // Drop orphan parent pointers — any attachedToEntryId that doesn't
    // resolve to a sibling entry. Without this guard a crafted payload
    // or a half-migrated localStorage row could leave entries that
    // neither render as roots nor under any parent.
    const knownIds = new Set(safeEntries.map(e => e.entryId).filter(Boolean));
    safeEntries.forEach(e => {
      if (e.attachedToEntryId && !knownIds.has(e.attachedToEntryId)) e.attachedToEntryId = null;
    });
    return new Army({
      id:             typeof data.id === 'string' ? data.id : undefined,
      name:           typeof data.name === 'string' ? data.name : undefined,
      factionName:    typeof data.factionName === 'string' ? data.factionName : '',
      chapter:        data.chapter && typeof data.chapter === 'object' ? data.chapter : null,
      detachmentName: typeof data.detachmentName === 'string' ? data.detachmentName : null,
      detachmentNames: Array.isArray(data.detachmentNames)
        ? data.detachmentNames.filter(n => typeof n === 'string' && n)
        : undefined,   // undefined → constructor migrates from detachmentName
      pointsLimit:    Number.isFinite(data.pointsLimit) ? data.pointsLimit : 2000,
      entries:        safeEntries,
      createdAt:      typeof data.createdAt === 'string' ? data.createdAt : undefined,
      updatedAt:      typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    });
  }
};

window.ArmyManager = class ArmyManager {
  constructor() {
    this.armies = this._load();
    this.currentArmy = null;
  }

  _load() {
    try {
      const raw = localStorage.getItem('yaab_armies');
      if (!raw) return [];
      const all = JSON.parse(raw).map(d => Army.fromJSON(d));
      // Drop any persisted entries that fail the name guard. Legacy local
      // state (and cloud state from before the guard was added) can still
      // contain "New Army" placeholders. Filtering at load time both
      // hides them from the UI and — once mgr.save() runs and notifies
      // sync — kicks off a diff that enqueues deleteArmy for each id, so
      // the cloud copies get cleaned up too.
      const named = all.filter(a => ArmyManager.isNamed(a));
      if (named.length !== all.length) {
        try {
          localStorage.setItem('yaab_armies', JSON.stringify(named.map(a => a.toJSON())));
        } catch (_) {}
      }
      return named;
    } catch {
      return [];
    }
  }

  // True iff `army` has a real, user-chosen name. We block persistence of
  // armies still on the boot-time placeholder so a user clicking around
  // doesn't seed a graveyard of "New Army" entries in their saved list.
  // Whitespace-only names count as unnamed too.
  static isNamed(army) {
    if (!army) return false;
    const n = (army.name || '').trim();
    return n.length > 0 && n !== 'New Army';
  }

  save() {
    localStorage.setItem('yaab_armies', JSON.stringify(this.armies.map(a => a.toJSON())));
    if (window.App && window.App.Sync && typeof window.App.Sync.notifyArmiesChanged === 'function') {
      window.App.Sync.notifyArmiesChanged();
    }
  }

  // Returns true if the army was persisted, false if the name guard rejected
  // it. Callers that need to surface an error to the user (e.g. the explicit
  // Save button) should check the return value; auto-save callers can ignore.
  saveArmy(army) {
    if (!ArmyManager.isNamed(army)) return false;
    const idx = this.armies.findIndex(a => a.id === army.id);
    if (idx >= 0) {
      this.armies[idx] = army;
    } else {
      this.armies.push(army);
    }
    this.save();
    if (window.App && typeof window.App.fireArmyChange === 'function') {
      window.App.fireArmyChange('save', army);
    }
    return true;
  }

  deleteArmy(id) {
    this.armies = this.armies.filter(a => a.id !== id);
    this.save();
    if (window.App && typeof window.App.fireArmyChange === 'function') {
      window.App.fireArmyChange('delete');
    }
  }

  getArmy(id) {
    return this.armies.find(a => a.id === id) || null;
  }

  newArmy(factionName = '') {
    const army = new Army({ factionName });
    this.currentArmy = army;
    return army;
  }
};
