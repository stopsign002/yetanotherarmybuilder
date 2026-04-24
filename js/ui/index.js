// ui/index.js — assembles window.UI from submodules and owns init().
(function () {
  const UI = window.UI = window.UI || {};
  UI._state = null;

  UI.init = function (state) {
    UI._state = state;
    if (typeof UI._initTooltip === 'function') UI._initTooltip();
  };
})();
