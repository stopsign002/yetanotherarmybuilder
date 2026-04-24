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

  // ── Compact string export/import ──────────────────────────────────────
  // Format: `YAAB1:<base64url(deflate-raw(JSON))>`
  // Using the native CompressionStream API (Chrome 103+, FF 113+, Safari 16.4+).
  const EXPORT_PREFIX = 'YAAB1:';

  function _bytesToBase64Url(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function _base64UrlToBytes(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function exportArmyToString(army) {
    const json = JSON.stringify(army.toJSON());
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return EXPORT_PREFIX + _bytesToBase64Url(new Uint8Array(buf));
  }

  async function importArmyFromString(input) {
    const raw = (input || '').trim();
    if (!raw) throw new Error('Empty input');

    // Backward-compat: allow pasting raw JSON.
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw);
      if (!data.name || !Array.isArray(data.entries)) {
        throw new Error('Invalid army data');
      }
      return Army.fromJSON(data);
    }

    if (!raw.startsWith(EXPORT_PREFIX)) {
      throw new Error('Not a valid army code');
    }
    const payload = raw.slice(EXPORT_PREFIX.length).replace(/\s+/g, '');
    const bytes = _base64UrlToBytes(payload);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    const json = new TextDecoder().decode(buf);
    const data = JSON.parse(json);
    if (!data.name || !Array.isArray(data.entries)) {
      throw new Error('Invalid army data');
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
    exportArmyToString,
    importArmyFromString,
    exportArmyToText,
    exportArmyToCSV,
    downloadFile
  };
})();
