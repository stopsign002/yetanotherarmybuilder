// ui/celebrations.js — confetti, rolling points tween, landing pulse, shimmer.
(function () {
  const App = window.App = window.App || {};
  const UI  = window.UI  = window.UI  || {};
  if (!App.hooks) return;

  const REDUCED = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── State ──────────────────────────────────────────────────────────
  let prevTotal        = null;   // last observed total
  let prevLimit        = null;   // last observed limit
  let prevOver         = false;  // was prev state over-limit?
  let lastAnimatedTo   = null;   // last value the tween has landed on
  let tweenRaf         = 0;
  let shimmerObserved  = new WeakSet();

  // ── Confetti ───────────────────────────────────────────────────────
  let canvas = null, ctx = null, particles = [], burstDeadline = 0, rafBurst = 0;

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.id = 'yaab-confetti-canvas';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return canvas;
  }

  function accentPalette() {
    const cs = getComputedStyle(document.documentElement);
    const rgb = (cs.getPropertyValue('--accent-rgb') || '255,255,255').trim();
    return [
      `rgb(${rgb})`,
      '#ffffff',
      '#ffd447',       // gold
      `rgba(${rgb},0.7)`,
      '#ff8a47',       // secondary warm
    ];
  }

  function spawnConfetti(count) {
    ensureCanvas();
    const colors = accentPalette();
    const w = window.innerWidth;
    const originY = Math.min(window.innerHeight * 0.45, 360);
    for (let i = 0; i < count; i++) {
      const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.4;
      const speed = 7 + Math.random() * 9;
      particles.push({
        x: w * (0.15 + Math.random() * 0.7),
        y: originY + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        size: 5 + Math.random() * 6,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
        maxLife: 2200 + Math.random() * 400,
        shape: Math.random() < 0.6 ? 'rect' : 'circ',
      });
    }
    burstDeadline = performance.now() + 2600;
    if (!rafBurst) rafBurst = requestAnimationFrame(tickConfetti);
  }

  let lastTs = 0;
  function tickConfetti(ts) {
    const dt = lastTs ? Math.min(ts - lastTs, 48) : 16;
    lastTs = ts;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gravity = 0.35;
    const drag    = 0.992;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      p.vy += gravity * (dt / 16);
      p.vx *= drag;
      p.vy *= drag;
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.vr;
      const fade = Math.max(0, 1 - p.life / p.maxLife);
      if (fade <= 0 || p.y > window.innerHeight + 40) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (particles.length > 0 || ts < burstDeadline) {
      rafBurst = requestAnimationFrame(tickConfetti);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafBurst = 0;
      lastTs   = 0;
    }
  }

  // ── Rolling-number tween (#points-current) ─────────────────────────
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function tweenPoints(target) {
    const el = document.getElementById('points-current');
    if (!el) return;
    const from = lastAnimatedTo != null ? lastAnimatedTo : parseInt(el.textContent, 10) || 0;
    if (!isFinite(target)) return;
    const delta = Math.abs(target - from);
    if (delta === 0) { lastAnimatedTo = target; return; }
    if (delta > 500 || REDUCED()) {
      if (tweenRaf) { cancelAnimationFrame(tweenRaf); tweenRaf = 0; }
      el.textContent = String(target);
      lastAnimatedTo = target;
      el.classList.remove('tweening');
      return;
    }
    if (tweenRaf) cancelAnimationFrame(tweenRaf);
    const start = performance.now();
    const dur   = 450;
    el.classList.add('tweening');
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const v = Math.round(from + (target - from) * easeOutCubic(t));
      el.textContent = String(v);
      if (t < 1) {
        tweenRaf = requestAnimationFrame(step);
      } else {
        tweenRaf = 0;
        lastAnimatedTo = target;
        el.classList.remove('tweening');
      }
    };
    tweenRaf = requestAnimationFrame(step);
  }

  // ── Points-bar celebration trigger ─────────────────────────────────
  function handleArmyChange(army /*, kind */) {
    if (!army) return;
    const total = army.getTotalPoints ? army.getTotalPoints() : 0;
    const limit = army.pointsLimit || 0;
    const over  = limit > 0 && total > limit;

    tweenPoints(total);

    if (prevTotal === null) {
      prevTotal = total; prevLimit = limit; prevOver = over;
      lastAnimatedTo = total;
      return;
    }

    const crossedToExact = (
      limit > 0 &&
      total === limit &&
      (prevTotal !== limit || prevLimit !== limit)
    );
    const crossedOver = over && !prevOver;

    if (crossedToExact) {
      triggerLanding(limit);
    } else if (crossedOver) {
      triggerShake();
    }

    prevTotal = total; prevLimit = limit; prevOver = over;
  }

  function triggerLanding(limit) {
    if (!REDUCED()) spawnConfetti(80);

    const bar = document.getElementById('points-bar');
    if (bar) {
      bar.classList.remove('points-bar-celebrate');
      void bar.offsetWidth;
      bar.classList.add('points-bar-celebrate');
      setTimeout(() => bar.classList.remove('points-bar-celebrate'), 1000);
    }

    const summary = document.querySelector('.points-summary');
    if (summary) {
      summary.classList.remove('points-landed');
      void summary.offsetWidth;
      summary.classList.add('points-landed');
      setTimeout(() => summary.classList.remove('points-landed'), 1600);
    }

    if (UI && typeof UI.toast === 'function') {
      UI.toast(`Nailed it. ${limit}/${limit}.`, 'celebrate', 2400);
    }
  }

  function triggerShake() {
    const summary = document.querySelector('.points-summary');
    if (!summary) return;
    summary.classList.remove('points-shake');
    void summary.offsetWidth;
    summary.classList.add('points-shake');
    setTimeout(() => summary.classList.remove('points-shake'), 450);
  }

  // ── Unit-card shimmer on .selected gain ────────────────────────────
  function wireShimmer() {
    const grid = document.getElementById('unit-grid');
    if (!grid || shimmerObserved.has(grid)) return;
    shimmerObserved.add(grid);

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
        const el = m.target;
        if (!(el instanceof Element)) continue;
        if (!el.classList.contains('unit-card')) continue;
        const wasSelected = m.oldValue && /\bselected\b/.test(m.oldValue);
        const isSelected  = el.classList.contains('selected');
        if (!wasSelected && isSelected) {
          el.classList.remove('just-selected');
          void el.offsetWidth;
          el.classList.add('just-selected');
          setTimeout(() => el.classList.remove('just-selected'), 700);
        }
      }
    });
    mo.observe(grid, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class'],
      subtree: true,
    });
  }

  // ── Bootstrap registration ─────────────────────────────────────────
  App.hooks.bootstrap.push(function () {
    wireShimmer();
    const el = document.getElementById('points-current');
    if (el) lastAnimatedTo = parseInt(el.textContent, 10) || 0;
  });

  App.hooks.armyChange.push(handleArmyChange);
})();
