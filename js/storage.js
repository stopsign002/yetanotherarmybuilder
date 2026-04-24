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
  // The JSON is a compact v2 object that stores only selections:
  //   { v:2, n:name, f:factionName, c:chapter?, p:pointsLimit, d:detachment?,
  //     e:[[unitId, count, selectedPts?, [[enhName, enhPts], ...]?], ...] }
  // Unit data is rehydrated from the live faction catalogue at import time.
  // Raw JSON ({...) and pre-v2 YAAB1: codes (full serialized Army) are still
  // accepted by importArmyFromString for backward compatibility.
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

  async function _deflate(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function _inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  function _toCompact(army, { factionName, chapter, detachmentName } = {}) {
    const data = {
      v: 2,
      n: army.name,
      p: army.pointsLimit,
    };
    if (factionName)    data.f = factionName;
    if (chapter)        data.c = chapter;
    if (detachmentName) data.d = detachmentName;
    data.e = (army.entries || []).map(entry => {
      const tuple = [entry.unitId, entry.count];
      const enhs = (entry.enhancements || []).map(e => [e.name, e.pts || 0]);
      const hasEnh = enhs.length > 0;
      const hasPts = entry.selectedPts != null;
      if (hasPts || hasEnh) tuple.push(hasPts ? entry.selectedPts : null);
      if (hasEnh)           tuple.push(enhs);
      return tuple;
    });
    return data;
  }

  function _findUnit(factions, preferredNames, unitId) {
    // Prefer a declared faction (chapter, then parent); fall back to any
    // loaded faction (mirrors findUnit's linked-catalogue policy in app.js).
    for (const name of preferredNames) {
      if (!name) continue;
      const f = factions.find(f => f.factionName === name);
      if (!f) continue;
      const u = (f.units || []).find(u => u.id === unitId);
      if (u) return u;
    }
    for (const f of factions) {
      const u = (f.units || []).find(u => u.id === unitId);
      if (u) return u;
    }
    return null;
  }

  function _fromCompact(data, { factions = [] } = {}) {
    const factionName = data.f || '';
    const chapter     = data.c || '';
    const lookupOrder = [chapter, factionName];
    const displayFaction = chapter || factionName || '(unknown)';
    const entries = (data.e || []).map(tuple => {
      const [unitId, count = 1, selectedPts = null, enhPairs = null] = tuple;
      const unitData = _findUnit(factions, lookupOrder, unitId);
      if (!unitData) {
        throw new Error(`Unit "${unitId}" from "${displayFaction}" is not loaded yet. Wait for background loading to finish, then try again.`);
      }
      const resolvedPts = (selectedPts == null) ? (unitData.points || 0) : selectedPts;
      let squadLabel = null;
      const squadOpt = (unitData.squadOptions || []).find(o => o.pts === resolvedPts);
      if (squadOpt && squadOpt.models) squadLabel = `${squadOpt.models} models`;
      const enhancements = Array.isArray(enhPairs)
        ? enhPairs.map(p => Array.isArray(p)
            ? { name: p[0], pts: p[1] || 0, description: '' }
            : { name: String(p), pts: 0, description: '' })
        : [];
      return {
        unitId,
        unitName: unitData.name,
        unitData,
        count,
        selectedPts: resolvedPts,
        squadLabel,
        enhancements,
      };
    });
    const army = new Army({
      name: data.n || 'Imported Army',
      factionName,
      pointsLimit: data.p || 2000,
      entries,
    });
    return { army, chapter: data.c || null, detachment: data.d || null };
  }

  async function exportArmyToString(army, opts = {}) {
    const json = JSON.stringify(_toCompact(army, opts));
    const bytes = await _deflate(json);
    return EXPORT_PREFIX + _bytesToBase64Url(bytes);
  }

  async function importArmyFromString(input, opts = {}) {
    const raw = (input || '').trim();
    if (!raw) throw new Error('Empty input');

    // Legacy raw-JSON paste (old .json file exports).
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw);
      if (!data.name || !Array.isArray(data.entries)) {
        throw new Error('Invalid army data');
      }
      return { army: Army.fromJSON(data), chapter: null, detachment: null };
    }

    if (!raw.startsWith(EXPORT_PREFIX)) {
      throw new Error('Not a valid army code');
    }
    const payload = raw.slice(EXPORT_PREFIX.length).replace(/\s+/g, '');
    const bytes = _base64UrlToBytes(payload);
    const json = await _inflate(bytes);
    const data = JSON.parse(json);

    if (data && data.v === 2) {
      return _fromCompact(data, opts);
    }

    // Pre-v2 YAAB1 codes contained the full serialized Army.
    if (data && data.name && Array.isArray(data.entries)) {
      return { army: Army.fromJSON(data), chapter: null, detachment: null };
    }
    throw new Error('Unknown army code format');
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
