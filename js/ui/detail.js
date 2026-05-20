// ui/detail.js — right-panel unit detail, rule detail, and Led-By index cache.
(function () {
  const UI = window.UI = window.UI || {};

  // Weapon-keyword color class resolver. Matches by lowercase prefix or
  // exact lowercase name. Falls through to default (no class = neutral gray).
  function weaponKwClass(raw) {
    const kw = (raw || '').trim().toLowerCase();
    if (!kw) return '';
    if (kw.startsWith('anti-'))       return 'weapon-kw-red';
    if (kw === 'lethal hits')         return 'weapon-kw-red';
    if (kw === 'devastating wounds')  return 'weapon-kw-red';
    if (kw.startsWith('sustained hits')) return 'weapon-kw-orange';
    if (kw === 'melta' || kw.startsWith('melta '))  return 'weapon-kw-orange';
    if (kw === 'assault')             return 'weapon-kw-blue';
    if (kw === 'pistol')              return 'weapon-kw-blue';
    if (kw.startsWith('rapid fire'))  return 'weapon-kw-blue';
    if (kw === 'heavy')               return 'weapon-kw-blue';
    if (kw === 'twin-linked' || kw === 'twin linked') return 'weapon-kw-purple';
    if (kw === 'torrent')             return 'weapon-kw-purple';
    return '';
  }

  // "Led By" lookup is delegated to `App.Attachments.candidateLeadersFor`
  // (js/app/attachments.js). That module owns the reverse-index — both
  // GDC-structured `gdcLeadBy` reads AND the prose-scan fallback — so
  // the detail panel and drag-to-attach share a single source of truth.
  function getLedByFor(unit) {
    if (!unit || !window.App || !App.Attachments) return [];
    return App.Attachments.candidateLeadersFor(unit);
  }

  // Lazy global map of weapon keyword → rule text, harvested from every
  // BSData-parsed weapon's _keywordDefs across all loaded factions. Used to
  // attach tooltips to GDC-rendered weapon rows (GDC ships keyword names but
  // not their rule text). Rebuilt when factionsVersion advances.
  let _weaponKwGlossary = null;
  let _weaponKwGlossaryVersion = -1;

  function buildWeaponKwGlossary() {
    const map = new Map();
    const factions = (window.App && App.state && App.state.factions) || [];
    factions.forEach(f => {
      (f.units || []).forEach(u => {
        (u.weapons || []).forEach(w => {
          const defs = w && w._keywordDefs;
          if (!defs) return;
          for (const k in defs) {
            if (!Object.prototype.hasOwnProperty.call(defs, k)) continue;
            const lk = k.trim().toLowerCase();
            if (!lk || map.has(lk)) continue;
            const v = defs[k];
            if (typeof v === 'string' && v) map.set(lk, v);
          }
        });
      });
    });
    return map;
  }

  function ensureWeaponKwGlossary() {
    const state = window.App && App.state;
    const v = (state && state.factionsVersion) || 0;
    if (_weaponKwGlossary === null || _weaponKwGlossaryVersion !== v) {
      _weaponKwGlossary = buildWeaponKwGlossary();
      _weaponKwGlossaryVersion = v;
    }
    return _weaponKwGlossary;
  }

  // Resolve a (potentially parameterized) keyword to its rule text. Mirrors
  // parser/weapons.js findWeaponKeywordDesc: try exact, then strip a trailing
  // " N" or " N+" (so "Sustained Hits 1" → "Sustained Hits", "Anti-Infantry 4+"
  // → "Anti-Infantry"), then look for a glossary key that ends with "-" the
  // keyword starts with (e.g. "anti-" matching "anti-infantry").
  function lookupWeaponKwDef(rawKeyword) {
    const map = ensureWeaponKwGlossary();
    if (!map || map.size === 0) return undefined;
    const lower = String(rawKeyword || '').trim().toLowerCase();
    if (!lower) return undefined;
    let d = map.get(lower);
    if (d !== undefined) return d;
    const stripped = lower.replace(/\s+\d+\+?$/, '').trim();
    if (stripped !== lower) {
      d = map.get(stripped);
      if (d !== undefined) return d;
    }
    for (const [name, desc] of map) {
      if (name.endsWith('-') && lower.startsWith(name)) return desc;
    }
    return undefined;
  }

  // Convert GDC's pre-bucketed weapon shape (meleeWeapons[]/rangedWeapons[],
  // each with profiles[]) into the flat row shape the existing weapon-table
  // renderer consumes (one row per profile, fields named Range/A/BS|WS/S/AP/D/
  // Keywords). GDC pre-disambiguates same-name dual-profile weapons (e.g.
  // "Plasmic lance – Melee" / "Plasmic lance – Ranged") and structurally
  // separates ranged vs melee, so this avoids the BSData heuristic-bucketing
  // that loses one of two same-named profiles on units like the Plasmancer.
  function gdcProfilesToRows(weapons, type) {
    if (!Array.isArray(weapons)) return [];
    const out = [];
    weapons.forEach(w => {
      if (!w || w.active === false || !Array.isArray(w.profiles)) return;
      w.profiles.forEach(p => {
        if (!p || p.active === false) return;
        const row = {
          name: p.name || w.name || '',
          Range: p.range != null && p.range !== '' ? p.range : (type === 'melee' ? 'Melee' : '—'),
          A: p.attacks,
          S: p.strength,
          AP: p.ap,
          D: p.damage,
        };
        // GDC merges BS/WS into a single `skill` field; route to the correct
        // column based on the bucket the weapon came from.
        if (type === 'ranged') row.BS = p.skill;
        else                   row.WS = p.skill;
        if (Array.isArray(p.keywords) && p.keywords.length > 0) {
          row.Keywords = p.keywords.join(', ');
          // Attach per-keyword rule text from the BSData-harvested glossary so
          // the existing tooltip path (renderWeaponTable reads w._keywordDefs)
          // lights up for GDC-rendered rows too.
          const defs = {};
          p.keywords.forEach(k => {
            const def = lookupWeaponKwDef(k);
            if (def) defs[k] = def;
          });
          if (Object.keys(defs).length > 0) row._keywordDefs = defs;
        }
        out.push(row);
      });
    });
    return out;
  }

  UI.renderUnitDetail = function (unit, detachmentEnhancements = [], selectedEnhancements = []) {
    const esc = UI.escapeHtml;
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const stats        = unit.stats        || {};
    const weapons      = unit.weapons      || [];
    const abilities    = unit.abilities    || [];
    const keywords     = unit.keywords     || [];
    const wargearOpts  = unit.wargearOptions || [];
    const squadOptions = unit.squadOptions || (unit.points ? [{ pts: unit.points, models: null }] : []);

    const getStatVal = key => (UI._STAT_ALIASES[key] || [key]).map(a => stats[a]).find(v => v) || '—';

    let html = `<div class="unit-detail-content unit-detail-datasheet" data-detail-kind="unit">`;

    const ptsOpts = unit.pointsOptions || (unit.points ? [unit.points] : []);
    const subtitleParts = [];
    if (unit._factionName) subtitleParts.push(`<span class="detail-faction">${esc(unit._factionName)}</span>`);
    if (unit.type)         subtitleParts.push(`<span class="detail-type">${esc(unit.type)}</span>`);

    // Render unit-flavor blurb when unit.description is empty and a matching
    // App.UNIT_FLAVOR entry exists (case-insensitive substring match on name).
    let flavorHtml = '';
    if (!unit.description && window.App && App.UNIT_FLAVOR) {
      const lcName = String(unit.name || '').toLowerCase();
      let flavor = null;
      for (const key in App.UNIT_FLAVOR) {
        if (lcName.indexOf(key) !== -1) { flavor = App.UNIT_FLAVOR[key]; break; }
      }
      if (flavor) {
        flavorHtml = `<div class="detail-flavor" style="font-style:italic;font-size:12px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(flavor)}</div>`;
      }
    }

    html += `
      <div class="detail-header detail-banner">
        <div class="detail-header-main">
          <div class="detail-name">${esc(unit.name)}</div>
          ${flavorHtml}
          <div class="detail-meta detail-banner-subtitle">
            ${subtitleParts.join('')}
          </div>
        </div>
        <div class="detail-header-actions detail-banner-actions">
          ${ptsOpts.length > 0 ? `<span class="detail-pts detail-banner-pts">${ptsOpts.join(' / ')} pts</span>` : ''}
          ${(window.App && App.hooks && App.hooks.detailActions || []).map(a =>
            `<button class="detail-action-btn" data-action-id="${esc(a.id)}" title="${esc(a.title || '')}">${a.html || esc(a.label || '')}</button>`
          ).join('')}
          <button class="btn-google-search" id="btn-google-images" data-unit="${esc(unit.name)}" title="Search Google Images">
            <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    const hasSquadChoice = squadOptions.length > 1;
    html += `
      <div class="detail-add-section">
        <div class="detail-add-row">
          ${hasSquadChoice ? `
            <select class="form-select detail-squad-select" id="detail-squad-select">
              ${squadOptions.map((opt, i) => {
                const label = opt.models ? `${opt.models} models — ${opt.pts} pts` : `${opt.pts} pts`;
                return `<option value="${i}">${esc(label)}</option>`;
              }).join('')}
            </select>
          ` : `<span class="detail-pts-label">${squadOptions[0] ? squadOptions[0].pts + ' pts' : '—'}</span>`}
          <input type="number" id="detail-qty" class="form-input detail-qty-input" value="1" min="1" max="99" />
          <button class="btn btn-accent detail-add-btn" id="btn-detail-add">Add to Army</button>
        </div>
      </div>
    `;

    const STAT_ORDER = ['M', 'T', 'SV', 'W', 'LD', 'OC'];

    // Multi-statline units (Marneus Calgar + Victrix Honour Guard,
    // Wardens of Ultramar, Terminator Assault Squad TH/SS vs LC) carry
    // an array of distinct stat profiles. Render one row per profile;
    // fall back to the legacy single `stats` dict when modelStats is
    // absent (older cached factions, units that genuinely have one
    // statline).
    const profilesToRender = (Array.isArray(unit.modelStats) && unit.modelStats.length > 0)
      ? unit.modelStats
      : [{ name: '', ...stats }];

    const presentStats = STAT_ORDER.filter(k =>
      profilesToRender.some(p => {
        const aliases = UI._STAT_ALIASES[k] || [k];
        return aliases.some(a => p[a]);
      })
    );

    if (presentStats.length > 0) {
      const renderPillar = (k, prof) => {
        const aliases = UI._STAT_ALIASES[k] || [k];
        const v = aliases.map(a => prof[a]).find(x => x) || '—';
        if (k === 'SV' && unit.invulnSave && v !== '—') {
          return `<div class="detail-stat-cell detail-stat-pillar detail-stat-pillar-sv">
            <span class="stat-name detail-stat-pillar-label">SV</span>
            <span class="stat-value detail-stat-pillar-value">${esc(String(v))}</span>
            <span class="detail-stat-pillar-invuln">${esc(String(unit.invulnSave))} INV</span>
          </div>`;
        }
        return `<div class="detail-stat-cell detail-stat-pillar">
          <span class="stat-name detail-stat-pillar-label">${esc(k)}</span>
          <span class="stat-value detail-stat-pillar-value">${esc(String(v))}</span>
        </div>`;
      };

      html += `<div class="detail-section detail-stats-section">`;
      profilesToRender.forEach(prof => {
        const label = profilesToRender.length > 1 && prof.name
          ? `<div class="detail-stat-rowlabel" style="font-size:11px;color:var(--text-muted);margin:4px 0 2px">${esc(prof.name)}</div>`
          : '';
        html += label;
        html += `<div class="detail-stats-row detail-stat-strip" style="grid-template-columns:repeat(${presentStats.length},1fr)">
            ${presentStats.map(k => renderPillar(k, prof)).join('')}
          </div>`;
      });
      html += `</div>`;
    }

    // Prefer GDC weapons when available — they're pre-bucketed into ranged
    // vs melee, multi-profile weapons are explicitly modeled, and same-name
    // dual-mode weapons (e.g. Plasmancer's Plasmic lance) are pre-disambiguated.
    // Falls back to the BSData _typeName/Range heuristic for units with no
    // GDC entry.
    const useGdcWeapons = Array.isArray(unit.gdcMeleeWeapons) || Array.isArray(unit.gdcRangedWeapons);
    let ranged, melee;
    if (useGdcWeapons) {
      ranged = gdcProfilesToRows(unit.gdcRangedWeapons || [], 'ranged');
      melee  = gdcProfilesToRows(unit.gdcMeleeWeapons  || [], 'melee');
    } else {
      ranged = weapons.filter(w => {
        const tn = (w._typeName || '').toLowerCase();
        return tn.includes('ranged') || (!tn.includes('melee') && w.Range !== 'Melee');
      });
      melee = weapons.filter(w => {
        const tn = (w._typeName || '').toLowerCase();
        return tn.includes('melee') || w.Range === 'Melee';
      });
    }

    if (ranged.length > 0 || melee.length > 0) {
      const renderWeaponTable = (list, type) => {
        if (list.length === 0) return '';
        const COLS = type === 'ranged'
          ? ['Range', 'A', 'BS', 'S', 'AP', 'D', 'Keywords']
          : ['Range', 'A', 'WS', 'S', 'AP', 'D', 'Keywords'];
        const allCols = new Set();
        list.forEach(w => Object.keys(w).forEach(k => { if (k !== 'name' && k !== '_typeName' && k !== '_keywordDefs') allCols.add(k); }));
        const cols = COLS.filter(c => allCols.has(c));

        const label = type === 'ranged' ? 'Ranged Weapons' : 'Melee Weapons';
        const numericCols = new Set(['Range', 'A', 'BS', 'WS', 'S', 'AP', 'D']);
        return `
          <div class="weapons-subsection weapons-section">
            <div class="weapons-subsection-title weapons-section-banner weapons-section-banner-${type} ${type}">${label}</div>
            <div class="detail-table-wrap weapons-table-wrap">
              <table class="weapons-table weapons-datasheet-table">
                <thead><tr>
                  <th class="weapons-col-name">Name</th>${cols.map(c => `<th class="${numericCols.has(c) ? 'weapons-col-num' : 'weapons-col-kw'}">${esc(c)}</th>`).join('')}
                </tr></thead>
                <tbody>
                  ${list.map(w => `<tr>
                    <td class="weapon-type-${type} weapons-col-name">${esc(w.name)}</td>
                    ${cols.map(c => {
                      if (c === 'Keywords' && w[c]) {
                        const kws = String(w[c]).split(',').map(k => k.trim()).filter(Boolean);
                        return `<td class="weapon-keywords-cell weapons-col-kw">${kws.map(k => {
                          const d = w._keywordDefs && w._keywordDefs[k];
                          const colorClass = weaponKwClass(k);
                          const classes = 'weapon-kw-tag'
                            + (d ? ' has-tooltip' : '')
                            + (colorClass ? ' ' + colorClass : '');
                          return `<span class="${classes}"${d ? ` data-tooltip="${esc(d)}"` : ''}>${esc(k)}</span>`;
                        }).join('')}</td>`;
                      }
                      const cellClass = numericCols.has(c) ? 'weapons-col-num' : '';
                      return `<td class="${cellClass}">${esc(String(w[c] != null ? w[c] : '—'))}</td>`;
                    }).join('')}
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      };

      html += `<div class="detail-section detail-weapons-section">
        <div class="detail-section-title">Weapons</div>
        ${renderWeaponTable(ranged, 'ranged')}
        ${renderWeaponTable(melee, 'melee')}
      </div>`;
    }

    const coreAbilities    = abilities.filter(a => a.isCore);
    // Sub-ability detection — same logic as cards-mode.js
    // subAbilitySectionKey(). Children of choose-from-N hero toggles
    // have a non-standard BSData typeName matching (or related to) the
    // parent ability's name:
    //   Lion El'Jonson  → typeName="Primarch of the First Legion"
    //   Angron          → typeName="Wrathful Presence"
    //   Silent King     → typeName="Triarch Abilities"
    // The parent ability has typeName="Abilities" and stays in the
    // regular Abilities section, where it reads as the always-on rule
    // explaining the choose mechanic.
    const STD_AB_TN = new Set(['', 'abilities', 'leader', 'invulnerable save', 'damaged']);
    const subAbilityKey = (a) => {
      if (!a || !a._typeName) return null;
      const tn = String(a._typeName).trim();
      if (STD_AB_TN.has(tn.toLowerCase())) return null;
      // Match "Primarch" (synthetic typeName from Guilliman's split)
      // AND "Primarch of <legion>" (natural typeName for Lion / Magnus
      // / Mortarion shapes). Both route to the PRIMARCH section.
      if (/^primarch\b/i.test(tn)) return 'PRIMARCH';
      return tn.toUpperCase();
    };
    // Group sub-abilities by section key, preserving first-seen order.
    const subGroups = new Map();
    abilities.forEach(a => {
      if (a.isCore) return;
      const key = subAbilityKey(a);
      if (!key) return;
      if (!subGroups.has(key)) subGroups.set(key, []);
      subGroups.get(key).push(a);
    });
    const isSub = (a) => !!subAbilityKey(a);
    const leaderAbilities  = abilities.filter(a => !a.isCore && !isSub(a) && /can be attached to/i.test(a.description));
    const regularAbilities = abilities.filter(a => !a.isCore && !isSub(a) && !/can be attached to/i.test(a.description));

    if (coreAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Core Abilities</div>
        <div class="core-abilities-list">
          ${coreAbilities.map(a => `<span class="core-ability-tag"${a.description ? ` data-tooltip="${esc(a.description)}"` : ''}>${esc(a.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    if (unit.transportCapacity) {
      html += `<div class="detail-section detail-transport-section">
        <div class="detail-section-title">Transport</div>
        <div class="detail-ability-desc">${esc(unit.transportCapacity)}</div>
      </div>`;
    }

    if (leaderAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title detail-section-title-leader">Leader</div>`;
      leaderAbilities.forEach(ab => {
        const attachText = ab.description.replace(/^.*?can be attached to.*?:/i, '').trim();
        const unitList = attachText
          .split(/[■\n●•]+/)
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (unitList.length > 0) {
          html += `<div class="detail-leader-units">
            <span class="detail-ability-name">Can lead:</span>
            <div class="detail-leader-list">
              ${unitList.map(u => `<span class="leader-unit-tag">${esc(u)}</span>`).join('')}
            </div>
          </div>`;
        } else {
          html += `<div class="detail-ability">
            <span class="detail-ability-name">${esc(ab.name)}:</span>
            <span class="detail-ability-desc">${esc(ab.description || '—')}</span>
          </div>`;
        }
      });
      html += `</div>`;
    }

    // "Led By" uses the memoized reverse-index. Collapsed by default: first
    // 3 leaders visible + "+N more" pill; click section header or pill to expand.
    const ledBy = getLedByFor(unit);
    if (ledBy.length > 0) {
      const extra = ledBy.length - 3;
      const collapsed = ledBy.length > 3;
      html += `<div class="detail-section detail-ledby-section">
        <div class="detail-section-title detail-section-title-ledbby detail-ledby-title"${collapsed ? ' role="button" tabindex="0"' : ''}>Led By</div>
        <div class="detail-ledby-list${collapsed ? ' collapsed' : ''}">
          ${ledBy.map(l => `<span class="ledby-tag">${esc(l.name)}</span>`).join('')}
          ${collapsed ? `<span class="ledby-more-pill" role="button" tabindex="0">+${extra} more</span>` : ''}
        </div>
      </div>`;
    }

    if (regularAbilities.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Abilities</div>`;
      regularAbilities.forEach(ab => {
        html += `<div class="detail-ability">
          <span class="detail-ability-name">${esc(ab.name)}:</span>
          <span class="detail-ability-desc">${esc(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // One special section per choose-from-N typeName group:
    //   "PRIMARCH" for Lion / Magnus / Angron-the-primarch / etc.
    //   "WRATHFUL PRESENCE" for Angron's toggles
    //   "TRIARCH ABILITIES" for Silent King
    // Hint text is generic — the parent ability (above) has the
    // specific "select one/two" wording.
    subGroups.forEach((rows, label) => {
      const friendlyLabel = label.charAt(0) + label.slice(1).toLowerCase();
      html += `<div class="detail-section detail-section-primarch">
        <div class="detail-section-title detail-section-title-primarch">${esc(friendlyLabel)} <span class="detail-primarch-hint">pick from these each turn</span></div>`;
      rows.forEach(ab => {
        html += `<div class="detail-ability detail-ability-primarch">
          <span class="detail-ability-name">${esc(ab.name)}:</span>
          <span class="detail-ability-desc">${esc(ab.description || '—')}</span>
        </div>`;
      });
      html += `</div>`;
    });

    const modelNums = [...new Set(squadOptions.map(o => o.models).filter(m => m != null))].sort((a, b) => a - b);
    const compLabel = modelNums.length === 0 ? null
      : modelNums.length === 1 ? `${modelNums[0]} model${modelNums[0] !== 1 ? 's' : ''}`
      : `${modelNums[0]}–${modelNums[modelNums.length - 1]} models`;

    const modelTypeOpts = wargearOpts.filter(o => o.type === 'model');
    const choiceOpts    = wargearOpts.filter(o => o.type !== 'model');

    // ── GDC-driven wargear/composition (preferred when present) ──
    // game-datacards-eu ships pre-formatted wargear option strings + a default
    // loadout line + canonical composition lines. When we have those we render
    // them in place of the BSData-derived Loadout section, which has parser
    // edge cases for some units. Coverage is faction-dependent (e.g. Imperial
    // Knights, Titans aren't in GDC) so we fall back to BSData below.
    const gdcWargear     = Array.isArray(unit.gdcWargear) ? unit.gdcWargear : null;
    const gdcLoadoutText = (typeof unit.gdcLoadout === 'string') ? unit.gdcLoadout : '';
    const gdcComposition = Array.isArray(unit.gdcComposition) ? unit.gdcComposition : null;
    const useGdc = !!(gdcWargear || gdcLoadoutText || gdcComposition);

    if (useGdc) {
      const sectionTitle = (gdcWargear && gdcWargear.length > 0) ? 'Wargear Options' : 'Loadout';
      html += `<div class="detail-section"><div class="detail-section-title">${esc(sectionTitle)}</div>`;

      if (gdcComposition && gdcComposition.length > 0) {
        html += `<div class="wl-composition">${gdcComposition.map(esc).join(' · ')}</div>`;
      }

      if (gdcLoadoutText) {
        html += `<div class="wl-defaults">
          <span class="wl-defaults-label">Default:</span>
          <span class="wl-defaults-weapons">${esc(gdcLoadoutText)}</span>
        </div>`;
      }

      if (gdcWargear && gdcWargear.length > 0) {
        gdcWargear.forEach(line => {
          // GDC encodes "X can be replaced with one of the following: ◦ A ◦ B …"
          // by separating the heading from each option with a ◦. Split on ◦,
          // first piece is the description, the rest are sub-bullets.
          const parts = String(line).split(/\s*◦\s*/);
          const head = (parts[0] || '').replace(/:\s*$/, '').trim();
          const subs = parts.slice(1).map(s => s.trim()).filter(Boolean);
          html += `<div class="wl-choice-group">`;
          if (head) html += `<div class="wl-choice-group-title">${esc(head)}</div>`;
          if (subs.length > 0) {
            html += `<ul class="wl-choice-list">`;
            subs.forEach(s => { html += `<li>${esc(s)}</li>`; });
            html += `</ul>`;
          }
          html += `</div>`;
        });
      }

      html += `</div>`;
    } else if (compLabel || wargearOpts.length > 0) {
      html += `<div class="detail-section"><div class="detail-section-title">Loadout</div>`;

      if (compLabel) {
        html += `<div class="wl-composition">${esc(compLabel)}</div>`;
      }

      modelTypeOpts.forEach(opt => {
        let countStr = '';
        if (opt.modelMin != null && opt.modelMax != null) {
          if (opt.modelMin === opt.modelMax) {
            countStr = `${opt.modelMin} model${opt.modelMin !== 1 ? 's' : ''}`;
          } else if (opt.modelMin === 0) {
            // Optional model variant ("up to N of these can be swapped in").
            // Render as "up to N models" rather than "0–N models" — clearer.
            countStr = `up to ${opt.modelMax} model${opt.modelMax !== 1 ? 's' : ''}`;
          } else {
            countStr = `${opt.modelMin}–${opt.modelMax} models`;
          }
        } else if (opt.modelMax != null) {
          countStr = `up to ${opt.modelMax} model${opt.modelMax !== 1 ? 's' : ''}`;
        } else if (opt.modelMin != null) {
          countStr = `${opt.modelMin}+ models`;
        }

        html += `<div class="wl-model-block"><div class="wl-model-header">
          <span class="wl-model-name">${esc(opt.modelName)}</span>`;
        if (countStr) html += `<span class="wl-model-count">${esc(countStr)}</span>`;
        html += `</div>`;

        if (opt.defaultWeapons && opt.defaultWeapons.length > 0) {
          html += `<div class="wl-defaults">
            <span class="wl-defaults-label">Default:</span>
            <span class="wl-defaults-weapons">${opt.defaultWeapons.map(esc).join(' · ')}</span>
          </div>`;
        }

        (opt.subOptions || []).forEach(sub => {
          const subCtx = sub.max === 1 ? ' — choose one' : sub.max > 1 ? ` — choose up to ${sub.max}` : '';
          html += `<div class="wl-suboption">
            <div class="wl-suboption-title">${esc(sub.name)}${subCtx}</div>
            <ul class="wl-choice-list">`;
          (sub.choices || []).forEach(c => {
            html += `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`;
          });
          html += `</ul></div>`;
        });

        html += `</div>`;
      });

      choiceOpts.forEach(opt => {
        const name    = typeof opt === 'object' ? (opt.name || '') : opt;
        const choices = typeof opt === 'object' && opt.choices ? opt.choices : [];
        const maxSpan = typeof opt === 'object' && opt.max != null
          ? ` <span class="wl-max">(max ${opt.max})</span>` : '';
        html += `<div class="wl-choice-group">
          <div class="wl-choice-group-title">${esc(name)}${maxSpan}</div>`;
        if (choices.length > 0) {
          html += `<ul class="wl-choice-list">`;
          choices.forEach(c => { html += `<li>${esc(typeof c === 'object' ? c.name : c)}</li>`; });
          html += `</ul>`;
        }
        html += `</div>`;
      });

      html += `</div>`;
    }

    if (keywords.length > 0) {
      html += `<div class="detail-section">
        <div class="detail-section-title">Keywords</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${keywords.map(k => `<span class="keyword-tag">${esc(k)}</span>`).join('')}
        </div>
      </div>`;
    }

    // 10e rule: enhancements require the Character keyword AND the unit
    // must NOT be an Epic Hero (named special characters can't take
    // enhancements per 10e core rules).
    const kws = unit.keywords || [];
    const isCharacter = kws.some(k => String(k).toLowerCase() === 'character');
    const isEpicHero  = kws.some(k => String(k).toLowerCase() === 'epic hero');
    const canTakeEnhancement = isCharacter && !isEpicHero;
    // Show the section when the unit can take enhancements, or when a
    // detachment with enhancements is loaded — that way users always see
    // where the feature lives, with a contextual hint when they haven't
    // selected a detachment yet. Epic Heroes with no detachment loaded
    // get nothing (the "pick a detachment" hint would be misleading).
    if (canTakeEnhancement || (detachmentEnhancements && detachmentEnhancements.length > 0)) {
      const selectedNames = new Set((selectedEnhancements || []).map(e => e.name));
      html += `<div class="detail-section" id="detail-enhancements-section">
        <div class="detail-section-title">Enhancements</div>`;

      if (!detachmentEnhancements || detachmentEnhancements.length === 0) {
        html += `<div class="detail-enhancements-empty">
          Pick a detachment with enhancements (top-left) to apply one to this character.
        </div></div>`;
      } else {
        const ineligNote = isEpicHero
          ? 'Epic Hero — cannot take enhancements'
          : 'Character-only';
        const ineligTitle = isEpicHero
          ? 'Epic Heroes cannot take enhancements'
          : 'Character-only';
        html += `<div class="detail-enhancements-list">`;
        detachmentEnhancements.forEach(enh => {
          const checked = selectedNames.has(enh.name) ? ' checked' : '';
          const ineligClass = canTakeEnhancement ? '' : ' enhancement-ineligible';
          html += `<label class="enhancement-cb-item${ineligClass}"${!canTakeEnhancement ? ` title="${esc(ineligTitle)}"` : ''}>
            <input type="checkbox" class="enhancement-cb" value="${esc(enh.name)}"${checked}
              data-enh-pts="${enh.pts || 0}" data-enh-name="${esc(enh.name)}" data-enh-desc="${esc(enh.description || '')}"/>
            <span class="enh-cb-body">
              <span class="enh-cb-header">
                <span class="enh-cb-name">${esc(enh.name)}</span>
                <span class="enh-cb-pts">${enh.pts ? enh.pts + ' pts' : ''}</span>
              </span>
              <span class="enh-cb-desc">${esc(enh.description || '')}</span>
              ${!canTakeEnhancement ? `<span class="enh-cb-ineligible-note">${esc(ineligNote)}</span>` : ''}
            </span>
          </label>`;
        });
        html += `</div></div>`;
      }
    }

    html += `</div>`;

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    panel.insertAdjacentHTML('beforeend', html);

    document.getElementById('btn-google-images').addEventListener('click', e => {
      const name = e.currentTarget.dataset.unit;
      window.open('https://www.google.com/search?q=' + encodeURIComponent('warhammer 40k ' + name + ' miniature') + '&tbm=isch', 'yaab_img');
    });

    // Wire hook-registered detail action buttons.
    const actions = (window.App && App.hooks && App.hooks.detailActions) || [];
    panel.querySelectorAll('.detail-action-btn').forEach(btn => {
      const id = btn.dataset.actionId;
      const action = actions.find(a => a.id === id);
      if (action && typeof action.onClick === 'function') {
        btn.addEventListener('click', () => action.onClick(unit));
      }
    });

    // Led-By: clicking the section title or "+N more" pill toggles collapse.
    const ledbyList = panel.querySelector('.detail-ledby-list');
    if (ledbyList) {
      const expand = () => ledbyList.classList.remove('collapsed');
      const toggle = () => ledbyList.classList.toggle('collapsed');
      const title = panel.querySelector('.detail-ledby-title');
      if (title) {
        title.addEventListener('click', toggle);
        title.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }
      const pill = panel.querySelector('.ledby-more-pill');
      if (pill) {
        pill.addEventListener('click', e => { e.stopPropagation(); expand(); });
        pill.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); }
        });
      }
    }
  };

  // Stratagem descriptions follow GW's "WHEN: … TARGET: … EFFECT: …
  // [RESTRICTIONS: …]" datacard convention. Splitting on the uppercase
  // label tokens lets us render each clause as its own labelled block,
  // matching how the official datasheets read.
  function splitStratagemSections(text) {
    if (!text) return [];
    // Match label tokens that look like the GW labels: 2+ uppercase
    // letters (with optional internal spaces / ampersand) followed by a
    // colon and a space. Keeps captures so we can pair labels with the
    // text that follows them.
    const re = /\b([A-Z][A-Z &]{1,})\s*:\s/g;
    const matches = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ label: m[1].trim(), start: m.index, contentStart: m.index + m[0].length });
    }
    if (matches.length === 0) return [{ label: '', text: text.trim() }];
    const out = [];
    // Anything before the first label is a preface (rare — included
    // verbatim above the labelled blocks).
    if (matches[0].start > 0) {
      const pre = text.slice(0, matches[0].start).trim();
      if (pre) out.push({ label: '', text: pre });
    }
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const next = matches[i + 1];
      const body = text.slice(cur.contentStart, next ? next.start : text.length).trim()
        .replace(/\s*\.\s*$/, ''); // trim trailing dot — re-added by CSS layout, not needed inline
      out.push({ label: cur.label, text: body });
    }
    return out;
  }

  UI.renderRuleDetail = function (data) {
    const esc = UI.escapeHtml;
    const panel = document.getElementById('unit-detail-panel');
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = 'none';

    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();

    const isEnhancement = data.type === 'enhancement';
    const isStratagem   = data.type === 'stratagem';

    let body;
    if (isStratagem) {
      const sections = splitStratagemSections(data.description || '');
      if (sections.length === 0) {
        body = `<p class="strat-section-empty">No description available.</p>`;
      } else {
        body = '<div class="strat-sections">' + sections.map(s => {
          if (!s.label) {
            return `<p class="strat-section-text strat-section-preface">${esc(s.text)}</p>`;
          }
          return `<div class="strat-section">
            <div class="strat-section-label">${esc(s.label)}</div>
            <div class="strat-section-text">${esc(s.text)}</div>
          </div>`;
        }).join('') + '</div>';
      }
    } else {
      body = `<p style="font-size:13px;line-height:1.6;color:var(--text-muted)">${esc(data.description || 'No description available.')}</p>`;
    }

    let kindLabel = 'Army Rule';
    if (isEnhancement) kindLabel = 'Enhancement';
    else if (isStratagem) kindLabel = 'Stratagem';

    let sectionTitle = 'Rule';
    if (isEnhancement) sectionTitle = 'Enhancement';
    else if (isStratagem) sectionTitle = 'Stratagem';

    let headerActions = '';
    if (isEnhancement && data.pts) {
      headerActions = `<div class="detail-header-actions detail-banner-actions"><span class="detail-pts detail-banner-pts">${esc(String(data.pts))} pts</span></div>`;
    } else if (isStratagem && data.cp != null) {
      headerActions = `<div class="detail-header-actions detail-banner-actions"><span class="detail-pts detail-banner-pts">${esc(String(data.cp))} CP</span></div>`;
    }

    let subtitleExtra = '';
    if (isStratagem && data.phase) {
      subtitleExtra = ` <span class="detail-rule-phase">· ${esc(data.phase)}</span>`;
    }

    panel.insertAdjacentHTML('beforeend', `
      <div class="unit-detail-content unit-detail-rule" data-detail-kind="rule">
        <div class="detail-header detail-banner detail-banner-rule">
          <div class="detail-header-main">
            <div class="detail-name">${esc(data.name)}</div>
            <div class="detail-meta detail-banner-subtitle">
              <span class="detail-rule-kind">${kindLabel}</span>${subtitleExtra}
            </div>
          </div>
          ${headerActions}
        </div>
        <div class="detail-section">
          <div class="detail-section-title">${sectionTitle}</div>
          ${body}
        </div>
      </div>
    `);
  };

  UI.clearUnitDetail = function () {
    const panel = document.getElementById('unit-detail-panel');
    const existing = panel.querySelector('.unit-detail-content');
    if (existing) existing.remove();
    const empty = document.getElementById('unit-detail-empty');
    if (empty) empty.style.display = '';
  };
})();
