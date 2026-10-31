// build.mjs — work/{gdc,mfm,dc}.json + aliases.json → data/dataset/candidate/<id>/
//
//   node build.mjs [--out <datasetDir>] [--id <forced id>]
//
// Contract: docs/DATASET.md. One JSON file per faction in the exact shape the
// renderers consume (the golden set), plus manifest.json and build-log.json.
// Field ownership (§3): GDC owns the datasheet, its text, stats, weapons,
// abilities, detachments, rules, enhancements and stratagems; MFM owns points,
// ordinal bands and wargear item costs; the pinned 40kdc snapshot owns the
// structured wargear options, allied rules, force-disposition text and
// game-mode filtering. No overlays, no hand text, no stat fixes.
//
// The last stdout line is the candidate id (the CLI greps for it).
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));
const WORK = process.env.WORK_DIR ? join(process.env.WORK_DIR, 'work') : SOURCES.work;
const DATASET = process.env.YAAB_DATASET_DIR || SOURCES.datasetDir;

// Flat per-squad wargear points (alwaysCost) may only come from these items.
// The validator enforces the same list (§6.3).
export const ALWAYS_COST_ALLOWLIST = {
  'adeptus-astartes/victrix-honour-guard': ['banner-of-macragge'],
};

// Display names: identity labels for the 34 faction ids (the strings the
// renderers, App.CHAPTER_PARENTS and saved armies key on). Not data.
export const FACTION_NAME = {
  'adepta-sororitas': 'Imperium - Adepta Sororitas',
  'adeptus-astartes': 'Imperium - Adeptus Astartes - Space Marines',
  'adeptus-custodes': 'Imperium - Adeptus Custodes',
  'adeptus-mechanicus': 'Imperium - Adeptus Mechanicus',
  'agents-of-the-imperium': 'Imperium - Agents of the Imperium',
  'astra-militarum': 'Imperium - Astra Militarum',
  'grey-knights': 'Imperium - Grey Knights',
  'imperial-knights': 'Imperium - Imperial Knights',
  'aeldari': 'Xenos - Aeldari',
  'drukhari': 'Xenos - Drukhari',
  'genestealer-cults': 'Xenos - Genestealer Cults',
  'leagues-of-votann': 'Xenos - Leagues of Votann',
  'necrons': 'Xenos - Necrons',
  'orks': 'Xenos - Orks',
  'tau-empire': "Xenos - T'au Empire",
  'tyranids': 'Xenos - Tyranids',
  'chaos-daemons': 'Chaos - Chaos Daemons',
  'chaos-knights': 'Chaos - Chaos Knights',
  'chaos-space-marines': 'Chaos - Chaos Space Marines',
  'death-guard': 'Chaos - Death Guard',
  'emperors-children': "Chaos - Emperor's Children",
  'thousand-sons': 'Chaos - Thousand Sons',
  'world-eaters': 'Chaos - World Eaters',
  'black-templars': 'Imperium - Adeptus Astartes - Black Templars',
  'blood-angels': 'Imperium - Adeptus Astartes - Blood Angels',
  'dark-angels': 'Imperium - Adeptus Astartes - Dark Angels',
  'deathwatch': 'Imperium - Adeptus Astartes - Deathwatch',
  'imperial-fists': 'Imperium - Adeptus Astartes - Imperial Fists',
  'iron-hands': 'Imperium - Adeptus Astartes - Iron Hands',
  'raven-guard': 'Imperium - Adeptus Astartes - Raven Guard',
  'salamanders': 'Imperium - Adeptus Astartes - Salamanders',
  'space-wolves': 'Imperium - Adeptus Astartes - Space Wolves',
  'ultramarines': 'Imperium - Adeptus Astartes - Ultramarines',
  'white-scars': 'Imperium - Adeptus Astartes - White Scars',
};
const SM_PARENT = 'adeptus-astartes';
const GENERIC_SM_TAG = 'Adeptus Astartes';
const chapterTag = (fid) => FACTION_NAME[fid].replace(/^Imperium - Adeptus Astartes - /, '');

// Printed Leader / Support core ability. Same wording as the detail pane's
// fallback so one rule never reads two ways; GDC prints the keyword only.
const ATTACH_ROLE_ABILITY = {
  leader: { name: 'Leader', description: 'This model is a Leader and can be attached to a Bodyguard unit.' },
  support: { name: 'Support', description: 'This model has Support and can be attached to a unit.' },
};
const CORE_ABILITY_RE = /^(Deadly Demise|Deep Strike|Feel No Pain|Fights First|Firing Deck|Infiltrators|Lone Operative|Scouts|Stealth|Hover|Super-heavy Walker|Titanic Walker)\b/i;

// ── text helpers (mirror js/gdc.js so text renders the same) ─────────────────
export const en = (v) => (v == null ? '' : typeof v === 'string' ? v : (typeof v === 'object' ? (v.en || '') : String(v)));
export function cleanMarkup(s) {
  return String(s == null ? '' : s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/<k>([\s\S]*?)<\/k>/gi, (_m, x) => x.toUpperCase())
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>\s*/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const C = (v) => cleanMarkup(en(v));
const plainText = (v) => cleanMarkup(en(v)).replace(/\*\*/g, '').replace(/[ \t]{2,}/g, ' ').trim();
function listLines(v) {
  const items = Array.isArray(v) ? v.map(plainText) : [plainText(v)];
  return items.flatMap((s) => s.split(/\n|(?:\s*■\s*)/)).map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'none');
}
function leaderTargets(v) {
  const s = en(v); if (!s) return [];
  const out = []; const re = /\*\*([^*]+?)\*\*/g; let m;
  while ((m = re.exec(s))) { const n = m[1].replace(/\s+/g, ' ').trim(); if (n) out.push(n); }
  if (!out.length && /■/.test(s)) s.split(/\s*■\s*/).slice(1).forEach((x) => { const t = x.replace(/\s+/g, ' ').trim(); if (t) out.push(t); });
  return out;
}
function composeRuleText(chunks) {
  if (!Array.isArray(chunks)) return '';
  return chunks.filter((c) => c && c.type !== 'image')
    .map((c) => ({ order: c.order || 0, title: en(c.title), text: C(c.text) }))
    .filter((c) => c.text && c.text !== '-')
    .sort((a, b) => a.order - b.order)
    .map((c) => (c.title ? c.title.trim() + ': ' : '') + c.text)
    .join('\n\n');
}
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const kebab = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const alnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Default join key (aliases.json _comment): lowercase, drop ' and curly
// apostrophes, U+2011 → '-', non-alnum runs → ' ', drop a leading article,
// remove spaces.
export function nk(s) {
  let t = String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/‑/g, '-')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/^(the|a|an) /, '');
  return t.replace(/ /g, '');
}

// ── v1 ability-text index (sources.json abilityIndex) — fallback only ────────
let AIDX = {};
// Approved dataset's units (fid → id → unit), read once per build.
const CUR_UNITS = new Map();
function loadAbilityIndex() {
  const p = SOURCES.abilityIndex && SOURCES.abilityIndex.path;
  if (!p || !existsSync(p)) return { loaded: false };
  const buf = readFileSync(p);
  const md5 = createHash('md5').update(buf).digest('hex');
  AIDX = JSON.parse(buf.toString('utf8'));
  return { loaded: true, md5, pinned: SOURCES.abilityIndex.md5 || null, ok: !SOURCES.abilityIndex.md5 || SOURCES.abilityIndex.md5 === md5 };
}
function indexText(name, factionIds) {
  const slugs = [kebab(name), kebab(String(name).replace(/\s*\([^)]*\)\s*$/, ''))];
  for (const sl of slugs) {
    for (const f of factionIds || []) { const e = f && AIDX[`${f}/${sl}`]; if (e && (e.raw_text || e.effect)) return e.raw_text || e.effect; }
    const e = AIDX[sl]; if (e && (e.raw_text || e.effect)) return e.raw_text || e.effect;
  }
  return '';
}

// ── core-rule glossary (sources.json coreRules) ─────────────────────────────
let CORE = {};
function loadCore() {
  const p = SOURCES.coreRules && SOURCES.coreRules.path;
  if (!p || !existsSync(p)) return { loaded: false };
  const buf = readFileSync(p);
  const md5 = createHash('md5').update(buf).digest('hex');
  CORE = JSON.parse(buf.toString('utf8')).rules || {};
  return { loaded: true, md5, pinned: SOURCES.coreRules.md5 || null, ok: !SOURCES.coreRules.md5 || SOURCES.coreRules.md5 === md5 };
}
function coreText(id) {
  if (!id) return '';
  if (CORE[id]) return CORE[id].text || '';
  const base = String(id).replace(/-\d+\+?$/, '').replace(/-d\d+(-\d+)?$/, '').replace(/-\d*d\d+.*$/, '');
  if (CORE[base]) return CORE[base].text || '';
  const parts = String(id).split('-');
  for (let n = parts.length - 1; n > 0; n--) { const p = parts.slice(0, n).join('-'); if (CORE[p]) return CORE[p].text || ''; }
  return '';
}
const prettyKw = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function gdcKwToken(raw) {
  const s = String(raw == null ? '' : raw).trim(); if (!s) return null;
  const colon = s.indexOf(':');
  const head = (colon === -1 ? s : s.slice(0, colon)).trim();
  const qual = colon === -1 ? '' : s.slice(colon + 1).trim();
  const m = /^(.*?)\s*(\d+\+?)?$/.exec(head);
  const words = ((m && m[1]) || head).trim();
  const rating = (m && m[2]) || '';
  const base = words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) return null;
  let label = prettyKw(base);
  if (rating) label += ' ' + rating;
  if (qual) label += ': ' + qual;
  return { id: base, label };
}
function kwText(id) {
  const t = coreText(id); if (t) return t;
  if (/^anti-/.test(id)) return coreText('anti');
  return '';
}
const num = (v) => (v == null ? '' : String(v));
function weaponRows(groups, melee) {
  const rows = [];
  (groups || []).forEach((g) => (g && g.profiles || []).forEach((p) => {
    const isMelee = melee || String(p.range || '').trim().toLowerCase() === 'melee';
    const skill = num(p.skill) === '-' ? '' : num(p.skill);
    const row = { name: en(p.name), _typeName: isMelee ? 'Melee' : 'Ranged',
      Range: isMelee ? 'Melee' : (p.range ? String(p.range) : '—'),
      A: num(p.attacks), S: num(p.strength), AP: num(p.ap), D: num(p.damage) };
    if (isMelee) row.WS = skill; else row.BS = skill;
    const toks = (p.keywords || []).map(gdcKwToken).filter(Boolean);
    if (toks.length) {
      row.Keywords = toks.map((t) => t.label).join(', ');
      const defs = {};
      toks.forEach((t) => {
        const txt = kwText(t.id); if (!txt) return;
        defs[t.label] = txt;
        const stripped = t.label.replace(/\s+\d+\+?$/, '');
        if (stripped !== t.label) defs[stripped] = txt;
        const base = prettyKw(t.id);
        if (!defs[base]) defs[base] = txt;
      });
      if (Object.keys(defs).length) row._keywordDefs = defs;
    }
    rows.push(row);
  }));
  return rows;
}
function normalizeWeapons(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((w) => w && Array.isArray(w.profiles))
    .map((w) => ({ active: w.active !== false, name: en(w.name),
      profiles: w.profiles.map((p) => ({ ...p, name: en(p && p.name) })) }))
    .filter((w) => w.profiles.length);
}
const normOC = (v) => { const s = v == null ? '' : String(v).trim(); return (s && !isNaN(parseInt(s, 10)) && parseInt(s, 10) < 0) ? '-' : s; };

// ── points (same semantics as the v1 parsePoints) ────────────────────────────
export function parsePoints(rawPts) {
  const bySize = new Map(); let fromCount = null;
  for (const p of rawPts || []) {
    if (p.cost == null) continue;
    const isBase = p.unit_count_min == null || p.unit_count_min === 1;
    const cur = bySize.get(p.models) || { base: null, surcharged: null };
    if (isBase) cur.base = cur.base == null ? p.cost : Math.min(cur.base, p.cost);
    else cur.surcharged = cur.surcharged == null ? p.cost : Math.min(cur.surcharged, p.cost);
    bySize.set(p.models, cur);
    if (p.unit_count_min != null && p.unit_count_min > 1 && fromCount == null) fromCount = p.unit_count_min;
  }
  const squadOptions = [...bySize.entries()]
    .map(([models, c]) => ({ models: models || null, pts: c.base != null ? c.base : c.surcharged }))
    .filter((o) => o.pts != null).sort((a, b) => a.pts - b.pts);
  let ordinal = null;
  if (fromCount != null) {
    let surcharge = 0;
    for (const c of bySize.values()) if (c.base != null && c.surcharged != null) { surcharge = c.surcharged - c.base; break; }
    if (surcharge > 0) ordinal = { fromCount, surcharge };
  }
  const pointsOptions = [...new Set(squadOptions.map((o) => o.pts))].sort((a, b) => a - b);
  return { squadOptions, pointsOptions, ordinal };
}

// ── inputs ───────────────────────────────────────────────────────────────────
function readJson(p, what) {
  if (!existsSync(p)) throw new Error(`${what} missing: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function build() {
  const gdc = readJson(join(WORK, 'gdc.json'), 'work/gdc.json (run extract/gdc.mjs)');
  const mfm = readJson(join(WORK, 'mfm.json'), 'work/mfm.json (run extract/mfm.py)');
  const dc = readJson(join(WORK, 'dc.json'), 'work/dc.json (run extract/dc.mjs)');
  const aliases = readJson(join(HERE, 'aliases.json'), 'pipeline/aliases.json');
  const core = loadCore();
  const abilityIndex = loadAbilityIndex();
  const log = { unpricedUnits: [], provisionalUnits: [], noDcJoin: [], mfmRowsUsed: {}, mfmItemsUnmatched: [],
    aliasesUnresolved: [], mfmUnitKey: {}, idsFromCurrent: [], factionAbilityUnresolved: [], legendsFrom40kdc: [], dupDatasheets: [], unbilledItems: [], coreRules: core, abilityIndex, droppedWargearOptions: [], keptWargearOptionsKnownGap: [], factionAbilityEmpty: [], warnings: [] };
  const aliasUnits = aliases.units || {};
  const aliasItems = aliases.items || {};
  const usedAlias = new Set();

  // MFM index: page → nk(name) → {key, row}
  const mfmByPage = new Map();
  for (const [key, row] of Object.entries(mfm.units || {})) {
    const i = key.indexOf('|'); const page = key.slice(0, i); const name = key.slice(i + 1);
    if (!mfmByPage.has(page)) mfmByPage.set(page, new Map());
    mfmByPage.get(page).set(nk(name), { key, name, row });
  }
  // 40kdc index: dc faction → nk(name) → unit
  const dcF = dc.factions || {};
  const dcByName = new Map();
  for (const [fid, f] of Object.entries(dcF)) {
    const m = new Map();
    for (const u of Object.values(f.units || {})) if (!m.has(nk(u.name))) m.set(nk(u.name), u);
    dcByName.set(fid, m);
  }
  const fdByName = new Map();
  (dc.forceDispositions || []).forEach((d) => fdByName.set(String(d.name || '').toLowerCase(), d));

  // ── factions skeleton ──────────────────────────────────────────────────────
  const factions = new Map();
  for (const fid of Object.keys(FACTION_NAME)) {
    factions.set(fid, { factionName: FACTION_NAME[fid], _factionId: fid, filename: FACTION_NAME[fid],
      unitCount: 0, units: [], armyRules: [], detachments: [], linkedCatalogues: [], _source: 'gdc+mfm' });
  }
  const fileAlias = aliases.factions || {};
  const filesByFaction = new Map();   // detachment/rule-owning faction → [file]
  for (const [file, a] of Object.entries(fileAlias)) {
    if (!gdc.factions[file]) { log.aliasesUnresolved.push(`factions/${file}: no GDC file`); continue; }
    if (!factions.has(a.factionId)) { log.aliasesUnresolved.push(`factions/${file}: unknown factionId ${a.factionId}`); continue; }
  }

  // Id stability: a unit with no 40kdc join keeps the id the approved
  // dataset (current/) gave it, so saved armies / reserves / favourites that
  // key on it keep resolving; only a brand-new sheet gets the GDC slug.
  const curIds = new Map();
  const curDir = join(DATASET, 'current');
  if (existsSync(join(curDir, 'manifest.json'))) {
    for (const f of readdirSync(curDir)) {
      if (!f.endsWith('.json') || f === 'manifest.json' || f.startsWith('_')) continue;
      try {
        const j = JSON.parse(readFileSync(join(curDir, f), 'utf8'));
        if (!j || !j._factionId || !Array.isArray(j.units)) continue;
        const m = new Map(); j.units.forEach((u) => { if (!u._allyOf && !m.has(nk(u.name))) m.set(nk(u.name), u.id); });
        curIds.set(j._factionId, m);
        CUR_UNITS.set(j._factionId, new Map(j.units.filter((u) => !u._allyOf).map((u) => [u.id, u])));
      } catch (_) { /* unreadable current file: fall back to slugs */ }
    }
  }
  // Faction abilities GDC prints by NAME only on a datasheet: their text is
  // in the same file's rules.army / rules.detachment, keyed by name.
  const ruleTextFor = (files) => {
    const m = new Map();
    for (const f of files) {
      const R = (gdc.factions[f] || {}).rules || {};
      (R.army || []).forEach((r) => { const k = nk(en(r.name)); if (k && !m.has(k)) m.set(k, composeRuleText(r.rules)); });
      (R.detachment || []).forEach((e) => (e.rules || []).forEach((sr) => { const k = nk(en(sr && sr.name)); if (k && !m.has(k)) m.set(k, composeRuleText(sr && sr.rules)); }));
    }
    return m;
  };
  const smFile0 = Object.keys(fileAlias).find((f) => fileAlias[f].factionId === SM_PARENT);
  const smFamily = [smFile0, ...Object.keys(fileAlias).filter((f) => fileAlias[f].unitsInto === SM_PARENT)].filter((f) => f && gdc.factions[f]);

  // ── units ─────────────────────────────────────────────────────────────────
  const unitSlugByFaction = new Map(); // fid → Map(slug → unit)
  // Process the parent SM file first so a chapter file's duplicate of a shared
  // sheet does not shadow the parent's copy.
  const fileOrder = Object.keys(fileAlias).filter((f) => gdc.factions[f])
    .sort((a, b) => (fileAlias[a].unitsInto ? 1 : 0) - (fileAlias[b].unitsInto ? 1 : 0));
  const pending = []; // [unit, ds, fid] for the leader pass
  for (const file of fileOrder) {
    const a = fileAlias[file]; const g = gdc.factions[file];
    const fid = a.unitsInto || a.factionId;
    const fac = factions.get(fid); if (!fac) continue;
    if (!unitSlugByFaction.has(fid)) unitSlugByFaction.set(fid, new Map());
    const have = unitSlugByFaction.get(fid);
    const pages = [a.mfm, ...(a.mfmAlso || [])].filter(Boolean);
    const dcDirs = [a.dc, ...(a.dcAlso || [])].filter(Boolean);
    for (const ds of g.datasheets) {
      const name = en(ds.name); const slug = ds._slug || kebab(name);
      if (!name) continue;
      if (have.has(slug)) { log.dupDatasheets.push(`${fid}/${slug} (${file})`); continue; }
      const al = aliasUnits[`${fid}/${slug}`] || {};
      if (aliasUnits[`${fid}/${slug}`]) usedAlias.add(`${fid}/${slug}`);
      // 40kdc join
      let dcu = null, dcFid = null;
      if (al.dc) {
        const dirs = al.dcFaction ? [al.dcFaction] : dcDirs;
        for (const d of dirs) { const u = dcF[d] && dcF[d].units && dcF[d].units[al.dc]; if (u) { dcu = u; dcFid = d; break; } }
        if (!dcu) log.aliasesUnresolved.push(`units/${fid}/${slug}: dc ${al.dc} not found`);
      }
      if (!dcu) for (const d of dcDirs) { const u = dcByName.get(d) && dcByName.get(d).get(nk(name)); if (u) { dcu = u; dcFid = d; break; } }
      // MFM join
      let mrow = null;
      if (al.mfm) {
        for (const p of pages) { const r = mfmByPage.get(p) && mfmByPage.get(p).get(nk(al.mfm)); if (r) { mrow = r; break; } }
        if (!mrow) log.aliasesUnresolved.push(`units/${fid}/${slug}: mfm ${al.mfm} not found`);
      }
      if (!mrow) for (const p of pages) { const r = mfmByPage.get(p) && mfmByPage.get(p).get(nk(name)); if (r) { mrow = r; break; } }
      if (mrow) log.mfmRowsUsed[mrow.key] = `${fid}/${slug}`;
      const curId = (curIds.get(fid) || new Map()).get(nk(name)) || null;
      // the HOME faction's army rules (adeptus-astartes: space_marines.json's)
      const homeFile = Object.keys(fileAlias).find((f) => fileAlias[f].factionId === fid && !fileAlias[f].unitsInto) || file;
      const armyRuleNames = new Set(((gdc.factions[homeFile].rules || {}).army || []).map((r) => nk(en(r.name))));
      const unit = buildUnit(ds, { fid, file, slug, dcu, dcFid, mrow, aliasItems, log, curId,
        ruleText: ruleTextFor(fid === SM_PARENT ? smFamily : [file]), armyRuleNames });
      have.set(slug, unit);
      if (mrow) log.mfmUnitKey[`${fid}/${unit.id}`] = mrow.key;
      fac.units.push(unit);
      pending.push([unit, ds, fid]);
      if (!dcu) log.noDcJoin.push(`${fid}/${slug}`);
    }
  }
  // ── 40kdc-only sheets (owner: "fill anything missing from 40kdc") ─────────
  // A 40kdc unit in a faction's own 40kdc dir that no GDC datasheet joined is
  // a sheet GW's app no longer carries (Tactical Squad, Custodian Guard, …).
  // Keep it as Legends from the pinned snapshot so no saved army loses it.
  const ck = SOURCES.dc.checkout;
  const ckSha = existsSync(join(ck, '.sha')) ? readFileSync(join(ck, '.sha'), 'utf8').trim() : null;
  if (ckSha && SOURCES.dc.sha && ckSha !== SOURCES.dc.sha) log.warnings.push(`40kdc checkout sha ${ckSha} != pinned ${SOURCES.dc.sha}`);
  const ckRead = (dir, f) => { const p = join(ck, 'data', 'core', dir, f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []; };
  const weaponIdx = new Map(); // dir → Map(id → weapon)
  const weaponsIn = (dir) => { if (!weaponIdx.has(dir)) weaponIdx.set(dir, new Map(ckRead(dir, 'weapons.json').map((w) => [w.id, w]))); return weaponIdx.get(dir); };
  const allDirs = Object.keys(dcF);
  for (const [file, a] of Object.entries(fileAlias)) {
    if (a.unitsInto || !a.dc || !dcF[a.dc] || !gdc.factions[file]) continue;
    const fid = a.factionId; const fac = factions.get(fid); if (!fac) continue;
    const joinedIds = new Set(fac.units.map((u) => u.id));
    const joinedNames = new Set(fac.units.map((u) => nk(u.name)));
    const raw = new Map(ckRead(a.dc, 'units.json').map((u) => [u.id, u]));
    // every GDC file that feeds this faction, for ability-text lookup by name
    const feeding = Object.keys(fileAlias).filter((f) => (fileAlias[f].unitsInto || fileAlias[f].factionId) === fid && gdc.factions[f]);
    const gdcAbText = new Map();
    for (const f of feeding) for (const ds of gdc.factions[f].datasheets) {
      const ab = ds.abilities || {};
      [...(ab.other || []), ...(ab.special || []), ...(ab.wargear || [])].forEach((x) => { const k = nk(en(x && x.name)); const t = C(x && x.description); if (k && t && !gdcAbText.has(k)) gdcAbText.set(k, t); });
    }
    const rt = ruleTextFor(feeding.concat(fid === SM_PARENT ? [] : []));
    for (const dcu of Object.values(dcF[a.dc].units || {})) {
      if (joinedIds.has(dcu.id) || joinedNames.has(nk(dcu.name))) continue;
      if (Array.isArray(dcu.game_modes) && dcu.game_modes.includes('combat-patrol')) continue;
      const r = raw.get(dcu.id); if (!r) { log.warnings.push(`${fid}/${dcu.id}: in dc.json but not in the checkout`); continue; }
      const pages = [a.mfm, ...(a.mfmAlso || [])].filter(Boolean);
      const mrow = pages.map((p) => mfmByPage.get(p) && mfmByPage.get(p).get(nk(dcu.name))).find(Boolean) || null;
      if (mrow) log.mfmRowsUsed[mrow.key] = `${fid}/${dcu.id}`;
      const unit = buildDcUnit(r, dcu, { fid, dir: a.dc, mrow, log, aliasItems, weapons: (id) => weaponsIn(a.dc).get(id) || allDirs.map((d) => weaponsIn(d).get(id)).find(Boolean) || null,
        abText: (name) => gdcAbText.get(nk(name)) || rt.get(nk(name)) || '',
        leadBy: [...new Set((dcF[a.dc].leaderAttachments || []).filter((l) => l.leader_id === dcu.id)
          .flatMap((l) => l.eligible_bodyguard_ids || [])
          .map((bid) => { const u = fac.units.find((x) => x.id === bid); return u ? u.name : (dcF[a.dc].units[bid] || {}).name; }).filter(Boolean))] });
      if (mrow) log.mfmUnitKey[`${fid}/${unit.id}`] = mrow.key;
      fac.units.push(unit); joinedIds.add(unit.id);
      log.legendsFrom40kdc.push(`${fid}/${dcu.id}`);
    }
  }

  // unit ids must be unique per faction
  for (const fac of factions.values()) {
    const seen = new Map();
    for (const u of fac.units) {
      if (seen.has(u.id)) { log.warnings.push(`${fac._factionId}: duplicate unit id ${u.id} (${seen.get(u.id)} / ${u.name}) — second one re-keyed`); u.id = alnum(u.name); }
      seen.set(u.id, u.name);
    }
  }
  // Leader graph: GW's attachesTo, in OUR unit names where one matches.
  for (const [unit, ds, fid] of pending) {
    const local = new Map(factions.get(fid).units.map((u) => [nk(u.name), u.name]));
    const seen = new Set();
    const att = (ds.attachesTo || []).filter((x) => x && (!x.type || /^(leader|support)$/i.test(String(x.type))));
    // Keyword targets ("any IMPERIUM BATTLELINE INFANTRY unit") are one
    // conjunction, which GW's leader prose prints as a single bold phrase.
    const kwT = att.filter((x) => x.targetType === 'keyword').map((x) => en(x.target).toUpperCase());
    const kwPhrase = kwT.length ? (leaderTargets(ds.leader).find((p) => kwT.every((k) => p.toUpperCase().split(/\s+/).includes(k)))
      || kwT.join(' ')) : null;
    let lb = att.filter((x) => x.targetType !== 'keyword').map((x) => en(x.target)).concat(kwPhrase ? [kwPhrase] : []).filter(Boolean)
      .filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!lb.length && ds.leader) lb = leaderTargets(ds.leader);
    unit.gdcLeadBy = lb.map((n) => local.get(nk(n)) || n);
  }

  // ── detachments + army rules ───────────────────────────────────────────────
  const smFile = Object.keys(fileAlias).find((f) => fileAlias[f].factionId === SM_PARENT);
  const ownFile = new Map(); // fid → own GDC file (for detachments/rules)
  for (const [file, a] of Object.entries(fileAlias)) if (gdc.factions[file]) ownFile.set(a.factionId, file);
  for (const [fid, fac] of factions) {
    const isChapter = fid !== SM_PARENT && FACTION_NAME[fid].startsWith('Imperium - Adeptus Astartes - ');
    const own = ownFile.get(fid) || null;
    const files = isChapter ? [own, smFile].filter(Boolean) : [own].filter(Boolean);
    if (!files.length) { log.warnings.push(`${fid}: no GDC file`); continue; }
    const dcFid = (own && fileAlias[own].dc && !fileAlias[own].unitsInto) ? fileAlias[own].dc : (dcF[fid] ? fid : null);
    const dcFac = (dcFid && dcF[dcFid]) || null;
    // army rules: the faction's own file (chapters without one use the parent's)
    const ruleFile = own || smFile;
    fac.armyRules = (gdc.factions[ruleFile].rules.army || []).map((r) => ({ name: en(r.name), description: composeRuleText(r.rules), source: 'gdc' }))
      .filter((r) => r.name);
    // eligible detachments
    const want = []; const seenDet = new Set();
    for (const file of files) {
      for (const gd of gdc.factions[file].detachments || []) {
        const name = en(gd.name); if (!name) continue;
        const tag = String(gd.faction || '').trim() || GENERIC_SM_TAG;
        const ok = !isChapter || file === own || tag === GENERIC_SM_TAG || tag === chapterTag(fid);
        if (!ok || seenDet.has(nk(name))) continue;
        seenDet.add(nk(name)); want.push({ gd, name, tag, file });
      }
    }
    const tagged = new Set(want.map((w) => w.tag)).size > 1 || fid === SM_PARENT || isChapter;
    const dcDetByName = new Map(Object.entries((dcFac && dcFac.detachments) || {}).map(([id, d]) => [nk(d.name), { id, ...d }]));
    const dcStrats = (dcFac && dcFac.stratagems) || {};
    const dcEnh = (dcFac && dcFac.enhancements) || {};
    for (const { gd, name, tag } of want) {
      const dd = dcDetByName.get(nk(name)) || null;
      if (dd && Array.isArray(dd.game_modes) && dd.game_modes.includes('combat-patrol')) continue;
      const detK = nk(name);
      const rules = []; const strats = []; const enh = [];
      const seenS = new Set(); const seenE = new Set();
      for (const file of files) {
        const G = gdc.factions[file];
        for (const entry of G.rules.detachment || []) {
          if (nk(en(entry.detachment)) !== detK || rules.length) continue;
          (entry.rules || []).forEach((sr) => {
            const description = composeRuleText(sr && sr.rules);
            if (description) rules.push({ name: en(sr && sr.name) || name, description, source: 'gdc' });
          });
        }
        for (const s of G.stratagems || []) {
          if (nk(en(s.detachment)) !== detK) continue;
          const p = projectStratagem(s); if (!p || seenS.has(nk(p.name))) continue;
          seenS.add(nk(p.name));
          let sid = null;
          if (dd) sid = (dd.stratagem_ids || []).find((id) => dcStrats[id] && nk(dcStrats[id].name) === nk(p.name)) || null;
          if (sid) p.timing = dcStrats[sid].timing || p.timing;
          strats.push({ p, sid: sid || 'gdc:' + kebab(p.name) });
        }
        for (const e of G.enhancements || []) {
          if (nk(en(e.detachment)) !== detK) continue;
          const ename = en(e.name); if (!ename || seenE.has(nk(ename))) continue;
          seenE.add(nk(ename));
          const kws = (Array.isArray(e.keywords) ? e.keywords : []).map(en).filter(Boolean);
          let eid = null;
          if (dd) eid = (dd.enhancement_ids || []).find((id) => dcEnh[id] && nk(dcEnh[id].name) === nk(ename.replace(/\s*\(upgrade\)\s*$/i, ''))) || null;
          enh.push({ name: ename, pts: typeof e.cost === 'number' ? e.cost : (parseInt(e.cost, 10) || 0),
            description: C(e.description), keywords: kws.length ? kws : null, id: eid || 'gdc:' + kebab(ename) });
        }
      }
      const fds = Array.isArray(gd.forceDispositions) ? gd.forceDispositions : (gd.forceDisposition ? [gd.forceDisposition] : []);
      const dispositions = []; const seenD = new Set();
      fds.forEach((fd) => {
        const n = en(fd && fd.name); if (!n || seenD.has(n.toLowerCase())) return;
        seenD.add(n.toLowerCase());
        const hit = fdByName.get(n.toLowerCase());
        dispositions.push(hit ? { id: hit.id, name: hit.name, text: hit.text || '' } : { id: null, name: n, text: '' });
      });
      const det = { name, rules, enhancements: enh, _factionId: fid,
        id: dd ? dd.id : 'gdc:' + String(gd.id || kebab(name)),
        points: gd.detachmentPoints != null ? gd.detachmentPoints : (dd && dd.detachment_points != null ? dd.detachment_points : null),
        dispositions, stratagemIds: strats.map((s) => s.sid), gdcStratagems: strats.map((s) => s.p) };
      if (tagged) det._gdcFactionTag = tag;
      fac.detachments.push(det);
    }
    if (dcFac) {
      const retired = Object.values(dcFac.detachments || {})
        .filter((d) => !(Array.isArray(d.game_modes) && d.game_modes.includes('combat-patrol')))
        .filter((d) => !seenDet.has(nk(d.name))).map((d) => d.name);
      if (retired.length) fac._retiredDetachments = retired;
    }
  }

  // ── allied units (40kdc allied rules + pools; rows are clones of OUR units)
  const byFid = factions;
  const hostPages = (fid) => Object.values(fileAlias).filter((a) => a.factionId === fid && !a.unitsInto).flatMap((a) => [a.mfm].filter(Boolean));
  for (const [fid, fac] of factions) {
    const dcFac = dcF[fid]; if (!dcFac || !(dcFac.alliedRules || []).length) continue;
    const ownIds = new Set(fac.units.map((u) => u.id));
    const detNameById = new Map(fac.detachments.map((d) => [d.id, d.name]));
    const picked = new Map(); const rulesUsed = [];
    for (const rule of dcFac.alliedRules) {
      const detNames = (rule.detachment_ids || []).map((id) => detNameById.get(id)).filter(Boolean);
      let added = 0;
      for (const pu of rule.pool || []) {
        if (!pu || !pu.id || ownIds.has(pu.id)) continue;
        const srcDc = dcF[pu.faction_id] && dcF[pu.faction_id].units && dcF[pu.faction_id].units[pu.id];
        if (srcDc && Array.isArray(srcDc.game_modes) && srcDc.game_modes.includes('combat-patrol')) continue;
        const seen = picked.get(pu.id);
        if (seen) { seen.ruleIds.add(rule.id); continue; }
        const srcFac = byFid.get(pu.faction_id);
        const src = srcFac && srcFac.units.find((u) => u.id === pu.id);
        if (!src) { log.warnings.push(`${fid}: ally ${pu.faction_id}/${pu.id} (${rule.id}) has no built unit`); continue; }
        picked.set(pu.id, { src, srcFid: pu.faction_id, rule, ruleIds: new Set([rule.id]), detNames });
        added++;
      }
      if (added) rulesUsed.push({ id: rule.id, name: rule.name || rule.id, label: rule.label || rule.name || 'Allies',
        sourceFactionName: FACTION_NAME[rule.source_faction_id] || null,
        detachmentNames: detNames.length ? detNames : null, pointsLimits: rule.points_limits || null,
        keywordLimits: rule.keyword_limits || null, cannotBeWarlord: !!rule.cannot_be_warlord,
        cannotTakeEnhancements: !!rule.cannot_take_enhancements,
        battlelineRatioKeywords: rule.battleline_ratio_keywords || null, notes: rule.notes || '' });
    }
    if (!picked.size) continue;
    const ruleById = new Map(dcFac.alliedRules.map((r) => [r.id, r]));
    for (const { src, srcFid, rule, ruleIds, detNames } of picked.values()) {
      const clone = JSON.parse(JSON.stringify(src));
      clone._allyOf = fac.factionName;
      clone._allySourceFaction = FACTION_NAME[srcFid] || null;
      clone._allyLabel = rule.label || rule.name || 'Allies';
      clone._allyRuleIds = [...ruleIds];
      clone._allyNoEnhancements = [...ruleIds].every((rid) => !!(ruleById.get(rid) || {}).cannot_take_enhancements);
      clone._allyDetachments = detNames.length ? detNames.slice() : null;
      // MFM prices some allies on the HOST's page (World Eaters' Bloodletters
      // cost 90 there, 110 in Chaos Daemons). The host page wins when it has a row.
      const hostRow = hostPages(fid).map((p) => mfmByPage.get(p) && mfmByPage.get(p).get(nk(clone.name))).find(Boolean);
      if (hostRow && hostRow.row.points && hostRow.row.points.length) {
        const pp = parsePoints(hostRow.row.points);
        Object.assign(clone, { points: pp.pointsOptions.length ? pp.pointsOptions[0] : 0, pointsOptions: pp.pointsOptions,
          squadOptions: pp.squadOptions, ordinal: pp.ordinal, _mfmPoints: true, _provisional: false, _unpriced: false });
        if (clone.isLegends && !pp.squadOptions.length) clone.isLegends = true; else if (pp.squadOptions.length) clone.isLegends = false;
        log.mfmRowsUsed[hostRow.key] = `${fid}/ally:${clone.id}`;
        log.mfmUnitKey[`${fid}/${clone.id}/ally`] = hostRow.key;
      }
      fac.units.push(clone);
    }
    fac.alliedRules = rulesUsed;
    fac.allyUnitCount = picked.size;
  }
  for (const fac of factions.values()) fac.unitCount = fac.units.length;

  for (const k of Object.keys(aliasUnits)) if (!usedAlias.has(k)) log.aliasesUnresolved.push(`units/${k}: no GDC datasheet with that key`);
  // MFM rows nothing joined
  log.unpricedMfmRows = Object.keys(mfm.units || {}).filter((k) => !log.mfmRowsUsed[k]);
  // Classify: a row on a chapter page whose name is an SM unit already priced
  // from another page is a duplicate (chapter pages repeat the codex roster).
  const smNames = new Set((factions.get(SM_PARENT) || { units: [] }).units.filter((u) => u._mfmPoints).map((u) => nk(u.name)));
  const chapterPages = new Set(Object.values(fileAlias).filter((a) => a.unitsInto === SM_PARENT || a.factionId === SM_PARENT)
    .flatMap((a) => [a.mfm, ...(a.mfmAlso || [])]).filter(Boolean));
  const byPage = {}; let dup = 0, real = 0;
  for (const k of log.unpricedMfmRows) {
    const i = k.indexOf('|'); const page = k.slice(0, i); const name = k.slice(i + 1);
    const kind = chapterPages.has(page) && smNames.has(nk(name)) ? 'chapter-page-duplicate' : 'unjoined';
    kind === 'unjoined' ? real++ : dup++;
    ((byPage[page] ??= { 'chapter-page-duplicate': [], unjoined: [] })[kind]).push({ name, legends: !!(mfm.units[k] || {}).legends });
  }
  log.unpricedMfmSummary = { total: log.unpricedMfmRows.length, chapterPageDuplicates: dup, unjoined: real };
  try { writeFileSync(join(WORK, 'mfm-unjoined.json'), JSON.stringify({ builtFrom: mfm.fetched || null, summary: log.unpricedMfmSummary, pages: byPage }, null, 1)); } catch (e) { log.warnings.push('could not write mfm-unjoined.json: ' + e.message); }
  return { factions: [...factions.values()], log, gdc, mfm, dc };
}

function projectStratagem(s) {
  const name = en(s && s.name); if (!name) return null;
  const phases = Array.isArray(s.phase) ? s.phase.filter(Boolean).map(cap) : [];
  const phase = phases.length >= 5 ? 'Any' : (phases[0] || '');
  const cp = typeof s.cost === 'number' ? s.cost : (parseInt(s.cost, 10) || 0);
  const when = C(s.when), target = C(s.target), effect = C(s.effect), restr = C(s.restrictions);
  const secondary = C(s.secondary_effect).replace(/^or\s*:\s*/i, '').trim();
  const secCost = typeof s.secondary_effect_cost === 'number' ? s.secondary_effect_cost : (parseInt(s.secondary_effect_cost, 10) || 0);
  const parts = [];
  if (when) parts.push('WHEN: ' + when);
  if (target) parts.push('TARGET: ' + target);
  if (effect) parts.push('EFFECT: ' + effect);
  if (restr) parts.push('RESTRICTIONS: ' + restr);
  let description = parts.join('\n\n') || C(s.fluff);
  if (secondary) description += (description ? '\n\n' : '') + (secCost ? '+' + secCost + ' CP — Or: ' : 'Or: ') + secondary;
  return { name, cp, phase, phases, turn: en(s.turn) || '', timing: '', type: en(s.type) || '', description, source: 'gdc' };
}

// ── one GDC datasheet → one unit ─────────────────────────────────────────────
function buildUnit(ds, ctx) {
  const { fid, slug, dcu, mrow, aliasItems, log, curId, ruleText, armyRuleNames } = ctx;
  const name = en(ds.name);
  const ab = ds.abilities || {};
  const kwSeen = new Set();
  const keywords = (ds.keywords || []).map(en).filter(Boolean).concat((ds.factions || []).map(en).filter(Boolean))
    .filter((k) => { const l = k.toLowerCase(); if (kwSeen.has(l)) return false; kwSeen.add(l); return true; });
  const lk = keywords.map((k) => k.toLowerCase());
  const modelStats = (ds.stats || []).map((s) => ({ name: en(s.name), M: num(s.m), T: num(s.t), SV: num(s.sv),
    W: num(s.w), LD: num(s.ld), OC: normOC(s.oc) }));
  if (!modelStats.length) modelStats.push({ name, M: '', T: '', SV: '', W: '', LD: '', OC: '' });
  const { name: _n, ...stats } = modelStats[0];

  // abilities
  const abilities = []; const seen = new Set();
  const push = (a) => { const k = String(a.name || '').toLowerCase(); if (!a.name || seen.has(k)) return; seen.add(k); abilities.push(a); };
  const coreNames = (ab.core || []).map((a) => en(a && a.name != null ? a.name : a)).filter(Boolean);
  const isLeader = coreNames.some((n) => /^leader$/i.test(n));
  const isSupport = (ab.special || []).some((a) => /^support$/i.test(en(a && a.name)));
  coreNames.forEach((n) => {
    if (/^(leader|support)$/i.test(n)) return;
    const aid = kebab(n);
    let d = coreText(aid);
    const dm = /^damaged-(\d+)$/.exec(aid);
    if (dm) d = d.replace('1-N', '1-' + dm[1]);
    push({ name: n, description: d, isCore: true, id: aid });
  });
  (ab.other || []).forEach((a) => { const n = en(a && a.name); if (n) push({ name: n, description: C(a.description), isCore: false, id: kebab(n) }); });
  (ab.special || []).forEach((a) => {
    const n = en(a && a.name);
    if (!n || /^transport$/i.test(n) || /^support$/i.test(n)) return;
    push({ name: n, description: C(a.description), isCore: CORE_ABILITY_RE.test(n), id: kebab(n) });
  });
  (Array.isArray(ab.primarch) ? ab.primarch : []).forEach((grp) => {
    const gname = en(grp && grp.name);
    (grp && grp.abilities || []).forEach((a) => { const n = en(a && a.name); if (n) push({ name: n, description: C(a.description), isCore: false, id: kebab(n), _typeName: gname }); });
  });
  if (ab.damaged) {
    const rawRange = en(ab.damaged.range);
    let span = (/(\d+\s*[-–]\s*\d+)/.exec(rawRange) || [])[1] || '';
    let desc = C(ab.damaged.description);
    const di = abilities.findIndex((a) => /^damaged\b/i.test(a.name || ''));
    if (di !== -1) {
      if (!span) { const n = (/(\d+)\s*$/.exec(abilities[di].name) || [])[1]; if (n) span = '1-' + n; }
      if (!desc) desc = abilities[di].description || '';
      seen.delete(String(abilities[di].name).toLowerCase()); abilities.splice(di, 1);
    }
    if (span && desc) desc = desc.replace(/\b\d+\s*[-–]\s*\d+(?=\s+wounds?\s+remaining\b)/gi, span);
    const dn = span ? 'Damaged: ' + span + ' wounds remaining' : (rawRange ? 'Damaged: ' + rawRange.toLowerCase() : 'Damaged');
    if (desc) push({ name: dn, description: desc, isCore: false, _typeName: 'damaged' });
  }
  // Faction abilities (name only on the sheet) → text from the file's rules.
  // Skipped when the name IS one of the faction's army rules: that text is on
  // the Army Rules panel already, and a copy on every card is noise.
  // Owner ruling: never drop an ability GDC prints. Text order: GDC rules
  // (army or detachment, by name) → pinned v1 index → empty.
  (ab.faction || []).forEach((a) => {
    const n = en(a && a.name != null ? a.name : a); if (!n) return;
    const k = nk(n);
    let t = ruleText ? ruleText.get(k) || ruleText.get(nk(n.replace(/\s*\([^)]*\)\s*$/, ''))) : '';
    if (!t) { t = indexText(n, [ctx.dcFid, fid]); if (t) log.factionAbilityUnresolved.push(`${fid}/${slug}: ${n} (v1 index)`); }
    if (!t) log.factionAbilityEmpty.push(`${fid}/${slug}: ${n}`);
    push({ name: n, description: t || '', isCore: false, id: kebab(n) });
  });
  const role = isLeader ? 'leader' : (isSupport ? 'support' : null);
  if (role) push({ name: ATTACH_ROLE_ABILITY[role].name, description: ATTACH_ROLE_ABILITY[role].description, isCore: true, id: role });

  const wargearAbilities = []; const wgSeen = new Set();
  (ab.wargear || []).forEach((a) => { const n = en(a && a.name); if (!n || wgSeen.has(n.toLowerCase())) return; wgSeen.add(n.toLowerCase()); wargearAbilities.push({ name: n, description: C(a.description) }); });

  // points: MFM, else GDC (provisional)
  let pts; let provisional = false;
  if (mrow && mrow.row.points && mrow.row.points.length) pts = mrow.row.points;
  else {
    pts = (ds.points || []).filter((p) => !p.keyword && !p.detachment)
      .map((p) => ({ cost: parseInt(p.cost, 10), models: parseInt(p.models, 10) }))
      .filter((p) => !isNaN(p.cost) && !isNaN(p.models));
    provisional = pts.length > 0;
    // last resort before unpriced: the pinned 40kdc snapshot's points
    if (!pts.length && dcu && Array.isArray(dcu.points) && dcu.points.length) { pts = dcu.points; provisional = true; }
  }
  const { squadOptions, pointsOptions, ordinal } = parsePoints(pts);
  const unpriced = !squadOptions.length;
  if (unpriced) log.unpricedUnits.push(`${fid}/${slug}`);
  if (provisional) log.provisionalUnits.push(`${fid}/${slug}`);

  // role (battlefield) from keywords
  const brole = lk.includes('epic hero') ? 'epic-hero' : lk.includes('character') ? 'character'
    : lk.includes('battleline') ? 'battleline' : lk.includes('dedicated transport') ? 'dedicated-transport' : null;
  const transportSpecial = (ab.special || []).find((a) => /^transport$/i.test(en(a && a.name)));
  const transportCapacity = plainText(ds.transport) || (transportSpecial ? plainText(transportSpecial.description) : '') || null;

  let chapterBadge = null;
  if (fid === SM_PARENT) {
    const ch = (ds.factions || []).map(en).filter((k) => k && !/^(adeptus astartes|imperium)$/i.test(k));
    if (ch.length) chapterBadge = ch.join(' / ');
  }

  const unit = {
    id: dcu ? dcu.id : (curId || slug),
    name, type: 'unit', chapterBadge, role: brole, transportCapacity,
    stats, modelStats,
    invulnSave: (ab.invul && en(ab.invul.value)) || null,
    invulnNote: (ab.invul && plainText(ab.invul.info)) || null,
    weapons: weaponRows(ds.rangedWeapons, false).concat(weaponRows(ds.meleeWeapons, true)),
    abilities, wargearAbilities,
    wargearProfile: null,
    keywords,
    wargearOptions: [],
    points: pointsOptions.length ? pointsOptions[0] : 0,
    pointsOptions, squadOptions, ordinal,
    description: '',
    // Legends: MFM files the row under Legends, GDC marks the sheet
    // Imperial Armour / legends, or nobody prices it at all.
    isLegends: unpriced || !!(mrow && mrow.row.legends) || !!ds.imperialArmour || !!ds.legends,
    _unpriced: unpriced,
    attachmentRole: role,
    gdcLeadBy: [],
    _mfmPoints: !!mrow && !!(mrow.row.points && mrow.row.points.length),
    _provisional: provisional,
    gdcLoadout: plainText(ds.loadout) || null,
    gdcWargear: listLines(ds.wargear),
    gdcComposition: listLines(ds.composition),
    gdcMeleeWeapons: normalizeWeapons(ds.meleeWeapons),
    gdcRangedWeapons: normalizeWeapons(ds.rangedWeapons),
  };
  unit.wargearProfile = wargearProfile(unit, ctx);
  return unit;
}

// ── one 40kdc-only unit → one Legends unit (sheet GDC no longer carries) ────
const svp = (v) => (v == null ? '' : `${v}+`);
function dcKwToken(k) {
  if (!k) return null;
  if (typeof k === 'string') return { id: k, label: prettyKw(k) };
  const id = k.keyword_id; if (!id) return null;
  const p = k.parameters || {};
  if (id === 'anti') { const t = p.target_keyword ? String(p.target_keyword) : ''; return { id, label: (t ? 'Anti-' + t : 'Anti') + (p.threshold != null ? ' ' + p.threshold + '+' : '') }; }
  if (p.value != null) return { id, label: prettyKw(id) + ' ' + p.value };
  return { id, label: prettyKw(id) };
}
function dcWeaponRows(ws) {
  const rows = []; const seen = new Set();
  for (const w of ws) {
    if (!w || !Array.isArray(w.profiles)) continue;
    for (const p of w.profiles) {
      const st = p.stats || {};
      const melee = w.type === 'melee' || st.WS != null || String(p.range == null ? '' : p.range).trim().toLowerCase() === 'melee';
      const pn = p.name || '', wn = w.name || '';
      const name = (w.profiles.length > 1 && pn && wn && pn.toLowerCase() !== wn.toLowerCase() && pn.toLowerCase().indexOf(wn.toLowerCase()) === -1) ? `${wn} – ${pn}` : (pn || wn);
      const key = (melee ? 'm:' : 'r:') + name + JSON.stringify(st);
      if (seen.has(key)) continue; seen.add(key);
      const row = { name, _typeName: melee ? 'Melee' : 'Ranged', Range: melee ? 'Melee' : (p.range != null ? `${p.range}"` : '—'),
        A: num(st.A), S: num(st.S), AP: num(st.AP), D: num(st.D) };
      if (melee) row.WS = svp(st.WS != null ? st.WS : st.BS); else row.BS = svp(st.BS);
      const toks = (p.keywords || []).map(dcKwToken).filter(Boolean);
      if (toks.length) {
        row.Keywords = toks.map((t) => t.label).join(', ');
        const defs = {};
        toks.forEach((t) => { const txt = kwText(t.id); if (!txt) return; defs[t.label] = txt; const b = prettyKw(t.id); if (!defs[b]) defs[b] = txt; });
        if (Object.keys(defs).length) row._keywordDefs = defs;
      }
      rows.push(row);
    }
  }
  return rows;
}
function buildDcUnit(r, dcu, ctx) {
  const { fid, mrow, log, weapons, abText } = ctx;
  const profiles = (r.profiles && r.profiles.length) ? r.profiles : [{ name: r.name }];
  const modelStats = profiles.map((p) => ({ name: p.name || r.name, M: p.M == null ? '' : `${p.M}"`, T: num(p.T), SV: svp(p.Sv), W: num(p.W), LD: svp(p.Ld), OC: num(p.OC) }));
  const { name: _n, ...stats } = modelStats[0];
  const abilities = []; const seen = new Set();
  for (const aid of r.ability_ids || []) {
    if (aid === 'leader') continue;
    const name = String(aid).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (seen.has(nk(name))) continue; seen.add(nk(name));
    const core = !!coreText(aid) && (CORE_ABILITY_RE.test(name) || !!CORE[aid] || !!CORE[String(aid).replace(/-[^-]*$/, '')]);
    abilities.push({ name, description: coreText(aid) || abText(name) || (AIDX[`${ctx.dir}/${aid}`] || AIDX[aid] || {}).raw_text || '', isCore: core, id: aid });
  }
  const role = r.attachment_role || dcu.attachment_role || null;
  if (role && ATTACH_ROLE_ABILITY[role]) abilities.push({ name: ATTACH_ROLE_ABILITY[role].name, description: ATTACH_ROLE_ABILITY[role].description, isCore: true, id: role });
  // Price order (owner ruling): MFM row → GDC points (none: no GDC sheet) →
  // the pinned 40kdc snapshot's own points[] (provisional) → unpriced.
  const fromMfm = !!(mrow && mrow.row.points && mrow.row.points.length);
  const pts = fromMfm ? mrow.row.points : ((dcu.points && dcu.points.length) ? dcu.points : (r.points || []));
  const { squadOptions, pointsOptions, ordinal } = parsePoints(pts);
  const unpriced = !squadOptions.length;
  const kw = (r.keywords || []).concat(r.faction_keywords || []);
  const tc = r.transport_capacity;
  let chapterBadge = null;
  if (fid === SM_PARENT) { const ch = (r.faction_keywords || []).filter((k) => !/^(adeptus astartes|imperium)$/i.test(k)); if (ch.length) chapterBadge = ch.join(' / '); }
  const unit = {
    id: r.id, name: r.name, type: 'unit', chapterBadge, role: r.role || null,
    transportCapacity: tc && tc.capacity != null ? `This model has a transport capacity of ${tc.capacity} models.` + ((tc.exclusion_keywords || []).length ? ` It cannot transport ${tc.exclusion_keywords.join(' or ')} models.` : '') : null,
    stats, modelStats,
    invulnSave: profiles[0].invuln_sv != null ? svp(profiles[0].invuln_sv) : null, invulnNote: null,
    weapons: dcWeaponRows((r.weapon_ids || []).map(weapons).filter(Boolean)),
    abilities, wargearAbilities: [], wargearProfile: null, keywords: kw, wargearOptions: [],
    points: pointsOptions.length ? pointsOptions[0] : 0, pointsOptions, squadOptions, ordinal,
    description: '', isLegends: true, _unpriced: unpriced, attachmentRole: role, gdcLeadBy: [],
    _mfmPoints: fromMfm, _provisional: !fromMfm && !unpriced,
    gdcLoadout: null, gdcWargear: [], gdcComposition: [], gdcMeleeWeapons: [], gdcRangedWeapons: [],
    _source: '40kdc',
  };
  unit.gdcLeadBy = ctx.leadBy || [];
  unit.wargearProfile = wargearProfile(unit, { fid, slug: r.id, dcu, mrow, aliasItems: ctx.aliasItems || {}, log });
  return unit;
}

// Does the datasheet print this item? A weapon profile (any "– mode" suffix
// ignored), a wargear/other ability, or a mention in the loadout/wargear prose.
// Shared with validate.mjs (§6.4 join check).
const baseName = (s) => nk(String(s || '').replace(/\s+[–-]\s+.*$/, ''));
export function sheetCarries(u, itemName) {
  const k = nk(itemName); if (!k) return true;
  const have = new Set([...(u.weapons || []).map((w) => baseName(w.name)), ...(u.weapons || []).map((w) => nk(w.name)),
    ...(u.wargearAbilities || []).map((a) => nk(a.name)), ...(u.abilities || []).map((a) => nk(a.name))]);
  if (have.has(k) || have.has(k.replace(/s$/, ''))) return true;
  // GDC drops the faction prefix 40kdc keeps ("Astartes chainsword" → "Chainsword").
  for (const h of have) if (h.length > 4 && (h.startsWith(k) || k.startsWith(h) || k.endsWith(h) || h.endsWith(k))) return true;
  // The generic melee profile is printed under a sheet-specific name.
  if (k === 'closecombatweapon') return true;
  const prose = nk([u.gdcLoadout, ...(u.gdcWargear || []), ...(u.gdcComposition || [])].join(' '));
  return prose.includes(k);
}

// Structured wargear (40kdc) + item costs (MFM).
function wargearProfile(unit, ctx) {
  const { fid, slug, dcu, mrow, aliasItems, log } = ctx;
  const names = (dcu && dcu.itemNames) || {};
  const itemName = (id) => names[id] || String(id).replace(/-/g, ' ');
  // MFM item costs → 40kdc item ids
  let itemCosts = null;
  const mItems = (mrow && mrow.row.items) || {};
  if (Object.keys(mItems).length) {
    itemCosts = {};
    // Several 40kdc ids can share one printed name (meltagun / meltagun-dominion-squad):
    // prefer the ids the unit can actually field (options or default loadout).
    const reach = new Set();
    ((dcu && dcu.wargear_options) || []).forEach((r) => { (r.replaces || []).forEach((x) => reach.add(x)); (r.replacement || []).forEach((x) => reach.add(x)); (r.replacement_choice || []).forEach((g) => (g || []).forEach((x) => reach.add(x))); });
    ((dcu && dcu.composition && dcu.composition.models) || []).forEach((m) => (m.default_weapon_ids || []).forEach((x) => reach.add(x)));
    ((dcu && dcu.wargear_budgets) || []).forEach((b) => (b.items || []).forEach((x) => reach.add(x)));
    const byNk = new Map();
    Object.entries(names).forEach(([id, n]) => { const k = nk(n); const cur = byNk.get(k); if (!cur || (!reach.has(cur) && reach.has(id))) byNk.set(k, id); });
    const aliased = {};
    for (const [k, v] of Object.entries(aliasItems)) if (k.startsWith(`${fid}/${slug}/`)) aliased[nk(v)] = k.slice(`${fid}/${slug}/`.length);
    for (const [iname, pts] of Object.entries(mItems)) {
      const id = aliased[nk(iname)] || byNk.get(nk(iname)) || null;
      if (id) itemCosts[id] = pts;
      else { itemCosts[kebab(iname)] = pts; log.mfmItemsUnmatched.push(`${fid}/${slug}: ${iname}=${pts}`); }
    }
  }
  const costOf = (id) => (itemCosts && itemCosts[id]) || 0;
  const options = ((dcu && dcu.wargear_options) || []).map((r) => {
    const groups = Array.isArray(r.replacement_choice) ? r.replacement_choice : (Array.isArray(r.replacement) ? [r.replacement] : []);
    return { id: r.id, replaces: (r.replaces || []).map((id) => ({ id, name: itemName(id) })),
      choices: groups.map((g) => (g || []).map((id) => ({ id, name: itemName(id) }))),
      constraint: r.model_constraint || {}, cost: 0 };
  }).filter((o) => o.id && o.choices.length)
    .filter((o) => {
      const missing = [o.replaces, ...o.choices].flat().filter((it) => !sheetCarries(unit, it.name));
      if (!missing.length) return true;
      // Owner ruling: drop only where this build introduces the gap. If the
      // approved dataset still offers this option on a sheet that lacked the
      // same items, it was already live that way and stays (a known naming
      // difference). An option the approved dataset already dropped stays dropped.
      const ref = (CUR_UNITS.get(fid) || new Map()).get(unit.id);
      const refHasOption = !!(ref && ref.wargearProfile && (ref.wargearProfile.options || []).some((x) => x.id === o.id));
      if (refHasOption && missing.every((it) => !sheetCarries(ref, it.name))) { log.keptWargearOptionsKnownGap.push(`${fid}/${unit.id}: ${o.id}`); return true; }
      log.droppedWargearOptions.push(`${fid}/${unit.id}: ${o.id} (sheet lacks ${[...new Set(missing.map((x) => x.name))].join(', ')})`);
      return false;
    });
  const budgets = ((dcu && dcu.wargear_budgets) || []).map((b) => ({ items: (b && b.items || []).map((id) => ({ id, name: itemName(id) })),
    count: (b && b.count) || 0, perModels: (b && b.per_models) || 0 })).filter((b) => b.items.length && b.count > 0);
  let modelsBySize = null, defaultsBySize = null;
  const comp = dcu && dcu.composition;
  if (comp) {
    const defByModel = {};
    (comp.models || []).forEach((m) => { if (m && m.name && Array.isArray(m.default_weapon_ids)) defByModel[m.name] = m.default_weapon_ids; });
    const tiers = (Array.isArray(comp.tiers) && comp.tiers.length) ? comp.tiers : (comp.models ? [{ models: comp.models }] : []);
    modelsBySize = {}; defaultsBySize = {};
    tiers.forEach((t) => {
      let total = 0; const byName = {}; const items = new Map();
      (t && t.models || []).forEach((m) => {
        const n = (m && (m.max != null ? m.max : m.min)) || 0; total += n;
        if (!m || !m.name) return; byName[m.name] = n;
        (defByModel[m.name] || []).forEach((id) => items.set(id, (items.get(id) || 0) + n));
      });
      if (total > 0) { modelsBySize[total] = byName; defaultsBySize[total] = [...items.entries()].map(([id, count]) => ({ id, name: itemName(id), count })); }
    });
    const distribute = (models, size) => {
      if (!Array.isArray(models) || !models.length) return null;
      const byName = {}; let used = 0;
      models.forEach((m) => { const n = (m && m.min) || 0; if (m && m.name) byName[m.name] = n; used += n; });
      let rem = size - used; if (rem < 0) return null;
      for (const m of models) { if (rem <= 0) break; if (!m || !m.name) continue;
        const capN = ((m.max != null ? m.max : m.min) || 0) - byName[m.name]; const add = Math.max(0, Math.min(capN, rem)); byName[m.name] += add; rem -= add; }
      return rem === 0 ? byName : null;
    };
    (unit.squadOptions || []).forEach((so) => {
      const size = so && so.models; if (!size || defaultsBySize[size]) return;
      const byName = distribute(comp.models, size); if (!byName) return;
      const items = new Map();
      Object.keys(byName).forEach((nm) => (defByModel[nm] || []).forEach((id) => items.set(id, (items.get(id) || 0) + byName[nm])));
      modelsBySize[size] = byName; defaultsBySize[size] = [...items.entries()].map(([id, count]) => ({ id, name: itemName(id), count }));
    });
    if (!Object.keys(modelsBySize).length) { modelsBySize = null; defaultsBySize = null; }
  }
  let defaultCostBySize = null; let alwaysCost = 0;
  if (itemCosts) {
    if (defaultsBySize) { defaultCostBySize = {}; for (const s of Object.keys(defaultsBySize)) defaultCostBySize[s] = defaultsBySize[s].reduce((t, d) => t + costOf(d.id) * d.count, 0); }
    const reachable = new Set();
    if (defaultsBySize) Object.values(defaultsBySize).forEach((l) => l.forEach((d) => reachable.add(d.id)));
    options.forEach((o) => { o.replaces.forEach((x) => reachable.add(x.id)); o.choices.forEach((g) => g.forEach((x) => reachable.add(x.id))); });
    const allow = new Set(ALWAYS_COST_ALLOWLIST[`${fid}/${unit.id}`] || []);
    for (const id of Object.keys(itemCosts)) {
      if (reachable.has(id)) continue;
      if (allow.has(id)) alwaysCost += itemCosts[id];
      else log.unbilledItems.push(`${fid}/${unit.id}: ${id}=${itemCosts[id]}`);
    }
  }
  if (!options.length && !itemCosts && !budgets.length) return null;
  return { options, budgets, modelsBySize, defaultsBySize, itemCosts, defaultCostBySize, alwaysCost };
}

// ── write the candidate ──────────────────────────────────────────────────────
function stableStringify(o) { return JSON.stringify(o); }
export function writeCandidate(result, opts = {}) {
  const { factions, log, gdc, mfm, dc } = result;
  const files = factions.map((f) => [f._factionId, stableStringify(f)]).sort((a, b) => a[0].localeCompare(b[0]));
  const h = createHash('md5'); files.forEach(([id, s]) => { h.update(id); h.update(s); });
  const md5 = h.digest('hex');
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}-${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}`;
  const id = opts.id || `${stamp}-${gdc.version}-${md5.slice(0, 8)}`;
  const root = join(opts.out || DATASET, 'candidate');
  const dir = join(root, id); const tmp = join(root, `.tmp-${id}-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  files.forEach(([fid, s]) => writeFileSync(join(tmp, fid + '.json'), s));
  const wargearPriced = Object.values(mfm.units || {}).reduce((s, u) => s + Object.keys(u.items || {}).length, 0);
  const manifest = { id, builtAt: now.toISOString(),
    sources: { gdc: { version: gdc.version, updated: gdc.updated, files: gdc.files },
      mfm: { fetched: mfm.fetched || null, unitsPriced: Object.keys(mfm.units || {}).length, wargearPriced },
      dc: { sha: dc.sha || null }, coreRules: { md5: log.coreRules.md5 || null } },
    factions: factions.map((f) => ({ id: f._factionId, name: f.factionName, units: f.units.length, detachments: f.detachments.length })),
    md5 };
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(join(tmp, '_build-log.json'), JSON.stringify(log, null, 1));
  // The loader's glossary reads core-rule text from the dataset, not from code.
  if (SOURCES.coreRules && SOURCES.coreRules.path && existsSync(SOURCES.coreRules.path)) copyFileSync(SOURCES.coreRules.path, join(tmp, 'core-rules.json'));
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return { id, dir, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1]; };
  try {
    const r = build();
    const { id, dir } = writeCandidate(r, { out: opt('--out'), id: opt('--id') });
    const L = r.log;
    console.log(`factions ${r.factions.length}, units ${r.factions.reduce((s, f) => s + f.units.length, 0)}, `
      + `unpriced ${L.unpricedUnits.length}, provisional ${L.provisionalUnits.length}, no-40kdc ${L.noDcJoin.length}, `
      + `unjoined MFM rows ${L.unpricedMfmRows.length}, alias problems ${L.aliasesUnresolved.length}, warnings ${L.warnings.length}`);
    if (!L.coreRules.loaded) console.log('WARNING: core-rules glossary not loaded; core ability text will be empty');
    console.log(`wrote ${dir}`);
    console.log(id);
  } catch (e) {
    console.error('build failed:', e.stack || e.message);
    process.exit(1);
  }
}
