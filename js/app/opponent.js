// app/opponent.js — opponent army state + paste-in parser (YAAB1 + plain text).
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const LS_KEY = 'yaab_opponent';

  // ── Plain-text parsing ──────────────────────────────────────────────

  // Header / separator lines we skip outright.
  const HEADER_RE = /^\s*(===+|\+\++|---+)/;
  // BattleScribe / WTC preamble lines.
  const PREAMBLE_RE = /^\s*(army|faction|detachment|points?\s*limit|total|list\s+name|warlord|player|chars?\s*:|battleline\s*:|other\s*:|pts|size)\b/i;
  // Lines we treat as wargear/enhancement sub-items — always skipped.
  // Per spec: indented lines, or lines starting with '+', '*', '•'.
  // A bare leading '-' is treated as a unit bullet, not a sub-item.
  const SUB_ITEM_RE = /^(\s{2,}|\t)|^\s*(\+|\*|•|◦)\s+\S/;

  // Rough unit-line detector + extractor. We try several shapes:
  //   "3x Intercessor Squad [120 pts]"
  //   "Char1: 1x Captain (95 pts)"
  //   "Intercessor Squad (5 models) ... 80pts"
  //   "- Captain ........ 95"
  // Returns { count, name, pts } or null.
  function extractUnitLine(raw) {
    if (!raw) return null;
    let line = raw.replace(/\t/g, ' ').trim();
    if (!line) return null;
    if (HEADER_RE.test(line)) return null;
    if (PREAMBLE_RE.test(line)) return null;

    // WTC / "Char1:", "Battleline:" style prefix
    line = line.replace(/^\s*(chars?\d*|battleline\d*|other\d*|dedicated\d*|allied\d*)\s*:\s*/i, '');

    // Points extraction — pick the LAST integer that looks like points.
    // Accepts "[120 pts]", "(95pts)", "80 pts", "- 80".
    let pts = 0;
    const ptsMatch = line.match(/(\d{2,4})\s*(?:pts?|points?)?\s*[\]\)]?\s*$/i);
    if (ptsMatch) pts = parseInt(ptsMatch[1], 10) || 0;

    // Strip trailing "[... pts]" / "(... pts)" / "- 80pts" / bare "80" blocks.
    let core = line
      .replace(/\s*[\[\(]\s*\d{1,4}\s*(?:pts?|points?)?\s*[\]\)]\s*$/i, '')
      .replace(/\s*[-–—]\s*\d{1,4}\s*(?:pts?|points?)?\s*$/i, '')
      .replace(/\s*\d{1,4}\s*(?:pts?|points?)\s*$/i, '')
      .replace(/\s+\d{2,4}\s*$/, '')
      .replace(/[\s.·]+$/, '')
      .trim();

    // Leading count: "3x ", "3 x ", "3× "
    let count = 1;
    const cm = core.match(/^(\d{1,2})\s*[x×]\s+(.+)$/i);
    if (cm) {
      count = Math.max(1, parseInt(cm[1], 10) || 1);
      core = cm[2].trim();
    } else {
      // Bullet-less dash prefix or nothing.
      core = core.replace(/^[-–—]\s+/, '').trim();
    }

    // Strip trailing parentheticals like "(5 models)" or "(Warlord)".
    core = core.replace(/\s*\([^)]*\)\s*$/g, '').trim();

    // Reject lines that became empty or obviously not a unit.
    if (!core) return null;
    if (core.length < 3) return null;
    if (/^\d+$/.test(core)) return null;

    return { count, name: core, pts };
  }

  // Match a parsed name against App.state.allUnits using a longest-substring
  // comparison. Both sides lowercased; trailing parenthetical noise already
  // stripped by extractUnitLine.
  function matchUnit(name) {
    const all = (App.state && App.state.allUnits) || [];
    if (!all.length || !name) return null;
    const needle = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!needle) return null;

    let best = null;
    let bestLen = 0;
    for (let i = 0; i < all.length; i++) {
      const u = all[i];
      const un = String(u.name || '').toLowerCase();
      if (!un) continue;
      if (un === needle) return u; // exact shortcut
      // Bidirectional substring: either the parsed name contains the catalogue
      // name, or vice versa. We score by the length of the catalogue name so
      // "Captain in Terminator Armour" beats "Captain" when both match.
      const hit = needle.indexOf(un) !== -1 || un.indexOf(needle) !== -1;
      if (hit && un.length > bestLen) {
        best = u;
        bestLen = un.length;
      }
    }
    return best;
  }

  function parsePlainText(text) {
    const out = [];
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (SUB_ITEM_RE.test(raw)) continue; // enhancements / wargear indents
      const parsed = extractUnitLine(raw);
      if (!parsed) continue;
      const unit = matchUnit(parsed.name);
      out.push({
        unitName: unit ? unit.name : parsed.name,
        unit: unit || null,
        count: parsed.count,
        pts: parsed.pts,
      });
    }
    return out;
  }

  // Turn parsed entries into an Army-shaped object (compatible with
  // ui/matchup.js). We don't route through ArmyManager; the opponent army
  // is state-only.
  function entriesToArmy(entries, { name = 'Opponent', factionName = '' } = {}) {
    const mapped = entries.map(e => {
      const u = e.unit;
      const pts = e.pts || (u && u.points) || 0;
      return {
        unitId: u ? u.id : ('unknown:' + e.unitName),
        unitName: e.unitName,
        unitData: u || { name: e.unitName, stats: {}, weapons: [], keywords: [], points: pts },
        count: e.count || 1,
        selectedPts: pts,
        squadLabel: null,
        enhancements: [],
      };
    });
    const army = new Army({ name, factionName, pointsLimit: 0, entries: mapped });
    return army;
  }

  // ── State + persistence ─────────────────────────────────────────────

  function setOpponent(army, code) {
    App.state.opponentArmy = army || null;
    try {
      if (code) localStorage.setItem(LS_KEY, code);
      else if (!army) localStorage.removeItem(LS_KEY);
    } catch (_) {}
    refreshMatchupButton();
  }

  function clearOpponent() {
    App.state.opponentArmy = null;
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    refreshMatchupButton();
  }

  function refreshMatchupButton() {
    const btn = document.getElementById('yaab-btn-matchup');
    if (!btn) return;
    if (App.state && App.state.opponentArmy) btn.removeAttribute('disabled');
    else btn.setAttribute('disabled', '');
  }

  // ── YAAB1 vs plain text dispatch ────────────────────────────────────

  async function importFromYAAB1(raw) {
    const { army } = await Storage.importArmyFromString(raw, {
      factions: App.state.factions,
    });
    return army;
  }

  async function parseInput(raw) {
    const text = String(raw || '').trim();
    if (!text) throw new Error('Empty input');
    if (text.startsWith('YAAB1:') || text.startsWith('{')) {
      const army = await importFromYAAB1(text);
      return { kind: 'yaab1', army, code: text.startsWith('YAAB1:') ? text : null, entries: null };
    }
    const entries = parsePlainText(text);
    if (!entries.length) {
      throw new Error('No units recognized — paste a YAAB1 code or a cleaner text list.');
    }
    const army = entriesToArmy(entries, { name: 'Opponent' });
    return { kind: 'text', army, code: null, entries };
  }

  // ── Bootstrap: restore persisted opponent ──────────────────────────

  async function restoreFromStorage() {
    let code = null;
    try { code = localStorage.getItem(LS_KEY); } catch (_) {}
    if (!code) return;
    if (!App.state.factions || App.state.factions.length === 0) return; // retry later
    try {
      const army = await importFromYAAB1(code);
      App.state.opponentArmy = army;
      refreshMatchupButton();
    } catch (_) {
      // Opponent code references units from factions not loaded yet — leave
      // for a later retry via armyChange hook.
    }
  }

  App.hooks.bootstrap.push(function () {
    // Kick off a restore attempt; retry every 1.5s for up to 60s until
    // factions are loaded enough to rehydrate.
    const started = Date.now();
    const tick = () => {
      if (App.state.opponentArmy) return;
      if (Date.now() - started > 60000) return;
      restoreFromStorage().then(() => {
        if (!App.state.opponentArmy) setTimeout(tick, 1500);
      });
    };
    tick();
  });

  // ── Public API ──────────────────────────────────────────────────────

  App.opponent = {
    parseInput,
    parsePlainText,
    setOpponent,
    clearOpponent,
    refreshMatchupButton,
    matchUnit,
    LS_KEY,
  };
})();
