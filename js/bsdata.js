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

  // Per-fetch timeout. A hung TCP connection can otherwise wedge a worker forever
  // and freeze the progress bar at "X / total".
  const FETCH_TIMEOUT_MS = 30000;
  // One retry on network failure before giving up. Helps with flaky wifi.
  const FETCH_RETRIES    = 1;
  const FETCH_RETRY_MS   = 1000;
  // IndexedDB put cap — slow/quota-pressured Safari can hang put forever.
  const DB_PUT_TIMEOUT_MS = 10000;

  /**
   * Fetches the raw XML text of a single file by its repo path.
   * Files are plain XML despite the .cat extension.
   *
   * Hardened against silent hangs:
   *  - 30s AbortController timeout per attempt
   *  - 1 retry on network failure (1s delay)
   */
  async function fetchFile(path) {
    // raw.githubusercontent.com doesn't encode spaces the same way
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${RAW_BASE}/${encodedPath}`;

    let lastErr = null;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      // Each attempt gets its own AbortController so the timeout is fresh.
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => {
        try { ctrl.abort(); } catch (_) {}
      }, FETCH_TIMEOUT_MS) : null;
      try {
        const resp = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (timer) clearTimeout(timer);
        if (!resp.ok) {
          // 404/403 won't get better with a retry — fail fast.
          throw new Error(`Failed to download "${path}" (HTTP ${resp.status})`);
        }
        return await resp.text();
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastErr = err;
        const aborted = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')));
        if (aborted) {
          console.warn(`[BSData] fetch timeout on "${path}" (attempt ${attempt + 1})`);
        }
        if (attempt < FETCH_RETRIES) {
          await new Promise(r => setTimeout(r, FETCH_RETRY_MS));
          continue;
        }
        throw lastErr;
      }
    }
    // Unreachable — loop above either returns or throws.
    throw lastErr || new Error(`fetchFile: unknown failure for ${path}`);
  }

  // ── Bulk loader ──────────────────────────────────────────────────────────

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
        try { xml = await YaabDB.getGst(gst.name); } catch (_) {}
        if (!xml) {
          xml = await fetchFile(gst.path);
          try { await YaabDB.putGst(gst.name, xml); } catch (_) {}
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
    // Library catalogues (e.g. "Library - Tyranids.cat",
    // "Imperium - Imperial Knights - Library.cat") contain shared unit
    // definitions referenced by entryLink or importRootEntries catalogueLinks.
    // Loading them into the shared index before Phase 2 ensures their entries
    // and root entryLinks are resolvable during parallel catalogue parsing.
    // Match any name containing the word "library" (case-insensitive) to catch
    // both "Library - X" and "X - Library" naming conventions.
    const libFiles = catFiles.filter(f => /\blibrary\b/i.test(f.name));
    for (const lib of libFiles) {
      try {
        let xml = null;
        try { xml = await YaabDB.getGst(lib.name); } catch (_) {}
        if (!xml) {
          xml = await fetchFile(lib.path);
          try { await YaabDB.putGst(lib.name, xml); } catch (_) {}
        }
        WahapediaParser.addToSharedIndex(xml);
      } catch (e) {
        console.warn('[BSData] Failed to load library "' + lib.name + '":', e.message);
      }
    }

    let cursor = 0;

    // Watchdog: log any file that's been "in flight" for more than 15s without
    // completing. Helps diagnose hangs when the progress bar freezes.
    const inFlight = new Map(); // file.name -> startedAtMs
    const watchdog = setInterval(() => {
      const now = Date.now();
      inFlight.forEach((startedAt, name) => {
        const elapsed = now - startedAt;
        if (elapsed > 15000) {
          console.warn(`[BSData] still fetching: "${name}" (${Math.round(elapsed / 1000)}s)`);
        }
      });
    }, 5000);

    async function worker() {
      while (cursor < catFiles.length) {
        if (signal && signal.aborted) return;
        const file = catFiles[cursor++];
        inFlight.set(file.name, Date.now());
        try {
          const cached = await _getCachedFaction(file.name);
          let faction;
          // A cached faction with 0 units is stale (e.g. parsed before its
          // library catalogue was in the shared index). Re-fetch so Pattern C
          // can resolve the missing units now that the index is populated.
          if (cached && cached.units && cached.units.length > 0) {
            faction = cached;
          } else {
            const xml = await fetchFile(file.path);
            if (signal && signal.aborted) { inFlight.delete(file.name); return; }
            // Some catalogues (e.g. "Unaligned Forces") aren't named "Library …"
            // but still mark themselves as `library="true"` in XML and contain
            // only sharedSelectionEntries/Groups. Parsing them as normal
            // catalogues yields zero units and (more importantly) made the
            // loader appear to hang on certain BSData versions. Detect via
            // the root element attribute and route to the shared index.
            if (/<catalogue\b[^>]*\blibrary\s*=\s*"true"/i.test(xml.slice(0, 1024))) {
              try { WahapediaParser.addToSharedIndex(xml); } catch (_) {}
              done++;
              inFlight.delete(file.name);
              onProgress(done, total, file.name);
              continue;
            }
            faction = WahapediaParser.parse(xml, file.path);
            await _cacheFaction(faction);
          }
          done++;
          inFlight.delete(file.name);
          onProgress(done, total, faction.factionName);
          if (faction.units.length > 0) onFactionLoaded(faction);
        } catch (err) {
          // CRITICAL: catch must always increment `done` so the worker pool drains
          // even when fetchFile throws (timeout) or the parser throws (bad input).
          done++;
          inFlight.delete(file.name);
          onProgress(done, total, file.name);
          console.warn(`[BSData] Failed to load "${file.name}":`, err && err.message ? err.message : err);
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: 6 }, worker));
    } finally {
      clearInterval(watchdog);
    }

    // Release the shared DOM-node index. Each retained element kept its entire
    // parsed XML document alive via ownerDocument; clearing these Maps lets
    // those multi-MB trees be garbage collected.
    try { WahapediaParser.releaseSharedIndex(); } catch (_) {}

    // ── Phase 3: GDC stratagem layer ─────────────────────────────────────────
    // BSData wh40k-10e doesn't ship 10e stratagem rules. Pull them from the
    // game-datacards-eu JSON repo and merge into the parsed faction objects.
    // Defensive: if GDC is unreachable or its schema shifts, BSData-driven
    // units/datasheets/detachments still work — only the inline Stratagems
    // subsection silently degrades to core strats only.
    try {
      if (window.App && App.GDC && Array.isArray(App.state && App.state.factions)) {
        const factionNames = App.state.factions.map(f => f.factionName);
        await App.GDC.loadAll(factionNames);
        if (signal && signal.aborted) return;
        App.GDC.mergeIntoFactions(App.state.factions);

        // Re-render the army-rules box now that gdcStratagems are attached.
        // On a fresh page load with a saved army, App.getCurrentFaction()
        // and App.state.selectedDetachment are already populated by the
        // saved-army restore flow — but updateFactionRules ran BEFORE this
        // merge, so the Detachment Stratagems list came back empty. Without
        // this re-render the user has to manually re-pick the detachment to
        // see the strats appear.
        try {
          if (window.UI && typeof UI.updateFactionRules === 'function') {
            const currentFaction = (typeof App.getCurrentFaction === 'function')
              ? App.getCurrentFaction()
              : null;
            UI.updateFactionRules(currentFaction, App.state.selectedDetachment || null);
          }
        } catch (renderErr) {
          console.warn('[BSData] post-GDC re-render failed (non-fatal):', renderErr && renderErr.message ? renderErr.message : renderErr);
        }
      }
    } catch (e) {
      console.warn('[BSData] GDC stratagem layer failed (non-fatal):', e && e.message ? e.message : e);
    }
  }

  // ── Cache busting ────────────────────────────────────────────────────────

  function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
  }

  // ── Persistent cache helpers (IndexedDB via YaabDB) ──────────────────────

  async function _getCachedFaction(name) {
    try {
      // Guard against an IDB read that never resolves (txn pipeline wedged
      // by an earlier slow put). 10s is plenty for a single record read.
      const get = YaabDB.getFaction(name);
      const timeout = new Promise((resolve) => setTimeout(() => {
        console.warn(`[BSData] IndexedDB get timed out for "${name}" — falling back to network`);
        resolve(null);
      }, DB_PUT_TIMEOUT_MS));
      return await Promise.race([get, timeout]);
    }
    catch (_) { return null; }
  }

  async function _cacheFaction(faction) {
    // YaabDB.putFaction can hang silently on quota pressure / Safari private mode.
    // Race it against a 10s timeout so a stuck IDB write can't wedge the worker.
    try {
      const put = YaabDB.putFaction(faction);
      const timeout = new Promise((resolve) => setTimeout(() => {
        console.warn(`[BSData] IndexedDB put timed out for "${faction && faction.factionName}" — skipping cache`);
        resolve();
      }, DB_PUT_TIMEOUT_MS));
      await Promise.race([put, timeout]);
    } catch (_) {}
  }

  async function clearFactionCache() {
    // Clear legacy sessionStorage keys (for users upgrading from the old cache)
    // as well as the filelist, then wipe the IndexedDB stores.
    const keys = [];
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('yaab_bsf_') || k.startsWith('yaab_bsdata_filelist') || k.startsWith('yaab_gst_'))) keys.push(k);
      }
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
    try { await YaabDB.clearFactions(); } catch (_) {}
    try { await YaabDB.clearGst(); } catch (_) {}
  }

  return { fetchFileList, fetchFile, loadAllFactions, clearCache, clearFactionCache };
})();
