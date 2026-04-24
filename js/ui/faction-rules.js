// ui/faction-rules.js — renders Army Rules + Detachment Rule + Enhancements list.
(function () {
  const UI = window.UI = window.UI || {};

  UI.updateFactionRules = function (faction, detachment = null) {
    const esc          = UI.escapeHtml;
    const section      = document.getElementById('army-rules-section');
    const armySubsec   = document.getElementById('army-rules-subsection');
    const detSubsec    = document.getElementById('army-detachment-subsection');
    const enhSubsec    = document.getElementById('army-stratagem-subsection');
    const armyList     = document.getElementById('army-rules-list');
    const detList      = document.getElementById('army-detachment-rules-list');
    const enhList      = document.getElementById('army-stratagems-list');
    if (!section || !armyList || !enhList) return;

    const rules        = (faction && faction.armyRules)  || [];
    const detRules     = (detachment && detachment.rules) || [];
    const enhancements = (detachment && detachment.enhancements) || [];

    if (rules.length === 0 && detRules.length === 0 && enhancements.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

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
  };
})();
