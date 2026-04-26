/**
 * army.js - Army data model
 */

window.Army = class Army {
  constructor({ id, name, factionName, chapter, detachmentName, pointsLimit, entries } = {}) {
    this.id = id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    this.name = name || 'New Army';
    this.factionName = factionName || '';
    this.chapter = chapter || null;
    this.detachmentName = detachmentName || null;
    this.pointsLimit = pointsLimit || 2000;
    this.entries = entries || []; // [{unitId, unitName, unitData, count}]
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
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
      });
    }
    this.updatedAt = new Date().toISOString();
  }

  setEnhancements(index, enhancements) {
    if (this.entries[index]) {
      this.entries[index].enhancements = enhancements || [];
      this.updatedAt = new Date().toISOString();
    }
  }

  removeEntry(index) {
    this.entries.splice(index, 1);
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
    return this.entries.reduce((total, entry) => {
      const pts    = (entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0));
      const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
      return total + pts * entry.count + enhPts;
    }, 0);
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
    return new Army(data);
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
      return JSON.parse(raw).map(d => Army.fromJSON(d));
    } catch {
      return [];
    }
  }

  save() {
    localStorage.setItem('yaab_armies', JSON.stringify(this.armies.map(a => a.toJSON())));
  }

  saveArmy(army) {
    const idx = this.armies.findIndex(a => a.id === army.id);
    if (idx >= 0) {
      this.armies[idx] = army;
    } else {
      this.armies.push(army);
    }
    this.save();
  }

  deleteArmy(id) {
    this.armies = this.armies.filter(a => a.id !== id);
    this.save();
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
