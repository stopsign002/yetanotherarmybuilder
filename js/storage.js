/**
 * storage.js - Faction data persistence and army export/import
 */

window.Storage = (() => {
  const FACTIONS_KEY = 'yaab_factions';

  function saveFactionData(factions) {
    try {
      localStorage.setItem(FACTIONS_KEY, JSON.stringify(factions));
    } catch (e) {
      console.error('Failed to save faction data:', e);
      alert('Storage quota exceeded. Try removing some faction data.');
    }
  }

  function loadFactionData() {
    try {
      const raw = localStorage.getItem(FACTIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function addFaction(factionData) {
    const factions = loadFactionData();
    const idx = factions.findIndex(f => f.factionName === factionData.factionName);
    if (idx >= 0) {
      factions[idx] = factionData;
    } else {
      factions.push(factionData);
    }
    saveFactionData(factions);
    return factions;
  }

  function removeFaction(factionName) {
    const factions = loadFactionData().filter(f => f.factionName !== factionName);
    saveFactionData(factions);
    return factions;
  }

  function exportArmyToJSON(army) {
    return JSON.stringify(army.toJSON(), null, 2);
  }

  function importArmyFromJSON(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data.name || !Array.isArray(data.entries)) {
      throw new Error('Invalid army file format');
    }
    return Army.fromJSON(data);
  }

  function exportArmyToText(army) {
    const lines = [];
    lines.push(`=== ${army.name} ===`);
    if (army.factionName) lines.push(`Faction: ${army.factionName}`);
    lines.push(`Points Limit: ${army.pointsLimit}`);
    lines.push('');

    // Group by keywords if possible
    const entries = army.entries;
    entries.forEach(entry => {
      const pts = (entry.unitData.points || 0) * entry.count;
      lines.push(`${entry.count}x ${entry.unitName} [${pts} pts]`);
      if (entry.unitData.keywords && entry.unitData.keywords.length > 0) {
        lines.push(`  Keywords: ${entry.unitData.keywords.join(', ')}`);
      }
    });

    lines.push('');
    lines.push(`Total: ${army.getTotalPoints()} / ${army.pointsLimit} pts`);
    return lines.join('\n');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    saveFactionData,
    loadFactionData,
    addFaction,
    removeFaction,
    exportArmyToJSON,
    importArmyFromJSON,
    exportArmyToText,
    downloadFile
  };
})();
