// extract/app.mjs — stored GW app dump → work/gdc.json in the GDC record shape (DATASET.md §11.4).
//
//   node extract/app.mjs [--dump PATH(.json|.json.gz)] [--store /work/app-dumps] [--out /work/work/gdc.json]
//
// Phase 1 of §11 is a drop-in: the output is exactly what extract/gdc.mjs
// writes from the GDC snapshot (same 28 file ids, same record shapes, a
// `_slug` on every record), so build.mjs does not change. The mapping from
// GW's relational dump to GDC's records was recovered from the pairs (dump N →
// GDC N); where GDC evidently hand-edited or mis-converted we follow the dump
// and pipeline/app-parity-accepted.json says why.
//
// Reads ONLY the dump (and the store's index.json / last-check.json for the
// provenance block). Never data/gdc/, the golden set or a previous dataset:
// those are the parity oracle (tests/app-parity.mjs).
//
// Every dump datasheet that is not emitted is counted under a named rule in
// `excluded` (and `files.<file>.excluded`): `combat-patrol` (its publication
// is a Combat Patrol box), `faction-without-file` (its publication's faction
// keyword has no GDC file: Titan Legions) and
// `hidden-keyword-copy-of-published-sheet` (see the datasheet loop).
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './gdc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = JSON.parse(readFileSync(join(HERE, '..', 'sources.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };

// GW faction keyword (English name, as the dump prints it) → GDC file id.
// Identity labels, not data: GDC names its files after the army, GW keys the
// army on a faction keyword. A keyword with no file here (Titan Legions,
// Ynnari, the daemon legion sub-keywords) has no GDC file; its datasheets are
// counted under `faction-without-file`. A publication of a keyword that has no
// file but whose PARENT keyword has one (Ultramarines → Adeptus Astartes)
// files under the parent.
export const FILE_OF_KEYWORD = {
  'Adepta Sororitas': 'adeptasororitas',
  'Adeptus Custodes': 'adeptuscustodes',
  'Adeptus Mechanicus': 'adeptusmechanicus',
  'Asuryani': 'aeldari',
  'Agents of the Imperium': 'agents',
  'Astra Militarum': 'astramilitarum',
  'Black Templars': 'blacktemplar',
  'Blood Angels': 'bloodangels',
  'Heretic Astartes': 'chaos_spacemarines',
  'Legiones Daemonica': 'chaosdaemons',
  'Chaos Knights': 'chaosknights',
  'Dark Angels': 'darkangels',
  'Death Guard': 'deathguard',
  'Deathwatch': 'deathwatch',
  'Drukhari': 'drukhari',
  'Emperor’s Children': 'emperors_children',
  'Grey Knights': 'greyknights',
  'Genestealer Cults': 'gsc',
  'Imperial Knights': 'imperialknights',
  'Necrons': 'necrons',
  'Orks': 'orks',
  'Adeptus Astartes': 'space_marines',
  'Space Wolves': 'spacewolves',
  'T’au Empire': 'tau',
  'Thousand Sons': 'thousandsons',
  'Tyranids': 'tyranids',
  'Leagues of Votann': 'votann',
  'World Eaters': 'worldeaters',
};

// ── dump access ──────────────────────────────────────────────────────────────
export function readDump(path) {
  const buf = readFileSync(path);
  const txt = (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
  const j = JSON.parse(txt);
  if (!j || !j.metadata || !j.data) throw new Error(`${path}: not an app dump (no metadata/data)`);
  return j;
}

// Newest stored dump: highest dataVersion, ties → newest fetchedAt.
export function pickStored(store) {
  const idx = JSON.parse(readFileSync(join(store, 'index.json'), 'utf8'));
  const dumps = (idx.dumps || []).slice().sort((a, b) => (b.dataVersion - a.dataVersion) || String(b.fetchedAt).localeCompare(String(a.fetchedAt)));
  if (!dumps.length) throw new Error(`${store}/index.json lists no dumps`);
  return { index: idx, entry: dumps[0] };
}

const T = (r) => (r && r.localisations && r.localisations.en) || {};
// GDC's text cleaning, recovered from the pairs: numeric entities the app
// leaves in some strings (`&#x20;`, `&#x65;`) are decoded, CRLF is LF, ends
// are trimmed.
export const clean = (s) => (s == null ? '' : String(s))
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/\r\n/g, '\n').trim();
const loc = (s) => ({ en: clean(s) });
// GDC sorts several lists on the dump's values compared AS STRINGS (cpCost
// "10" < "9"); recovered from the pairs, see the call sites.
const strCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sCmp = (a, b) => strCmp(String(a), String(b));
// Datasheets are in English collation order (case-insensitive, punctuation
// before letters: "Be’lakor" < "Beasts", "Commander Farsight" < "Commander in …").
const NAME_ORDER = new Intl.Collator('en');
const byOrder = (a, b) => (a.displayOrder - b.displayOrder) || strCmp(a.id || '', b.id || '');
// Several GDC lists come out in REVERSE displayOrder (ties: id ascending):
// datasheet rules, wargear prose, weapon keywords, points within a group.
const byOrderDesc = (a, b) => (b.displayOrder - a.displayOrder) || strCmp(a.id || '', b.id || '');

function indexDump(data) {
  const byId = {};
  const groups = {};
  const id = (t) => (byId[t] ??= new Map((data[t] || []).map((r) => [r.id, r])));
  const group = (t, k) => {
    const key = t + '.' + k;
    if (!groups[key]) {
      const m = new Map();
      for (const r of data[t] || []) { const v = r[k]; if (!m.has(v)) m.set(v, []); m.get(v).push(r); }
      groups[key] = m;
    }
    return (v) => groups[key].get(v) || [];
  };
  return { id, group, rows: (t) => data[t] || [] };
}

// ── conversion ───────────────────────────────────────────────────────────────
export function convert(dump) {
  const X = indexDump(dump.data);
  const fk = X.id('faction_keyword');
  const pub = X.id('publication');
  const kwName = (id) => T(X.id('keyword').get(id)).name || '';
  const fkName = (id) => T(fk.get(id)).name || '';

  // faction keyword id → file id (own file, else the parent's); detachments
  // sort on id, datasheets on name
  const fileOfFk = new Map();
  const fkOfFile = new Map();
  for (const r of X.rows('faction_keyword')) {
    const f = FILE_OF_KEYWORD[T(r).name];
    if (f) { fileOfFk.set(r.id, f); fkOfFile.set(f, r); }
  }
  for (const r of X.rows('faction_keyword')) {
    if (fileOfFk.has(r.id) || !r.parentFactionKeywordId) continue;
    const p = fileOfFk.get(r.parentFactionKeywordId); if (p) fileOfFk.set(r.id, p);
  }
  const fileOfPub = (pid) => { const p = pub.get(pid); return p && p.factionKeywordId ? fileOfFk.get(p.factionKeywordId) || null : null; };

  const excluded = {};
  const files = {};
  const factions = {};
  for (const file of SOURCES.gdc.files) {
    const r = fkOfFile.get(file);
    if (!r) throw new Error(`no faction keyword in the dump maps to GDC file ${file}`);
    const parent = r.parentFactionKeywordId ? fk.get(r.parentFactionKeywordId) : null;
    factions[file] = { file, id: r.id, name: T(r).name, parent_name: parent ? T(parent).name : null,
      compatibleDataVersion: Number(dump.metadata.data_version), updated: null,
      datasheets: [], stratagems: [], enhancements: [], detachments: [], rules: { army: [], detachment: [] } };
    files[file] = { version: Number(dump.metadata.data_version), updated: null, datasheets: 0, excluded: {} };
  }
  const exclude = (file, rule) => {
    excluded[rule] = (excluded[rule] || 0) + 1;
    if (file && files[file]) files[file].excluded[rule] = (files[file].excluded[rule] || 0) + 1;
  };

  // ── datasheets ────────────────────────────────────────────────────────────
  const dsFk = X.group('datasheet_faction_keyword', 'datasheetId');
  // A datasheet whose faction keywords are all ones GW hides from the army
  // builder (Plague Legions, Blood Legions, …) is a codex's copy of a sheet
  // another file publishes under its real faction (Death Guard's
  // Plaguebearers = Chaos Daemons' Plaguebearers); GDC keeps only the
  // original. Sheets of a hidden keyword with no such original (Harlequins,
  // Ynnari, Anathema Psykana) stay.
  const realName = new Set();
  const hiddenOnly = (ds) => { const own = dsFk(ds.id).map((x) => fk.get(x.factionKeywordId)).filter(Boolean); return own.length > 0 && own.every((k) => k.excludedFromArmyBuilder); };
  for (const ds of X.rows('datasheet')) {
    const p = pub.get(ds.publicationId);
    if (fileOfPub(ds.publicationId) && !(p && p.isCombatPatrol) && !hiddenOnly(ds)) realName.add(T(ds).name);
  }
  for (const ds of X.rows('datasheet')) {
    const p = pub.get(ds.publicationId);
    const file = fileOfPub(ds.publicationId);
    if (!file) { exclude(null, 'faction-without-file'); continue; }
    if (p && p.isCombatPatrol) { exclude(file, 'combat-patrol'); continue; }
    if (hiddenOnly(ds) && realName.has(T(ds).name)) { exclude(file, 'hidden-keyword-copy-of-published-sheet'); continue; }
    factions[file].datasheets.push(datasheet(X, ds, factions[file], { kwName, fkName }));
  }
  for (const f of Object.values(factions)) {
    f.datasheets.sort((a, b) => NAME_ORDER.compare(a.name.en, b.name.en));
    files[f.file].datasheets = f.datasheets.length;
  }

  // ── detachments, stratagems, enhancements, rules ──────────────────────────
  // A detachment belongs to its publication's faction, unless GW does not
  // list that faction among the detachment's own keywords (Deathwatch
  // Support: published in the Deathwatch supplement, keyed to Adeptus
  // Astartes and every chapter but Deathwatch) — then the publication
  // faction's parent.
  const detFkOf = X.group('detachment_faction_keyword', 'detachmentId');
  const detTagId = new Map();
  const detFile = new Map();
  for (const d of X.rows('detachment')) {
    const p = pub.get(d.publicationId); if (!p || !p.factionKeywordId || d.isCombatPatrol) continue;
    const own = detFkOf(d.id).map((x) => x.factionKeywordId);
    let tag = p.factionKeywordId;
    if (own.length && !own.includes(tag)) { const par = (fk.get(tag) || {}).parentFactionKeywordId; if (par && own.includes(par)) tag = par; }
    const file = fileOfFk.get(tag); if (!file) continue;
    detTagId.set(d.id, tag); detFile.set(d.id, file);
  }
  const fdName = (id) => T(X.id('force_disposition').get(id)).name || '';
  const fdOf = X.group('detachment_force_disposition', 'detachmentId');
  const ukOf = X.group('detachment_unique_keyword', 'detachmentId');
  const dets = [...detFile.keys()].map((id) => X.id('detachment').get(id)).sort((a, b) => strCmp(a.id, b.id));
  for (const d of dets) {
    const file = detFile.get(d.id);
    const fds = fdOf(d.id).map((x) => x.forceDispositionId).sort(strCmp).map((id) => ({ id, name: loc(fdName(id)) }));
    factions[file].detachments.push({ id: d.id, name: loc(T(d).name), faction: fkName(detTagId.get(d.id)),
      detachmentPoints: d.detachmentPointsCost, forceDisposition: fds[0] || null, forceDispositions: fds,
      uniqueTags: ukOf(d.id).map((x) => ({ id: x.keywordId, name: loc(kwName(x.keywordId)) })) });
  }
  const detById = X.id('detachment');
  const detTag = (did) => (detTagId.has(did) ? fkName(detTagId.get(did)) : null);

  // stratagems: detachments in id order; within one, on (category, cpCost,
  // displayOrder) compared as strings ("10" < "9"), then id
  const phases = X.group('stratagem_phase', 'stratagemId');
  const strats = X.rows('stratagem').filter((s) => s.detachmentId && detFile.has(s.detachmentId))
    .sort((a, b) => strCmp(a.detachmentId, b.detachmentId) || sCmp(a.category, b.category) || sCmp(a.cpCost, b.cpCost)
      || sCmp(a.displayOrder, b.displayOrder) || strCmp(a.id, b.id));
  for (const s of strats) {
    const file = detFile.get(s.detachmentId); const f = factions[file];
    f.stratagems.push(stratagem(s, f, T(detById.get(s.detachmentId)).name, detTag(s.detachmentId), phases(s.id)));
  }
  // enhancements: per detachment, on (displayOrder, cost as a string, id)
  const enhKw = enhancementKeywords(X, kwName, fkName);
  const enh = X.rows('enhancement').filter((e) => e.detachmentId && detFile.has(e.detachmentId) && !e.isCombatPatrol)
    .sort((a, b) => strCmp(a.detachmentId, b.detachmentId) || (a.displayOrder - b.displayOrder) || sCmp(a.basePointsCost, b.basePointsCost) || strCmp(a.id, b.id));
  for (const e of enh) {
    const file = detFile.get(e.detachmentId); const f = factions[file];
    f.enhancements.push({ id: e.id, name: loc(T(e).name), cost: String(e.basePointsCost), keywords: enhKw.keywords(e.id, detTag(e.detachmentId)),
      excludes: enhKw.excludes(e.id), equipableByNonCharacter: !!e.isEquipableByNonCharacterUnit,
      description: loc(T(e).rules), faction_id: f.id, detachment: T(detById.get(e.detachmentId)).name, detachment_id: e.detachmentId,
      detachment_faction: detTag(e.detachmentId), source: '40k-11e', cardType: 'enhancement' });
  }

  const comps = (k) => X.group('rule_container_component', k);
  const armyComps = comps('armyRuleId'); const detComps = comps('detachmentRuleId');
  // army rules: those GW ties to a faction keyword (army_rule_faction_keyword),
  // under that keyword's own file
  const arFk = X.group('army_rule_faction_keyword', 'armyRuleId');
  for (const r of X.rows('army_rule').slice().sort(byOrder)) {
    for (const x of arFk(r.id)) {
      const file = FILE_OF_KEYWORD[fkName(x.factionKeywordId)]; if (!file) continue;
      factions[file].rules.army.push({ name: loc(T(r).name), rules: ruleChunks(armyComps(r.id)), source: '40k-11e', cardType: 'armyRule' });
    }
  }
  const drOf = X.group('detachment_rule', 'detachmentId');
  for (const d of dets) {
    const file = detFile.get(d.id);
    const rules = drOf(d.id).slice().sort(byOrder).map((r) => ({ name: loc(T(r).name), rules: ruleChunks(detComps(r.id)), source: '40k-11e', cardType: 'detachmentRule' }));
    factions[file].rules.detachment.push({ detachment: T(d).name, detachment_id: d.id, faction: detTag(d.id), rules });
  }

  // _slug on every record (gdc.mjs tag())
  const tag = (list) => list.map((r) => ({ ...r, _slug: slug(r.name) }));
  for (const f of Object.values(factions)) {
    f.datasheets = tag(f.datasheets); f.stratagems = tag(f.stratagems); f.enhancements = tag(f.enhancements);
    f.detachments = tag(f.detachments);
    f.rules = { army: tag(f.rules.army), detachment: tag(f.rules.detachment) };
  }
  return { factions, files, excluded };
}

function ruleChunks(list) {
  return list.slice().sort(byOrder).filter((c) => c.type !== 'loreAccordion').map((c) => {
    const t = T(c); const o = { order: c.displayOrder, type: c.type };
    if (t.title) o.title = loc(t.title);
    if (t.subtitle) o.subTitle = loc(t.subtitle);
    if (t.textContent != null) o.text = loc(t.textContent);
    return o;
  });
}

const TURN = { yourTurn: 'your', opponentsTurn: 'opponents', eitherPlayer: 'either' };
const TYPE = { battleTactic: 'Battle Tactic', strategicPloy: 'Strategic Ploy', epicDeed: 'Epic Deed', wargear: 'Wargear' };
const PHASE = { commandPhase: 'command', movementPhase: 'movement', shootingPhase: 'shooting', chargePhase: 'charge', fightPhase: 'fight' };
function stratagem(s, f, detName, detFaction, phaseRows) {
  const t = T(s);
  const o = { id: s.id, name: loc(t.name), cost: Number(s.cpCost), turn: TURN[s.key] || '', type: TYPE[s.category] || '',
    // "Any phase" in the WHEN line → ["any"]; else the phases, alphabetical
    phase: /\bany phase\b/i.test(t.whenRules || '') ? ['any'] : phaseRows.map((p) => PHASE[p.phase] || p.phase).sort(strCmp), target: loc(t.targetRules), when: loc(t.whenRules), effect: loc(t.effectRules),
    fluff: loc(t.lore), faction_id: f.id, detachment: detName, detachment_id: s.detachmentId, detachment_faction: detFaction, source: '40k-11e' };
  if (t.restrictionRules != null) o.restrictions = loc(t.restrictionRules);
  if (t.secondaryEffect) { o.secondary_effect = loc(t.secondaryEffect); o.secondary_effect_cost = Number(s.secondaryEffectAdditionalCPCost) || 0; o.secondary_effect_exclusive = !!s.secondaryEffectIsMutuallyExclusive; }
  return o;
}

function enhancementKeywords(X, kwName, fkName) {
  const grp = X.group('enhancement_required_keyword_group', 'enhancementId');
  const gk = X.group('enhancement_required_keyword_group_keyword', 'enhancementRequiredKeywordGroupId');
  const gf = X.group('enhancement_required_keyword_group_faction_keyword', 'enhancementRequiredKeywordGroupId');
  const ex = X.group('enhancement_excluded_keyword', 'enhancementId');
  // per requirement group (group-id order) its keywords, then its faction
  // keywords, each in keyword-id order; a sheet-only requirement
  // ("Shield-Captain in Allarus Terminator Armour model only") lists the
  // detachment's faction instead. Excluded keywords: keyword-id order.
  const byId = (a, b) => strCmp(a.keywordId || a.factionKeywordId, b.keywordId || b.factionKeywordId);
  return {
    keywords: (id, faction) => {
      const out = [];
      for (const g of grp(id).slice().sort((a, b) => strCmp(a.id, b.id))) {
        gk(g.id).slice().sort(byId).forEach((x) => out.push(kwName(x.keywordId)));
        gf(g.id).slice().sort(byId).forEach((x) => out.push(fkName(x.factionKeywordId)));
      }
      const uniq = [...new Set(out)].filter(Boolean);
      return uniq.length ? uniq : (faction ? [faction] : []);
    },
    excludes: (id) => ex(id).slice().sort(byId).map((x) => kwName(x.keywordId)).filter(Boolean),
  };
}

// ── one dump datasheet → one GDC datasheet record ────────────────────────────
function datasheet(X, ds, f, { kwName, fkName }) {
  const t = T(ds);
  const minis = X.group('miniature', 'datasheetId')(ds.id).slice().sort(byOrder);
  const mk = X.group('miniature_keyword', 'miniatureId');
  // a model's keywords in displayOrder compared as strings ("10" < "2")
  const kwOf = (m) => mk(m.id).slice().sort((a, b) => sCmp(a.displayOrder, b.displayOrder) || strCmp(a.id, b.id)).map((x) => kwName(x.keywordId));
  const allKw = minis.map(kwOf);
  // unit keywords: the first model with a statline, then whatever the other
  // models add (statline models first); modelKeywords: per model, what not
  // every model has
  const order = [...minis.keys()].sort((a, b) => (minis[a].statlineHidden ? 1 : 0) - (minis[b].statlineHidden ? 1 : 0));
  const keywords = [];
  order.forEach((i) => allKw[i].forEach((k) => { if (!keywords.includes(k)) keywords.push(k); }));
  const common = keywords.filter((k) => allKw.every((l) => l.includes(k)));
  const modelKeywords = minis.length > 1 ? minis.map((m, i) => ({ name: loc(T(m).name), keywords: allKw[i].filter((k) => !common.includes(k)).map(loc) }))
    .filter((m) => m.keywords.length) : [];
  const hasDamage = X.group('datasheet_damage', 'datasheetId')(ds.id).length > 0;
  const stats = minis.filter((m) => !m.statlineHidden).map((m) => {
    const o = { name: loc(minis.length > 1 ? T(m).name : t.name), m: m.movement, t: m.toughness, sv: m.save, w: m.wounds, ld: m.leadership, oc: m.objectiveControl };
    if (minis.length > 1) o.showName = true;
    if (hasDamage) o.showDamagedMarker = true;
    return o;
  });

  // weapons: every item the sheet's option groups reference, in item-id order
  const groups = X.group('wargear_option_group', 'datasheetId')(ds.id).slice().sort(byOrder);
  const optsOf = X.group('wargear_option', 'wargearOptionGroupId');
  const itemIds = new Set();
  groups.forEach((g) => optsOf(g.id).forEach((o) => itemIds.add(o.wargearItemId)));
  const wi = X.id('wargear_item');
  const items = [...itemIds].map((id) => wi.get(id)).filter(Boolean).sort((a, b) => strCmp(a.id, b.id));
  const profOf = X.group('wargear_item_profile', 'wargearItemId');
  const pab = X.group('wargear_item_profile_wargear_ability', 'wargearItemProfileId');
  const wab = X.id('wargear_ability');
  const ranged = []; const melee = [];
  for (const it of items) {
    if (it.wargearType !== 'weapon') continue;
    const name = String(T(it).name || '').trim();
    // an item's only profile prints its own name (but a bare "melee" /
    // "ranged", exactly its type, prints the item name); of several, one
    // named like its item prints the item name, the rest "Item – Mode"
    const pname = (p, n1) => { const n = clean(T(p).name); if (n1) return n && n !== p.type ? n : name; return !n || n === name ? name : `${name} – ${n.charAt(0).toUpperCase()}${n.slice(1)}`; };
    const mk2 = (p, n1) => ({ name: loc(pname(p, n1)), range: p.type === 'melee' ? 'Melee' : p.range,
      attacks: p.attacks, skill: p.type === 'melee' ? p.weaponSkill : p.ballisticSkill, strength: p.strength, ap: p.armourPenetration, damage: p.damage,
      keywords: pab(p.id).slice().sort(byOrderDesc).map((x) => clean(T(wab.get(x.wargearAbilityId)).name)).filter(Boolean) });
    // GDC orders an item's profiles on the dump row's columns taken
    // alphabetically (armourPenetration, attacks, ballisticSkill, damage,
    // displayOrder, id), each compared as a string.
    const pkey = (p) => [p.armourPenetration, p.attacks, p.ballisticSkill, p.damage, p.displayOrder, p.id].map((v) => String(v == null ? '' : v));
    // C'tan powers are profiles of type "ctanpowers": not weapons in GDC
    const profs = profOf(it.id).filter((p) => p.type === 'ranged' || p.type === 'melee');
    const order = (list) => list.map((p) => [pkey(p), p]).sort((a, b) => { for (let i = 0; i < a[0].length; i++) { const c = strCmp(a[0][i], b[0][i]); if (c) return c; } return 0; }).map((x) => mk2(x[1], profs.length === 1));
    // a weapon ability with no lore is a rule of that weapon (Linked Fire),
    // printed under the weapon as well as among its keywords
    const wabs = (list) => { const out = []; const seen = new Set(); list.forEach((p) => pab(p.id).slice().sort(byOrderDesc).forEach((x) => {
      const w = wab.get(x.wargearAbilityId); if (!w || T(w).lore != null || seen.has(w.id)) return; seen.add(w.id); out.push({ name: loc(T(w).name), description: loc(T(w).rules) }); })); return out; };
    const group = (list) => { const g = { profiles: order(list) }; const a = wabs(list); if (a.length) g.abilities = a; return g; };
    const r = profs.filter((p) => p.type !== 'melee'); const m = profs.filter((p) => p.type === 'melee');
    if (r.length) ranged.push(group(r));
    if (m.length) melee.push(group(m));
  }

  // abilities
  const links = X.group('datasheet_datasheet_ability', 'datasheetId')(ds.id).slice().sort(byOrder);
  const dab = X.id('datasheet_ability');
  const subs = X.group('datasheet_sub_ability', 'datasheetAbilityId');
  const abilities = { faction: [], core: [], other: [] };
  for (const l of links) {
    const a = dab.get(l.datasheetAbilityId); if (!a) continue;
    const at = T(a);
    const restr = T(l).restriction;   // "(Szarekh model only)"
    if (a.abilityType === 'core' || a.abilityType === 'faction') {
      const o = { name: loc(at.name) }; if (restr) o.restriction = loc(restr);
      abilities[a.abilityType].push(o);
    }
    else {
      // an ability with sub-abilities (Canticles of the Omnissiah) is printed
      // as an ability AND as a "primarch" block listing the subs
      const sa = subs(a.id).slice().sort(byOrder);
      if (sa.length) (abilities.primarch ??= []).push({ name: loc(at.name), abilities: sa.map((s) => ({ name: loc(T(s).name), description: loc(T(s).rules) })) });
      const o = { name: loc(at.name), description: loc(at.rules) };
      if (a.isAura) o.isAura = true; if (a.isPsychic) o.isPsychic = true; if (a.isPain) o.isPain = true; if (a.isBondsman) o.isBondsman = true;
      abilities.other.push(o);
    }
  }
  // one invulnerable save per sheet; with one per model (Wardens of
  // Ultramar: 4+ and 5+) GDC prints the lowest row id's
  const inv = X.group('invulnerable_save', 'datasheetId')(ds.id).slice().sort((a, b) => strCmp(a.id, b.id))[0];
  if (inv) { abilities.invul = { value: inv.save }; if (T(inv).rules) abilities.invul.info = loc(T(inv).rules); }
  if (!abilities.core.length) delete abilities.core;
  if (!abilities.faction.length) delete abilities.faction;
  if (!abilities.other.length) delete abilities.other;
  // (GDC drops the trailing "Designer’s Note" paragraph of a wargear rule)
  const wgAb = items.filter((it) => it.wargearType === 'wargear' && T(it).ruleText)
    .map((it) => ({ name: loc(T(it).name), description: loc(String(T(it).ruleText).replace(/\n\n[*\s]*Designer[’']s Note[\s\S]*$/, '')) }));
  if (wgAb.length) abilities.wargear = wgAb;
  const dmg = X.group('datasheet_damage', 'datasheetId')(ds.id)[0];
  if (dmg) { abilities.damaged = { range: loc(String(T(dmg).name || '').replace(/^DAMAGED:?\s*/i, '').toUpperCase()) }; if (T(dmg).rules) abilities.damaged.description = loc(T(dmg).rules); }
  const rules = X.group('datasheet_rule', 'datasheetId')(ds.id).slice().sort(byOrder);
  // every datasheet rule but Leader (→ leader) and Transport (→ transport),
  // in reverse displayOrder; GDC matches both names case-sensitively
  const special = rules.filter((r) => !/^(Leader|Transport)$/.test(T(r).name)).sort(byOrderDesc).map((r) => ({ name: loc(T(r).name), description: loc(T(r).rules) }));
  if (special.length) abilities.special = special;

  // composition / loadout from the one unitComposition text
  const uc = String(t.unitComposition || '');
  // "<model lines>\n\n<equipped-with lines>"; one block (HTML lists) stays whole
  // ("■" bullets dropped; the loadout block's blank lines closed up)
  const cut = uc.indexOf('\n\n');
  const composition = (cut === -1 ? uc : uc.slice(0, cut)).split('\n').map((l) => l.replace(/■/g, ''));
  const loadout = cut === -1 ? '' : uc.slice(cut + 2).replace(/\n\n/g, '\n');

  const wrules = X.group('wargear_rule', 'datasheetId')(ds.id).slice().sort(byOrderDesc);
  const wargear = wrules.length ? wrules.map((r) => loc(String(T(r).rulesText || '').replace(/■/g, '').replace(/\n/g, ' '))) : [loc('None')];

  const ucs = X.group('unit_composition', 'datasheetId')(ds.id).slice().sort(byOrder);
  const ucm = X.group('unit_composition_miniature', 'unitCompositionId');
  const ucDet = X.group('unit_composition_required_detachment', 'unitCompositionId');
  const ucFk = X.group('unit_composition_required_faction_keyword', 'unitCompositionId');
  const points = ucs.map((u) => {
    const d = ucDet(u.id)[0]; const fq = ucFk(u.id)[0];
    return { cost: String(u.points), models: String(ucm(u.id).reduce((s, m) => s + (m.max || 0), 0)),
      keyword: u.referenceGroupingKeywordId ? loc(kwName(u.referenceGroupingKeywordId)) : null,
      faction: fq ? loc(fkName(fq.factionKeywordId)) : null,
      detachment: d ? loc(T(X.id('detachment').get(d.detachmentId)).name) : null, _o: u.displayOrder, _id: u.id };
  });
  // grouped by condition (groups in displayOrder), each group in REVERSE
  // displayOrder; an exact repeat (same cost, size and condition) once
  const gkey = (p) => JSON.stringify([p.keyword, p.faction, p.detachment]);
  const first = new Map(); points.forEach((p) => { if (!first.has(gkey(p))) first.set(gkey(p), p._o); else first.set(gkey(p), Math.min(first.get(gkey(p)), p._o)); });
  points.sort((a, b) => (first.get(gkey(a)) - first.get(gkey(b))) || (b._o - a._o) || strCmp(a._id, b._id));
  points.forEach((p) => { delete p._o; delete p._id; });
  const seenPts = new Set();
  const pointsOut = points.filter((p) => { const k = JSON.stringify(p); if (seenPts.has(k)) return false; seenPts.add(k); return true; });

  const wargearOptions = groups.map((g) => ({ instruction: loc(T(g).instructionText),
    options: optsOf(g.id).slice().sort(byOrder).map((o) => ({ name: loc(T(wi.get(o.wargearItemId)).name), cost: String(o.points) })) }))
    .filter((g) => g.options.length);   // a group with no options is not printed

  const out = { id: ds.id, source: '40k-11e', name: loc(t.name), factions: X.group('datasheet_faction_keyword', 'datasheetId')(ds.id).slice().sort(byOrder).map((x) => fkName(x.factionKeywordId)),
    faction_id: f.id, keywords: keywords.map(loc), modelKeywords, stats, rangedWeapons: ranged, meleeWeapons: melee, abilities,
    composition: composition.map(loc), loadout: loc(loadout), wargear };
  if (t.lore) out.fluff = loc(t.lore);
  if (t.baseSize) out.baseSize = loc(t.baseSize);
  out.points = pointsOut;
  if (wargearOptions.length) out.wargearOptions = wargearOptions;
  const leader = rules.find((r) => T(r).name === 'Leader');
  if (leader) out.leader = loc(String(T(leader).rules || '').replace(/\n/g, ' '));
  const att = attachesTo(X, ds);
  if (att.length) out.attachesTo = att;
  const steps = X.group('datasheet_points_step', 'datasheetId')(ds.id);
  if (steps.length) out.additionalCost = { cost: String(steps[0].stepPoints), afterSelections: steps[0].stepAt - 1 };
  const tr = rules.find((r) => T(r).name === 'Transport');
  if (tr) out.transport = loc(T(tr).rules);
  const p = X.id('publication').get(ds.publicationId);
  if (p && /^Imperial Armour/i.test(T(p).name || '')) out.imperialArmour = true;
  return out;
}

function attachesTo(X, ds) {
  const bg = X.group('datasheet_bodyguard_group', 'datasheetId')(ds.id);
  const bgd = X.group('datasheet_bodyguard_group_datasheet', 'datasheetBodyguardGroupId');
  const bgk = X.group('datasheet_bodyguard_group_keyword', 'datasheetBodyguardGroupId');
  const dsById = X.id('datasheet');
  const det = X.id('detachment'); const kw = X.id('keyword');
  const out = [];
  for (const g of bg) {
    const extra = {};
    if (g.excludedDetachmentId) extra.excludesDetachment = T(det.get(g.excludedDetachmentId)).name || '';
    if (g.requiredDetachmentId) extra.requiresDetachment = T(det.get(g.requiredDetachmentId)).name || '';
    if (g.requiresAllUnitsHaveKeywordId) extra.requiresKeyword = T(kw.get(g.requiresAllUnitsHaveKeywordId)).name || '';
    for (const x of bgd(g.id)) out.push({ type: g.bodyguardType, target: T(dsById.get(x.datasheetId)).name || '', targetType: 'datasheet', ...extra });
    for (const x of bgk(g.id)) out.push({ type: g.bodyguardType, target: T(kw.get(x.keywordId)).name || '', targetType: 'keyword', ...extra });
  }
  // A target GW lists both as a datasheet and as a keyword of the same name
  // (data 963/972: "Terminator Squad") is printed once, as the keyword.
  const kwKey = (a) => JSON.stringify({ ...a, targetType: 'keyword' });
  const kws = new Set(out.filter((a) => a.targetType === 'keyword').map(kwKey));
  const kept = out.filter((a) => a.targetType !== 'datasheet' || !kws.has(kwKey(a)));
  // ordered on the records' JSON text (so "X with Y" sorts before "X")
  return kept.sort((a, b) => strCmp(JSON.stringify(a), JSON.stringify(b)));
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const STORE = opt('--store', SOURCES.app.store);
  const OUT = opt('--out', join(SOURCES.work, 'gdc.json'));
  let dumpPath = opt('--dump', null); let entry = null; let index = null;
  if (existsSync(join(STORE, 'index.json'))) {
    const picked = pickStored(STORE); index = picked.index;
    if (!dumpPath) { entry = picked.entry; dumpPath = join(STORE, entry.file); }
    else entry = (index.dumps || []).find((e) => e.file === basename(dumpPath)) || null;
  }
  if (!dumpPath) throw new Error(`no --dump and no ${STORE}/index.json`);
  const dump = readDump(dumpPath);
  const version = Number(dump.metadata.data_version);
  const { factions, files, excluded } = convert(dump);
  const lcPath = join(STORE, 'last-check.json');
  const lastCheck = existsSync(lcPath) ? JSON.parse(readFileSync(lcPath, 'utf8')) : null;
  const updated = (entry && entry.fetchedAt) || null;
  for (const f of Object.values(factions)) f.updated = updated;
  for (const f of Object.values(files)) f.updated = updated;
  const app = { package: (index && index.package) || SOURCES.app.package, appVersion: entry ? entry.appVersion : null, dataVersion: version,
    sha256: entry ? entry.sha256 : null, fetchedAt: updated, source: entry ? entry.source : null, lastCheck };
  const out = { version, updated, ref: null, from: 'app', extractedAt: new Date().toISOString(), files, factions, excluded, app };
  mkdirSync(dirname(OUT), { recursive: true });
  const tmp = OUT + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(out)); renameSync(tmp, OUT);
  const n = Object.values(factions).reduce((s, f) => s + f.datasheets.length, 0);
  const x = Object.entries(excluded).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`app: ${Object.keys(factions).length} files, ${n} datasheets (excluded: ${x || 'none'}), data ${version} -> ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('app extract failed:', e.stack || e.message); process.exit(3); });
}
