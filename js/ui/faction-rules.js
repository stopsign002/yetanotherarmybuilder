// ui/faction-rules.js — renders Army Rules + Detachment Rule + Enhancements + Stratagems list.
(function () {
  const UI = window.UI = window.UI || {};

  // Markup template for the inner subsections — used both as the initial
  // body when the empty-state placeholder gets replaced, and as a self-heal
  // fallback if a previous render swapped the section's innerHTML.
  const SUBSECTIONS_HTML =
    '<div class="army-rules-subsection" id="army-rules-subsection" hidden>' +
      '<div class="army-rules-title">Army Rules</div>' +
      '<div class="army-rules-list" id="army-rules-list"></div>' +
    '</div>' +
    '<div class="army-rules-subsection" id="army-detachment-subsection" hidden>' +
      '<div class="army-rules-title">Detachment Rule</div>' +
      '<div class="army-rules-list" id="army-detachment-rules-list"></div>' +
    '</div>' +
    '<div class="army-rules-subsection" id="army-stratagem-subsection" hidden>' +
      '<div class="army-rules-title">Enhancements</div>' +
      '<div class="army-rules-list" id="army-stratagems-list"></div>' +
    '</div>' +
    '<div class="army-rules-subsection" id="army-strats-subsection" hidden>' +
      '<div class="army-rules-title">Detachment Stratagems</div>' +
      '<div class="army-rules-list army-rules-list-scroll" id="army-strats-list"></div>' +
    '</div>' +
    '<div class="army-rules-subsection" id="army-strats-common-subsection" hidden>' +
      '<div class="army-rules-title">Common Stratagems</div>' +
      '<div class="army-rules-list army-rules-list-scroll" id="army-strats-common-list"></div>' +
    '</div>';

  UI.updateFactionRules = function (faction, detachment = null) {
    const esc         = UI.escapeHtml;
    const collapsible = document.getElementById('army-rules-collapsible');
    const section     = document.getElementById('army-rules-section');
    if (!section) return;

    // Defensive: if no detachment was passed but the app already has one
    // selected, use it. Some call sites (chapter-change, faction re-render
    // hooks) pass only `faction` and would otherwise wipe the enhancements
    // subsection even though the user has a detachment locked in.
    if (!detachment && window.App && App.state && App.state.selectedDetachment) {
      detachment = App.state.selectedDetachment;
    }

    const rules        = (faction && faction.armyRules)  || [];
    const detRules     = (detachment && detachment.rules) || [];
    const enhancements = (detachment && detachment.enhancements) || [];

    // Stratagems are split into TWO buckets in the UI:
    //   - Detachment Stratagems: detachment-specific (BSData rare + GDC) AND
    //     faction-wide strats. Together these are the "this army's strats".
    //   - Common Stratagems: the universal core list (Command Re-roll, etc.)
    //     shared by every faction.
    // BSData wh40k-10e doesn't ship 10e stratagem rules; GDC fills that gap
    // (see app/js/gdc.js). Names dedupe across all sources.
    const detStrats           = (detachment && Array.isArray(detachment.stratagems))    ? detachment.stratagems    : [];
    const detGdcStrats        = (detachment && Array.isArray(detachment.gdcStratagems)) ? detachment.gdcStratagems : [];
    const factionStrats       = (faction && Array.isArray(faction.factionStratagems))    ? faction.factionStratagems    : [];
    const factionGdcStrats    = (faction && Array.isArray(faction.gdcFactionStratagems)) ? faction.gdcFactionStratagems : [];
    const coreStrats          = (faction && window.App && Array.isArray(App.CORE_STRATAGEMS)) ? App.CORE_STRATAGEMS : [];
    const seenStratNames = new Set();
    const detachmentStrats = [];
    [detStrats, detGdcStrats, factionStrats, factionGdcStrats].forEach(arr => {
      arr.forEach(s => {
        if (!s || !s.name) return;
        const key = s.name.toLowerCase();
        if (seenStratNames.has(key)) return;
        seenStratNames.add(key);
        detachmentStrats.push(s);
      });
    });
    const commonStrats = [];
    coreStrats.forEach(s => {
      if (!s || !s.name) return;
      const key = s.name.toLowerCase();
      if (seenStratNames.has(key)) return;
      seenStratNames.add(key);
      commonStrats.push(s);
    });

    // The outer <details> stays visible from page load — even before factions
    // finish parsing — so the box doesn't pop into existence later. Only the
    // inner .army-rules-section is shown when there's actual content; when
    // empty we render a small placeholder so an expanded-but-empty box reads
    // as "pick a faction" instead of looking broken.
    if (collapsible) collapsible.hidden = false;
    const hasAnyContent = rules.length > 0 || detRules.length > 0 || enhancements.length > 0
        || detachmentStrats.length > 0 || commonStrats.length > 0;
    if (!hasAnyContent) {
      section.hidden = false;
      section.innerHTML = '<div class="army-rules-empty">Pick a faction and detachment to see rules &amp; stratagems.</div>';
      return;
    }
    // Restore the subsection containers if a previous empty-state render
    // replaced them. After this block the IDs below are guaranteed present.
    if (!document.getElementById('army-rules-subsection')) {
      section.innerHTML = SUBSECTIONS_HTML;
    }
    section.hidden = false;

    // (Re-)read element references — they may have been recreated by the
    // SUBSECTIONS_HTML rewrite just above.
    const armySubsec        = document.getElementById('army-rules-subsection');
    const detSubsec         = document.getElementById('army-detachment-subsection');
    const enhSubsec         = document.getElementById('army-stratagem-subsection');
    const stratSubsec       = document.getElementById('army-strats-subsection');
    const stratCommonSubsec = document.getElementById('army-strats-common-subsection');
    const armyList          = document.getElementById('army-rules-list');
    const detList           = document.getElementById('army-detachment-rules-list');
    const enhList           = document.getElementById('army-stratagems-list');
    const stratList         = document.getElementById('army-strats-list');
    const stratCommonList   = document.getElementById('army-strats-common-list');
    if (!armyList || !enhList) return;

    if (rules.length > 0) {
      armySubsec.hidden = false;
      armyList.innerHTML = '';
      rules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'army-rule-item';
        item.dataset.ruleName = rule.name;
        item.dataset.ruleDesc = rule.description || '';
        item.dataset.ruleType = 'rule';
        item.innerHTML = `<span>${esc(rule.name)}</span><span class="rule-arrow">&#9656;</span>`;
        armyList.appendChild(item);
      });
    } else {
      armySubsec.hidden = true;
    }

    if (detSubsec && detList) {
      if (detRules.length > 0) {
        detSubsec.hidden = false;
        detList.innerHTML = '';
        detRules.forEach(rule => {
          const item = document.createElement('div');
          item.className = 'army-rule-item';
          item.dataset.ruleName = rule.name;
          item.dataset.ruleDesc = rule.description || '';
          item.dataset.ruleType = 'rule';
          item.innerHTML = `<span>${esc(rule.name)}</span><span class="rule-arrow">&#9656;</span>`;
          detList.appendChild(item);
        });
      } else {
        detSubsec.hidden = true;
      }
    }

    if (enhSubsec && enhList) {
      if (enhancements.length > 0) {
        enhSubsec.hidden = false;
        enhList.innerHTML = '';
        enhancements.forEach(enh => {
          const item = document.createElement('div');
          item.className = 'army-rule-item enhancement-item';
          item.dataset.ruleName = enh.name;
          item.dataset.ruleDesc = enh.description || '';
          item.dataset.ruleType = 'enhancement';
          item.dataset.rulePts  = enh.pts || 0;
          const ptsBadge = enh.pts ? `<span class="enhancement-pts-badge">${enh.pts} pts</span>` : '';
          item.innerHTML = `<span>${esc(enh.name)}</span><span class="rule-item-right">${ptsBadge}<span class="rule-arrow">&#9656;</span></span>`;
          enhList.appendChild(item);
        });
      } else {
        enhSubsec.hidden = true;
      }
    }

    function renderStratItem(strat) {
      const item = document.createElement('div');
      item.className = 'army-rule-item stratagem-item';
      item.dataset.ruleName  = strat.name;
      item.dataset.ruleDesc  = strat.description || '';
      item.dataset.ruleType  = 'stratagem';
      if (strat.cp != null)    item.dataset.ruleCp    = strat.cp;
      if (strat.phase)         item.dataset.rulePhase = strat.phase;
      const cp = strat.cp != null ? strat.cp : '';
      const cpBadge = (cp !== '' && cp !== null) ? `<span class="cp-badge">${esc(String(cp))} CP</span>` : '';
      const phaseBadge = strat.phase ? `<span class="strat-phase-badge">${esc(strat.phase)}</span>` : '';
      item.innerHTML = `<span>${esc(strat.name)}</span><span class="rule-item-right">${phaseBadge}${cpBadge}<span class="rule-arrow">&#9656;</span></span>`;
      return item;
    }

    if (stratSubsec && stratList) {
      if (detachmentStrats.length > 0) {
        stratSubsec.hidden = false;
        stratList.innerHTML = '';
        detachmentStrats.forEach(s => stratList.appendChild(renderStratItem(s)));
      } else {
        stratSubsec.hidden = true;
      }
    }
    if (stratCommonSubsec && stratCommonList) {
      if (commonStrats.length > 0) {
        stratCommonSubsec.hidden = false;
        stratCommonList.innerHTML = '';
        commonStrats.forEach(s => stratCommonList.appendChild(renderStratItem(s)));
      } else {
        stratCommonSubsec.hidden = true;
      }
    }
  };
})();
