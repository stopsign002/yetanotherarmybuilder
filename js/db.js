// db.js - IndexedDB wrapper for persistent faction + raw XML cache across sessions.
window.YaabDB = (() => {

  const DB_NAME    = 'yaab';
  // Bumped to v4 after parser added detachment.stratagems + factionStratagems
  // arrays (powers the Stratagem Browser modal).
  const DB_VERSION = 4;
  const STORE_FACTIONS = 'factions';
  const STORE_GST      = 'gst';

  const hasIDB = typeof indexedDB !== 'undefined' && !!indexedDB;

  // Lazy, memoized open. If the very first open fails (e.g. Safari private mode),
  // cache the failure and fall through to no-op stubs thereafter.
  let _dbPromise = null;
  let _disabled  = !hasIDB;

  function _open() {
    if (_disabled) return Promise.resolve(null);
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (_) { _disabled = true; resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        // Drop existing stores on any version bump so stale parsed shapes don't leak across releases.
        if (db.objectStoreNames.contains(STORE_FACTIONS)) db.deleteObjectStore(STORE_FACTIONS);
        if (db.objectStoreNames.contains(STORE_GST))      db.deleteObjectStore(STORE_GST);
        db.createObjectStore(STORE_FACTIONS, { keyPath: 'factionName' });
        db.createObjectStore(STORE_GST,      { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => { _disabled = true; resolve(null); };
      req.onblocked = () => { /* leave pending; another tab is upgrading */ };
    });
    return _dbPromise;
  }

  function _tx(db, storeName, mode) {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  function _wrap(req) {
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(undefined);
    });
  }

  // ── Factions ──────────────────────────────────────────────────────────────

  async function getFaction(name) {
    const db = await _open();
    if (!db) return null;
    try {
      const rec = await _wrap(_tx(db, STORE_FACTIONS, 'readonly').get(name));
      return rec || null;
    } catch (_) { return null; }
  }

  async function putFaction(faction) {
    const db = await _open();
    if (!db || !faction || !faction.factionName) return;
    try { await _wrap(_tx(db, STORE_FACTIONS, 'readwrite').put(faction)); } catch (_) {}
  }

  async function getAllFactions() {
    const db = await _open();
    if (!db) return [];
    try {
      const rec = await _wrap(_tx(db, STORE_FACTIONS, 'readonly').getAll());
      return Array.isArray(rec) ? rec : [];
    } catch (_) { return []; }
  }

  async function clearFactions() {
    const db = await _open();
    if (!db) return;
    try { await _wrap(_tx(db, STORE_FACTIONS, 'readwrite').clear()); } catch (_) {}
  }

  // ── Raw XML (.gst + Library *.cat) ────────────────────────────────────────

  async function getGst(name) {
    const db = await _open();
    if (!db) return null;
    try {
      const rec = await _wrap(_tx(db, STORE_GST, 'readonly').get(name));
      return rec && typeof rec.xml === 'string' ? rec.xml : null;
    } catch (_) { return null; }
  }

  async function putGst(name, xml) {
    const db = await _open();
    if (!db || !name || typeof xml !== 'string') return;
    try { await _wrap(_tx(db, STORE_GST, 'readwrite').put({ name, xml })); } catch (_) {}
  }

  async function clearGst() {
    const db = await _open();
    if (!db) return;
    try { await _wrap(_tx(db, STORE_GST, 'readwrite').clear()); } catch (_) {}
  }

  return {
    getFaction, putFaction, getAllFactions, clearFactions,
    getGst, putGst, clearGst,
  };
})();
