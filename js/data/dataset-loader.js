// data/dataset-loader.js — the live game-data source (pipeline v2).
//
// Contract: docs/DATASET.md §1 and §7. The dataset under data/dataset/<which>/
// is the array BSData.loadAllFactions() used to build in the browser, already
// serialised one faction per file. This module only fetches it: no merging, no
// overlays, no fixes. Whatever the files say is what the renderers get.
//
//   ?data=current            (default)  data/dataset/current/
//   ?data=candidate:<id>                data/dataset/candidate/<id>/
//
// It also keeps the three small surfaces the old adapter (dc-adapter.js +
// dc-bundle.js) provided that renderers still call:
//   - window.BSData            { loadAllFactions, clearCache, clearFactionCache, ... }
//   - WahapediaParser._internal.foldKey   (attachments.js; installed before the
//                                         dormant parser so its own fold loses)
//   - window.DC.abilityText / DC.abilities.get   (ui/glossary.js), derived
//                                         from the dataset's core abilities and
//                                         weapon _keywordDefs + App.CORE_STRATAGEMS
// window.YAAB_DATASET holds the manifest that was loaded (debugging).
(function () {
  'use strict';

  const BASE = 'data/dataset/';

  // ── which dataset ─────────────────────────────────────────────────────────
  function resolveWhich() {
    let raw = 'current';
    try { raw = new URLSearchParams(location.search).get('data') || 'current'; } catch (_) {}
    if (raw === 'current') return { label: 'current', dir: BASE + 'current/' };
    const m = /^candidate:([A-Za-z0-9._-]+)$/.exec(raw);
    if (m && m[1] !== '.' && m[1] !== '..') {
      return { label: 'candidate:' + m[1], dir: BASE + 'candidate/' + m[1] + '/' };
    }
    console.error('[dataset] unrecognised ?data=' + raw + ' — loading current instead');
    return { label: 'current', dir: BASE + 'current/', bad: raw };
  }

  function toast(msg) {
    try { if (window.UI && typeof UI.toast === 'function') UI.toast(msg, 'error', 8000); } catch (_) {}
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
    return res.json();
  }

  const WHICH = resolveWhich();

  // Start fetching at script-execution time so the network overlaps the rest
  // of the deferred scripts; loadAllFactions only awaits it.
  let progress = null;  // (done, total, name) — set by loadAllFactions
  const loaded = (async function () {
    let manifest;
    try {
      manifest = await getJson(WHICH.dir + 'manifest.json');
    } catch (e) {
      const msg = 'Game data manifest failed to load (' + WHICH.label + '): ' + e.message;
      console.error('[dataset] ' + msg);
      throw new Error(msg);
    }
    window.YAAB_DATASET = Object.assign({ which: WHICH.label }, manifest);
    const list = Array.isArray(manifest.factions) ? manifest.factions : [];
    if (!list.length) throw new Error('Game data manifest ' + WHICH.label + ' lists no factions');

    let done = 0;
    const results = await Promise.all(list.map(async (entry) => {
      const file = entry.file || (entry.id + '.json');
      try {
        const f = await getJson(WHICH.dir + file);
        if (!f || !Array.isArray(f.units)) throw new Error(file + ' is not a faction file');
        return { ok: true, faction: f };
      } catch (e) {
        return { ok: false, id: entry.id || file, error: e && e.message ? e.message : String(e) };
      } finally {
        done += 1;
        if (progress) { try { progress(done, list.length, entry.name || entry.id); } catch (_) {} }
      }
    }));

    const factions = results.filter(r => r.ok).map(r => r.faction);
    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      failed.forEach(r => console.error('[dataset] faction file failed: ' + r.id + ' — ' + r.error));
    }
    if (!factions.length) {
      throw new Error('No faction files could be loaded from ' + WHICH.label +
        ' (' + failed.length + ' failed)');
    }
    console.info('[dataset] ' + WHICH.label + ' ' + (manifest.id || '?') + ': ' + factions.length +
      ' factions, ' + factions.reduce((n, f) => n + f.units.length, 0) + ' units' +
      (failed.length ? ', ' + failed.length + ' FAILED' : ''));
    return { manifest, factions, failed, total: list.length };
  })();
  // Keep an early rejection from being reported as unhandled before anyone awaits it.
  loaded.catch(() => {});

  async function loadAllFactions(onProgress, onFactionLoaded /*, signal */) {
    progress = typeof onProgress === 'function' ? onProgress : null;
    const { factions, failed, total } = await loaded;   // throws → bsdata-load toasts it
    progress = null;
    factions.forEach((faction, i) => {
      if (onProgress) onProgress(i + 1, factions.length, faction.factionName);
      if (onFactionLoaded) onFactionLoaded(faction);
    });
    if (failed.length) {
      toast('Game data incomplete: ' + failed.length + ' of ' + total + ' factions failed to load (' +
        failed.map(r => r.id).join(', ') + '). Reload to retry.');
    }
    if (WHICH.bad) toast('Unknown ?data=' + WHICH.bad + ' — showing the current dataset.');
    return factions;
  }

  // ── window.BSData (same public surface the adapter exposed) ────────────────
  window.BSData = {
    loadAllFactions,
    fetchFileList: async () => [],
    fetchFile: async () => { throw new Error('dataset loader: no XML fetch'); },
    clearCache: async () => {},
    clearFactionCache: async () => { try { await window.YaabDB.clearFactions(); } catch (_) {} },
  };

  // ── foldKey stub (attachments.js) ─────────────────────────────────────────
  // Identical to the adapter's. Installed here, before js/parser/classify.js,
  // which only sets its own fold when none exists.
  window.WahapediaParser = window.WahapediaParser || {};
  window.WahapediaParser._internal = window.WahapediaParser._internal || {};
  if (!window.WahapediaParser._internal.foldKey) {
    window.WahapediaParser._internal.foldKey = (s) => String(s || '')
      .toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9]/g, '');
  }

  // ── window.DC glossary shim (ui/glossary.js) ──────────────────────────────
  // glossary.js reads DC.abilityText ({id: {faction:'core', raw_text}}) and
  // DC.abilities.get(id).name once, lazily, on the first glossary lookup. The
  // old bundle carried a 40kdc core-rule store; the dataset carries the same
  // rules as core unit abilities and per-weapon _keywordDefs, so the store is
  // derived from those. Ids are the parameter-free base ("feel-no-pain",
  // "sustained-hits", "anti"); base terms get no explicit name so glossary
  // title-cases the id, exactly as it did for the bundle's base entries.
  const slug = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const PARAM = /\s+(?:\d+\+?|D\d+(?:\+\d+)?|\d*D\d+(?:\+\d+)?|\d+(?:"|”))$/i;
  function baseOf(name) {
    let n = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (/^anti\b/i.test(n)) return { id: 'anti', named: false };
    const stripped = n.replace(PARAM, '').trim();
    return { id: slug(stripped), named: stripped === n, name: n };
  }

  let dcStore = null;
  function buildDcStore() {
    const text = {}, names = {};
    const put = (id, raw, name) => {
      if (!id || !raw) return;
      if (!text[id]) text[id] = { faction: 'core', raw_text: String(raw) };
      if (name && !names[id]) names[id] = String(name);
    };
    const A = window.App;
    const factions = (A && A.state && Array.isArray(A.state.factions)) ? A.state.factions : [];
    factions.forEach(f => (f.units || []).forEach(u => {
      (u.abilities || []).forEach(a => {
        if (!a || !a.isCore) return;
        const b = baseOf(a.name);
        if (b.id === 'damaged') return;   // a model state, not a glossary rule
        put(b.id, a.description, b.named ? b.name : null);
      });
      (u.weapons || []).forEach(w => {
        const kd = w && w._keywordDefs;
        if (!kd || typeof kd !== 'object') return;
        Object.keys(kd).forEach(k => { put(baseOf(k).id, kd[k], null); });
      });
    }));
    (window.App && Array.isArray(window.App.CORE_STRATAGEMS) ? window.App.CORE_STRATAGEMS : []).forEach(s => {
      if (s && s.name) put(slug(s.name), s.description, s.name);
    });
    return { text, names, n: factions.length };
  }
  function store() {
    const A = window.App;
    const n = (A && A.state && Array.isArray(A.state.factions)) ? A.state.factions.length : 0;
    if (!dcStore || dcStore.n !== n) dcStore = buildDcStore();
    return dcStore;
  }
  if (!window.DC) {
    window.DC = {
      get abilityText() { return store().text; },
      abilities: {
        get(id) {
          const nm = store().names[id];
          if (nm) return { id, name: nm };
          if (store().text[id]) return { id, name: '' };
          throw new Error('unknown ability ' + id);
        },
      },
    };
  }

  console.info('[dataset] loader active (' + WHICH.label + ') — BSData overridden.');
})();
