// Datasheet wargear prose → structured rules (contract: docs/WARGEAR-RULES.md §1-2).
//
// Pure functions, no I/O. build.mjs calls parseWargearRules(unit.gdcWargear, ctx)
// from wargearProfile() and parseLoadout() for the default loadout lines.
//
// One source line is one rule (id `<unit>-wr-<n>`, n = 1-based line index), except
// a compound line ("For every 5 models in this unit: ◦ <clause> ◦ <clause>") whose
// bullets are each a full clause: those become `<unit>-wr-<n>.<k>`. Footnote lines
// ("*You cannot select both…", "* That model's X cannot be replaced.", "The same
// model cannot be equipped with more than one of these wargear options.") are
// consumed as modifiers of other rules, not rules themselves. Anything the
// grammar below does not recognise goes to `unparsed` verbatim — never dropped.
//
// GDC sorts a datasheet's wargear lines alphabetically, so a footnote's position
// says nothing about which rules it governs: an un-starred footnote applies to
// the largest group (≥2) of rules sharing model, kind, scope, n and requires.

const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';
const toNum = (s) => (s == null ? null : /^\d+$/.test(s) ? parseInt(s, 10) : (NUMW[String(s).toLowerCase()] ?? null));
const BULLET = '◦';

// Parsing copy of a line: straight apostrophes, ASCII hyphens, one bullet glyph.
export function normLine(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐‑‒]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s*[◦▫•■]\s*/g, ` ${BULLET} `)
    .replace(/\s+/g, ' ')
    .trim();
}

const kebab = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function singWord(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/men$/.test(w)) return w.slice(0, -3) + 'man';
  if (/(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (/ss$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}
// Plural- and punctuation-tolerant key: "Plague Marines" == "Plague Marine",
// "Atalan Jackals'" == "Atalan Jackal", "hot‐shot" == "hot-shot".
export function wkey(s) {
  return normLine(s).toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map(singWord).join(' ');
}
const baseItemName = (s) => String(s || '').replace(/\s+[–-]\s+.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();

class Unparsed extends Error {}
const fail = (why) => { throw new Unparsed(why); };

function makeCtx(ctx) {
  const c = ctx || {};
  const models = new Map();   // wkey → canonical model name
  for (const n of c.modelNames || []) { const k = wkey(n); if (k && !models.has(k)) models.set(k, n); }
  for (const [a, n] of Object.entries(c.modelAliases || {})) { const k = wkey(a); if (k && !models.has(k)) models.set(k, n); }
  const items = new Map();    // wkey → printed item name
  for (const n of c.itemNames || []) { const b = baseItemName(n); const k = wkey(b); if (k && !items.has(k)) items.set(k, b); }
  const unmatched = new Set();
  const resolve = typeof c.resolveItem === 'function' ? c.resolveItem : null;
  return {
    unitId: c.unitId || 'unit', singleModel: !!c.singleModel, models, items, unmatched,
    item(raw, count) {
      let n = String(raw || '').replace(/\s*\([^)]*\)/g, '').replace(/^(?:an?|the|additional)\s+/i, '').replace(/\s*\*+\s*$/, '').replace(/[.,;:\s]+$/, '').trim();
      n = n.replace(/^additional\s+/i, '');
      if (!n) fail('empty item');
      const k = wkey(n);
      let name = (this.groupItems && this.groupItems.get(k)) || items.get(k);
      if (!name && / - /.test(n)) name = items.get(wkey(n.replace(/\s+-\s+.*$/, '')));
      if (!name) { name = cap(n); unmatched.add(name); }
      const id = resolve ? (resolve(name) || kebab(name)) : kebab(name);
      const it = { id, name };
      if (count && count > 1) it.count = count;
      return it;
    },
    // longest model-name prefix of `phrase`; returns { name, rest } or null
    model(phrase) {
      const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
      for (let i = words.length; i >= 1; i--) {
        const k = wkey(words.slice(0, i).join(' '));
        if (models.has(k)) return { name: models.get(k), rest: words.slice(i).join(' ') };
      }
      // "1 Terminator's" on a Chaos Terminator Squad: the one candidate ending in it
      const k = wkey(words.join(' '));
      const tail = [...new Set([...models.entries()].filter(([mk]) => mk.endsWith(' ' + k)).map(([, v]) => v))];
      if (k && tail.length === 1) return { name: tail[0], rest: '' };
      return null;
    },
  };
}

// "1 boltgun", "2 heavy bolters", "a storm bolter", "whip coils" → item
function countedItem(C, s) {
  const t = String(s || '').trim().replace(/^(?:and|or)\s+/i, '');
  const m = new RegExp(`^${NUM}\\s+(.+)$`, 'i').exec(t) || /^(an?)\s+(.+)$/i.exec(t);
  if (m) return C.item(m[2], toNum(m[1]));
  return C.item(t, 1);
}
// One AND-bundle: "1 autopistol, 1 remote mine and 1 close combat weapon".
// " and " splits only before a count/article, so "Knives and Fists" stays whole.
function bundle(C, s) {
  const t = String(s || '').trim().replace(/[.;]+$/, '');
  if (!t) fail('empty bundle');
  if (/\bor\b/i.test(t.replace(/\bor more\b/i, ''))) fail('OR inside a bundle');
  const parts = t.split(new RegExp(`\\s*,\\s*(?:and\\s+)?|\\s+and\\s+(?=(?:\\d+|an?|one|two|three|four)\\s)`, 'i')).filter(Boolean);
  return parts.flatMap((p) => splitBareAnd(C, p)).map((p) => countedItem(C, p));
}
// "shuriken pistol and power sword" → two items unless the run is a printed name
function splitBareAnd(C, p) {
  const known = (x) => C.items.has(wkey(x.replace(new RegExp(`^${NUM}\\s+`, 'i'), '')));
  if (known(p) || !/\sand\s/i.test(p)) return [p];
  const toks = p.split(/\s+and\s+/i); const out = [];
  for (let i = 0; i < toks.length;) {
    let j = toks.length;
    while (j > i + 1 && !known(toks.slice(i, j).join(' and '))) j--;
    out.push(toks.slice(i, j).join(' and ')); i = j;
  }
  // only split when every piece is a printed item; otherwise keep the phrase whole
  return out.every(known) ? out : [p];
}
// Items a model must (not) carry: "a boltgun", "1 plasma gun and a power weapon",
// "either a HYLas rotary cannon or an ion beamer" (the OR form only for `not`).
function itemSet(C, s, allowOr) {
  const t = String(s || '').trim().replace(/^either\s+/i, '');
  const parts = t.split(new RegExp(`\\s*,\\s*|\\s+(?:and|or)\\s+(?=(?:\\d+|an?|one)\\s)|\\s+or\\s+`, 'i')).filter(Boolean);
  if (!allowOr && /\sor\s/i.test(t)) fail('OR in requires');
  return parts.map((p) => countedItem(C, p));
}
// The replaced items: "boltgun", "boltgun and power weapon", "2 bolt pistols",
// "shuriken pistol, Scorpion chainsword and Scorpion's claw". OR is not representable.
function replacedItems(C, s) {
  const t = String(s || '').trim().replace(/^one of (?:its|their)\s+/i, '');
  if (/\sor\s/i.test(t)) fail('OR in replaced items');
  const known = (p) => C.items.has(wkey(p.replace(new RegExp(`^${NUM}\\s+`, 'i'), '')));
  if (known(t)) return [countedItem(C, t)];
  // commas and "and" before a count always split; a bare "and" splits unless the
  // longest run of words it joins is a printed item ("cult claws and knife").
  const parts = [];
  for (const chunk of t.split(/\s*,\s*(?:and\s+)?/).flatMap((p) => p.split(new RegExp(`\\s+and\\s+(?=(?:\\d+|an?)\\s)`, 'i')))) {
    const toks = chunk.split(/\s+and\s+/i);
    for (let i = 0; i < toks.length;) {
      let j = toks.length;
      while (j > i + 1 && !known(toks.slice(i, j).join(' and '))) j--;
      parts.push(toks.slice(i, j).join(' and ')); i = j;
    }
  }
  return parts.filter(Boolean).map((p) => countedItem(C, p));
}

// Choice list after "replaced with" / "equipped with".
// Returns { choices: [[item]], picks?, distinct?, upTo? }
function choiceSpec(C, raw) {
  let s = String(raw || '').trim().replace(/[.]+$/, '').trim();
  if (/,\s*or can\b|\bor can be\b/i.test(s)) fail('two alternative verbs');
  const out = {};
  let m;
  // "1 shuriken pistol and one of the following: ◦ …" → prefix bundle + each option
  if ((m = /^(.+?)\s+and\s+(?:one|1) of the following\s*[:;]?\s*([^:;\s].*)$/i.exec(s))) {
    const pre = bundle(C, m[1]);
    out.choices = listChoices(C, m[2]).map((b) => pre.concat(b));
    return out;
  }
  const fromOptions = () => { if (!C.groupOptions || !C.groupOptions.length) fail('empty list and no options'); return C.groupOptions.map((n) => [C.item(n, 1)]); };
  if ((m = /^(.+?)\s+and\s+(?:one|1) of the following\s*[:;]?\s*$/i.exec(s))) { const pre = bundle(C, m[1]); out.choices = fromOptions().filter((b) => !pre.some((x) => x.id === b[0].id)).map((b) => pre.concat(b)); return out; }
  if ((m = new RegExp(`^up to ${NUM} of the following(?:\\s+options)?(?:\\s*,\\s*(and can|but cannot) take duplicates)?\\s*[:;]?\\s*$`, 'i').exec(s))) { out.picks = toNum(m[1]); if (m[2] && /cannot/i.test(m[2])) out.distinct = true; out.choices = fromOptions(); return out; }
  if (/^(?:(?:one|1) of the following(?:\s+options)?|the following)\s*(?:\([^)]*\))?\s*[:;]?\s*$/i.test(s) || /^:?\s*$/.test(s)) { out.choices = fromOptions(); return out; }
  if ((m = new RegExp(`^up to ${NUM} of the following(?:\\s+options)?(?:\\s*,\\s*(and can|but cannot) take duplicates)?\\s*[:;]?\\s*(.+)$`, 'i').exec(s))) {
    out.picks = toNum(m[1]);
    if (m[2] && /cannot/i.test(m[2])) out.distinct = true;
    out.choices = listChoices(C, m[3]);
    return out;
  }
  if ((m = /^(?:(?:one|1) of the following(?:\s+options)?|the following)\s*(?:\([^)]*\))?\s*[:;]?\s*(.+)$/i.exec(s))) {
    out.choices = listChoices(C, m[1]);
    return out;
  }
  if ((m = /^:\s*(.+)$/.exec(s))) { out.choices = listChoices(C, m[1]); return out; }
  if (s.includes(BULLET)) {
    if (s.startsWith(BULLET)) { out.choices = listChoices(C, s); return out; }
    fail('bullets after an unrecognised lead-in');
  }
  if ((m = new RegExp(`^up to ${NUM}\\s+(.+)$`, 'i').exec(s))) {
    out.upTo = toNum(m[1]);
    out.choices = [[C.item(m[2], 1)]];
    return out;
  }
  if (/\bof the following\b/i.test(s)) fail('unhandled "of the following" form');
  out.choices = [bundle(C, s)];
  return out;
}
// "◦ 1 A ◦ 1 B and 1 C" | "1 A, 1 B and 1 C, 1 D" | "1 A 1 B" | "1 A and 1 B 1 C and 1 D"
function listChoices(C, raw) {
  const s = String(raw || '').trim();
  let groups;
  if (s.includes(BULLET)) groups = s.split(BULLET).map((x) => x.trim()).filter(Boolean);
  else {
    groups = [];
    for (const part of s.split(/\s*,\s*/)) {
      // split at a count that starts a new option, unless the previous token ended with "and"
      const toks = part.split(/\s+(?=\d+\s)/);
      let cur = '';
      for (const t of toks) {
        if (cur && !/\sand$/i.test(cur)) { groups.push(cur); cur = t; } else cur = cur ? `${cur} ${t}` : t;
      }
      if (cur) groups.push(cur);
    }
    // a comma list whose later entries start without a count is one bundle split badly: rejoin
    if (groups.some((g) => !new RegExp(`^(?:${NUM}|an?)\\s`, 'i').test(g))) groups = [s];
  }
  if (!groups.length) fail('empty choice list');
  return groups.map((g) => bundle(C, g));
}

// Modifier text that can sit anywhere in a line (usually trailing).
function stripModifiers(line) {
  let s = line; const mod = { locks: [], choiceMax: null, choiceMaxN: null, groupExclusive: false, distinct: false, starred: false, notes: [] };
  const take = (re, fn) => { s = s.replace(re, (...a) => { fn(a); return ' '; }); };
  take(/\s*Designer's Note:.*$/i, () => {});
  take(/\(\s*(?:that|this|these) models?(?:'s|'|s')\s+((?:(?!\bcan\b)[^)])+?)\s+cannot be replaced\s*\)\.?/gi, (a) => { mod.locks.push(a[1]); });
  take(/(?<=[.*]\s*|[◦]\s.*?\s)\*?\s*(?:that|this|these) models?(?:'s|'|s')\s+((?:(?!\bcan\b)[^.*])+?)\s+cannot be replaced\.?/gi, (a) => { mod.locks.push(a[1]); });
  take(/\(\s*(?:duplicates are not allowed|you cannot select the same option more than once)\s*\)/gi, () => { mod.choiceMax = 1; });
  take(/You cannot select the same (?:weapon|option)(?: from this list)? more than (once|twice) per unit(?:,?\s*unless (?:it|this unit) contains (\d+) models, in which case you cannot select the same (?:weapon|option)(?: from this list)? more than twice per unit)?\.?/gi,
    (a) => { mod.choiceMax = a[1].toLowerCase() === 'once' ? 1 : 2; if (a[2]) mod.choiceMaxN = Math.floor(parseInt(a[2], 10) / 2); });
  take(/\s*To a maximum of 1 per (\d+) models in this unit\.?/gi, (a) => { mod.choiceMax = 1; mod.choiceMaxN = parseInt(a[1], 10); });
  take(/\s*Maximum 1 per model\.?/gi, () => { mod.distinct = true; });
  take(/\s+in addition to any other weapons(?=\s*:)/gi, () => {});
  take(/\*?\s*You cannot select both (?:(.+?)|of these options) for the same model\.?\*?/gi, (a) => { mod.exclBoth = a[1] && !/^of these options$/i.test(a[1]) ? a[1] : true; });
  take(/\*?\s*A model can only take one of these options[^.*]*\.?\*?/gi, () => { mod.groupExclusive = true; });
  take(/This model cannot have duplicates of these pieces of wargear\.?/gi, () => { mod.distinct = true; });
  // choice-level exclusions the schema cannot express — dropped, noted
  take(/\*\s*(?:No model can be equipped with both|A model cannot be equipped with more than one|This model cannot be equipped with both)[^*]*$/i, (a) => { mod.notes.push(a[0].trim()); });
  take(/\*?This weapon cannot be replaced\.?\*?/gi, (a) => { mod.notes.push(a[0].trim()); });
  if (/\*/.test(s)) { mod.starred = true; s = s.replace(/\s*\*+\s*/g, ' '); }
  s = s.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return { s, mod };
}

const FOOT_EXCL = /^\*?\s*(?:You cannot select both of these options for the same model|The same model cannot be equipped with more than one of these wargear options)\.?\*?$/i;
const FOOT_LOCK = /^\*\s*(?:That|This) model's\s+(.+?)\s+cannot be replaced\.?$/i;

// Leading conditions: unit size, "If this model/the <M> is (not) equipped with …".
function conditionPrefix(C, s, r) {
  let m;
  if ((m = new RegExp(`^If this unit contains (only )?${NUM}(?: or (more|fewer))? models?\\s*[,:]\\s*(.*)$`, 'i').exec(s))) {
    const n = toNum(m[2]);
    if (m[1]) r.condition = { minModels: n, maxModels: n };
    else if (m[3] && /more/i.test(m[3])) r.condition = { minModels: n };
    else if (m[3]) r.condition = { maxModels: n };
    else r.condition = { minModels: n, maxModels: n };
    return m[4];
  }
  if ((m = /^If (this model|the (.+?)|this unit's (.+?)) is (not )?equipped with (.+?),\s*(it|its)\s+(.*)$/i.exec(s))) {
    const who = m[2] || m[3];
    if (who) { const mm = C.model(who); if (!mm || mm.rest) fail('unknown model in condition'); r._condModel = mm.name; }
    const set = itemSet(C, m[5], !!m[4]);
    if (m[4]) r.forbids = (r.forbids || []).concat(set); else r.requires = r.requires.concat(set);
    r._condSubject = m[6].toLowerCase();
    return m[6].toLowerCase() === 'its' ? `its ${m[7]}` : `it ${m[7]}`;
  }
  return s;
}

// "For every N models in this unit, …" / "For every 5 Inquisitorial Agents in this unit, …"
function perNPrefix(C, s, r) {
  const m = new RegExp(`^For every ${NUM} (.+?) in (?:this|the) unit\\s*,\\s*(.*)$`, 'i').exec(s);
  if (!m) return s;
  r.scope = 'per_n'; r.n = toNum(m[1]);
  if (!/^models?$/i.test(m[2])) {
    const mm = C.model(m[2]); if (!mm || mm.rest) fail('unknown model in per-N header');
    r.nModel = mm.name;
  }
  return m[3];
}

function resolveModel(C, phrase) {
  let p = String(phrase || '').trim().replace(/^(?:additional|other)\s+/i, '').replace(/\s+in (?:this|the) unit$/i, '').trim();
  p = p.replace(/\.?\s+models?$/i, '').trim();
  if (!p || /^models?$/i.test(p)) return { generic: true };
  const mm = C.model(p);
  if (mm && !mm.rest) return { name: mm.name };
  if (mm && /^models?$/i.test(mm.rest)) return { name: mm.name };
  return null;
}

// Split "<model phrase>[ possessive item | equipped-with filter]" (text before " can ").
function subjectPart(C, sp, r) {
  let s = sp.trim();
  // equipped-with filter
  let m = /^(.*?)\s+(?:in (?:this|the) unit\s+)?(?:that is |that are |each |who is )?(not )?equipped with (?:either )?(.+)$/i.exec(s);
  if (m && !/'s\s|s'\s/.test(m[1] + ' ')) {
    const mod = resolveModel(C, m[1]); if (!mod) fail('unknown model');
    const set = itemSet(C, m[3], !!m[2]);
    if (m[2]) r.forbids = (r.forbids || []).concat(set); else r.requires = r.requires.concat(set);
    return { model: mod, item: null };
  }
  m = /^(.*?)\s+not equipped with (?:either )?(.+)$/i.exec(s);
  if (m) { const mod = resolveModel(C, m[1]); if (!mod) fail('unknown model'); r.forbids = (r.forbids || []).concat(itemSet(C, m[2], true)); return { model: mod, item: null }; }
  // possessive: try every marker, keep the split whose prefix is a known model (longest first)
  const re = /(?:'s|s'|')\s+/g; const cands = []; let mm;
  while ((mm = re.exec(s))) cands.push({ pre: s.slice(0, mm.index) + (mm[0].startsWith("s'") ? 's' : ''), item: s.slice(mm.index + mm[0].length) });
  for (const c of cands.slice().reverse()) { const mod = resolveModel(C, c.pre); if (mod) return { model: mod, item: c.item }; }
  if (cands.length) fail('possessive with unknown model');
  const mod = resolveModel(C, s); if (!mod) fail('unknown model');
  return { model: mod, item: null };
}

// verb phrase after " can "
function verbPart(C, vp, item, r) {
  let m;
  const v = vp.trim();
  if ((m = /^(?:each\s+)?be replaced with\s*(.*)$/i.exec(v))) { if (!item) fail('replace without item'); return { replaces: replacedItems(C, item), spec: m[1] }; }
  if ((m = /^(?:each\s+)?have (?:its|their) (.+?)\s+(?:can be\s+)?replaced with\s*(.*)$/i.exec(v))) return { replaces: replacedItems(C, m[1]), spec: m[2] };
  if ((m = /^(?:each\s+)?have each (.+?) it is equipped with replaced with\s*(.*)$/i.exec(v))) { r._each = true; return { replaces: replacedItems(C, m[1]), spec: m[2] }; }
  if ((m = /^(?:each\s+)?replace (?:its|their|one of (?:its|their)) (.+?) with\s*(.*)$/i.exec(v))) return { replaces: replacedItems(C, m[1]), spec: m[2] };
  if ((m = /^(?:each\s+)?be equipped(?: with)?\s*(.*)$/i.exec(v))) { if (item) fail('add after possessive'); return { replaces: [], spec: m[1] }; }
  if ((m = /^have\s+(.*)$/i.exec(v))) { if (item) fail('have after possessive'); return { replaces: [], spec: m[1] }; }
  fail('unknown verb');
}

// One clause (no footnotes, modifiers stripped) → rule fields.
function parseClause(C, clause, base) {
  const r = { kind: 'replace', model: null, scope: 'fixed', n: null, max: 1, replaces: [], choices: [], requires: [], locks: [], exclusiveWith: [], condition: base && base.condition ? { ...base.condition } : null };
  if (base && base.scope === 'per_n') { r.scope = 'per_n'; r.n = base.n; if (base.nModel) r.nModel = base.nModel; }
  let s = clause.trim().replace(/[.]+$/, '');
  s = conditionPrefix(C, s, r);
  if (r.scope !== 'per_n') s = perNPrefix(C, s, r);
  if (/^If /i.test(s) || /^For (?:every|each) /i.test(s)) fail('unhandled lead-in');

  let q = null, k = null, rest = null, possItem = null, model = null, generic = false;
  let m;
  if ((m = /^(?:each of|any number of) this model's (.+)$/i.exec(s))) { q = 'all'; possItem = true; rest = m[1]; }
  else if ((m = new RegExp(`^${NUM} of this model's (.+)$`, 'i').exec(s))) { q = 'upto'; k = toNum(m[1]); possItem = true; rest = m[2]; }
  else if ((m = /^(?:this|the) model's (.+)$/i.exec(s))) { q = 'this'; possItem = true; rest = m[1]; }
  else if ((m = /^its (.+)$/i.exec(s))) { q = r._condModel ? 'the' : 'this'; model = r._condModel || null; possItem = true; rest = m[1]; }
  else if ((m = /^(?:this model|it) (can .+)$/i.exec(s))) { q = r._condModel ? 'the' : (r.scope === 'per_n' ? 'unit' : 'this'); model = r._condModel || null; rest = m[1]; }
  else if ((m = /^this unit (can .+)$/i.exec(s))) { q = 'unit'; rest = m[1]; }
  else if ((m = /^each model (can have each .+)$/i.exec(s))) { q = 'all'; generic = true; rest = m[1]; }
  else if ((m = /^(?:each|every) model's (.+)$/i.exec(s))) { q = 'all'; generic = true; possItem = true; rest = m[1]; }
  else if ((m = /^all (?:of the )?models(?: in (?:this|the) unit)? (can .+)$/i.exec(s))) { q = 'all'; generic = true; rest = m[1]; }
  else if ((m = /^all (.+?)(?: models?)? in (?:this|the) unit (can .+)$/i.exec(s))) { q = 'all'; rest = `${m[1]} ${m[2]}`; }
  else if ((m = /^(?:each|every) (.+)$/i.exec(s))) { q = 'all'; rest = m[1]; }
  else if ((m = /^any number of (.+)$/i.exec(s))) { q = 'any'; rest = m[1]; }
  else if ((m = new RegExp(`^up(?: to)? ${NUM} (.+)$`, 'i').exec(s))) { q = 'upto'; k = toNum(m[1]); rest = m[2]; }
  else if ((m = /^(?:1|one) (.+)$/i.exec(s))) { q = 'upto'; k = 1; rest = m[1]; }
  else if ((m = new RegExp(`^${NUM} (.+)$`, 'i').exec(s))) { q = 'upto'; k = toNum(m[1]); rest = m[2]; }
  else if ((m = /^the (.+)$/i.exec(s))) { q = 'the'; rest = m[1]; }
  else { q = 'the'; rest = s; }

  // split subject / verb at the first " can "
  let sp, vp;
  if (/^can /i.test(rest)) { sp = ''; vp = rest.slice(4); }
  else {
    const i = rest.search(/\s+can\s+/i); if (i < 0) fail('no verb');
    sp = rest.slice(0, i); vp = rest.slice(i).replace(/^\s+can\s+/i, '');
  }
  let item = null;
  if (possItem) item = sp;
  else if (sp) {
    const sub = subjectPart(C, sp, r);
    if (sub.model.generic) generic = true; else model = sub.model.name;
    item = sub.item;
  }
  const { replaces, spec } = verbPart(C, vp, item, r);
  const cs = choiceSpec(C, spec);
  r.replaces = replaces;
  r.kind = replaces.length ? 'replace' : 'add';
  r.choices = cs.choices;
  if (cs.distinct) r.distinct = true;

  // scope / max
  if (q === 'all' || q === 'any') { if (r.scope === 'per_n') fail('any inside per-N'); r.scope = 'any'; r.max = null; }
  else if (q === 'upto') r.max = k;
  else if (q === 'unit' || q === 'this') r.max = 1;
  else if (q === 'the') { if (r.scope !== 'per_n') r.max = null; }
  if (generic) model = null;
  if (r.scope === 'fixed' && q === 'the' && !model) fail('no model for "the"');
  r.model = C.singleModel ? null : (model || null);
  if (r.scope === 'fixed' && q === 'the' && C.singleModel) r.max = 1;
  if (cs.upTo) {
    if (r.scope === 'fixed' && (q === 'this' || q === 'the' || q === 'unit')) r.max = cs.upTo;
    else r.picks = cs.upTo;
  }
  if (cs.picks) r.picks = cs.picks;
  delete r._condModel; delete r._condSubject; delete r._each;
  return r;
}

// One parsed clause → rule(s). `entry` = { text, parse, id, group, options }.
function parseEntry(C, entry, rules, footnotes) {
  const line = normLine(entry.parse);
  if (!line) return true;
  if (FOOT_EXCL.test(line)) { footnotes.push({ kind: 'excl' }); return true; }
  const fl = FOOT_LOCK.exec(line);
  if (fl) { footnotes.push({ kind: 'lock', item: fl[1] }); return true; }
  C.groupItems = new Map((entry.options || []).map((o) => { const b = baseItemName(o.name); return [wkey(b), b]; }));
  C.groupOptions = (entry.options || []).map((o) => o.name);
  try {
    const { s, mod } = stripModifiers(line);
    const finish = (r, id) => {
      const rule = { id, text: entry.text, ...r };
      delete rule._generic;
      if (mod.locks.length) rule.locks = rule.locks.concat(mod.locks.map((x) => replacedItems(C, x)).flat());
      if (mod.choiceMax != null) { rule.choiceMax = mod.choiceMax; if (mod.choiceMaxN) rule.choiceMaxN = mod.choiceMaxN; }
      if (mod.distinct) rule.distinct = true;
      Object.defineProperty(rule, '_meta', { value: { starred: mod.starred, groupExcl: mod.groupExclusive, exclBoth: mod.exclBoth, group: entry.group }, enumerable: false });
      return rule;
    };
    const cm = new RegExp(`^(For every ${NUM} models in (?:this|the) unit|If this unit contains (?:only )?${NUM}(?: or (?:more|fewer))? models?)\\s*:\\s*${BULLET}\\s*(.+)$`, 'i').exec(s);
    if (cm && /\bcan\b/i.test(cm[4])) {
      const hdr = { condition: null, scope: 'fixed', n: null };
      if (/^If/i.test(cm[1])) { const tmp = { requires: [], condition: null }; conditionPrefix(C, `${cm[1]}, x`, tmp); hdr.condition = tmp.condition; }
      else { hdr.scope = 'per_n'; hdr.n = toNum(cm[2]); }
      const subs = cm[4].split(BULLET).map((x) => x.trim()).filter(Boolean);
      const built = subs.map((c, k) => finish(parseClause(C, c, hdr), `${entry.id}.${k + 1}`));
      rules.push(...built);
      return true;
    }
    if (/^You can select/i.test(s)) fail('select-one-of-options');
    rules.push(finish(parseClause(C, s, null), entry.id));
    return true;
  } catch (e) {
    if (!(e instanceof Unparsed)) throw e;
    return false;
  } finally { C.groupItems = null; C.groupOptions = null; }
}

// footnotes, group exclusivity, forbids → exclusiveWith
function linkRules(C, rules, footnotes, unparsed) {
  const sig = (r) => JSON.stringify([r.model, r.kind, r.scope, r.n, r.requires.map((x) => x.id), (r.forbids || []).map((x) => x.id)]);
  const meta = (r) => r._meta || {};
  const groupOf = (r) => rules.filter((x) => sig(x) === sig(r));
  const sameGroup = (r) => (meta(r).group == null ? [] : rules.filter((x) => meta(x).group === meta(r).group));
  const largestGroup = () => {
    const by = new Map(); rules.forEach((r) => { const k = sig(r); by.set(k, (by.get(k) || []).concat(r)); });
    let best = []; for (const g of by.values()) if (g.length > best.length) best = g;
    return best.length >= 2 ? best : [];
  };
  const linkExclusive = (set) => {
    const ids = [...new Set(set.map((r) => r.id))]; if (ids.length < 2) return;
    for (const r of set) r.exclusiveWith = [...new Set(r.exclusiveWith.concat(ids.filter((x) => x !== r.id)))];
  };
  const starred = rules.filter((r) => meta(r).starred && meta(r).group == null);
  for (const f of footnotes) {
    if (f.kind === 'lock') {
      if (!starred.length) { unparsed.push(`* That model's ${f.item} cannot be replaced.`); continue; }
      const it = replacedItems(C, f.item);
      for (const r of starred) if (!r.locks.some((x) => x.id === it[0].id)) r.locks = r.locks.concat(it);
    } else {
      const tgt = starred.length >= 2 ? starred : largestGroup();
      if (tgt.length < 2) { unparsed.push('The same model cannot be equipped with more than one of these wargear options.'); continue; }
      linkExclusive(tgt);
    }
  }
  for (const r of rules) {
    const m = meta(r);
    if (m.groupExcl) linkExclusive([...new Set([r, ...groupOf(r), ...sameGroup(r), ...(m.group == null ? starred : [])])]);
    if (m.exclBoth) {
      const names = m.exclBoth === true ? [] : m.exclBoth.split(/\s+and\s+/i).map((x) => wkey(x.replace(/^(?:an?|the)\s+/i, '')));
      const offers = rules.filter((o) => o.choices.some((b) => b.some((x) => names.includes(wkey(x.name)))));
      linkExclusive([...new Set([r, ...(names.length ? offers : sameGroup(r))])]);
    }
  }
  for (const r of rules) for (const f of r.forbids || []) {
    for (const o of rules) if (o !== r && o.model === r.model && o.choices.some((b) => b.some((x) => x.id === f.id))) linkExclusive([r, o]);
  }
}

// Fallback input: the flattened prose lines (unit.gdcWargear).
export function parseWargearRules(lines, ctxIn) {
  const C = makeCtx(ctxIn);
  const rules = []; const unparsed = []; const footnotes = [];
  (Array.isArray(lines) ? lines : []).forEach((raw, idx) => {
    const text = String(raw == null ? '' : raw);
    if (!parseEntry(C, { text, parse: text, id: `${C.unitId}-wr-${idx + 1}`, group: null, options: null }, rules, footnotes)) unparsed.push(text);
  });
  linkRules(C, rules, footnotes, unparsed);
  return { rules, unparsed, unmatchedItems: [...C.unmatched] };
}

// Primary input: the raw GDC datasheet's wargearOptions — an ordered list of
// { instruction: {en}, options: [{ name: {en}, cost }] }. "Default Wargear"
// groups list a model type's default loadout, one per composition entry in
// order (defaultsByBlock). They are NOT a reliable owner for the groups that
// follow them (Boyz, Grey Knights Terminators, Inquisitorial Agents, Troupe
// put a model's options under another model's block), so a rule's model comes
// from its own prose. Every other group is one rule (or several: "■" clauses,
// a second "If this unit contains…" paragraph, a compound bullet header).
// Choices come from the group's prose list when it has one (bundles, counts),
// else from its options; names are canonicalised against the options.
// Returns { rules, unparsed, unmatchedItems, groups, groupsParsed, defaultsByBlock,
//   loadoutGroups, costs, defaultBlocksMatchComposition }.
export function parseWargearGroups(groups, ctxIn) {
  const C = makeCtx(ctxIn);
  const rules = []; const unparsed = []; const footnotes = [];
  const en = (v) => (v == null ? '' : typeof v === 'string' ? v : (v.en || ''));
  const seen = new Set(); const defaultsByBlock = []; const costs = []; const loadoutGroups = [];
  let gi = 0, groupsParsed = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    const text = en(g && g.instruction).trim();
    const options = ((g && g.options) || []).map((o) => ({ name: en(o && o.name).trim(), cost: parseInt(o && o.cost, 10) || 0 })).filter((o) => o.name);
    options.forEach((o) => { if (o.cost > 0) costs.push(o); });
    if (DEFAULT_RE.test(text)) { defaultsByBlock.push(options.map((o) => o.name)); continue; }
    if (!text || seen.has(text)) continue;
    if (/\bis equipped with:?$/i.test(text)) { loadoutGroups.push({ text, items: options.map((o) => o.name) }); continue; }
    seen.add(text); gi++;
    // paragraphs: "*…" are footnotes of this group; "■" lines and a paragraph that
    // is not a list continuation start a new clause
    const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const notes = []; const clauses = [];
    for (const p of paras) {
      if (/^\*/.test(p)) { notes.push(p.replace(/^\*+\s*/, '').replace(/\*+\.?$/, '').trim()); continue; }
      for (const piece of p.split(/(?:^|\n)\s*■\s*/).map((x) => x.trim()).filter(Boolean)) {
        if (/^[◦▫•-]\s/.test(piece) && clauses.length) clauses[clauses.length - 1] += '\n' + piece;
        else if (!/\bcan\b/i.test(piece) && clauses.length) clauses[clauses.length - 1] += '\n' + piece;
        else clauses.push(piece);
      }
    }
    const tail = notes.length ? ' ' + notes.map((n) => `* ${n.replace(/\.?$/, '.')}`).join(' ') : '';
    let ok = clauses.length > 0;
    clauses.forEach((c, k) => {
      const id = `${C.unitId}-wr-${gi}` + (clauses.length > 1 ? `.${k + 1}` : '');
      const parse = c.replace(/\n-\s+/g, ` ${BULLET} `) + tail;
      if (!parseEntry(C, { text, parse, id, group: gi, options }, rules, footnotes)) ok = false;
    });
    if (ok) groupsParsed++; else unparsed.push(text);
  }
  // GDC's flattened prose field sometimes carries a footnote the groups lost
  // (Inquisitorial Agents' "The same model cannot…", Catachan Command Squad's
  // "A model can only take one of these options"): apply those, nothing else.
  const alnum = (x) => normLine(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const blob = [...seen].map(alnum).join('|');
  for (const l of (ctxIn && ctxIn.proseLines) || []) {
    const n = normLine(l);
    if (blob.includes(alnum(n.split(BULLET)[0]))) continue;
    if (FOOT_EXCL.test(n)) { footnotes.push({ kind: 'excl', prose: true }); continue; }
    if (/A model can only take one of these options/i.test(n)) {
      const head = alnum(n.split(/\*|A model can only/i)[0]);
      const r = rules.find((x) => head && alnum(x.text).startsWith(head.slice(0, Math.max(20, head.length - 2))));
      if (r) r._meta.groupExcl = true;
    }
  }
  linkRules(C, rules, footnotes, unparsed);
  return { rules, unparsed, unmatchedItems: [...C.unmatched], groups: gi, groupsParsed, defaultsByBlock, loadoutGroups, costs, defaultBlocksMatchComposition: !!(ctxIn && ctxIn.blockModels && ctxIn.blockModels.length === countDefaults(groups)) };
}
const DEFAULT_RE = /^de\w+ warge\w+$/i;
const countDefaults = (groups) => (groups || []).filter((g) => DEFAULT_RE.test(String((g && g.instruction && (g.instruction.en || g.instruction)) || '').trim())).length;

// "Every model is equipped with: boltgun; plague knives." and friends →
// { byModel: { '<model>'|'*': [{ name, count }] } }  ('*' = every model)
export function parseLoadout(lines, ctxIn) {
  const C = makeCtx(ctxIn);
  const byModel = {};
  for (const raw of Array.isArray(lines) ? lines : String(lines || '').split('\n')) {
    const line = normLine(raw);
    const m = /^(.+?) (?:is|are) equipped with\s*:?\s*(.+)$/i.exec(line);
    if (!m) continue;
    let who = m[1].replace(/^(?:every|each|the|all)\s+/i, '').trim();
    let key;
    if (/^(?:this )?models?$/i.test(who) || /^this model$/i.test(m[1])) key = '*';
    else { const mm = resolveModel(C, who); if (!mm) continue; key = mm.generic ? '*' : mm.name; }
    const items = m[2].replace(/[.]+$/, '').split(/\s*;\s*/).filter(Boolean).map((p) => {
      try { const it = countedItem(C, p.trim()); return { name: it.name, count: it.count || 1 }; } catch { return null; }
    }).filter(Boolean);
    if (items.length) byModel[key] = (byModel[key] || []).concat(items);
  }
  return { byModel };
}

// Model type names printed in the composition lines ("1 Plague Champion",
// "4-9 Plague Marines", "1 Shock Trooper Sergeant and 9 Shock Troopers").
export function compositionModelNames(lines) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = normLine(raw).replace(/^[◦•]\s*/, '');
    if (/equipped with|^or$|^\*/i.test(line)) continue;
    for (const part of line.split(/\s+and\s+(?=\d)/i)) {
      const m = /^(\d+(?:\s*-\s*\d+)?)\s+(.+?)\s*\*?$/.exec(part.trim());
      if (!m) continue;
      const name = m[2].replace(/\s+models?$/i, '').trim();
      if (name) out.push(name);
    }
  }
  return out;
}

// Model counts printed in the composition lines: "2‑3 Custodian Warden models"
// → { name: 'Custodian Warden', min: 2, max: 3 }; "1 Shock Trooper Sergeant and
// 9 Shock Troopers" → two entries. Lines that are not a count are skipped; a
// caller that needs every model type covered must check names itself.
export function compositionCounts(lines) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = normLine(raw).replace(/^[◦•]\s*/, '');
    if (/equipped with|^or$|^\*/i.test(line)) continue;
    for (const part of line.split(/\s+and\s+(?=\d)/i)) {
      const m = /^(\d+)(?:\s*-\s*(\d+))?\s+(.+?)\s*\*?$/.exec(part.trim());
      if (!m) continue;
      const name = m[3].replace(/\s+models?$/i, '').trim();
      const min = parseInt(m[1], 10); const max = m[2] != null ? parseInt(m[2], 10) : min;
      if (name && max >= min) out.push({ name, min, max });
    }
  }
  return out;
}

// ctx for parseWargearRules/parseLoadout from a built unit. `extraModels` are
// canonical names that win over the prose spellings (wargearProfile.modelsBySize keys).
export function ctxFromUnit(unit, opts = {}) {
  const comp = compositionModelNames(unit.gdcComposition || []);
  const extra = opts.extraModels || [];
  const modelNames = [...extra];
  const modelAliases = {};
  // a prose name that is not a canonical (modelsBySize) name but is the tail
  // of exactly one ("Nob" → "Boss Nob") is an alias of it; otherwise its own type
  for (const n of comp) {
    const k = wkey(n);
    if (extra.some((e) => wkey(e) === k)) continue;
    const tail = extra.filter((e) => { const ek = wkey(e); return ek.endsWith(' ' + k) || k.endsWith(' ' + ek) || k.startsWith(ek + ' '); });
    if (tail.length === 1) modelAliases[n] = tail[0]; else modelNames.push(n);
  }
  // a single-model unit: one composition line of exactly 1 model, or none at all
  const counts = (unit.gdcComposition || []).map(normLine).filter((l) => /^\d/.test(l) && !/equipped/i.test(l));
  const singleModel = opts.singleModel != null ? opts.singleModel
    : (counts.length === 1 && /^1\s/.test(counts[0]) && !/\sand\s\d/.test(counts[0])) || (!counts.length && (unit.modelStats || []).length <= 1);
  if (!modelNames.length && unit.name) modelNames.push(unit.name);
  const itemNames = [...(unit.weapons || []).map((w) => w.name), ...(unit.wargearAbilities || []).map((a) => a.name), ...(opts.extraItems || [])];
  const blockModels = comp.map((n) => modelAliases[n] || extra.find((e) => wkey(e) === wkey(n)) || n);
  return { unitId: unit.id, modelNames, modelAliases, blockModels, itemNames, singleModel, resolveItem: opts.resolveItem };
}

export const isDefaultGroup = (g) => DEFAULT_RE.test(String((g && g.instruction && (g.instruction.en || g.instruction)) || '').trim());
