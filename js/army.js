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
  constructor({ id, name, factionName, chapter, detachmentName, pointsLimit, entries, createdAt, updatedAt } = {}) {
    this.id = id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    this.name = name || 'New Army';
    this.factionName = factionName || '';
    this.chapter = chapter || null;
    this.detachmentName = detachmentName || null;
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
   */
  addUnit(unitData, count = 1, squadOption = null, enhancements = []) {
    const selectedPts  = squadOption ? squadOption.pts  : (unitData.points || 0);
    const squadLabel   = squadOption && squadOption.models ? `${squadOption.models} models` : null;
    // Entries with enhancements are always separate; plain entries can stack
    const existing = !enhancements.length && this.entries.find(
      e => e.unitId === unitData.id && e.selectedPts === selectedPts && !(e.enhancements && e.enhancements.length)
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
        entryId: _mintEntryId(),
        attachedToEntryId: null,
      });
    }
    this.updatedAt = new Date().toISOString();
  }

  // Convenience accessor for the attachment graph.
  findByEntryId(entryId) {
    if (!entryId) return null;
    return this.entries.find(e => e && e.entryId === entryId) || null;
  }

  setEnhancements(index, enhancements) {
    if (this.entries[index]) {
      this.entries[index].enhancements = enhancements || [];
      this.updatedAt = new Date().toISOString();
    }
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

  updateCount(index, count) {
    if (count <= 0) {
      this.removeEntry(index);
    } else {
      this.entries[index].count = count;
      this.updatedAt = new Date().toISOString();
    }
  }

  getTotalPoints() {
    // Base: squad-size cost × count + enhancements, per entry.
    let total = 0;
    const copiesByUnit = new Map();   // unitId -> total copies fielded (for ordinal)
    const ordinalByUnit = new Map();  // unitId -> { fromCount, surcharge }
    for (const entry of this.entries) {
      const pts    = (entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData && entry.unitData.points || 0));
      const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
      total += pts * entry.count + enhPts;
      const uid = entry.unitId;
      if (uid) {
        copiesByUnit.set(uid, (copiesByUnit.get(uid) || 0) + (entry.count || 0));
        const ord = entry.unitData && entry.unitData.ordinal;
        if (ord && ord.surcharge && !ordinalByUnit.has(uid)) ordinalByUnit.set(uid, ord);
      }
    }
    // 11e per-army-ordinal surcharge: each copy of a datasheet at/after its
    // threshold count costs `surcharge` more (flat). Counted across all entries
    // of that datasheet, since the ordinal is per-datasheet, not per-squad.
    total += this.getOrdinalSurcharge(copiesByUnit, ordinalByUnit);
    return total;
  }

  getOrdinalSurcharge(copiesByUnit, ordinalByUnit) {
    let extra = 0;
    for (const [uid, ord] of ordinalByUnit) {
      const copies = copiesByUnit.get(uid) || 0;
      const surcharged = Math.max(0, copies - (ord.fromCount - 1));
      extra += surcharged * (ord.surcharge || 0);
    }
    return extra;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      factionName: this.factionName,
      chapter: this.chapter,
      detachmentName: this.detachmentName,
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
            enhancements: Array.isArray(e.enhancements) ? e.enhancements : [],
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
