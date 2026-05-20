// app/resize.js — drag-to-resize handles for left/right panels.
(function () {
  const App = window.App = window.App || {};

  App.setupResizablePanels = function () {
    const root = document.documentElement;

    function makeResizable(handleId, cssVar, side) {
      const handle = document.getElementById(handleId);
      if (!handle) return;
      let startX, startWidth;

      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        handle.classList.add('dragging');
        const main = document.getElementById('app-main');
        if (main) main.classList.add('is-resizing');
        startX = e.clientX;
        // Fallback matches the :root default in style.css (--col-left: 330px,
        // --col-right: 420px). Only fires when the computed var resolves
        // to empty, which shouldn't happen in practice but is defensive.
        const fallback = cssVar === '--col-right' ? 420 : 330;
        startWidth = parseInt(getComputedStyle(root).getPropertyValue(cssVar)) || fallback;

        function onMove(e) {
          const delta = e.clientX - startX;
          const newW = side === 'left'
            ? Math.max(200, Math.min(600, startWidth + delta))
            : Math.max(250, Math.min(700, startWidth - delta));
          root.style.setProperty(cssVar, newW + 'px');
        }
        function onUp() {
          handle.classList.remove('dragging');
          if (main) main.classList.remove('is-resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    }

    makeResizable('resize-left',  '--col-left',  'left');
    makeResizable('resize-right', '--col-right', 'right');
  };
})();
