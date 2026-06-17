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
  // v25: parser now surfaces Ork transport profiles (typeName="Transport"
  // with a single <characteristic name="Capacity">, which had no
  // matching path through classifyProfile / parseDirectProfiles) and
  // the detachment-level roll tables some factions encode as <profile>
  // siblings of the detachment <rule> (Dread Mob's "Try Dat Button!"
  // D6 table). Drop the cache so the new fields surface.
  // v26: parser now extracts transport capacity into a dedicated
  // unit.transportCapacity field (renderer puts it in its own
  // "Transport" section) and drops the orphan "Damaged: X Wounds
  // Remaining" wound-band profiles from the abilities list — 10e
  // BSData vehicles don't actually use degrading statlines, so those
  // were just clutter on Land Raider, Repulsor, etc.
  // v27: parser now blocks the abilities walker from descending into
  // Crusade-only "Weapon Modifications" hooks and per-detachment
  // "X Enhancements" sibling groups. Every Land Raider / Predator /
  // Repulsor in v26 caches was accidentally inheriting Precise /
  // Precision / Lethal Hits as core abilities (and the Headhunter
  // Task Force's four enhancements) because the walker followed those
  // entryLinks. catalogue.js gains a Pattern C that re-extracts
  // detachment enhancements from the standalone sibling groups so
  // detachments like Headhunter Task Force still surface their list.
  // v28: parser walks <infoGroup> elements (Orks: Ghazghkull / Warboss
  // "Leader" block, Tau bounty/pilot blocks) so the inner profile +
  // rule infoLinks reach the unit. Ghazghkull Thraka was missing his
  // entire Leader → "attached to Boyz / Meganobz / Nobz" entry.
  // Also drops chapter-locked army rules (Templar Vows) when the
  // current faction isn't the matching chapter — every non-Templar
  // chapter's Land Raider / Predator / Intercessor was inheriting
  // Templar Vows because the parent SM file hardcodes the infoLink
  // on every unit with no conditional hide modifier.
  // v29: parser now stores `catalogueId` on each faction and
  // `onlyCatalogues` / `notCatalogues` on chapter-exclusive detachments
  // (drives the detachment dropdown filter in selections.js).
  // v30: costs.js Pattern C now skips scope="force" constraints in
  // addition to scope="roster" — those are force-/army-wide caps
  // (rule-of-three style), not per-unit model counts. Imperial Knights
  // Armigers carry a `<constraint type="max" value="3" field="selections"
  // scope="force">` that previously made their composition show "3
  // models" instead of "1 model". Also tightens the abilities filter in
  // entry.js so the 10e core "Anti-" rule (literally named "Anti-" with
  // a trailing hyphen) is recognised as a weapon-keyword family when
  // any weapon keyword starts with "anti-" — Knight Castellan's
  // shieldbreaker missile launcher was leaking "Anti-" into the core
  // abilities row.
  // v31: composition parser now (a) sums inner <selectionEntries>
  // <selectionEntry type="model"> children of Pattern F upgrade-style
  // composition picks (Jakhals' "N mauler chainblades, M chainblades"
  // picks dropped the mauler count) and (b) honours a sibling
  // <modifier type="set"> targeting an automatic group constraint so
  // conditionally-bumped group max/min counts reach the model total
  // (Jakhals' Dishonoured group bumps from 1 to 2 on the large
  // compositions). Jakhals now correctly show 10 / 20 models instead
  // of 9 / 19.
  // v32: walkSelectionEntryGroup recurses into nested wargear sub-groups
  // so abilities granted by wargear (Big Mek in Mega Armour's Grot Oiler,
  // etc.) surface on the unit.
  // v33: parser coverage sweep — wargear sub-groups recurse for both
  // pickers and default weapons (every Votann character had empty wargear
  // panes), enhancement detachment-keying is diacritic-folded (Needgaârd
  // Oathband now shows its 4 enhancements), weapon "➤ X - foo" profile
  // glyph is stripped (Buri Aegnirssen's Bane reads "Bane - strike"),
  // shared profiles with a conditional hide-modifier no longer leak
  // onto unrelated units (Hekaton's Firebase Control), sharedInfoGroups
  // + infoLink type="infoGroup" are resolved, cost-tier scanning
  // descends into modifierGroups, primaryKeyword is captured.
  // v34: findStatProfiles aggregates ALL model statlines instead of
  // returning the first — multi-statline squads (Beast Snagga Boyz =
  // Boy + Nob, Kommandos = Boy + Nob + Bomb Squig, etc.) now carry
  // every distinct line in modelStats.
  // v35: composition model-count (costs.js) no longer mistakes a
  // wargear group's selection constraint for a model count — the Ork
  // Deff Dread's "pick 4 weapons" group made it report "4 models".
  // v36: detachment-gated rule infoLinks (BSData's shared "Detachment
  // Rules" infoGroup, linked by ~every unit) no longer leak onto units
  // as Core Abilities — the `rule` branch in abilities.js now honours the
  // conditional `set hidden=true` modifier, matching the profile branch.
  const DB_VERSION = 37; // 40kdc 11e cutover — drops stale 10e BSData faction cache
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
