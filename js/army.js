/**
 * army.js - Army data model
 */

window.Army = class Army {
  constructor({ id, name, factionName, pointsLimit, entries } = {}) {
    this.id = id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    this.name = name || 'New Army';
    this.factionName = factionName || '';
    this.pointsLimit = pointsLimit || 2000;
    this.entries = entries || []; // [{unitId, unitName, unitData, count}]
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  addUnit(unitData, count = 1) {
    const existing = this.entries.find(e => e.unitId === unitData.id);
    if (existing) {
      existing.count += count;
    } else {
      this.entries.push({
        unitId: unitData.id,
        unitName: unitData.name,
        unitData: unitData,
        count: count
      });
    }
    this.updatedAt = new Date().toISOString();
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
      return total + (entry.unitData.points || 0) * entry.count;
    }, 0);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      factionName: this.factionName,
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
