// Sign-in page: three form panes + a recovery-code pane. No framework, no inline handlers (CSP script-src 'self').
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var panes = { signin: $('pane-signin'), register: $('pane-register'), recover: $('pane-recover'), code: $('pane-code') };

  // Same-origin path only: starts with a single '/', not '//' (or '/\'), not /login.
  function sanitiseNext(raw) {
    if (typeof raw !== 'string' || raw.charAt(0) !== '/') return '/';
    if (raw.charAt(1) === '/' || raw.charAt(1) === '\\') return '/';
    if (/^\/login(?:[\/?#]|$)/.test(raw)) return '/';
    return raw;
  }
  var next = sanitiseNext(new URLSearchParams(location.search).get('next'));

  function show(name) {
    Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== name; });
    var f = panes[name].querySelector('input');
    if (f) f.focus();
  }
  function setErr(pane, msg) { pane.querySelector('.err').textContent = msg || ''; }

  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) {
    b.addEventListener('click', function () { setErr(panes.signin, ''); show(b.getAttribute('data-go')); });
  });

  // POST JSON; resolves { status, data }. Rejects only on network failure.
  function post(path, body) {
    return fetch('/api/auth/' + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, data: d }; });
    });
  }

  function wire(pane, run) {
    pane.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = pane.querySelector('button[type=submit]');
      var f = pane.elements;
      setErr(pane, '');
      btn.disabled = true;
      Promise.resolve(run(f)).catch(function () { setErr(pane, 'Network error. Try again.'); })
        .then(function () { btn.disabled = false; });
    });
  }

  function showCode(code, msg, after, cont) {
    $('code-msg').textContent = msg;
    $('code-box').textContent = code;
    $('code-after').textContent = after;
    $('code-continue').hidden = !cont;
    $('code-back').hidden = cont;
    show('code');
  }

  wire(panes.signin, function (f) {
    return post('login', { username: f.username.value.trim(), password: f.password.value }).then(function (r) {
      if (r.status === 200) { location.replace(next); return; }
      if (r.status === 401) setErr(panes.signin, 'Wrong username or password.');
      else if (r.status === 403 && r.data && r.data.error === 'pending_approval')
        setErr(panes.signin, "Your account is waiting for approval. You'll be able to sign in once Alec approves it.");
      else if (r.status === 429) setErr(panes.signin, 'Too many attempts, wait a minute.');
      else setErr(panes.signin, 'Sign-in failed (HTTP ' + r.status + ').');
    });
  });

  wire(panes.register, function (f) {
    if (f.password.value !== f.confirm.value) { setErr(panes.register, 'Passwords do not match.'); return; }
    return post('register', { username: f.username.value.trim(), password: f.password.value }).then(function (r) {
      if (r.status === 200 && r.data && r.data.recoveryCode) {
        f.password.value = f.confirm.value = '';
        showCode(r.data.recoveryCode, 'Account created for ' + r.data.username + '.',
          "Your account now waits for approval; you'll be able to sign in once it is approved.", false);
      } else if (r.status === 429) setErr(panes.register, 'Too many attempts, wait a minute.');
      else setErr(panes.register, (r.data && typeof r.data.error === 'string' && r.data.error) || 'Could not create account (HTTP ' + r.status + ').');
    });
  });

  wire(panes.recover, function (f) {
    return post('recover', { username: f.username.value.trim(), recoveryCode: f.code.value.trim(), newPassword: f.password.value }).then(function (r) {
      if (r.status === 200 && r.data && r.data.recoveryCode) {
        f.password.value = f.code.value = '';
        showCode(r.data.recoveryCode, 'Password reset. You are signed in. Your recovery code has changed:', 'The old code no longer works.', true);
      } else if (r.status === 401) setErr(panes.recover, 'Username or recovery code not recognised.');
      else if (r.status === 403 && r.data && r.data.error === 'pending_approval')
        setErr(panes.recover, "Your account is waiting for approval. You'll be able to sign in once Alec approves it.");
      else if (r.status === 429) setErr(panes.recover, 'Too many attempts, wait a minute.');
      else setErr(panes.recover, (r.data && typeof r.data.error === 'string' && r.data.error) || 'Recovery failed (HTTP ' + r.status + ').');
    });
  });

  $('code-copy').addEventListener('click', function () {
    var b = $('code-copy'), t = $('code-box').textContent;
    var done = function (ok) { b.textContent = ok ? 'Copied' : 'Select and copy manually'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });
  $('code-continue').addEventListener('click', function () { location.replace(next); });
  $('code-back').addEventListener('click', function () { $('code-copy').textContent = 'Copy'; $('code-box').textContent = ''; show('signin'); });
})();
