import fs from 'fs';
globalThis.window = {};
await import('./js/vendor/dc-bundle.js');
await import('./js/gdc.js');
const DC = window.DC;
const App = window.App;
const textFor = id => { const e=id&&DC.abilityText[id]; return e?(e.raw_text||e.effect||''):''; };

// FACTION_NAME map from adapter source
const src = fs.readFileSync('./js/data/dc-adapter.js','utf8');
const mapBlock = src.slice(src.indexOf('const FACTION_NAME = {'), src.indexOf('};', src.indexOf('const FACTION_NAME = {')));
const FACTION_NAME = {};
for (const m of mapBlock.matchAll(/'([a-z0-9\-]+)':\s*'([^']+)'/g)) FACTION_NAME[m[1]] = m[2];
const SM_PARENT_ID = 'adeptus-astartes';
const SM_CHAPTER = new Set(Object.keys(FACTION_NAME).filter(id => id!==SM_PARENT_ID && /^Imperium - Adeptus Astartes - /.test(FACTION_NAME[id])));

// Fetch every GDC file referenced by FACTION_TO_GDC (+ space_marines)
const files = new Set(['space_marines']);
Object.values(App.GDC.FACTION_TO_GDC).forEach(v => (Array.isArray(v)?v:[v]).forEach(f=>f&&files.add(f)));
for (const fn of files) {
  try {
    const r = await fetch('https://raw.githubusercontent.com/game-datacards/datasources/main/11th/gdc/'+fn+'.json');
    if (r.ok) App.GDC._rawCache.set('11th/'+fn, await r.json());
    else console.error('fetch fail', fn, r.status);
  } catch(e){ console.error('fetch err', fn, e.message); }
}

// strat/enh indexes from DC
const stratsByDet = new Map(), enhByDet = new Map();
(DC.stratagems.all||[]).map(s=>s.raw||s).forEach(s=>{ if(!s.detachment_id)return; (stratsByDet.get(s.detachment_id)||stratsByDet.set(s.detachment_id,[]).get(s.detachment_id)).push(s); });
(DC.enhancements.all||[]).map(e=>e.raw||e).forEach(e=>{ if(!e.detachment_id)return; (enhByDet.get(e.detachment_id)||enhByDet.set(e.detachment_id,[]).get(e.detachment_id)).push(e); });

// SM parent rule borrow map (foldName ≈ nameKey)
const nameKey = App.GDC._nameKey;
const smParentRule = new Map();
DC.detachments.byFaction(SM_PARENT_ID).map(d=>d.raw||d).forEach(d=>{
  if (d.detachment_rule_id && textFor(d.detachment_rule_id)) smParentRule.set(nameKey(d.name), textFor(d.detachment_rule_id));
});

// Build faction shells exactly shaped for mergeIntoFactions
const factions = [];
for (const fv of DC.factions.all){
  const f = fv.raw||fv;
  const factionName = FACTION_NAME[f.id];
  if (!factionName) continue;
  const dets = [];
  DC.detachments.byFaction(f.id).map(d=>d.raw||d).forEach(d=>{
    if (Array.isArray(d.game_modes) && d.game_modes.includes('combat-patrol')) return;
    let ruleText = d.detachment_rule_id ? textFor(d.detachment_rule_id) : '';
    if (!ruleText && SM_CHAPTER.has(f.id)) ruleText = smParentRule.get(nameKey(d.name)) || '';
    dets.push({
      name: d.name,
      _cp: false,
      rules: ruleText ? [{ name: d.name, description: ruleText }] : [],
      enhancements: (enhByDet.get(d.id)||[]).map(e=>({ name: e.name, description: textFor(e.ability_id) || '' })),
      stratagems: (stratsByDet.get(d.id)||[]).map(s=>({ name: s.name, description: textFor(s.ability_id) || '' })),
    });
  });
  factions.push({ factionName, armyRules: [], detachments: dets });
}

App.GDC.mergeIntoFactions(factions);

// Final audit
let clean=0, total=0;
const issues=[];
factions.forEach(fac=>{
  fac.detachments.forEach(d=>{
    total++;
    const probs=[];
    if (!(d.rules||[]).some(r=>r && r.description)) probs.push('rule text MISSING');
    const stratNames = new Map();
    (d.stratagems||[]).forEach(s=>stratNames.set(s.name.toLowerCase(), s.description||''));
    (d.gdcStratagems||[]).forEach(s=>{ const k=s.name.toLowerCase(); if(!stratNames.get(k)) stratNames.set(k, s.description||''); });
    const sTotal = stratNames.size;
    const sMissing = [...stratNames.values()].filter(v=>!v).length;
    if (sTotal===0) probs.push('0 stratagems');
    else if (sMissing) probs.push(`${sMissing}/${sTotal} strats no text`);
    const eTotal = (d.enhancements||[]).length;
    const eMissing = (d.enhancements||[]).filter(e=>!e.description).length;
    if (eTotal===0) probs.push('0 enhancements');
    else if (eMissing) probs.push(`${eMissing}/${eTotal} enh no text`);
    if (probs.length) issues.push(`${fac.factionName} :: ${d.name} — ${probs.join('; ')}`);
    else clean++;
  });
});
console.log(`FINAL (post-GDC): ${total} matched-play detachments, ${clean} fully covered, ${issues.length} with gaps:\n`);
issues.forEach(x=>console.log(' -', x));
