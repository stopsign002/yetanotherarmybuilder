/**
 * bsdata.js - Fetch Battlescribe data from the BSData/wh40k GitHub repository.
 *
 * Files are served as plain XML (.cat) from raw.githubusercontent.com which
 * supports CORS, so no proxy is needed.  The GitHub tree API (60 req/hr
 * unauthenticated) is used only once per session to list available files;
 * the list is cached in sessionStorage to avoid repeat calls.
 */

window.BSData = (() => {

  const REPO     = 'BSData/wh40k';
  const API_TREE = `https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`;
  const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/HEAD`;
  const CACHE_KEY = 'yaab_bsdata_filelist';

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

  // ── Cache busting ────────────────────────────────────────────────────────

  // ── Bulk loader ──────────────────────────────────────────────────────────

  /**
   * Download and parse every catalogue file in the repo.
   *
   * @param {function(done, total, lastName)} onProgress   - called after each file
   * @param {function(parsedFaction)}         onFactionLoaded - called for each non-empty faction
   * @param {AbortSignal}                     [signal]     - optional cancellation
   */
  async function loadAllFactions(onProgress, onFactionLoaded, signal) {
    const files = await fetchFileList();
    const catFiles = files.filter(f => f.type === 'catalogue');
    const total = catFiles.length;
    let done = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < catFiles.length) {
        if (signal && signal.aborted) return;
        const file = catFiles[cursor++];
        try {
          // Check sessionStorage cache first
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

    // Run 6 concurrent workers
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  // ── Session cache helpers ────────────────────────────────────────────────

  function _getCachedFaction(name) {
    try {
      const raw = sessionStorage.getItem('yaab_bsf_' + name);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function _cacheFaction(faction) {
    try {
      sessionStorage.setItem('yaab_bsf_' + faction.factionName, JSON.stringify(faction));
    } catch (_) { /* sessionStorage full — skip caching */ }
  }

  function clearFactionCache() {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('yaab_bsf_')) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
    clearCache(); // also clear the file list cache
  }

  return { fetchFileList, fetchFile, loadAllFactions, clearCache, clearFactionCache };
