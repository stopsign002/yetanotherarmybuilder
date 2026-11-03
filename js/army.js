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
  // ── Wargear inventory (docs/WARGEAR-RULES.md §5) ─────────────────────────
  // entry.loadout = [{ id, name, count }] is the squad's COMPLETE wargear
  // inventory (defaults included, zeros omitted). These statics are shared by
  // the picker, entry-rehydrate.js and the army list so all of them agree on
  // squad size, defaults and price.
  static _kebab(s) {
    return String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  // Squad size of an entry: "N models" label, else the squad option whose
  // price matches, else null (callers fall back to the smallest tier).
  static entryModels(entry) {
    if (!entry) return null;
    const m = /^(\d+)\s+model/.exec(entry.squadLabel || '');
    if (m) return parseInt(m[1], 10);
    const so = entry.unitData && Array.isArray(entry.unitData.squadOptions)
      ? entry.unitData.squadOptions.find(o => o && o.pts === entry.selectedPts) : null;
    return so && so.models ? so.models : null;
  }
  // Exact tier, else nearest below, else the smallest.
  static _tier(bySize, models) {
    if (!bySize) return null;
    if (models != null && bySize[models]) return bySize[models];
    const sizes = Object.keys(bySize).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (!sizes.length) return null;
    let pick = sizes[0];
    sizes.forEach(n => { if (models != null && n <= models) pick = n; });
    return bySize[pick] || null;
  }
  static defaultLoadout(unitData, models) {
    const prof = unitData && unitData.wargearProfile;
    const tier = prof ? (Army._tier(prof.defaultsBySize, models) || []) : [];
    return tier.filter(d => d && (d.count || 0) > 0)
      .map(d => ({ id: String(d.id || Army._kebab(d.name)), name: String(d.name || d.id || ''), count: d.count }));
  }
  // Untrusted-input gate for a loadout (also used by fromJSON).
  static cleanLoadout(list) {
    if (!Array.isArray(list)) return null;
    return list.filter(x => x && typeof x === 'object' && (typeof x.id === 'string' || typeof x.name === 'string'))
      .map(x => ({
        id: String(typeof x.id === 'string' && x.id ? x.id : Army._kebab(x.name)).slice(0, 120),
        name: String(typeof x.name === 'string' && x.name ? x.name : x.id).slice(0, 120),
        count: Number.isFinite(x.count) ? Math.max(0, Math.floor(x.count)) : 0,
      }))
      .filter(x => x.id && x.count > 0);
  }
  // Order-free identity of a loadout (stacking compares these).
  static loadoutKey(list) {
    const m = new Map();
    (list || []).forEach(x => {
      if (!x || !x.count) return;
      const k = x.id || Army._kebab(x.name);
      m.set(k, (m.get(k) || 0) + x.count);
    });
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(e => e[0] + ':' + e[1]).join('|');
  }
  static itemPrice(unitData, item) {
    const ic = unitData && unitData.wargearProfile && unitData.wargearProfile.itemCosts;
    if (!ic || !item) return 0;
    if (item.id != null && ic[item.id] != null) return ic[item.id] || 0;
    return ic[Army._kebab(item.name)] || 0;
  }
  // Per-copy wargear points of a loadout: alwaysCost + Σ itemCosts × count,
  // floored at 0. For an untouched default loadout this equals the priced
  // default base (defaultCostBySize) — checked over every tier in the dataset.
  static loadoutPts(unitData, loadout) {
    const prof = unitData && unitData.wargearProfile;
    let pts = (prof && prof.alwaysCost) || 0;
    (loadout || []).forEach(x => { pts += Army.itemPrice(unitData, x) * (x.count || 0); });
    return Math.max(0, pts);
  }

  constructor({ id, name, factionName, chapter, detachmentName, detachmentNames, disposition, pointsLimit, entries, createdAt, updatedAt } = {}) {
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
    // 11e Force Disposition the player has declared for this army — a
    // disposition id ('take-and-hold', …). Only meaningful when it is one of
    // the dispositions carried by the selected detachments; App.getArmyDisposition
    // (detachment-picker.js) resolves the effective one and auto-picks when the
    // detachments only offer a single disposition. null = not chosen.
    this.disposition = (typeof disposition === 'string' && disposition) ? disposition : null;
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
    // The picker now hands over a full inventory ([{id, name, count}],
    // docs/WARGEAR-RULES.md §5) in the old `wargear` slot; legacy selection
    // rows ({optionId, …}) are still accepted and stored as before.
    let loadout = null;
    if (Array.isArray(wargear) && wargear.length && wargear.every(w => w && !w.optionId && typeof w.name === 'string')) {
      loadout = Army.cleanLoadout(wargear);
      wargear = [];
    }
    const models = squadOption && squadOption.models ? squadOption.models : null;
    const keyOf = (e, lo) => Army.loadoutKey(lo || Army.defaultLoadout(e.unitData || unitData, Army.entryModels(e) || models));
    const newKey = Army.loadoutKey(loadout || Army.defaultLoadout(unitData, models));
    // Entries with enhancements, legacy wargear selections, or a custom name
    // are always separate; plain entries stack when their loadouts match
    // (an untouched default loadout matches an entry with none stored).
    const existing = !customName && !enhancements.length && !(wargear && wargear.length) && this.entries.find(
      e => e.unitId === unitData.id && e.selectedPts === selectedPts
        && !e.customName
        && !(e.enhancements && e.enhancements.length) && !(e.wargear && e.wargear.length)
        && keyOf(e, e.loadout) === newKey
    );
    let entry = existing;
    if (existing) {
      existing.count += count;
    } else {
      entry = {
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
        // Full wargear inventory (docs/WARGEAR-RULES.md §5); absent = the
        // default loadout at this size.
        loadout: loadout || undefined,
        // User-given name for this specific unit. Undefined (not null) when
        // absent so it drops out of JSON.stringify entirely and saved armies
        // without the feature stay byte-identical.
        customName: customName || undefined,
        entryId: _mintEntryId(),
        attachedToEntryId: null,
      };
      this.entries.push(entry);
    }
    this.updatedAt = new Date().toISOString();
    // The entry the unit landed in (new, or the stack it merged into), so the
    // Add button can remember it for a follow-up enhancement tick (#117).
    return entry;
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

  setDisposition(id, opts) {
    this.disposition = (typeof id === 'string' && id) ? id : null;
    if (!opts || opts.touch !== false) this.updatedAt = new Date().toISOString();
  }

  // Replace an entry's wargear inventory (the picker's live write-back).
  setLoadout(index, loadout) {
    if (this.entries[index]) {
      this.entries[index].loadout = Army.cleanLoadout(loadout) || [];
      this.updatedAt = new Date().toISOString();
    }
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
      loadout: Array.isArray(src.loadout) ? src.loadout.map(x => ({ id: x.id, name: x.name, count: x.count })) : undefined,
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
    const wgPts  = this.getEntryCopyWargearPts(index);
    return pts * (entry.count || 0) + enhPts + wgPts * (entry.count || 0) + this.getEntryOrdinalSurcharge(index);
  }

  // 11e wargear cost, per squad copy: the DEFAULT loadout's priced items
  // (base, from the MFM overlay via wargearProfile) plus each selection's
  // NET delta (w.pts from the picker — negative when a swap sheds a priced
  // default, e.g. thunder hammer → free lightning claws). Floored at 0: a
  // loadout can't refund more than its priced defaults.
  //
  // With an inventory (entry.loadout, §5) it is simply alwaysCost +
  // Σ itemCosts × count, floored at 0; the delta formula below only serves
  // entries not yet migrated from `wargear`.
  getEntryCopyWargearPts(index) {
    const entry = this.entries[index];
    if (!entry) return 0;
    if (Array.isArray(entry.loadout)) return Army.loadoutPts(entry.unitData, entry.loadout);
    const wgSel = (entry.wargear || []).reduce((s, w) => s + (w.pts || 0) * (w.count || 0), 0);
    return Math.max(0, this.getEntryWargearBasePts(index) + wgSel);
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
      disposition: this.disposition,
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
            // Full wargear inventory (§5). Absent stays absent (= defaults).
            loadout: Array.isArray(e.loadout) ? Army.cleanLoadout(e.loadout) : undefined,
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
      disposition:    typeof data.disposition === 'string' ? data.disposition.slice(0, 60) : null,
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
    // false while save() is failing (see save()); sync reads it.
    this.lastSaveOk = true;
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
      // #113 widened the guard: an unnamed army that has units is kept
      // (autosave persists it), only an empty placeholder is dropped.
      const named = all.filter(a => ArmyManager.isPersistable(a));
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

  // True iff `army` is worth keeping on disk: it has a real name OR at least
  // one entry. A list built under the placeholder name used to exist only in
  // memory until it was renamed, so a reload or a crash lost it (#113). Only
  // an EMPTY unnamed placeholder is still refused.
  static isPersistable(army) {
    if (!army) return false;
    if (ArmyManager.isNamed(army)) return true;
    return Array.isArray(army.entries) && army.entries.length > 0;
  }

  // Writes every army to localStorage and tells sync. Returns true on
  // success, false when the write failed (quota exceeded — each entry embeds
  // a ~5 KB unitData snapshot, so 30–40 armies can fill the ~5M-char origin
  // quota — or storage blocked). It never throws for that: it used to, so the
  // Save button died with an uncaught error and autosave only console.warn'd,
  // and nobody was told their list was not being kept.
  //
  // On failure sync is NOT notified and `lastSaveOk` is false. Sync reads
  // that flag before writing its known-set: recording an army as "on the
  // server and on this device" while it exists only in memory is what turned
  // a quota error into a cloud delete after the next reload.
  save() {
    try {
      localStorage.setItem('yaab_armies', JSON.stringify(this.armies.map(a => a.toJSON())));
    } catch (e) {
      this.lastSaveOk = false;
      ArmyManager._reportSaveFailure(e);
      return false;
    }
    this.lastSaveOk = true;
    ArmyManager._saveFailureShown = false;
    if (window.App && window.App.Sync && typeof window.App.Sync.notifyArmiesChanged === 'function') {
      window.App.Sync.notifyArmiesChanged();
    }
    return true;
  }

  // One visible toast per failure streak (reset by the next successful
  // save), not one per keystroke of autosave.
  static _reportSaveFailure(e) {
    try { console.warn('[ArmyManager] save failed:', e && (e.name || e.message) ? (e.name || e.message) : e); } catch (_) {}
    if (ArmyManager._saveFailureShown) return;
    ArmyManager._saveFailureShown = true;
    const quota = !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    const msg = quota
      ? "Couldn't save your armies: this browser's storage is full. Delete or export old armies to free space — recent changes are not saved yet."
      : "Couldn't save your armies: this browser is blocking storage. Recent changes are not saved yet.";
    if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, 'error', 9000);
  }

  // Returns true if the army was handed to save(), false if the name guard
  // rejected it. Callers that need to surface an error to the user (e.g. the
  // explicit Save button) should check the return value; auto-save callers
  // can ignore. A storage failure is reported by save() itself (toast) and
  // shows up as `lastSaveOk === false`, not as a false return — false keeps
  // meaning "give it a name first".
  //
  // `opts.allowUnnamed` (autosave, URL import) accepts an army still on the
  // placeholder name as long as it has entries (ArmyManager.isPersistable).
  saveArmy(army, opts) {
    const allowUnnamed = !!(opts && opts.allowUnnamed);
    if (!(allowUnnamed ? ArmyManager.isPersistable(army) : ArmyManager.isNamed(army))) return false;
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
