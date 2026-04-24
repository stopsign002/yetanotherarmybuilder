// ui/modals.js — load / import / export modal show & hide helpers.
(function () {
  const UI = window.UI = window.UI || {};

  UI.showLoadModal = function (armies) {
    const esc = UI.escapeHtml;
    const list = document.getElementById('saved-army-list');
    list.innerHTML = '';

    if (!armies || armies.length === 0) {
      list.innerHTML = '<li class="saved-army-empty">No saved armies found.</li>';
    } else {
      armies.forEach(army => {
        const li = document.createElement('li');
        li.className = 'saved-army-item';
        const total = army.getTotalPoints ? army.getTotalPoints() : 0;
        const date  = army.updatedAt ? new Date(army.updatedAt).toLocaleDateString() : '';
        li.innerHTML = `
          <div class="saved-army-info">
            <div class="saved-army-name">${esc(army.name)}</div>
            <div class="saved-army-meta">${total} pts &bull; ${army.entries.length} unit${army.entries.length !== 1 ? 's' : ''}${date ? ' &bull; ' + date : ''}</div>
          </div>
          <div class="saved-army-actions">
            <button class="btn btn-sm btn-accent btn-load-saved"   data-id="${army.id}">Load</button>
            <button class="btn btn-sm btn-outline btn-delete-saved" data-id="${army.id}">Delete</button>
          </div>
        `;
        list.appendChild(li);
      });
    }

    document.getElementById('modal-load').removeAttribute('hidden');
  };

  UI.hideLoadModal = function () {
    document.getElementById('modal-load').setAttribute('hidden', '');
  };

  UI.showImportModal = function () {
    document.getElementById('import-json-textarea').value = '';
    document.getElementById('modal-import').removeAttribute('hidden');
    setTimeout(() => document.getElementById('import-json-textarea').focus(), 50);
  };

  UI.hideImportModal = function () {
    document.getElementById('modal-import').setAttribute('hidden', '');
  };

  UI.showExportModal = function (code) {
    const ta = document.getElementById('export-string-textarea');
    ta.value = code;
    const sizeEl = document.getElementById('export-string-size');
    if (sizeEl) sizeEl.textContent = `${code.length} chars`;
    document.getElementById('modal-export').removeAttribute('hidden');
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
  };

  UI.hideExportModal = function () {
    document.getElementById('modal-export').setAttribute('hidden', '');
  };
})();
