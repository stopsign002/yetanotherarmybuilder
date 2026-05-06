// db.js - IndexedDB wrapper for persistent faction + raw XML cache across sessions.
window.YaabDB = (() => {

  const DB_NAME    = 'yaab';
  // Bumped to v7: detachment parser now recognizes plural "Detachments"
  // group/selectionEntry/entryLink names (BSData uses both forms — Aeldari
  // library, Adeptus Mechanicus, and Grey Knights all sit behind the plural
  // form and previously surfaced zero detachments). Also walks
  // sharedSelectionEntries for Tyranid/GSC-style wrappers. Stale v6 cache
  // still has the missing detachments — drop it on upgrade.
  // Bumped to v6: wargearOptions defaultWeapons now resolves
  // selectionEntryGroup defaultSelectionEntryId (so e.g. an Intercessor
  // Sergeant's pre-selected Bolt Rifle / Close combat weapon surface as
  // defaults), filters optional entryLinks (no min) out of defaults, and
  // emits modelMin=0 for max-only model variants instead of inheriting
  // squadGroupMin (fixes "5–2 models" rendering for "1 per N" variants).
  // Bumped to v14: weapon dedup keys on name + classification (ranged
  // vs melee) instead of name alone. Necron Plasmancer / Technomancer
  // each carry a ranged AND a melee "Staff of Light" profile — v13's
  // single-key dedup dropped the melee, so the unit detail panel only
  // showed the ranged version. v14 keeps both.
  // Bumped to v13: squad-size tier parser now also recognises modifier
  // conditions of type "equalTo" and "greaterThan", not just "atLeast".
  // Ripper Swarms (basePts=25, equalTo=2 → 40, atLeast=3 → 50, max=3) was
  // surfacing as "1 / 3 / 3" because the equalTo tier's threshold was NaN
  // and fell through to maxModels. v13 emits "1 / 2 / 3". Also corrects
  // Tyranid Warriors and many Ork units that use "greaterThan" (~22 BSData
  // instances faction-wide).
  // Bumped to v12: squad-size tier parser now uses the UPPER bound of each
  // tier (next threshold − 1, falling back to maxModels for the highest
  // tier). Lokhust Destroyers now show "1 / 2 / 3 / 6" instead of v11's
  // "1 / 2 / 3 / 4" — the 4-tier modifier covers 4–6 models flat-priced.
  // Bumped to v11: squad-size cost parser now reads each cost modifier's
  // `atLeast model` condition for the tier's model count. Previously every
  // tier inherited maxModels (e.g. Lokhust Destroyers showed squad sizes
  // "1 / 6 / 6 / 6" instead of "1 / 2 / 3 / 4"). Stale v10 cache still has
  // the wrong counts — drop it on upgrade.
  // Bumped to v10: added `gdc` store for cached game-datacards-eu JSON
  // payloads (per-faction stratagem/detachment/enhancement data). Source:
  // https://github.com/game-datacards/datasources — used to fill the gap
  // BSData wh40k-10e leaves around stratagem rules.
  // Bumped to v17: ability walker (js/parser/abilities.js) now recurses
  // into every selectionEntry child regardless of `type` attribute (was
  // type="model" + type="upgrade" only) and goes 5 levels deep instead
  // of 3. v16 added the upgrade walk but Lion El'Jonson's "Primarch of
  // the First Legion" sub-abilities still didn't surface — they sit
  // under untyped or differently-typed selectionEntries deeper than
  // depth 3 in the Dark Angels catalogue. Stale cache still has the
  // narrow walk; drop the parsed-data stores on upgrade.
  // Bumped to v16: ability walker (js/parser/abilities.js) now also
  // visits `:scope > selectionEntries > selectionEntry[type="upgrade"]`
  // and `:scope > entryLinks > entryLink` at the unit's top level.
  // These are the encodings BSData uses for some 10e hero abilities
  // (Lion El'Jonson's three "Primarch of the First Legion" sub-
  // abilities sit in one of those paths — without the new walks they
  // were missing from his unit card). Stale v15 cache still has the
  // old ability lists, so drop the parsed-data stores on upgrade.
  // Bumped to v15: added `cardBackImages` store for the user-uploaded
  // card-back image library (cards-mode duplex printing). Unlike the
  // parsed-data stores, this is USER DATA — its upgrade path below is
  // non-destructive (only created if missing) so future DB_VERSION
  // bumps that drop the parsed stores don't wipe the user's library.
  // Bumped to v18: classifyProfile + parseDirectProfiles + abilities.js
  // infoLink walk now also recognise <characteristic name="Effect"> as
  // ability prose (in addition to the existing "Description" path) and
  // typeName="Primarch of <foo>" as an ability typeName. Lion El'Jonson
  // ships his three "Primarch of the First Legion" toggles as direct
  // profiles on the unit using those non-standard names — v17's wider
  // selectionEntry walk was the wrong axis (the profiles were already
  // visible to parseDirectProfiles, just classified as 'other' and
  // dropped). Stale v17 cache still has the old classification; drop
  // the parsed-data stores on upgrade.
  // Bumped to v20: parser now splits multi-paragraph choose-from-N
  // ability descriptions into parent + synthetic child records
  // (Guilliman's "Author of the Codex" — one ability profile whose
  // description contains 4 paragraphs — becomes 1 parent ability with
  // typeName="Abilities" + 3 child abilities with typeName="Primarch").
  // Detection in js/parser/entry.js splitMultiParagraphChooseFromN().
  // Stale v19 cache still has Guilliman's bundled ability; drop the
  // parsed-data stores on upgrade.
  // Bumped to v19: ability records gain a `_typeName` field carrying the
  // BSData profile typeName (e.g. "Primarch of the First Legion"). The
  // cards-mode renderer uses this to split primarch sub-abilities into
  // their own PRIMARCH section instead of mixing them into the regular
  // ABILITIES list, so players can see at a glance which abilities are
  // choose-from-N toggles.
  // Bumped to v21: weapon-keyword normalisation in entry.js. Weapon
  // keywords with trailing arity ("Rapid Fire 1", "Sustained Hits D3",
  // "Anti-Infantry 4+") are now also added to the dedup set as their
  // bare base name, so the existing isCore + name-match filter actually
  // drops the matching CORE ability ("Rapid Fire") instead of leaving
  // it on the unit's CORE chip line. Stale v20 cache still has those
  // entries; drop on upgrade.
  // Bumped to v22: findStats now also inspects a selectionEntryGroup's
  // own <profiles> block when recursing through groups. Victrix Honour
  // Guard puts its M/T/SV/W/LD/OC stats profile on the inner
  // selectionEntryGroup directly rather than on any of its model
  // entries — the previous walk only checked the entries' own profiles
  // and the group's <selectionEntries> children, so Victrix surfaced
  // with empty stats. Stale v21 cache still has the empty stats; drop
  // on upgrade.
  // v23: parser now emits unit.modelStats — array of distinct statlines
  // per unit. Multi-profile units (Marneus Calgar + Victrix Honour
  // Guard, Wardens of Ultramar Sergeant vs body, Terminator Assault
  // Squad TH/SS vs LC) lost their second profile to Object.assign
  // overwrite; v22 caches were wrong (Calgar surfaced with Victrix's
  // T=4 W=3 instead of his own T=6 W=6). Drop the cache.
  // v24: bsdata.js Phase 1.5 now preloads EVERY catalogue's shared
  // content into the parser index, not just files matching
  // /\blibrary\b/i. Cross-catalogue sharedProfile references — e.g.
  // Wolf Priest's "Litany of Hate" infoLink targeting a profile that
  // lives in `Imperium - Space Marines.cat` — used to fail to resolve
  // during parallel Phase 2 parsing, silently dropping the ability.
  // v23 caches are missing those abilities; drop on upgrade so the
  // next session reparses with the fully-populated shared index.
  const DB_VERSION = 24;
  const STORE_FACTIONS = 'factions';
  const STORE_GST      = 'gst';
  const STORE_GDC      = 'gdc';
  const STORE_IMAGES   = 'cardBackImages';
  // Per-owner cap on the image library (30 images). Enforced in add().
  const IMAGES_PER_OWNER_LIMIT = 30;

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
        // Parsed-data stores: drop on every version bump so stale parsed
        // shapes don't leak across releases.
        if (db.objectStoreNames.contains(STORE_FACTIONS)) db.deleteObjectStore(STORE_FACTIONS);
        if (db.objectStoreNames.contains(STORE_GST))      db.deleteObjectStore(STORE_GST);
        if (db.objectStoreNames.contains(STORE_GDC))      db.deleteObjectStore(STORE_GDC);
        db.createObjectStore(STORE_FACTIONS, { keyPath: 'factionName' });
        db.createObjectStore(STORE_GST,      { keyPath: 'name' });
        db.createObjectStore(STORE_GDC,      { keyPath: 'name' });
        // User-data store: only create if missing; never drop. Holds
        // card-back images keyed by an auto-incremented `id`, with an
        // `owner` index so we can cheaply list/cap by username.
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          const s = db.createObjectStore(STORE_IMAGES, { keyPath: 'id', autoIncrement: true });
          s.createIndex('owner', 'owner', { unique: false });
        }
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

  // ── GDC (game-datacards-eu) cached JSON payloads ────────────────────────

  async function getGdc(name) {
    const db = await _open();
    if (!db) return null;
    try {
      const rec = await _wrap(_tx(db, STORE_GDC, 'readonly').get(name));
      return rec && rec.payload ? rec.payload : null;
    } catch (_) { return null; }
  }

  async function putGdc(name, payload) {
    const db = await _open();
    if (!db || !name || !payload) return;
    try { await _wrap(_tx(db, STORE_GDC, 'readwrite').put({ name, payload })); } catch (_) {}
  }

  async function clearGdc() {
    const db = await _open();
    if (!db) return;
    try { await _wrap(_tx(db, STORE_GDC, 'readwrite').clear()); } catch (_) {}
  }

  // ── Card-back image library ──────────────────────────────────────────────
  // User-uploaded images for the cards-mode duplex-print feature. Records:
  //   { id (auto), owner (string), name (string), dataUrl (string), addedAt (ms) }
  // Owner is the username when signed in, 'anon' otherwise. Capped per-owner
  // by IMAGES_PER_OWNER_LIMIT.

  function _listByOwnerCursor(store, owner, onRecord, onDone) {
    // Walk the `owner` index. Cursor is more memory-friendly than getAll()
    // when records hold large data URLs (an image can be hundreds of KB).
    const idx = store.index('owner');
    const req = idx.openCursor(IDBKeyRange.only(owner));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        onRecord(cur.value, cur);
        cur.continue();
      } else {
        onDone();
      }
    };
    req.onerror = () => onDone();
  }

  async function imagesList(owner) {
    const db = await _open();
    if (!db || !owner) return [];
    return new Promise(resolve => {
      try {
        const out = [];
        const store = _tx(db, STORE_IMAGES, 'readonly');
        _listByOwnerCursor(store, owner, rec => out.push(rec), () => {
          out.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
          resolve(out);
        });
      } catch (_) { resolve([]); }
    });
  }

  async function imagesCount(owner) {
    const db = await _open();
    if (!db || !owner) return 0;
    return new Promise(resolve => {
      try {
        const idx = _tx(db, STORE_IMAGES, 'readonly').index('owner');
        const req = idx.count(IDBKeyRange.only(owner));
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror   = () => resolve(0);
      } catch (_) { resolve(0); }
    });
  }

  async function imagesAdd(owner, image) {
    const db = await _open();
    if (!db || !owner || !image || !image.dataUrl) {
      return { ok: false, reason: 'unavailable' };
    }
    const count = await imagesCount(owner);
    if (count >= IMAGES_PER_OWNER_LIMIT) {
      return { ok: false, reason: 'limit', limit: IMAGES_PER_OWNER_LIMIT, count };
    }
    return new Promise(resolve => {
      try {
        const rec = {
          owner: String(owner),
          name: String(image.name || 'image'),
          dataUrl: String(image.dataUrl),
          addedAt: Date.now(),
        };
        const req = _tx(db, STORE_IMAGES, 'readwrite').add(rec);
        req.onsuccess = () => resolve({ ok: true, id: req.result, image: Object.assign({ id: req.result }, rec) });
        req.onerror   = () => resolve({ ok: false, reason: 'idb' });
      } catch (_) { resolve({ ok: false, reason: 'exception' }); }
    });
  }

  async function imagesRemove(id) {
    const db = await _open();
    if (!db || id == null) return false;
    return new Promise(resolve => {
      try {
        const req = _tx(db, STORE_IMAGES, 'readwrite').delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror   = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  async function imagesGet(id) {
    const db = await _open();
    if (!db || id == null) return null;
    try {
      const rec = await _wrap(_tx(db, STORE_IMAGES, 'readonly').get(id));
      return rec || null;
    } catch (_) { return null; }
  }

  return {
    getFaction, putFaction, getAllFactions, clearFactions,
    getGst, putGst, clearGst,
    getGdc, putGdc, clearGdc,
    images: {
      LIMIT: IMAGES_PER_OWNER_LIMIT,
      list:   imagesList,
      count:  imagesCount,
      add:    imagesAdd,
      remove: imagesRemove,
      get:    imagesGet,
    },
  };
})();
