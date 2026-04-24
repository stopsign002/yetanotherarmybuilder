// ui/helpers.js — shared escapeHtml + stat constants used across UI modules.
(function () {
  const UI = window.UI = window.UI || {};

  UI.escapeHtml = function (str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

  UI._STAT_ALIASES = {
    M:  ['M'],
    T:  ['T'],
    SV: ['SV', 'Sv', 'sv'],
    W:  ['W'],
    LD: ['LD', 'Ld'],
    OC: ['OC'],
  };
  UI._CARD_STAT_PREF = ['M', 'T', 'SV', 'W', 'LD', 'OC'];
})();
