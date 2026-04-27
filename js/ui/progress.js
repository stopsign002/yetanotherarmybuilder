// ui/progress.js — top-of-page loading progress bar.
(function () {
  const UI = window.UI = window.UI || {};

  let _loadCompleteTimer = null;
  let _loadingComplete   = false;
  UI.loadingComplete     = false;

  UI.setLoadProgress = function (done, total) {
    if (_loadingComplete) return;

    const wrap        = document.getElementById('page-progress-wrap');
    const bar         = document.getElementById('page-progress-bar');
    const status      = document.getElementById('load-status');
    const spinner     = document.getElementById('load-spinner');
    const statusText  = document.getElementById('load-status-text');
    const statusCount = document.getElementById('load-status-count');

    if (total === 0) return;
    const pct = Math.round((done / total) * 100);

    wrap.hidden = false;
    bar.style.width = pct + '%';
    status.hidden = false;

    if (done >= total) {
      _loadingComplete = true;
      UI.loadingComplete = true;

      bar.style.width = '100%';
      if (spinner) spinner.style.display = 'none';
      statusText.textContent = 'All Factions Loaded';
      statusCount.textContent = `(${total})`;
      status.classList.add('load-complete');

      clearTimeout(_loadCompleteTimer);
      _loadCompleteTimer = setTimeout(() => {
        wrap.style.transition   = 'opacity 1s ease';
        status.style.transition = 'opacity 1s ease';
        wrap.style.opacity      = '0';
        status.style.opacity    = '0';
        setTimeout(() => {
          wrap.hidden = true;
          status.hidden = true;
          wrap.style.opacity = '';
          wrap.style.transition = '';
          status.style.opacity = '';
          status.style.transition = '';
          status.classList.remove('load-complete');
        }, 1000);
      }, 10000);
    } else {
      clearTimeout(_loadCompleteTimer);
      if (spinner) spinner.style.display = '';
      status.classList.remove('load-complete');
      statusText.textContent = 'Loading factions';
      statusCount.textContent = `${done} / ${total}`;
    }
  };
})();
