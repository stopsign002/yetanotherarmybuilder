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

  function exportArmyToText(army, { detachmentName } = {}) {
    const lines = [];
    lines.push(`=== ${army.name} ===`);
    if (army.factionName) lines.push(`Faction: ${army.factionName}`);
    if (detachmentName)   lines.push(`Detachment: ${detachmentName}`);
    lines.push(`Points Limit: ${army.pointsLimit}`);
    lines.push('');

    army.entries.forEach(entry => {
      const pts    = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
      const enhPts = (entry.enhancements || []).reduce((s, e) => s + (e.pts || 0), 0);
      const total  = pts * entry.count + enhPts;
      const squad  = entry.squadLabel ? ` (${entry.squadLabel})` : '';
      lines.push(`${entry.count}x ${entry.unitName}${squad} [${total} pts]`);
      (entry.enhancements || []).forEach(enh => {
        lines.push(`  + ${enh.name} [${enh.pts} pts]`);
      });
    });

    lines.push('');
    lines.push(`Total: ${army.getTotalPoints()} / ${army.pointsLimit} pts`);
    return lines.join('\n');
  }

  function exportArmyToCSV(army) {
    const rows = [['Unit Name', 'Models', 'Points Each', 'Quantity', 'Total Points']];
    army.entries.forEach(entry => {
      const pts = entry.selectedPts !== undefined ? entry.selectedPts : (entry.unitData.points || 0);
      const models = entry.squadLabel
        ? entry.squadLabel.replace(/[^\d]/g, '') || ''
        : (entry.unitData.squadOptions && entry.unitData.squadOptions[0] && entry.unitData.squadOptions[0].models != null
            ? entry.unitData.squadOptions[0].models
            : '');
      rows.push([
        entry.unitName,
        models,
        pts,
        entry.count,
        pts * entry.count,
      ]);
    });
    rows.push(['', '', '', 'Total', army.getTotalPoints()]);

    return rows.map(row =>
      row.map(cell => {
        const s = String(cell == null ? '' : cell);
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ).join('\r\n');
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
    exportArmyToCSV,
    downloadFile
  };
})();
