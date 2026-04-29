// app/mobile-shell.js — mobile-only chrome: sticky points pill at top of
// Army panel, dynamic page-title in topbar, back-arrow in Detail panel
// header. Pure additive — desktop is untouched.
//
// Activation: only injects DOM when window.matchMedia('(max-width: 820px)')
// matches at boot. Re-evaluates on resize so DevTools / orientation changes
// keep working. No new persistence keys.
(function () {
  const App = window.App = window.App || {};
  if (!App.hooks) return;

  const MOBILE_QUERY = '(max-width: 820px)';
  function isMobile() {
    try { return window.matchMedia && window.matchMedia(MOBILE_QUERY).matches; }
    catch (_) { return false; }
  }

  // ── 1. Sticky points pill in Army panel ──────────────────────────────
  // Mounts at top of #panel-left .panel-body. Reads state.currentArmy on
  // every armyChange and reflects faction + current/limit + bar.
  function ensurePtsPill() {
    const body = document.querySelector('#panel-left .panel-body');
    if (!body) return null;
    let pill = body.querySelector('.mobile-pts-pill');
    if (pill) return pill;
    pill = document.createElement('div');
    pill.className = 'mobile-pts-pill';
    pill.innerHTML =
      '<span class="mobile-pts-pill-faction" data-role="faction">No faction</span>' +
      '<span class="mobile-pts-pill-spacer"></span>' +
      '<span class="mobile-pts-pill-bar"><span class="mobile-pts-pill-bar-fill" data-role="bar"></span></span>' +
      '<span class="mobile-pts-pill-value" data-role="value">0 / 2000</span>';
    body.insertBefore(pill, body.firstChild);
    return pill;
  }

  function removePtsPill() {
    const pill = document.querySelector('.mobile-pts-pill');
    if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
  }

  function updatePtsPill() {
    if (!isMobile()) return;
    const pill = ensurePtsPill();
    if (!pill) return;
    const army = App.state && App.state.currentArmy;
    let factionLabel = 'No faction';
    let pts = 0;
    let limit = 0;
    try {
      if (army) {
        pts = (typeof army.totalPoints === 'function') ? army.totalPoints() : (army.pts || 0);
        limit = army.pointsLimit || 0;
      }
      const sel = App.state && App.state.factionFilter;
      if (sel && sel !== 'all') {
        const short = sel.includes(' - ') ? sel.split(' - ').pop().trim() : sel;
        factionLabel = short;
      }
    } catch (_) {}

    const factionEl = pill.querySelector('[data-role="faction"]');
    const valueEl   = pill.querySelector('[data-role="value"]');
    const barEl     = pill.querySelector('[data-role="bar"]');
    if (factionEl) factionEl.textContent = factionLabel;
    if (valueEl) {
      valueEl.textContent = pts + ' / ' + (limit || '—');
      valueEl.classList.toggle('over', limit > 0 && pts > limit);
    }
    if (barEl) {
      const pct = limit > 0 ? Math.min(120, Math.round((pts / limit) * 100)) : 0;
      barEl.style.width = Math.min(100, pct) + '%';
      barEl.classList.toggle('over', limit > 0 && pts > limit);
      barEl.classList.toggle('near', limit > 0 && pts > limit * 0.85 && pts <= limit);
    }
  }

  // ── 2. Back-arrow in Detail panel header ─────────────────────────────
  // On mobile, prepends a "<" button into #panel-right .panel-header that
  // calls App.setMobilePanel('units'). Hidden by CSS on desktop.
  function ensureDetailBackBtn() {
    const header = document.querySelector('#panel-right .panel-header');
    if (!header) return;
    if (header.querySelector('.mobile-back-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-back-btn';
    btn.setAttribute('aria-label', 'Back to units');
    btn.innerHTML = '&larr;';
    btn.addEventListener('click', () => {
      if (typeof App.setMobilePanel === 'function') App.setMobilePanel('units');
    });
    header.insertBefore(btn, header.firstChild);
  }

  // ── 3. Dynamic page-title in topbar ──────────────────────────────────
  // Mounts a <span class="mobile-page-title"> inside .topbar-inner. Updates
  // text based on current data-mobile-panel and selected faction.
  function ensurePageTitle() {
    if (document.querySelector('.mobile-page-title')) return;
    const inner = document.querySelector('.topbar-inner');
    if (!inner) return;
    const span = document.createElement('span');
    span.className = 'mobile-page-title';
    span.setAttribute('aria-live', 'polite');
    span.innerHTML =
      '<span class="mobile-page-title-main" data-role="main">Units</span>' +
      '<span class="mobile-page-title-sub"  data-role="sub"></span>';
    // Insert after the brand (first child).
    const brand = inner.querySelector('.topbar-brand');
    if (brand && brand.nextSibling) {
      inner.insertBefore(span, brand.nextSibling);
    } else {
      inner.appendChild(span);
    }
  }

  const PANEL_LABELS = { army: 'Army', units: 'Units', detail: 'Details' };

  function updatePageTitle() {
    const span = document.querySelector('.mobile-page-title');
    if (!span) return;
    const panel = (document.body.dataset.mobilePanel) || 'units';
    const main = span.querySelector('[data-role="main"]');
    const sub  = span.querySelector('[data-role="sub"]');
    if (main) main.textContent = PANEL_LABELS[panel] || 'Units';

    let subtitle = '';
    try {
      if (panel === 'detail') {
        const u = App.state && App.state.selectedUnit;
        if (u && u.name) subtitle = u.name;
      } else {
        const sel = App.state && App.state.factionFilter;
        if (sel && sel !== 'all') {
          subtitle = sel.includes(' - ') ? sel.split(' - ').pop().trim() : sel;
        }
      }
    } catch (_) {}
    if (sub) sub.textContent = subtitle;
  }

  // ── 4. Init + listeners ──────────────────────────────────────────────
  function rebuild() {
    if (isMobile()) {
      ensurePageTitle();
      ensureDetailBackBtn();
      ensurePtsPill();
      updatePtsPill();
      updatePageTitle();
    } else {
      removePtsPill();
      // page-title and back-btn stay in DOM (CSS hides them on desktop) so
      // we don't churn the topbar on resize.
    }
  }

  App.hooks.bootstrap.push(function () {
    rebuild();
  });

  // armyChange → pts pill + sub-title (faction may have changed via load).
  if (App.hooks.armyChange && Array.isArray(App.hooks.armyChange)) {
    App.hooks.armyChange.push(function () {
      updatePtsPill();
      updatePageTitle();
    });
  }

  // selectionChange → faction sub-title and pts pill faction line.
  if (App.hooks.selectionChange && Array.isArray(App.hooks.selectionChange)) {
    App.hooks.selectionChange.push(function () {
      updatePtsPill();
      updatePageTitle();
    });
  }

  // Panel switch (dispatched by pwa-install.js).
  document.addEventListener('yaab:mobile-panel-change', updatePageTitle);

  // Resize / orientation: rebuild as we cross the 820px threshold.
  if (window.matchMedia) {
    try {
      window.matchMedia(MOBILE_QUERY).addEventListener('change', rebuild);
    } catch (_) {
      // Older Safari: fallback to resize.
      window.addEventListener('resize', rebuild);
    }
  }
})();
