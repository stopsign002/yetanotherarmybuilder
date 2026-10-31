// extract/dc.mjs — pinned 40kdc checkout -> /work/work/dc.json (DATASET.md §4)
// Raw 40kdc records, regrouped per faction; nothing is reshaped beyond joining
// wargear options + composition onto each unit and resolving item names.
// Run: docker run --rm -v <app>:/app -v ~/sites/base/yaab-data:/work -w /app/pipeline node:22-slim node extract/dc.mjs
import fs from 'node:fs';
import path from 'node:path';

const CHECKOUT = process.env.DC_CHECKOUT || '/work/checkouts/40kdc-data';
const OUT = process.env.DC_OUT || '/work/work/dc.json';
const root = [CHECKOUT].find((p) => fs.existsSync(path.join(p, 'data/core')));
if (!root) { console.error('no 40kdc checkout at', CHECKOUT); process.exit(2); }
const core = path.join(root, 'data/core');
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const opt = (p) => (fs.existsSync(p) ? rd(p) : []);

let sha = process.env.DC_SHA || null;
try { if (!sha) sha = fs.readFileSync(path.join(root, '.sha'), 'utf8').trim(); } catch (_) {}
try {
  const head = fs.readFileSync(path.join(root, '.git/HEAD'), 'utf8').trim();
  if (!sha) sha = head.startsWith('ref:')
    ? fs.readFileSync(path.join(root, '.git', head.slice(5).trim()), 'utf8').trim() : head;
} catch (_) { /* no .git visible; sources.json pin is authoritative */ }

const factionDirs = fs.readdirSync(core, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(core, d.name, 'units.json')))
  .map((d) => d.name).sort();

const files = ['units', 'weapons', 'wargear', 'wargear-options', 'unit-compositions', 'detachments',
  'enhancements', 'stratagems', 'leader-attachments', 'factions'];
const byDir = {};
for (const dir of factionDirs) {
  byDir[dir] = {};
  for (const f of files) byDir[dir][f] = opt(path.join(core, dir, f + '.json'));
}
const allyRules = opt(path.join(core, 'allies.json'));
const dispositions = opt(path.join(core, 'force-dispositions.json'));
const coreStrats = opt(path.join(core, 'stratagems.json'));
const gameModes = opt(path.join(core, 'game-modes.json'));

// Name index: faction-scoped first, then global (adapter's lookupIn).
const nameIdx = { weapons: new Map(), wargear: new Map() };
for (const dir of factionDirs) for (const k of ['weapons', 'wargear']) {
  for (const r of byDir[dir][k]) {
    nameIdx[k].set(dir + '::' + r.id, r.name);
    if (!nameIdx[k].has('*::' + r.id)) nameIdx[k].set('*::' + r.id, r.name);
  }
}
const itemName = (fid, id) => nameIdx.weapons.get(fid + '::' + id) || nameIdx.wargear.get(fid + '::' + id)
  || nameIdx.weapons.get('*::' + id) || nameIdx.wargear.get('*::' + id) || null;

// Unit lookup across all dirs (allied pools cross factions)
const allUnits = [];
for (const dir of factionDirs) for (const u of byDir[dir].units) allUnits.push(u);
const kwSet = (u) => new Set([...(u.keywords || []), ...(u.faction_keywords || [])].map((k) => k.toLowerCase()));

const factionKeywords = {};
for (const dir of factionDirs) {
  const fr = byDir[dir].factions.find((f) => f.id === dir) || byDir[dir].factions[0];
  factionKeywords[dir] = (fr && fr.keywords) || [];
}

function alliesFor(dir, detIds) {
  const fk = new Set(factionKeywords[dir].map((k) => k.toLowerCase()));
  const ds = new Set(detIds);
  return allyRules.filter((r) => {
    const a = !(r.army_keywords_any || []).length || r.army_keywords_any.some((k) => fk.has(k.toLowerCase()));
    const d = !(r.detachment_ids || []).length || r.detachment_ids.some((i) => ds.has(i));
    return a && d;
  });
}
function allyUnitsFor(rule) {
  const base = rule.source_faction_id
    ? allUnits.filter((u) => u.faction_id === rule.source_faction_id) : allUnits;
  const sk = (rule.source_keywords || []).map((k) => k.toLowerCase());
  const rq = (rule.required_keywords || []).map((k) => k.toLowerCase());
  const ex = (rule.excluded_keywords || []).map((k) => k.toLowerCase());
  const roles = new Set(rule.roles || []);
  const ids = new Set(rule.source_datasheet_ids || []);
  return base.filter((u) => {
    const h = kwSet(u);
    if (ids.size && !ids.has(u.id)) return false;
    if (sk.length && !sk.some((k) => h.has(k))) return false;
    if (rq.length && !rq.every((k) => h.has(k))) return false;
    if (ex.some((k) => h.has(k))) return false;
    if (roles.size && !(u.role && roles.has(u.role))) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const out = { sha, factions: {}, forceDispositions: dispositions, gameModes, coreStratagems: coreStrats, allianceRules: allyRules };
let nUnits = 0, nOpts = 0, nDet = 0, nAllied = 0, nComp = 0;
for (const dir of factionDirs) {
  const d = byDir[dir];
  const opts = new Map(); const comps = new Map();
  // options/compositions are keyed (faction_id, unit_id) and may live in another dir's file
  for (const dd of factionDirs) {
    for (const o of byDir[dd]['wargear-options']) if (o.faction_id === dir) {
      const k = o.unit_id; if (!opts.has(k)) opts.set(k, new Map()); opts.get(k).set(o.id, o);
    }
    for (const c of byDir[dd]['unit-compositions']) if (c.faction_id === dir && !comps.has(c.unit_id)) comps.set(c.unit_id, c);
  }
  const units = {};
  for (const u of d.units) {
    const wo = [...(opts.get(u.id)?.values() || [])];
    const comp = comps.get(u.id) || null;
    const ids = new Set();
    (u.weapon_ids || []).forEach((i) => ids.add(i));
    (u.wargear_costs || []).forEach((c) => ids.add(c.item_id));
    (u.wargear_budgets || []).forEach((b) => (b.items || []).forEach((i) => ids.add(i)));
    wo.forEach((o) => { (o.replaces || []).forEach((i) => ids.add(i)); (o.replacement || []).forEach((i) => ids.add(i));
      (o.replacement_choice || []).forEach((g) => (g || []).forEach((i) => ids.add(i))); });
    (comp?.models || []).forEach((m) => (m.default_weapon_ids || []).forEach((i) => ids.add(i)));
    const itemNames = {};
    for (const i of ids) { const n = itemName(dir, i); if (n) itemNames[i] = n; }
    units[u.id] = {
      id: u.id, name: u.name, faction_id: u.faction_id, role: u.role ?? null, is_legend: !!u.is_legend,
      keywords: u.keywords || [], faction_keywords: u.faction_keywords || [],
      model_count: u.model_count || null, points: u.points || [], points_provisional: !!u.points_provisional,
      allied_points: u.allied_points || null, game_modes: u.game_modes || null,
      attachment_role: u.attachment_role ?? null, aliases: u.aliases || null,
      weapon_ids: u.weapon_ids || [], ability_ids: u.ability_ids || [],
      wargear_options: wo, wargear_budgets: u.wargear_budgets || [], wargear_costs: u.wargear_costs || [],
      composition: comp, itemNames,
    };
    nUnits++; nOpts += wo.length; if (comp) nComp++;
  }
  const detachments = {};
  for (const x of d.detachments) {
    detachments[x.id] = { name: x.name, detachment_rule_id: x.detachment_rule_id ?? null,
      stratagem_ids: x.stratagem_ids || [], enhancement_ids: x.enhancement_ids || [],
      game_modes: x.game_modes || null, force_dispositions: x.force_dispositions || [],
      detachment_points: x.detachment_points ?? null };
    nDet++;
  }
  const stratagems = {}; for (const s of d.stratagems) stratagems[s.id] = { name: s.name, detachment_id: s.detachment_id ?? null,
    category: s.category, type: s.type ?? null, cp_cost: s.cp_cost, phases: s.phases, player_turn: s.player_turn, timing: s.timing };
  const enhancements = {}; for (const e of d.enhancements) enhancements[e.id] = { name: e.name, detachment_id: e.detachment_id, cost: e.cost,
    keyword_restrictions: e.keyword_restrictions || [], is_unique: !!e.is_unique };
  const rules = alliesFor(dir, Object.keys(detachments)).map((r) => ({ ...r, pool: allyUnitsFor(r).map((u) => ({ faction_id: u.faction_id, id: u.id, name: u.name })) }));
  nAllied += rules.length;
  const fr = d.factions[0] || {};
  out.factions[dir] = { id: dir, name: fr.name || dir, keywords: factionKeywords[dir], parent_faction_id: fr.parent_faction_id ?? null,
    faction_rule_ids: fr.faction_rule_ids || [], units, detachments, stratagems, enhancements,
    leaderAttachments: d['leader-attachments'], alliedRules: rules, forceDispositions: dispositions };
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`dc.json: sha=${sha} factions=${factionDirs.length} units=${nUnits} wargearOptions=${nOpts} compositions=${nComp} detachments=${nDet} alliedRuleApplications=${nAllied} -> ${OUT}`);
