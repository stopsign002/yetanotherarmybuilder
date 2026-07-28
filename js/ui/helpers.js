// ui/helpers.js — shared escapeHtml + stat constants used across UI modules.
(function () {
  const UI = window.UI = window.UI || {};

  UI.escapeHtml = function (str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

  // ── GW prose markup ─────────────────────────────────────────────────────
  // GDC's rules text carries `**bold**` — 6.5k strings across stratagems,
  // enhancements, abilities, detachment rules, composition and loadout lines.
  // js/gdc.js also normalises GW's own <b> tags INTO `**` (cleanMarkup), so
  // every renderer of that prose has to convert it or the user reads literal
  // asterisks. Two forms, because the target context differs:
  //
  //   mdBold   → HTML body text. Escapes FIRST, then injects <strong>, so the
  //              only markup in the result is the tag we added.
  //   mdPlain  → attribute values (title="…", data-tooltip="…") and anywhere
  //              else HTML can't render. Drops the markers instead of bolding,
  //              because a tooltip would otherwise literally read "**CRYPTEK**".
  //
  // Only the paired `**` form is touched. A bare single `*` is left alone: 40k
  // stat text uses it (`D6+*`, `2D6*`) and eating those would corrupt real values.
  // The closing `**` must not itself be followed by a `*`. GW bolds runs whose
  // text legitimately ENDS in a footnote asterisk — "**1-2 Gun Servitors***" is
  // bold "1-2 Gun Servitors*" — and a plain non-greedy match closes too early,
  // leaving a stray asterisk outside the tag. The trailing sweep drops markers
  // GW never closed at all (15 strings open with `**` and end with a single
  // `*`); losing the emphasis on those beats showing raw asterisks.
  const BOLD_RE = /\*\*([\s\S]+?)\*\*(?!\*)/g;

  UI.mdBold = function (str) {
    return UI.escapeHtml(str).replace(BOLD_RE, '<strong>$1</strong>').replace(/\*\*/g, '');
  };

  UI.mdPlain = function (str) {
    return UI.escapeHtml(String(str == null ? '' : str).replace(/\*\*/g, ''));
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
