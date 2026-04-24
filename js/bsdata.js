/**
 * bsdata.js - Fetch Battlescribe data from the BSData/wh40k GitHub repository.
 *
 * Files are served as plain XML (.cat) from raw.githubusercontent.com which
 * supports CORS, so no proxy is needed.  The GitHub tree API (60 req/hr
 * unauthenticated) is used only once per session to list available files;
 * the list is cached in sessionStorage to avoid repeat calls.
 */

window.BSData = (() => {

  const REPO     = 'BSData/wh40k-10e';
  const API_TREE = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
  const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
  // Include version in cache key so old cached 9th-ed data is ignored
  const CACHE_KEY = 'yaab_bsdata_filelist_10e_v1';

  // ── File list ────────────────────────────────────────────────────────────

  /**
   * Returns an array of { path, name, type, size } objects for every .cat
   * and .gst file in the repo, sorted alphabetically by name.
   * Result is cached in sessionStorage for the lifetime of the tab.
   */
  async function fetchFileList() {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) {}
    }

    const resp = await fetch(API_TREE);
    if (!resp.ok) {
      // Surface rate-limit errors helpfully
      if (resp.status === 403 || resp.status === 429) {
        throw new Error('GitHub API rate limit reached. Try again in a minute.');
      }
      throw new Error(`GitHub API returned ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.tree) throw new Error('Unexpected response from GitHub API');

    const files = data.tree
      .filter(item => item.type === 'blob' &&
               (item.path.endsWith('.cat') || item.path.endsWith('.gst')))
      .map(item => ({
        path: item.path,
        name: item.path.replace(/\.(cat|gst)$/, ''),
        type: item.path.endsWith('.gst') ? 'gamesystem' : 'catalogue',
        size: item.size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    sessionStorage.setItem(CACHE_KEY, JSON.stringify(files));
    return files;
  }

  // ── File content ─────────────────────────────────────────────────────────

  /**
   * Fetches the raw XML text of a single file by its repo path.
   * Files are plain XML despite the .cat extension.
   */
  async function fetchFile(path) {
    // raw.githubusercontent.com doesn't encode spaces the same way
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${RAW_BASE}/${encodedPath}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to download "${path}" (HTTP ${resp.status})`);
    }
    return resp.text();
  }

  // ── Bulk loader ──────────────────────────────────────────────────────────

  const GST_CACHE_PREFIX = 'yaab_gst_10e_v3_';

  /**
   * Download and parse every catalogue file in the repo.
   * Loads game system (.gst) files first to build a cross-file shared index
   * so unit infoLinks to game-system rules (e.g. Deep Strike) resolve correctly.
   */
  async function loadAllFactions(onProgress, onFactionLoaded, signal) {
    const files = await fetchFileList();

    // ── Phase 1: load game system file(s) into shared parser index ───────────
    const gstFiles = files.filter(f => f.type === 'gamesystem');
    for (const gst of gstFiles) {
      try {
        let xml = null;
        try { xml = sessionStorage.getItem(GST_CACHE_PREFIX + gst.name); } catch (_) {}
        if (!xml) {
          xml = await fetchFile(gst.path);
          try { sessionStorage.setItem(GST_CACHE_PREFIX + gst.name, xml); } catch (_) {}
        }
        WahapediaParser.addToSharedIndex(xml);
      } catch (e) {
        console.warn('[BSData] Failed to load game system "' + gst.name + '":', e.message);
      }
    }

    // ── Phase 2: load catalogues ──────────────────────────────────────────────
    const catFiles = files.filter(f => f.type === 'catalogue');
    const total = catFiles.length;
    let done = 0;

    // ── Phase 1.5: load library catalogues into shared index ─────────────────
    // Library catalogues (e.g. "Library - Tyranids.cat") contain shared unit
    // definitions referenced by entryLink from main catalogues. Loading them into
    // the shared index makes their sharedSelectionEntries resolvable during parse.
    const libFiles = catFiles.filter(f => /^library[\s-]/i.test(f.name));
    for (const lib of libFiles) {
      try {
        let xml = null;
        try { xml = sessionStorage.getItem(GST_CACHE_PREFIX + lib.name); } catch (_) {}
        if (!xml) {
          xml = await fetchFile(lib.path);
          try { sessionStorage.setItem(GST_CACHE_PREFIX + lib.name, xml); } catch (_) {}
        }
        WahapediaParser.addToSharedIndex(xml);
      } catch (e) {
        console.warn('[BSData] Failed to load library "' + lib.name + '":', e.message);
      }
    }

    let cursor = 0;

    async function worker() {
      while (cursor < catFiles.length) {
        if (signal && signal.aborted) return;
        const file = catFiles[cursor++];
        try {
          const cached = _getCachedFaction(file.name);
          let faction;
          if (cached) {
            faction = cached;
          } else {
            const xml = await fetchFile(file.path);
            if (signal && signal.aborted) return;
            faction = WahapediaParser.parse(xml, file.path);
            _cacheFaction(faction);
          }
          done++;
          onProgress(done, total, faction.factionName);
          if (faction.units.length > 0) onFactionLoaded(faction);
        } catch (err) {
          done++;
          onProgress(done, total, file.name);
          console.warn(`[BSData] Failed to load "${file.name}":`, err.message);
        }
      }
    }

    await Promise.all(Array.from({ length: 6 }, worker));
  }

  // ── Cache busting ────────────────────────────────────────────────────────

  function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
  }

  // ── Session cache helpers ────────────────────────────────────────────────

  const FACTION_CACHE_PREFIX = 'yaab_bsf_10e_v7_';

  function _getCachedFaction(name) {
    try {
      const raw = sessionStorage.getItem(FACTION_CACHE_PREFIX + name);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function _cacheFaction(faction) {
    try {
      sessionStorage.setItem(FACTION_CACHE_PREFIX + faction.factionName, JSON.stringify(faction));
    } catch (_) { /* sessionStorage full — skip caching */ }
  }

  function clearFactionCache() {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('yaab_bsf_') || k.startsWith('yaab_bsdata_filelist') || k.startsWith('yaab_gst_'))) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
  }

  return { fetchFileList, fetchFile, loadAllFactions, clearCache, clearFactionCache };
})();
