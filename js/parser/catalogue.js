/* catalogue.js — top-level parse(): builds indexes, iterates units, extracts
 * detachments + enhancements + army rules + (best-effort) stratagems. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  // ── Stratagem heuristics ──────────────────────────────────────────────────
  // BSData wh40k-10e does NOT typically carry stratagem definitions in its
  // public XML (they sit behind a paywall). We still scan defensively: if any
  // <rule> entry inside or alongside a detachment looks stratagem-shaped
  // (CP cost in description, "/CP" suffix, "Battle Tactic", etc.) we surface
  // it. When nothing matches, the array stays empty — UI degrades gracefully.

  // Detect a CP cost like "1CP", "2 CP", "(1CP)" — defaults to 1 if missing.
  function parseCpCost(desc) {
    if (!desc) return 1;
    // Skip "0CP" embedded mid-sentence ("for 0CP") — that usually means an
    // ability lets a unit USE a stratagem at 0CP, not that the stratagem
    // itself is 0CP. Prefer a leading "X CP" pattern.
    const m = desc.match(/(?:^|\s|\()(\d)\s*CP\b/);
    return m ? parseInt(m[1], 10) : 1;
  }

  function detectPhase(text) {
    const t = (text || '').toLowerCase();
    if (/command\s+phase/.test(t))  return 'Command';
    if (/movement\s+phase/.test(t)) return 'Movement';
    if (/shooting\s+phase/.test(t)) return 'Shooting';
    if (/charge\s+phase/.test(t))   return 'Charge';
    if (/fight\s+phase/.test(t))    return 'Fight';
    if (/morale\s+phase/.test(t))   return 'Morale';
    return 'Any';
  }

  // Stratagem-shaped rule? Look for clear CP markers. Conservative — false
  // positives (like a detachment rule mentioning a stratagem in passing)
  // would crowd out the actual detachment rule we already extract.
  function looksLikeStratagem(name, desc) {
    if (!desc) return false;
    const txt = String(desc);
    // Strong signals first: "1CP", "2 CP", "/CP", "WHEN: ...", "TARGET: ...".
    if (/\b\d\s*CP\b/.test(txt) && /\bStratagem\b/i.test(txt)) return true;
    if (/\bWHEN:\s/i.test(txt) && /\bTARGET:\s/i.test(txt))    return true;
    if (/\bBattle\s+Tactic\b/i.test(txt) && /\b\d\s*CP\b/.test(txt)) return true;
    return false;
  }

  function buildStratagem(ruleEl, type) {
    const name = I.getAttr(ruleEl, 'name', '').trim();
    const descEl = ruleEl.querySelector(':scope > description');
    const description = descEl ? I.cleanText(descEl.textContent) : '';
    if (!name || !description) return null;
    if (!looksLikeStratagem(name, description)) return null;
    return {
      name,
      description,
      cp: parseCpCost(description),
      phase: detectPhase(description),
      type: type || 'detachment',
    };
  }

  function buildIndexes(root) {
    const entriesById  = new Map(I.sharedEntriesById);
    const profilesById = new Map(I.sharedProfilesById);
    const rulesById    = new Map(I.sharedRulesById);

    root.querySelectorAll(
      ':scope > sharedSelectionEntries > selectionEntry, ' +
      ':scope > sharedSelectionEntryGroups > selectionEntryGroup'
    ).forEach(el => {
      const id = el.getAttribute('id');
      if (id) entriesById.set(id, el);
    });

    root.querySelectorAll(':scope > sharedProfiles > profile').forEach(p => {
      const id = p.getAttribute('id');
      if (id) profilesById.set(id, p);
    });

    root.querySelectorAll(':scope > sharedRules > rule, :scope > rules > rule').forEach(r => {
      const id = r.getAttribute('id');
      if (id) rulesById.set(id, r);
    });

    return { entriesById, profilesById, rulesById };
  }

  function parse(xmlString, filename) {
    try {
      const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('XML parse error');
      }

      const root        = doc.documentElement;
      const factionName = I.getAttr(root, 'name') ||
        filename.replace(/\.(cat|xml)$/i, '').replace(/[-_]/g, ' ');

      const linkedCatalogues = [];
      root.querySelectorAll(':scope > catalogueLinks > catalogueLink[type="catalogue"]').forEach(lnk => {
        const n = I.getAttr(lnk, 'name', '').trim();
        if (n) linkedCatalogues.push(n);
      });

      const { entriesById, profilesById, rulesById } = buildIndexes(root);

      const units   = [];
      const seenIds = new Set();

      // Pattern A: units in selectionEntries
      root.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
        const t = I.getAttr(entry, 'type', '');
        if (t !== 'unit' && t !== 'model') return;
        if (I.isCrusadeSection(I.getAttr(entry, 'name', ''))) return;
        const unit = I.parseEntry(entry, entriesById, profilesById, rulesById, factionName);
        if (unit && !seenIds.has(unit.id)) {
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // Pattern B: units via root entryLinks → sharedSelectionEntries
      root.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
        if (I.getAttr(link, 'hidden', 'false') === 'true') return;
        const targetId = I.getAttr(link, 'targetId');
        if (seenIds.has(targetId)) return;
        const target = entriesById.get(targetId);
        if (!target) return;
        const t = I.getAttr(target, 'type', '');
        if (t !== 'unit' && t !== 'model') return;
        const linkName   = I.getAttr(link,   'name', '');
        const targetName = I.getAttr(target, 'name', '');
        if (I.isCrusadeSection(targetName) || I.isCrusadeSection(linkName)) return;
        // Legends-link fallback: entryLink name often carries "[Legends]" even when target does not.
        // Previously filtered out entirely; now let the flag flow through so the Legends toggle works.
        // if (linkName.includes('[Legends]') || targetName.includes('[Legends]')) return;
        const linkIsLegends = linkName.includes('[Legends]') || targetName.includes('[Legends]');
        const unit = I.parseEntry(target, entriesById, profilesById, rulesById, factionName);
        if (unit && !seenIds.has(unit.id)) {
          if (linkIsLegends) unit.isLegends = true;
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // Pattern C: units imported via catalogueLinks with importRootEntries="true".
      // Some factions (e.g. Imperial Knights, Chaos Knights) store all their unit
      // definitions in a "-Library" catalogue and import them via this mechanism.
      // The shared index was seeded with those root entryLinks during Phase 1.5.
      root.querySelectorAll(':scope > catalogueLinks > catalogueLink[importRootEntries="true"]').forEach(catLink => {
        const targetCatalogueId = I.getAttr(catLink, 'targetId');
        const rootLinks = I.sharedRootEntryLinksByCatalogueId.get(targetCatalogueId) || [];
        rootLinks.forEach(link => {
          if (I.getAttr(link, 'hidden', 'false') === 'true') return;
          const targetId = I.getAttr(link, 'targetId');
          if (seenIds.has(targetId)) return;
          const target = entriesById.get(targetId);
          if (!target) return;
          const t = I.getAttr(target, 'type', '');
          if (t !== 'unit' && t !== 'model') return;
          const linkName   = I.getAttr(link,   'name', '');
          const targetName = I.getAttr(target, 'name', '');
          if (I.isCrusadeSection(targetName) || I.isCrusadeSection(linkName)) return;
          const linkIsLegends = linkName.includes('[Legends]') || targetName.includes('[Legends]');
          const unit = I.parseEntry(target, entriesById, profilesById, rulesById, factionName);
          if (unit && !seenIds.has(unit.id)) {
            if (linkIsLegends) unit.isLegends = true;
            seenIds.add(unit.id);
            units.push(unit);
          }
        });
      });

      // ── Detachments ──
      const detachments = [];
      const detachmentRuleIds = new Set();
      const detachmentRuleNames = new Set();

      // Collect Detachment selectionEntryGroups from: local groups, and root-level
      // entryLinks named "Detachment"/"Detachments" whose target is a shared
      // group or upgrade wrapper. BSData is inconsistent — some factions use
      // singular "Detachment", others use plural "Detachments" (e.g. Aeldari
      // library, Adeptus Mechanicus, Grey Knights), and the wrapper SE may
      // contain an inner entryLink whose name disagrees with the outer one.
      // We accept both with a case-insensitive regex.
      const DETACH_NAME_RE = /^Detachments?$/i;
      const detachGroups = [];
      const seenDetachGroups = new Set();
      function addDetachGroup(g) {
        if (!g) return;
        const gid = g.getAttribute('id');
        if (gid && seenDetachGroups.has(gid)) return;
        if (gid) seenDetachGroups.add(gid);
        detachGroups.push(g);
      }
      // Local groups whose name matches /^Detachments?$/i.
      root.querySelectorAll('selectionEntryGroup').forEach(g => {
        const n = I.getAttr(g, 'name', '').trim();
        if (DETACH_NAME_RE.test(n)) addDetachGroup(g);
      });

      // Tyranids-style: top-level selectionEntry name="Detachment(s)" wraps an
      // entryLink whose targetId points into a library catalogue's shared group.
      //
      // Defensive guards: a malformed (or library-cycle) entryLink chain
      // could otherwise recurse forever — track visited targetIds AND
      // cap depth, so the parser can never wedge a worker.
      const MAX_DETACH_DEPTH = 8;
      const visitedDetachLinks = new Set();
      function walkDetachmentEntryLinks(scopeEl, depth) {
        if ((depth | 0) > MAX_DETACH_DEPTH) {
          console.warn('[Parser] walkDetachmentEntryLinks: max depth exceeded; aborting recursion');
          return;
        }
        // Accept both "Detachment" and "Detachments" (plural) — the BSData
        // Aeldari library wraps a singular outer link around a plural inner link.
        scopeEl.querySelectorAll(':scope > entryLinks > entryLink').forEach(link => {
          const linkName = I.getAttr(link, 'name', '').trim();
          if (!DETACH_NAME_RE.test(linkName)) return;
          const targetId = I.getAttr(link, 'targetId');
          if (!targetId || visitedDetachLinks.has(targetId)) return;
          visitedDetachLinks.add(targetId);
          const resolved = entriesById.get(targetId);
          if (!resolved) return;
          if (resolved.tagName === 'selectionEntryGroup') addDetachGroup(resolved);
          else walkDetachmentEntryLinks(resolved, (depth | 0) + 1);
        });
        // Chaos Daemons / Chaos Knights pattern: the wrapper selectionEntry
        // (resolved from a top-level entryLink into a Library catalogue) holds
        // its detachment list in a child <selectionEntryGroups>/<selectionEntryGroup
        // name="Detachment"> directly — no inner entryLink. Pick those up here
        // so the ~6 detachments per faction surface.
        scopeEl.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(g => {
          const gName = I.getAttr(g, 'name', '').trim();
          if (DETACH_NAME_RE.test(gName)) addDetachGroup(g);
        });
      }
      walkDetachmentEntryLinks(root, 0);
      // Top-level selectionEntries named "Detachment"/"Detachments" — Tyranid-style
      // wrappers that themselves contain entryLinks into shared groups.
      root.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(el => {
        const n = I.getAttr(el, 'name', '').trim();
        if (DETACH_NAME_RE.test(n)) walkDetachmentEntryLinks(el, 0);
      });
      // Genestealer Cults-style: the wrapper selectionEntry lives in
      // <sharedSelectionEntries> at root, with a root-level entryLink pointing
      // to it. The walkDetachmentEntryLinks above handles the entryLink, but
      // also walk shared SEs directly in case a future faction skips the link.
      root.querySelectorAll(':scope > sharedSelectionEntries > selectionEntry').forEach(el => {
        const n = I.getAttr(el, 'name', '').trim();
        if (DETACH_NAME_RE.test(n)) walkDetachmentEntryLinks(el, 0);
      });

      detachGroups.forEach(detachGroup => {
        detachGroup.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
          if (I.getAttr(entry, 'hidden', 'false') === 'true') return;
          const name = I.getAttr(entry, 'name', '').trim();
          if (!name || /^new\s/i.test(name)) return;
          if (I.isCrusadeSection(name)) return;

          const rules = [];
          const seenRuleIds = new Set();

          // Inline rules (SM pattern)
          entry.querySelectorAll(':scope > rules > rule').forEach(r => {
            if (I.getAttr(r, 'hidden', 'false') === 'true') return;
            const rName = I.getAttr(r, 'name', '').trim();
            if (!rName) return;
            const rId = I.getAttr(r, 'id', '');
            if (rId && seenRuleIds.has(rId)) return;
            if (rId) seenRuleIds.add(rId);
            const descEl = r.querySelector(':scope > description');
            rules.push({ name: rName, description: descEl ? I.cleanText(descEl.textContent) : '' });
            if (rId) detachmentRuleIds.add(rId);
            detachmentRuleNames.add(rName.toLowerCase());
          });

          // infoLinks → shared rules (Necrons pattern)
          entry.querySelectorAll(':scope > infoLinks > infoLink[type="rule"]').forEach(link => {
            if (I.getAttr(link, 'hidden', 'false') === 'true') return;
            const targetId = I.getAttr(link, 'targetId', '');
            if (!targetId) return;
            if (seenRuleIds.has(targetId)) return;
            seenRuleIds.add(targetId);
            const rule = rulesById.get(targetId);
            if (!rule) return;
            const rName = I.getAttr(rule, 'name', '').trim();
            if (!rName) return;
            const descEl = rule.querySelector(':scope > description');
            rules.push({ name: rName, description: descEl ? I.cleanText(descEl.textContent) : '' });
            detachmentRuleIds.add(targetId);
            detachmentRuleNames.add(rName.toLowerCase());
          });

          // Roll-table / sub-profile children of the detachment entry.
          // Some detachments (Dread Mob's "Try Dat Button!") encode a
          // D6 table as siblings of <rules>/<rule>: a group of
          // <profile> elements whose typeName matches a profileType
          // declared at the catalogue level (e.g. "Try Dat Button! - D6")
          // and whose name is the roll range ("1-2", "3-4", "5-6"). The
          // payload sits in a single non-Description characteristic
          // (e.g. "Button Effect"). Without scooping these in here the
          // rule prose surfaces but the table is silently dropped.
          // Group profiles by typeName and append them to the rule whose
          // name the typeName starts with; fall back to appending to the
          // last-pushed rule when no name match exists.
          const profsByType = new Map();
          entry.querySelectorAll(':scope > profiles > profile').forEach(p => {
            if (I.getAttr(p, 'hidden', 'false') === 'true') return;
            const tn = I.getAttr(p, 'typeName', '').trim();
            if (!tn) return;
            if (!profsByType.has(tn)) profsByType.set(tn, []);
            profsByType.get(tn).push(p);
          });
          if (profsByType.size > 0) {
            profsByType.forEach((profs, tn) => {
              const rows = profs.map(p => {
                const rowName = I.getAttr(p, 'name', '').trim();
                const valEls = p.querySelectorAll(':scope > characteristics > characteristic');
                const val = Array.from(valEls)
                  .map(c => I.cleanText(c.textContent || ''))
                  .filter(Boolean)
                  .join(' / ');
                return rowName && val ? rowName + ': ' + val : '';
              }).filter(Boolean);
              if (rows.length === 0) return;
              const tableText = rows.join('\n');
              // Pick the rule this table belongs to: typeName usually
              // starts with the rule name (e.g. typeName "Try Dat
              // Button! - D6" → rule "Try Dat Button!"). Fallback to
              // the last rule pushed.
              const lcTn = tn.toLowerCase();
              let target = rules.find(r => lcTn.startsWith(r.name.toLowerCase()));
              if (!target) target = rules[rules.length - 1];
              if (target) {
                target.description = (target.description ? target.description + '\n\n' : '')
                  + tableText;
              } else {
                rules.push({ name: tn, description: tableText });
              }
            });
          }

          // Stratagems (best-effort): scan inline <rules>/<rule> children of
          // the detachment selectionEntry that we did NOT count as the
          // detachment's main rule. BSData usually omits stratagems entirely
          // — if so, the array ends up empty and the UI degrades gracefully.
          const stratagems = [];
          const seenStratNames = new Set();
          entry.querySelectorAll(':scope > rules > rule').forEach(r => {
            if (I.getAttr(r, 'hidden', 'false') === 'true') return;
            const rId = I.getAttr(r, 'id', '');
            // Skip the rules we already classified as the detachment rule.
            if (rId && seenRuleIds.has(rId)) return;
            const strat = buildStratagem(r, 'detachment');
            if (!strat) return;
            if (seenStratNames.has(strat.name.toLowerCase())) return;
            seenStratNames.add(strat.name.toLowerCase());
            stratagems.push(strat);
          });
          // Also scan infoLink → shared rule pointers that aren't the detachment rule.
          entry.querySelectorAll(':scope > infoLinks > infoLink[type="rule"]').forEach(link => {
            if (I.getAttr(link, 'hidden', 'false') === 'true') return;
            const targetId = I.getAttr(link, 'targetId', '');
            if (!targetId || seenRuleIds.has(targetId)) return;
            const rule = rulesById.get(targetId);
            if (!rule) return;
            const strat = buildStratagem(rule, 'detachment');
            if (!strat) return;
            if (seenStratNames.has(strat.name.toLowerCase())) return;
            seenStratNames.add(strat.name.toLowerCase());
            stratagems.push(strat);
          });

          detachments.push({ name, rules, stratagems });
        });
      });

      // ── Enhancements (per detachment) ──
      const enhancementsByDetachment = {};
      const enhGroups = [];
      const seenEnhGroups = new Set();
      function addEnhGroup(g) {
        if (!g) return;
        const gid = g.getAttribute('id');
        if (gid && seenEnhGroups.has(gid)) return;
        if (gid) seenEnhGroups.add(gid);
        enhGroups.push(g);
      }
      root.querySelectorAll('selectionEntryGroup[name="Enhancements"]').forEach(addEnhGroup);
      // Tyranid-style: Enhancements group lives in the library catalogue behind an entryLink.
      root.querySelectorAll('entryLink[name="Enhancements"]').forEach(link => {
        const resolved = entriesById.get(I.getAttr(link, 'targetId'));
        if (resolved && resolved.tagName === 'selectionEntryGroup') addEnhGroup(resolved);
      });

      function extractEnhancementEntry(entry) {
        if (I.getAttr(entry, 'hidden', 'false') === 'true') return null;
        const name = I.getAttr(entry, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return null;
        if (I.isCrusadeSection(name)) return null;
        const costEl = entry.querySelector(':scope > costs > cost[name="pts"]');
        const pts = costEl ? Math.round(parseFloat(I.getAttr(costEl, 'value', '0'))) : 0;
        let description = '';
        const profile = entry.querySelector(':scope > profiles > profile[typeName="Abilities"]');
        if (profile) {
          const descEl = profile.querySelector(':scope > characteristics > characteristic');
          if (descEl) description = I.cleanText(descEl.textContent);
        }
        return { name, pts, description };
      }

      function pushEnhancement(detName, enh) {
        if (!detName || !enh) return;
        const list = enhancementsByDetachment[detName] || [];
        if (list.some(e => e.name === enh.name)) return;
        list.push(enh);
        enhancementsByDetachment[detName] = list;
      }

      enhGroups.forEach(enhGroup => {
        // Pattern A (Space Marines etc.): subgroups named "<Detachment> Enhancements"
        // each containing the detachment's selectionEntries.
        enhGroup.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(subGroup => {
          const groupName = I.getAttr(subGroup, 'name', '').trim();
          if (!/\s+Enhancements$/i.test(groupName)) return;
          const detName = groupName.replace(/\s+Enhancements$/i, '').trim();
          subGroup.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
            const enh = extractEnhancementEntry(entry);
            if (enh) pushEnhancement(detName, enh);
          });
        });
        // Pattern B (Necrons etc.): flat list — direct selectionEntries with a
        // <comment> child naming the owning detachment. Skip entries that are
        // already covered by the subgroup pattern.
        enhGroup.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
          const enh = extractEnhancementEntry(entry);
          if (!enh) return;
          const commentEl = entry.querySelector(':scope > comment');
          const detName = commentEl ? commentEl.textContent.trim() : '';
          if (!detName) return;
          pushEnhancement(detName, enh);
        });
      });

      // Pattern C: standalone shared selectionEntryGroups whose name ends
      // with " Enhancements" (e.g. "Headhunter Task Force Enhancements"
      // sits at the catalogue root, NOT inside the main "Enhancements"
      // group). Without this fallback those detachments lose every
      // enhancement, because the loop above only walks subgroups of
      // groups exactly named "Enhancements". Both shared (root-level)
      // and inline (catalogue-level) shared groups are scanned.
      const seenStandaloneGroups = new Set();
      const standaloneSelectors = [
        ':scope > sharedSelectionEntryGroups > selectionEntryGroup',
        ':scope > selectionEntryGroups > selectionEntryGroup',
      ];
      standaloneSelectors.forEach(sel => {
        root.querySelectorAll(sel).forEach(group => {
          if (seenEnhGroups.has(group.getAttribute('id'))) return;
          if (seenStandaloneGroups.has(group.getAttribute('id'))) return;
          const groupName = I.getAttr(group, 'name', '').trim();
          if (!/\s+Enhancements$/i.test(groupName)) return;
          // Skip the canonical "Enhancements" group itself (already handled).
          if (/^Enhancements$/i.test(groupName)) return;
          seenStandaloneGroups.add(group.getAttribute('id'));
          const detName = groupName.replace(/\s+Enhancements$/i, '').trim();
          group.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
            const enh = extractEnhancementEntry(entry);
            if (enh) pushEnhancement(detName, enh);
          });
        });
      });

      detachments.forEach(d => { d.enhancements = enhancementsByDetachment[d.name] || []; });

      // ── Army Rules ──
      const armyRules = [];
      const seenArmyRuleIds = new Set();
      root.querySelectorAll(':scope > rules > rule, :scope > sharedRules > rule').forEach(rule => {
        if (I.getAttr(rule, 'hidden', 'false') === 'true') return;
        const name = I.getAttr(rule, 'name', '').trim();
        if (!name || /^new\s/i.test(name)) return;
        if (I.isCrusadeSection(name)) return;
        const id = I.getAttr(rule, 'id', '');
        if (id && detachmentRuleIds.has(id)) return;
        if (detachmentRuleNames.has(name.toLowerCase())) return;
        if (id && seenArmyRuleIds.has(id)) return;
        if (id) seenArmyRuleIds.add(id);
        const descEl = rule.querySelector(':scope > description');
        armyRules.push({ name, description: descEl ? I.cleanText(descEl.textContent) : '' });
      });

      // ── Faction-wide stratagems (best-effort) ──
      // Scan top-level <sharedRules> and <rules> for stratagem-shaped
      // entries. Skip anything we already attributed to a detachment.
      const factionStratagems = [];
      const seenFactionStratNames = new Set();
      detachments.forEach(d => {
        (d.stratagems || []).forEach(s =>
          seenFactionStratNames.add(s.name.toLowerCase())
        );
      });
      root.querySelectorAll(':scope > sharedRules > rule, :scope > rules > rule').forEach(rule => {
        if (I.getAttr(rule, 'hidden', 'false') === 'true') return;
        const id = I.getAttr(rule, 'id', '');
        if (id && detachmentRuleIds.has(id)) return;
        const strat = buildStratagem(rule, 'faction');
        if (!strat) return;
        if (seenFactionStratNames.has(strat.name.toLowerCase())) return;
        seenFactionStratNames.add(strat.name.toLowerCase());
        factionStratagems.push(strat);
      });

      return { factionName, filename, unitCount: units.length, units, armyRules, detachments, factionStratagems, linkedCatalogues };

    } catch (err) {
      console.error('[Parser] Error in', filename, err);
      throw err;
    }
  }

  I.buildIndexes = buildIndexes;
  I.parse        = parse;
})();
