// node --test pipeline/tests/*.test.mjs  (a bare directory arg fails on node 22) (docker: see docs/DATASET.md §wargearProfile)
// Contract: docs/WARGEAR-RULES.md §1-2. Fixtures (tests/fixtures/wargear-sheets.json)
// are the raw GDC wargearOptions groups + parser ctx of real datasheets, frozen
// from work/gdc.json on 2026-11-03; the expectations below were reviewed by hand
// against each sheet's printed wargear text.
//
// Compact rule form: "n ; kind ; model ; scope ; n ; max ; replaces ; choices ;
// requires ; locks ; exclusiveWith ; condition" ('-' = null, '+' = AND bundle,
// ' | ' = OR of bundles, 'xN' = item count).
//
// Plague Marines, what the picker derives from these rules (§3):
//  - 10 models (1 Champion + 9 Plague Marines): per_n caps are floor(10/5)*max →
//    blight launcher 2, plague spewer 2, {meltagun|belcher|plasma gun} 2 total,
//    bubotic weapons 4, heavy plague weapon 4; icon of despair 1 (needs and locks a
//    boltgun); Champion rules 1 each ("The <M>" = every model of that type, max null).
//    All Plague Marine boltgun swaps + the icon together <= 9 carriers of a boltgun.
//  - 5 models (1 + 4): every per-5 cap is 1, the "up to 2 per 5" ones 2; still <= 4
//    boltgun carriers among the Plague Marines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWargearGroups, parseWargearRules, parseLoadout, compositionModelNames, compositionCounts, ctxFromUnit, wkey } from '../wargear-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'wargear-sheets.json'), 'utf8'));
const it = (a) => a.map((i) => i.name + (i.count ? 'x' + i.count : '')).join('+');
const compact = (x) => [x.id.replace(/.*-wr-/, ''), x.kind, x.model ?? '-', x.scope, x.n ?? '-', x.max ?? '-', it(x.replaces), x.choices.map(it).join(' | '),
  it(x.requires), it(x.locks), x.exclusiveWith.map((i) => i.replace(/.*-wr-/, '')).sort().join(','), x.condition ? JSON.stringify(x.condition) : ''].join(' ; ');

const EXPECTED = {
  'battle-sisters-squad': [
    "1 ; replace ; Sister Superior ; fixed ; - ; - ; Boltgun ; Bolt pistol | Combi-weapon | Condemnor boltgun | Inferno pistol | Ministorum hand flamer | Plasma pistol ;  ;  ;  ; ",
    "2 ; add ; Sister Superior ; fixed ; - ; - ;  ; Chainsword | Power weapon ;  ;  ;  ; ",
    "3 ; replace ; Battle Sister ; fixed ; - ; 1 ; Boltgun ; Artificer-crafted storm bolter | Meltagun | Ministorum flamer ;  ;  ;  ; ",
    "4 ; add ; Battle Sister ; fixed ; - ; 1 ;  ; Simulacrum Imperialis ; Boltgun ; Boltgun ;  ; ",
  ],
  'troupe': [
    "1 ; replace ; - ; any ; - ; - ; Harlequin’s blade ; Harlequin’s special weapon ;  ;  ;  ; ",
    "2 ; replace ; Lead Player ; fixed ; - ; - ; Harlequin’s blade ; Power sword ;  ;  ;  ; ",
    "3.1.1 ; replace ; - ; fixed ; - ; 2 ; Shuriken pistol ; Neuro disruptor ;  ;  ;  ; {\"maxModels\":9}",
    "3.1.2 ; replace ; - ; fixed ; - ; 2 ; Shuriken pistol ; Fusion pistol ;  ;  ;  ; {\"maxModels\":9}",
    "3.2.1 ; replace ; - ; fixed ; - ; 4 ; Shuriken pistol ; Neuro disruptor ;  ;  ;  ; {\"minModels\":10}",
    "3.2.2 ; replace ; - ; fixed ; - ; 4 ; Shuriken pistol ; Fusion pistol ;  ;  ;  ; {\"minModels\":10}",
  ],
  'exaction-squad': [
    "1 ; add ; Proctor-Exactant ; fixed ; - ; - ;  ; Nuncio aquila ;  ;  ;  ; ",
    "2 ; replace ; Exaction Vigilant ; fixed ; - ; 2 ; Arbites combat shotgun ; Executioner shotgun | Arbites grenade launcher | Heavy stubber | Webber ;  ;  ;  ; ",
    "3 ; add ; Exaction Vigilant ; fixed ; - ; 1 ;  ; Excruciator maul ; Arbites combat shotgun ; Arbites combat shotgun ;  ; ",
    "4 ; add ; Exaction Vigilant ; fixed ; - ; 1 ;  ; Arbites Medi-kit ; Arbites combat shotgun ; Arbites combat shotgun ;  ; ",
    "5 ; add ; Exaction Vigilant ; fixed ; - ; 1 ;  ; Soulguilt Scanner ; Arbites combat shotgun ; Arbites combat shotgun ;  ; ",
  ],
  'grey-knights-terminator-squad': [
    "1 ; replace ; Grey Knights Terminators ; fixed ; - ; 1 ; Storm Bolter ; Incinerator | Psilencer | Psycannon ;  ;  ; 3 ; ",
    "2 ; add ; Grey Knights Terminators ; fixed ; - ; 1 ;  ; Ancient’s Banner ; Storm Bolter ;  ; 3 ; ",
    "3 ; replace ; Grey Knights Terminators ; fixed ; - ; 1 ; Storm Bolter ; Narthecium ;  ;  ; 1,2 ; ",
  ],
  'imperial-navy-breachers': [
    "1 ; replace ; Navis Sergeant-at-Arms ; fixed ; - ; - ; Navis shotgun ; Autopistol+Chainsword | Bolt pistol+Power weapon ;  ;  ;  ; ",
    "2 ; replace ; Navis Armsman ; fixed ; - ; 1 ; Navis las-volley ; Meltagun | Plasma gun ;  ;  ;  ; ",
    "3 ; replace ; Navis Armsman ; fixed ; - ; 1 ; Navis shotgun ; Autopistol+Power weapon ;  ;  ;  ; ",
    "4 ; replace ; Navis Armsman ; fixed ; - ; 1 ; Navis shotgun ; Autopistol+Chainfist ;  ;  ;  ; ",
    "5 ; add ; Navis Armsman ; fixed ; - ; 1 ;  ; Demolition charge ;  ;  ;  ; ",
  ],
  'inquisitorial-agents': [
    "1 ; add ; Inquisitorial Agent ; per_n ; 5 ; 1 ;  ; Plasma pistol ;  ;  ; 2,4 ; ",
    "2 ; add ; Inquisitorial Agent ; per_n ; 5 ; 1 ;  ; Eviscerator ;  ;  ; 1,4 ; ",
    "3 ; replace ; Gun Servitor ; any ; - ; - ; Heavy bolter ; Multi-melta | Plasma cannon ;  ;  ;  ; ",
    "4 ; add ; Inquisitorial Agent ; per_n ; 5 ; 1 ;  ; Mystic stave ;  ;  ; 1,2 ; ",
    "5 ; add ; - ; per_n ; 5 ; 1 ;  ; Tome‐skull ;  ;  ;  ; ",
  ],
  'catachan-command-squad': [
    "1 ; replace ; Veteran Guardsman ; any ; - ; - ; Lasgun ; Flamer | Grenade launcher | Heavy flamer | Meltagun | Plasma gun | Sniper rifle ;  ;  ;  ; ",
    "2 ; add ; Veteran Guardsman ; fixed ; - ; 1 ;  ; Master Vox ; Lasgun ;  ; 3,4 ; ",
    "3 ; add ; Veteran Guardsman ; fixed ; - ; 1 ;  ; Medi-pack ; Lasgun ;  ; 2,4 ; ",
    "4 ; add ; Veteran Guardsman ; fixed ; - ; 1 ;  ; Regimental Standard ; Lasgun ;  ; 2,3 ; ",
    "5 ; replace ; Catachan Commander ; fixed ; - ; - ; Laspistol ; Bolt pistol | Plasma pistol ;  ;  ;  ; ",
    "6 ; add ; Catachan Commander ; fixed ; - ; - ;  ; Boltgun | Chainsword | Power fist | Power weapon ;  ;  ;  ; ",
  ],
  'death-korps-of-krieg': [
    "1 ; replace ; Death Korps Watchmaster ; any ; - ; - ; Laspistol+Chainsword ; Boltgun+Close combat weapon ;  ;  ;  ; ",
    "2 ; replace ; Death Korps Watchmaster ; any ; - ; - ; Chainsword ; Power weapon ;  ;  ;  ; ",
    "3 ; replace ; Death Korps Watchmaster ; any ; - ; - ; Laspistol ; Bolt pistol | Plasma pistol ;  ;  ;  ; ",
    "4 ; replace ; Death Korps Trooper ; per_n ; 10 ; 2 ; Lasgun ; Flamer | Grenade launcher | Long-las | Meltagun | Plasma gun ;  ;  ;  ; ",
    "5 ; add ; Death Korps Trooper ; per_n ; 10 ; 1 ;  ; Death Korps Medi-pack ; Lasgun ; Lasgun ; 6 ; ",
    "6 ; add ; Death Korps Trooper ; per_n ; 10 ; 1 ;  ; Vox-caster ; Lasgun ; Lasgun ; 5 ; ",
  ],
  'leman-russ-battle-tank': [
    "1 ; replace ; - ; fixed ; - ; 1 ; Lascannon ; Heavy bolter | Heavy flamer ;  ;  ;  ; ",
    "2 ; add ; - ; fixed ; - ; 1 ;  ; Heavy bolterx2 | Heavy flamerx2 | Multi-meltax2 | Plasma cannonx2 ;  ;  ;  ; ",
    "3 ; add ; - ; fixed ; - ; 1 ;  ; Heavy stubber | Storm bolter ;  ;  ;  ; ",
    "4 ; add ; - ; fixed ; - ; 1 ;  ; Hunter-killer missile ;  ;  ;  ; ",
  ],
  'raptors': [
    "1 ; replace ; Raptor Champion ; fixed ; - ; - ; Bolt pistol ; Plasma pistol ;  ;  ;  ; ",
    "2 ; replace ; Raptor Champion ; fixed ; - ; - ; Astartes chainsword ; Accursed weapon | Heavy melee weapon ;  ;  ;  ; ",
    "3 ; replace ; Raptor ; per_n ; 5 ; 2 ; Bolt pistol ; Plasma pistol ;  ; Astartes chainsword ;  ; ",
    "4 ; replace ; Raptor ; per_n ; 5 ; 2 ; Astartes chainsword ; Heavy melee weapon ;  ;  ;  ; ",
    "5 ; replace ; Raptor ; per_n ; 5 ; 1 ; Astartes chainsword ; Mutations ;  ;  ;  ; ",
    "6 ; replace ; Raptor ; fixed ; - ; 2 ; Astartes chainsword ; Flamer+Close Combat Weapon | Meltagun+Close Combat Weapon | Plasma gun+Close Combat Weapon ;  ;  ;  ; ",
    "7 ; replace ; Raptor ; fixed ; - ; 2 ; Astartes chainsword ; Flamer+Close Combat Weapon | Meltagun+Close Combat Weapon | Plasma gun+Close Combat Weapon ;  ;  ;  ; {\"minModels\":10,\"maxModels\":10}",
  ],
  'plague-marines': [
    "1 ; replace ; Plague Champion ; fixed ; - ; - ; Boltgun ; Bolt pistol | Plasma gun | Plasma pistol ;  ;  ;  ; ",
    "2 ; replace ; Plague Champion ; fixed ; - ; - ; Plague knives ; Bubotic weapons | Power fist ;  ;  ;  ; ",
    "3 ; replace ; Plague Marine ; per_n ; 5 ; 1 ; Boltgun ; Blight launcher ;  ;  ;  ; ",
    "4 ; replace ; Plague Marine ; per_n ; 5 ; 1 ; Boltgun ; Plague spewer ;  ;  ;  ; ",
    "5 ; replace ; Plague Marine ; per_n ; 5 ; 1 ; Boltgun ; Meltagun | Plague belcher | Plasma gun ;  ;  ;  ; ",
    "6 ; replace ; Plague Marine ; per_n ; 5 ; 2 ; Boltgun ; Bubotic weapons ;  ;  ;  ; ",
    "7 ; replace ; Plague Marine ; per_n ; 5 ; 2 ; Boltgun ; Heavy plague weapon ;  ;  ;  ; ",
    "8 ; add ; Plague Marine ; fixed ; - ; 1 ;  ; Icon of Despair ; Boltgun ; Boltgun ;  ; ",
  ],
  'deathwatch-veterans': [
    "1 ; replace ; Watch Sergeant ; fixed ; - ; - ; Boltgun ; Combi-weapon ;  ;  ;  ; ",
    "2 ; replace ; Watch Sergeant ; fixed ; - ; - ; Power Weapon ; Xenophase Blade ;  ;  ;  ; ",
    "3 ; replace ; Deathwatch Veterans ; per_n ; 5 ; 1 ; Boltgun+Power Weapon ; Stalker-pattern Boltgun+Knives and Fists ;  ;  ;  ; ",
    "4 ; replace ; Deathwatch Veterans ; per_n ; 5 ; 1 ; Boltgun+Power Weapon ; Infernus Heavy Bolter+Knives and Fists ;  ;  ;  ; ",
    "5 ; replace ; Deathwatch Veterans ; per_n ; 5 ; 2 ; Boltgun+Power Weapon ; Deathwatch Shotgun+Knives and Fists ;  ;  ;  ; ",
    "6 ; replace ; Deathwatch Veterans ; per_n ; 5 ; 2 ; Boltgun+Power Weapon ; Heavy Thunder Hammer ;  ;  ;  ; ",
    "7 ; replace ; Deathwatch Veterans ; per_n ; 5 ; 1 ; Boltgun+Power Weapon ; Frag Cannon+Knives and Fists ;  ;  ;  ; ",
    "8 ; replace ; Deathwatch Veterans ; fixed ; - ; 1 ; Boltgun+Power Weapon ; Black Shield Blades ;  ;  ;  ; ",
    "9 ; replace ; Deathwatch Veterans ; per_n ; 5 ; 2 ; Boltgun+Power Weapon ; Boltgun+Storm Shield | Power Weapon+Storm Shield ;  ;  ;  ; ",
  ],
  'kabalite-warriors': [
    "1 ; replace ; Sybarite ; fixed ; - ; - ; Close combat weapon ; Power weapon ;  ;  ;  ; ",
    "2 ; add ; Sybarite ; fixed ; - ; - ;  ; Kabalite Icon | Phantasm Grenade Launcher ;  ;  ;  ; ",
    "3 ; replace ; Sybarite ; fixed ; - ; - ; Splinter rifle ; Blast pistol | Splinter pistol ;  ;  ;  ; ",
    "4 ; replace ; Kabalite Warrior ; fixed ; - ; 1 ; Splinter rifle ; Blaster ;  ;  ;  ; ",
    "5 ; replace ; Kabalite Warrior ; fixed ; - ; 1 ; Splinter rifle ; Dark lance ;  ;  ;  ; ",
    "6 ; replace ; Kabalite Warrior ; fixed ; - ; 1 ; Splinter rifle ; Shredder ;  ;  ;  ; ",
    "7 ; replace ; Kabalite Warrior ; fixed ; - ; 1 ; Splinter rifle ; Splinter cannon ;  ;  ;  ; ",
  ],
  'immortals': [
    "1 ; replace ; - ; any ; - ; - ; Gauss blaster ; Tesla carbine ;  ;  ;  ; ",
  ],
  'necron-warriors': [
    "1 ; replace ; - ; any ; - ; - ; Gauss flayer ; Gauss reaper ;  ;  ;  ; ",
  ],
  'boyz': [
    "1 ; replace ; Boss Nob ; any ; - ; - ; Kustom Choppa+Kombi-skorcha ; Big Choppa ;  ;  ;  ; ",
    "2 ; replace ; Boss Nob ; any ; - ; - ; Kustom Choppa ; Power Klaw ;  ;  ;  ; ",
    "3 ; replace ; Boss Nob ; any ; - ; - ; Kombi-skorcha ; Kombi-rokkit | Kustom Shoota ;  ;  ;  ; ",
    "4 ; replace ; Boy ; per_n ; 10 ; 1 ; Shoota ; Big Shoota ;  ;  ;  ; ",
    "5 ; replace ; Boy ; per_n ; 10 ; 1 ; Shoota ; Rokkit Launcha ;  ;  ;  ; ",
    "6 ; replace ; Boy ; per_n ; 10 ; 1 ; Shoota ; Burna ;  ;  ;  ; ",
  ],
  'intercessor-squad': [
    "1 ; replace ; Intercessor Sergeant ; fixed ; - ; - ; Knives and Fists ; Chainsword | Power Fist | Power Weapon | Thunder Hammer ;  ;  ;  ; ",
    "2 ; replace ; Intercessor Sergeant ; fixed ; - ; - ; Bolt Rifle ; Chainsword | Hand Flamer | Plasma Pistol | Power Weapon ;  ;  ;  ; ",
    "3 ; add ; Intercessor ; per_n ; 5 ; 1 ;  ; Grenade Launcher ;  ;  ;  ; ",
  ],
  'terminator-squad': [
    "1 ; replace ; Terminator Sergeant ; fixed ; - ; - ; Power Fist ; Chainfist | Power Weapon ;  ;  ;  ; ",
    "2 ; replace ; Terminator ; any ; - ; - ; Power Fist ; Chainfist ;  ;  ;  ; ",
    "3 ; replace ; Terminator ; per_n ; 5 ; 1 ; Storm Bolter ; Assault Cannon | Heavy Flamer | Cyclone Missile Launcher+Storm Bolter ;  ; Storm Bolter ;  ; ",
  ],
  'strike-team': [
    "1 ; add ; Fire Warrior Shas’ui ; fixed ; - ; - ;  ; Guardian Drone | Gun Drone | Marker Drone | Shield Drone ;  ;  ;  ; ",
    "2 ; replace ; Fire Warrior ; any ; - ; - ; Pulse rifle ; Pulse carbine ;  ;  ;  ; ",
  ],
  'hernkyn-pioneers': [
    "1 ; add ; - ; per_n ; 3 ; 1 ;  ; HYLas rotary cannon | Ion beamer ;  ;  ; 2.1,2.2,2.3 ; ",
    "2.1 ; add ; - ; fixed ; - ; 1 ;  ; Multiwave Comms Array ;  ;  ; 1,2.2,2.3 ; ",
    "2.2 ; add ; - ; fixed ; - ; 1 ;  ; Panspectral Scanner ;  ;  ; 1,2.1,2.3 ; ",
    "2.3 ; add ; - ; fixed ; - ; 1 ;  ; Rollbar Searchlight ;  ;  ; 1,2.1,2.2 ; ",
  ],
};

for (const [slug, want] of Object.entries(EXPECTED)) {
  test(`groups → rules: ${slug}`, () => {
    const fx = FX[slug]; assert.ok(fx, `fixture ${slug}`);
    const r = parseWargearGroups(fx.groups, fx.ctx);
    assert.deepEqual(r.unparsed, []);
    assert.equal(r.groupsParsed, r.groups);
    assert.deepEqual(r.rules.map(compact), want);
    for (const x of r.rules) {
      assert.match(x.id, new RegExp(`^${fx.ctx.unitId}-wr-\\d+(\\.\\d+)*$`));
      assert.equal(typeof x.text, 'string');
      for (const k of ['kind', 'model', 'scope', 'n', 'max', 'replaces', 'choices', 'requires', 'locks', 'exclusiveWith', 'condition']) assert.ok(k in x, `${x.id} has ${k}`);
    }
  });
}

test('rule ids are unique and exclusiveWith is symmetric', () => {
  for (const [slug, fx] of Object.entries(FX)) {
    const { rules } = parseWargearGroups(fx.groups, fx.ctx);
    const ids = new Set(rules.map((r) => r.id)); assert.equal(ids.size, rules.length, slug);
    const by = new Map(rules.map((r) => [r.id, r]));
    for (const r of rules) for (const o of r.exclusiveWith) assert.ok(by.get(o) && by.get(o).exclusiveWith.includes(r.id), `${slug} ${r.id}↔${o}`);
  }
});

test('Plague Marines: canonical names and the Icon of Despair lock', () => {
  const { rules, defaultsByBlock } = parseWargearGroups(FX['plague-marines'].groups, FX['plague-marines'].ctx);
  const icon = rules.find((r) => r.choices[0][0].name === 'Icon of Despair');
  assert.equal(icon.id, 'plague-marines-wr-8');
  assert.equal(icon.text, 'One Plague Marine equipped with a boltgun can be equipped with 1 icon of despair. This model’s boltgun cannot be replaced.');
  assert.deepEqual(icon.requires.map((x) => x.name), ['Boltgun']);
  assert.deepEqual(icon.locks.map((x) => x.name), ['Boltgun']);
  assert.deepEqual(defaultsByBlock, [['Boltgun', 'Plague knives'], ['Boltgun', 'Plague knives']]);
});

test('Plague Marines: the prose fallback yields the same rule set', () => {
  const fx = FX['plague-marines'];
  const a = parseWargearGroups(fx.groups, fx.ctx).rules.map((r) => compact(r).replace(/^[\d.]+ ; /, '')).sort();
  const b = parseWargearRules(fx.prose, fx.ctx);
  assert.deepEqual(b.unparsed, []);
  assert.deepEqual(b.rules.map((r) => compact(r).replace(/^[\d.]+ ; /, '')).sort(), a);
});

test('resolveItem supplies ids; unmatched names are still emitted', () => {
  const ctx = { ...FX['plague-marines'].ctx, resolveItem: (n) => (n === 'Boltgun' ? 'boltgun' : null) };
  const { rules, unmatchedItems } = parseWargearRules(['For every 5 models in this unit, 1 Plague Marine’s boltgun can be replaced with 1 doom hammer.'], ctx);
  assert.equal(rules[0].replaces[0].id, 'boltgun');
  assert.deepEqual(rules[0].choices, [[{ id: 'doom-hammer', name: 'Doom hammer' }]]);
  assert.deepEqual(unmatchedItems, ['Doom hammer']);
});

// ── phrasings (prose path), one small sheet ctx each ──
const C = (models, items, single = false) => ({ unitId: 'u', modelNames: models, itemNames: items, singleModel: single });
const one = (line, ctx) => { const r = parseWargearRules([line], ctx); assert.deepEqual(r.unparsed, [], line); return r.rules[0]; };

test('single-model unit: This model / up to N / picks', () => {
  const ctx = C(['Wave Serpent'], ['Twin shuriken catapult', 'Shuriken cannon', 'Seeker missile', 'Gun drone', 'Marker drone'], true);
  let r = one('This model’s twin shuriken catapult can be replaced with 1 shuriken cannon.', ctx);
  assert.equal(compact(r), '1 ; replace ; - ; fixed ; - ; 1 ; Twin shuriken catapult ; Shuriken cannon ;  ;  ;  ; ');
  r = one('This model can be equipped with up to 2 seeker missiles.', ctx);
  assert.equal(r.max, 2); assert.equal(r.kind, 'add');
  r = one('This model can be equipped with up to two of the following, but cannot take duplicates: ◦ 1 gun drone ◦ 1 marker drone', ctx);
  assert.equal(r.picks, 2); assert.equal(r.distinct, true); assert.equal(r.max, 1);
  r = one('Each of this model’s shuriken catapults can be replaced with 1 flamer.', ctx);
  assert.equal(r.scope, 'any');
});

test('conditions: unit size and equipped-with', () => {
  const ctx = C(['Corsair Voidscarred', 'Voidscarred Felarch'], ['Shuriken rifle', 'Long rifle', 'Plasma pistol', 'Power weapon', 'Rod of office']);
  let r = one('If this unit contains 10 models, 1 Corsair Voidscarred’s shuriken rifle can be replaced with 1 long rifle.', ctx);
  assert.deepEqual(r.condition, { minModels: 10, maxModels: 10 }); assert.equal(r.model, 'Corsair Voidscarred');
  const s = parseWargearRules(['If this unit contains 10 or more models: ◦ Up to four models can each have their shuriken rifle replaced with 1 long rifle'], ctx);
  assert.deepEqual(s.rules[0].condition, { minModels: 10 }); assert.equal(s.rules[0].id, 'u-wr-1.1'); assert.equal(s.rules[0].max, 4);
  r = one('If this model is equipped with a plasma pistol and a power weapon, it can be equipped with: ◦ 1 rod of office', C(['Canoness'], ['Plasma pistol', 'Power weapon', 'Rod of office'], true));
  assert.deepEqual(r.requires.map((x) => x.name), ['Plasma pistol', 'Power weapon']);
});

test('bundles, counts and AND replaces', () => {
  const ctx = C(['Navis Armsman'], ['Navis shotgun', 'Autopistol', 'Chainfist', 'Knives and Fists', 'Boltgun', 'Power Weapon', 'Storm Shield']);
  let r = one('1 Navis Armsman’s Navis shotgun can be replaced with 1 autopistol and 1 chainfist.', ctx);
  assert.deepEqual(r.choices.map(it), ['Autopistol+Chainfist']);
  r = one('Any number of models can each have their Boltgun and Power Weapon replaced with one of the following: 1 Boltgun and 1 Storm Shield, 1 Power Weapon and 1 Storm Shield', ctx);
  assert.deepEqual(r.replaces.map((x) => x.name), ['Boltgun', 'Power Weapon']);
  assert.deepEqual(r.choices.map(it), ['Boltgun+Storm Shield', 'Power Weapon+Storm Shield']);
  r = one('Any number of models can each have their Knives and Fists replaced with 1 Chainfist.', ctx);
  assert.deepEqual(r.replaces.map((x) => x.name), ['Knives and Fists']);
  r = one('This model can be equipped with one of the following: ◦ 2 heavy bolters ◦ 2 lascannons', C(['Predator'], ['Heavy bolter', 'Lascannon'], true));
  assert.deepEqual(r.choices.map(it), ['Heavy bolterx2', 'Lascannonx2']);
});

test('unit-wide choice limits', () => {
  const ctx = C(['Shock Trooper'], ['Lasgun', 'Flamer', 'Meltagun']);
  const r = one('For every 10 models in this unit, up to 2 Shock Troopers can each have their lasgun replaced with one of the following: ◦ 1 flamer ◦ 1 meltagun You cannot select the same weapon more than once per unit unless it contains 20 models, in which case you cannot select the same weapon more than twice per unit.', ctx);
  assert.equal(r.choiceMax, 1); assert.equal(r.choiceMaxN, 10); assert.equal(r.scope, 'per_n'); assert.equal(r.max, 2);
});

test('footnotes: starred exclusivity, standalone lock, un-starred group', () => {
  let r = parseWargearRules(['*You cannot select both of these options for the same model.', '1 Grey Knights Terminator can have its storm bolter replaced with 1 narthecium.*',
    '1 Grey Knights Terminator equipped with a storm bolter can be equipped with 1 Ancient’s banner.*', '1 Grey Knights Terminator’s storm bolter can be replaced with 1 psycannon.'],
  C(['Grey Knights Terminator'], ['Storm bolter', 'Narthecium', 'Ancient’s banner', 'Psycannon']));
  assert.deepEqual(r.rules.map((x) => x.exclusiveWith.length), [1, 1, 0]);
  r = parseWargearRules(['* That model’s Arbites combat shotgun cannot be replaced.', '1 Exaction Vigilant that is equipped with an Arbites combat shotgun can be equipped with 1 excruciator maul.*'],
    C(['Exaction Vigilant'], ['Arbites combat shotgun', 'Excruciator maul']));
  assert.deepEqual(r.rules[0].locks.map((x) => x.name), ['Arbites combat shotgun']);
  r = parseWargearRules(['1 Tzaangor not equipped with a herd banner can be equipped with 1 brayhorn.', '1 Tzaangor not equipped with a brayhorn can be equipped with 1 herd banner.'], C(['Tzaangor'], ['Brayhorn', 'Herd banner']));
  assert.deepEqual(r.rules[0].exclusiveWith, ['u-wr-2']);
  assert.deepEqual(r.rules[0].forbids.map((x) => x.name), ['Herd banner']);
});

test('unrepresentable prose is reported, never guessed', () => {
  const ctx = C(['Hearthkyn Warrior'], ['Autoch-pattern bolter', 'Ion blaster', 'Plasma knife']);
  const r = parseWargearRules(['Up to 2 Hearthkyn Warriors can each have their Autoch‑pattern bolter or ion blaster replaced with 1 plasma knife.', 'This model can be equipped with 1 havoc launcher or can replace 1 combi-bolter with 1 havoc launcher.'], ctx);
  assert.equal(r.rules.length, 0); assert.equal(r.unparsed.length, 2);
});

test('loadout lines and composition names', () => {
  assert.deepEqual(compositionModelNames(['1 Shock Trooper Sergeant and 9 Shock Troopers', 'OR', '• 4-9 Deathwing Terminators models', '1‐2 Gun Servitors*', 'Every model is equipped with: x.']),
    ['Shock Trooper Sergeant', 'Shock Troopers', 'Deathwing Terminators', 'Gun Servitors']);
  const lo = parseLoadout(['Every Nob is equipped with: 1 Kustom Choppa; 1 Kombi-skorcha.', 'Every Boy is equipped with: 1 Choppa; 2 Sluggas.'], C(['Boss Nob', 'Boy', 'Nob'], ['Kustom Choppa', 'Kombi-skorcha', 'Choppa', 'Slugga']));
  assert.deepEqual(lo.byModel, { Nob: [{ name: 'Kustom Choppa', count: 1 }, { name: 'Kombi-skorcha', count: 1 }], Boy: [{ name: 'Choppa', count: 1 }, { name: 'Slugga', count: 2 }] });
  assert.equal(wkey('Atalan Jackals’'), wkey('Atalan Jackal'));
  const ctx = ctxFromUnit({ id: 'boyz', name: 'Boyz', gdcComposition: ['1‑2 Nob models', '9‑18 Boy models'] }, { extraModels: ['Boss Nob', 'Boy'] });
  assert.deepEqual(ctx.modelAliases, { Nob: 'Boss Nob' }); assert.deepEqual(ctx.blockModels, ['Boss Nob', 'Boy']);
});

// issue #130: GDC composition ranges are what sizes are checked against when a
// 40kdc tier is stale (Custodian Wardens: GDC 2-3, 40kdc pre-launch 4-5).
test('compositionCounts: ranges, non-ASCII hyphens, "and" lines, loadout lines skipped', () => {
  assert.deepEqual(compositionCounts(['2‑3 Custodian Warden models', 'Every model is equipped with: 1 Guardian Spear.']),
    [{ name: 'Custodian Warden', min: 2, max: 3 }]);
  assert.deepEqual(compositionCounts(['5‐10 Inquisitorial Agents']), [{ name: 'Inquisitorial Agents', min: 5, max: 10 }]);
  assert.deepEqual(compositionCounts(['1 Shock Trooper Sergeant and 9 Shock Troopers']),
    [{ name: 'Shock Trooper Sergeant', min: 1, max: 1 }, { name: 'Shock Troopers', min: 9, max: 9 }]);
  assert.deepEqual(compositionCounts(['1-2 Neurogaunt Nodebeasts*', '10-20 Neurogaunts']),
    [{ name: 'Neurogaunt Nodebeasts', min: 1, max: 2 }, { name: 'Neurogaunts', min: 10, max: 20 }]);
  assert.deepEqual(compositionCounts(['This unit can contain a maximum of 10 models.']), []);
});
