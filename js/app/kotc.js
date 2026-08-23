// app/kotc.js — "King of the Coliseum" box in the left panel.
//
// KOTC is a 600-point gladiator format with its own list-building
// restrictions. This module owns the box under Army setup / Detachments:
// it explains the format's rules, and — once the user ticks it on — checks
// the army against every one of them live, on each mutation.
//
// The checks are ADVISORY, exactly like js/app/validation.js: nothing is
// blocked, nothing is auto-removed. A failing rule shows as a red row with
// what's wrong, and the collapsed box's summary carries an issue-count badge
// so a violation is still visible with the box shut.
//
// Enablement is a device-level user pref (localStorage `yaab_kotc_enabled`),
// not army data — mirrors how Kill Team mode is stored, and keeps the KOTC
// flag out of the YAAB1 export / cloud sync payload.
(function () {
  const App = window.App = window.App || {};

  const STORAGE_KEY = 'yaab_kotc_enabled';
  const POINTS      = 600;   // format points limit
  const T_CAP       = 9;     // no model may exceed this Toughness
  const T_CAP_MAX   = 1;     // …and only this many units may sit AT the cap
  const INFANTRY_MIN = 2;    // required Infantry units, warlord excluded
  const BATTLELINE_COPIES = 2;
  const OTHER_COPIES      = 1;

  const esc = (s) => (window.UI && typeof UI.escapeHtml === 'function')
    ? UI.escapeHtml(s == null ? '' : String(s))
    : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  // ---------------------------------------------------------------------------
  // Enabled flag
  // ---------------------------------------------------------------------------
  function isEnabled() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {}
    render();
  }

  // ---------------------------------------------------------------------------
  // Unit helpers — keywords are a flat string array on unitData (dc-adapter),
  // but stay tolerant of the {name} object shape older snapshots could carry.
  // ---------------------------------------------------------------------------
  function keywordSet(entry) {
    const set = new Set();
    const kws = (entry && entry.unitData && entry.unitData.keywords) || [];
    kws.forEach(k => {
      const s = (typeof k === 'string') ? k : (k && (k.name || k.keyword)) || '';
      if (s) set.add(String(s).toLowerCase());
    });
    return set;
  }

  function hasKw(entry, kw) {
    return keywordSet(entry).has(String(kw).toLowerCase());
  }

  function isEpicHero(entry) {
    const ud = entry && entry.unitData;
    if (ud && String(ud.role || '') === 'epic-hero') return true;
    // 40kdc prints the keyword with a space; accept the hyphenated form too.
    return hasKw(entry, 'epic hero') || hasKw(entry, 'epic-hero');
  }

  // Highest Toughness across the datasheet — a multi-profile unit is judged on
  // its toughest model, which is what "nothing over T9" means at the table.
  function maxToughness(entry) {
    const ud = entry && entry.unitData;
    if (!ud) return 0;
    const vals = [];
    const push = (raw) => {
      if (raw == null) return;
      const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
      if (!isNaN(n)) vals.push(n);
    };
    if (ud.stats) push(ud.stats.T);
    if (Array.isArray(ud.modelStats)) ud.modelStats.forEach(ms => ms && push(ms.T));
    return vals.length ? Math.max.apply(null, vals) : 0;
  }

  const copies = (entry) => Math.max(0, (entry && entry.count) || 0);
  const entryName = (entry) =>
    (entry && (entry.unitName || (entry.unitData && entry.unitData.name))) || 'Unknown unit';

  // Sum of `detachment_points` across the selected detachments — the number
  // that decides who picks the twist.
  function detachmentInfo(army) {
    const names = (army && army.detachmentNames) || [];
    let dets = (App.state && App.state.selectedDetachments) || [];
    if (!dets.length && names.length && typeof App.getAvailableDetachments === 'function') {
      const avail = App.getAvailableDetachments() || [];
      dets = names.map(n => avail.find(d => d && d.name === n)).filter(Boolean);
    }
    return {
      count: names.length || dets.length,
      points: dets.reduce((s, d) => s + ((d && d.points) || 0), 0),
      priced: dets.length,
    };
  }

  // ---------------------------------------------------------------------------
  // The rules. Each returns { ok, detail, fix? } — `detail` is the line under
  // the rule title, `fix` an optional one-click remedy button.
  // ---------------------------------------------------------------------------
  function evaluate(army) {
    const entries = (army && army.entries) || [];
    const rows = [];

    // 1 — 600 points.
    (function () {
      let total = 0;
      try { total = army.getTotalPoints() || 0; } catch (_) { total = 0; }
      const limit = Number(army && army.pointsLimit) || 0;
      const overSpent = total > POINTS;
      const wrongLimit = limit !== POINTS;
      let detail = `${total} / ${POINTS} pts used`;
      if (overSpent) detail = `${total} pts — ${total - POINTS} over the ${POINTS} pt limit.`;
      else if (wrongLimit) detail += ` — this army's points limit is set to ${limit || 0}, not ${POINTS}.`;
      rows.push({
        title: `${POINTS} points`,
        rule: `The whole army is built to ${POINTS} points.`,
        ok: !overSpent && !wrongLimit,
        detail,
        fix: wrongLimit ? { action: 'limit', label: `Set limit to ${POINTS}` } : null,
      });
    })();

    // 2 — exactly one detachment, any size.
    (function () {
      const info = detachmentInfo(army);
      const ok = info.count === 1;
      let detail;
      if (info.count === 0) detail = 'No detachment selected yet.';
      else if (info.count === 1) detail = `1 detachment${info.priced ? ` · ${plural(info.points, 'detachment point')}` : ''}.`;
      else detail = `${info.count} detachments selected — KOTC allows exactly one.`;
      rows.push({
        title: 'One detachment',
        rule: 'One detachment of any size, but only the one.',
        ok, detail,
      });
    })();

    // 3 — a warlord. yaab has no per-entry warlord flag, so the check is
    // "could this army legally name one": at least one non-Epic Character.
    const characters = entries.filter(e => hasKw(e, 'character') && !isEpicHero(e));
    (function () {
      const ok = characters.length > 0;
      rows.push({
        title: 'A warlord',
        rule: 'The army must include a warlord. It does not count towards the Infantry requirement.',
        ok,
        detail: ok
          ? `${plural(characters.length, 'Character')} available to be your warlord.`
          : 'No Character in the army to take the warlord role.',
      });
    })();

    // 4 — two Infantry units, NOT counting the warlord. We don't know which
    // model is the warlord, so assume the arrangement most favourable to the
    // player: if any non-Infantry Character can carry it, no Infantry unit is
    // spent on the warlord; otherwise one Infantry Character is.
    (function () {
      const infantry = entries.filter(e => hasKw(e, 'infantry'));
      const infantryUnits = infantry.reduce((s, e) => s + copies(e), 0);
      const nonInfantryChar = characters.some(e => !hasKw(e, 'infantry'));
      const warlordCost = (characters.length && !nonInfantryChar) ? 1 : 0;
      const counted = Math.max(0, infantryUnits - warlordCost);
      const ok = counted >= INFANTRY_MIN;
      let detail = `${plural(counted, 'Infantry unit')} counting towards the minimum of ${INFANTRY_MIN}`;
      detail += warlordCost
        ? ' (one Infantry Character set aside as your warlord).'
        : '.';
      rows.push({
        title: `${INFANTRY_MIN} Infantry units`,
        rule: `At least ${INFANTRY_MIN} Infantry units, over and above the warlord.`,
        ok, detail,
      });
    })();

    // 5 — no Epic Heroes.
    (function () {
      const epics = entries.filter(isEpicHero);
      const names = [...new Set(epics.map(entryName))];
      rows.push({
        title: 'No Epic Heroes',
        rule: 'Named / Epic Hero characters are not allowed.',
        ok: epics.length === 0,
        detail: epics.length
          ? `Epic Hero in the army: ${names.map(esc).join(', ')}.`
          : 'No Epic Hero characters in the army.',
      });
    })();

    // 6 / 7 — the Toughness cap, and how many units may sit at it.
    const withT = entries.map(e => ({ e, t: maxToughness(e) }));
    (function () {
      const over = withT.filter(x => x.t > T_CAP);
      const names = [...new Set(over.map(x => `${entryName(x.e)} (T${x.t})`))];
      rows.push({
        title: `Nothing above Toughness ${T_CAP}`,
        rule: `No model in the army may have a Toughness characteristic higher than ${T_CAP}.`,
        ok: over.length === 0,
        detail: over.length
          ? `Too tough: ${names.map(esc).join(', ')}.`
          : `Every model is Toughness ${T_CAP} or lower.`,
      });
    })();
    (function () {
      const atCap = withT.filter(x => x.t === T_CAP);
      const n = atCap.reduce((s, x) => s + copies(x.e), 0);
      const names = [...new Set(atCap.map(x => entryName(x.e)))];
      rows.push({
        title: `Only ${T_CAP_MAX} Toughness ${T_CAP} unit`,
        rule: `At most ${T_CAP_MAX} unit in the army may be Toughness ${T_CAP}.`,
        ok: n <= T_CAP_MAX,
        detail: n
          ? `${plural(n, `Toughness ${T_CAP} unit`)}: ${names.map(esc).join(', ')}.`
          : `No Toughness ${T_CAP} units.`,
      });
    })();

    // 8 — datasheet copy limits. Battleline may be doubled; everything else
    // is unique. Counted per datasheet across ALL entries, since one datasheet
    // can be split over several entries (enhancements, wargear, custom names).
    (function () {
      const byUnit = new Map();
      entries.forEach(e => {
        const key = (e && e.unitId) || entryName(e);
        const cur = byUnit.get(key) || { name: entryName(e), n: 0, battleline: hasKw(e, 'battleline') };
        cur.n += copies(e);
        cur.battleline = cur.battleline || hasKw(e, 'battleline');
        byUnit.set(key, cur);
      });
      const bad = [];
      byUnit.forEach(u => {
        const cap = u.battleline ? BATTLELINE_COPIES : OTHER_COPIES;
        if (u.n > cap) bad.push(`${u.name} ×${u.n} (max ${cap})`);
      });
      rows.push({
        title: 'Datasheet copies',
        rule: `Up to ${BATTLELINE_COPIES} copies of a Battleline datasheet; only ${OTHER_COPIES} copy of any other datasheet.`,
        ok: bad.length === 0,
        detail: bad.length
          ? `Over the limit: ${bad.map(esc).join(', ')}.`
          : `${plural(byUnit.size, 'datasheet')} in the army, all within their copy limit.`,
      });
    })();

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const body  = document.getElementById('kotc-body');
    const badge = document.getElementById('kotc-status');
    if (!body) return;

    const on    = isEnabled();
    const army  = App.state && App.state.currentArmy;
    const rows  = army ? evaluate(army) : [];
    const empty = !army || !(army.entries || []).length;
    // With no units yet there is nothing to be wrong about — show the rules
    // in their neutral state rather than a wall of red on a blank army.
    const live  = on && !empty;
    const fails = live ? rows.filter(r => !r.ok).length : 0;

    const info = army ? detachmentInfo(army) : { points: 0, count: 0 };

    let html =
      '<label class="kotc-toggle">' +
        `<input type="checkbox" class="kotc-toggle-cb" id="kotc-enabled"${on ? ' checked' : ''} />` +
        '<span class="kotc-toggle-text">' +
          '<span class="kotc-toggle-title">Check my army against KOTC</span>' +
          `<span class="kotc-toggle-hint">${POINTS}-point gladiator format. Advisory only — nothing is blocked.</span>` +
        '</span>' +
      '</label>';

    html += `<ul class="kotc-rules${live ? ' kotc-live' : ''}">`;
    rows.forEach(r => {
      const state = !live ? 'idle' : (r.ok ? 'ok' : 'bad');
      const glyph = !live ? '&#9679;' : (r.ok ? '&#10003;' : '&#10007;');
      html +=
        `<li class="kotc-rule kotc-${state}">` +
          `<span class="kotc-glyph" aria-hidden="true">${glyph}</span>` +
          '<span class="kotc-rule-text">' +
            `<span class="kotc-rule-title">${esc(r.title)}</span>` +
            `<span class="kotc-rule-desc">${esc(r.rule)}</span>` +
            (live ? `<span class="kotc-rule-detail">${r.detail}</span>` : '') +
            (live && !r.ok && r.fix
              ? `<button type="button" class="kotc-fix" data-fix="${esc(r.fix.action)}">${esc(r.fix.label)}</button>`
              : '') +
          '</span>' +
        '</li>';
    });
    html += '</ul>';

    // The twist isn't a list-building restriction — it's the reason the
    // detachment-points total matters, so it rides along as a footnote.
    html +=
      '<div class="kotc-twist">' +
        '<span class="kotc-twist-label">Twist</span>' +
        '<span class="kotc-twist-text">KOTC is always played with a twist. Whoever spends the ' +
        '<strong>fewest detachment points</strong> chooses it' +
        (info.count ? ` — you are spending <strong>${plural(info.points, 'point')}</strong>.` : '.') +
        '</span>' +
      '</div>';

    body.innerHTML = html;

    if (badge) {
      if (!on) { badge.textContent = ''; badge.className = 'kotc-status'; }
      else if (empty) { badge.textContent = 'On'; badge.className = 'kotc-status kotc-status-idle'; }
      else if (fails) { badge.textContent = plural(fails, 'issue'); badge.className = 'kotc-status kotc-status-bad'; }
      else { badge.textContent = 'Legal'; badge.className = 'kotc-status kotc-status-ok'; }
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring — delegated, so it survives the innerHTML re-render above.
  // ---------------------------------------------------------------------------
  function inBody(el) {
    const body = document.getElementById('kotc-body');
    return !!(body && el && body.contains(el));
  }

  document.addEventListener('change', (e) => {
    const cb = e.target.closest && e.target.closest('.kotc-toggle-cb');
    if (!cb || !inBody(cb)) return;
    setEnabled(cb.checked);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.kotc-fix');
    if (!btn || !inBody(btn)) return;
    if (btn.dataset.fix !== 'limit') return;
    const army = App.state && App.state.currentArmy;
    if (!army) return;
    army.pointsLimit = POINTS;
    army.touch();
    const input = document.getElementById('points-limit-input');
    if (input) input.value = String(POINTS);
    if (window.UI && typeof UI.renderArmyList === 'function') {
      UI.renderArmyList(army, App.state.armyManager);
    } else {
      render();
    }
    if (App.state.armyManager && window.ArmyManager &&
        ArmyManager.isNamed && ArmyManager.isNamed(army)) {
      App.state.armyManager.saveArmy(army);
    }
  });

  // (Removed: a document-level '.detachment-row-cb' change listener that
  // re-rendered on a setTimeout, because App.setSelectedDetachments used not to
  // fire selectionChange. It does now — see issue #57 and the comment at the
  // end of js/app/detachment-picker.js — so the selectionChange registration
  // below covers detachment toggles and the workaround would only have made
  // render() run twice per toggle.)

  App.KOTC = {
    isEnabled,
    setEnabled,
    evaluate,
    render,
    POINTS,
  };

  if (App.hooks && Array.isArray(App.hooks.bootstrap)) {
    App.hooks.bootstrap.push(render);
    App.hooks.armyChange.push(render);
    App.hooks.selectionChange.push(render);
  }
})();
