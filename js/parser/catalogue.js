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
        const unit = I.parseEntry(entry, entriesById, profilesById, rulesById);
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
        const unit = I.parseEntry(target, entriesById, profilesById, rulesById);
        if (unit && !seenIds.has(unit.id)) {
          if (linkIsLegends) unit.isLegends = true;
          seenIds.add(unit.id);
          units.push(unit);
        }
      });

      // ── Detachments ──
      const detachments = [];
      const detachmentRuleIds = new Set();
      const detachmentRuleNames = new Set();

      // Collect Detachment selectionEntryGroups from: local groups, and root-level
      // entryLinks named "Detachment" whose target is a shared group or upgrade wrapper.
      const detachGroups = [];
      const seenDetachGroups = new Set();
      function addDetachGroup(g) {
        if (!g) return;
        const gid = g.getAttribute('id');
        if (gid && seenDetachGroups.has(gid)) return;
        if (gid) seenDetachGroups.add(gid);
        detachGroups.push(g);
      }
      root.querySelectorAll('selectionEntryGroup[name="Detachment"]').forEach(addDetachGroup);

      // Tyranids-style: top-level selectionEntry name="Detachment" wraps an entryLink
      // whose targetId points into a library catalogue's shared group.
      function walkDetachmentEntryLinks(scopeEl) {
        scopeEl.querySelectorAll(':scope > entryLinks > entryLink[name="Detachment"]').forEach(link => {
          const resolved = entriesById.get(I.getAttr(link, 'targetId'));
          if (!resolved) return;
          if (resolved.tagName === 'selectionEntryGroup') addDetachGroup(resolved);
          else walkDetachmentEntryLinks(resolved);
        });
      }
      walkDetachmentEntryLinks(root);
      root.querySelectorAll(':scope > selectionEntries > selectionEntry[name="Detachment"]').forEach(walkDetachmentEntryLinks);

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

      enhGroups.forEach(enhGroup => {
        enhGroup.querySelectorAll(':scope > selectionEntryGroups > selectionEntryGroup').forEach(subGroup => {
          const groupName = I.getAttr(subGroup, 'name', '').trim();
          if (!/\s+Enhancements$/i.test(groupName)) return;
          const detName = groupName.replace(/\s+Enhancements$/i, '').trim();
          const enhancements = enhancementsByDetachment[detName] || [];
          const seenEnhNames = new Set(enhancements.map(e => e.name));
          subGroup.querySelectorAll(':scope > selectionEntries > selectionEntry').forEach(entry => {
            if (I.getAttr(entry, 'hidden', 'false') === 'true') return;
            const name = I.getAttr(entry, 'name', '').trim();
            if (!name || /^new\s/i.test(name)) return;
            if (I.isCrusadeSection(name)) return;
            if (seenEnhNames.has(name)) return;
            seenEnhNames.add(name);
            const costEl = entry.querySelector(':scope > costs > cost[name="pts"]');
            const pts = costEl ? Math.round(parseFloat(I.getAttr(costEl, 'value', '0'))) : 0;
            let description = '';
            const profile = entry.querySelector(':scope > profiles > profile[typeName="Abilities"]');
            if (profile) {
              const descEl = profile.querySelector(':scope > characteristics > characteristic');
              if (descEl) description = I.cleanText(descEl.textContent);
            }
            enhancements.push({ name, pts, description });
          });
          if (enhancements.length > 0) enhancementsByDetachment[detName] = enhancements;
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
