// ui/auth-modal.js — UI.showAuthModal(mode) for login / register / recover /
// recovery-code / change-password, and UI.showAuthChoice(opts) for the
// account dialogs (sign out: keep / remove / cancel; account switch: keep /
// remove / sign out). Single backdrop element (#modal-auth) in index.html;
// this module renders the body for the active view.
//
// LOCKED MODE: the recovery-code view cannot be dismissed — no ×, Escape and
// backdrop taps are ignored, and other views wait — until "I have saved
// this" is ticked and Done pressed. The code is shown exactly once; a stray
// tap used to lose it for good.
//
// SECURITY: every dynamic value (username, recovery code, error text) goes
// through textContent. The password field is cleared (input.value = '')
// BEFORE the await so it never sits in the DOM longer than the request.
(function () {
  const UI = window.UI = window.UI || {};

  const MODAL_ID = 'modal-auth';

  function $modal() { return document.getElementById(MODAL_ID); }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class')      node.className = attrs[k];
        else if (k === 'text')  node.textContent = attrs[k];
        else if (k === 'html')  node.innerHTML = attrs[k]; // ONLY for static markup
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        }
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  // The element that had focus when the modal opened, so close() can hand
  // focus back to whatever opened it (More ▾ → Sign in, the top-bar account
  // menu, …). On mobile this modal is the ONLY account surface, so losing
  // focus to <body> strands a keyboard / switch-control user.
  let lastFocused = null;
  let wired = false;
  // Locked: the recovery-code view is up (or about to be). See header.
  let locked = false;
  const unlockWaiters = [];
  // The open choice dialog: { resolve, cancelId, dismissible } or null.
  let choice = null;

  function lock() { locked = true; }
  function unlock() {
    locked = false;
    const waiting = unlockWaiters.splice(0);
    for (const fn of waiting) setTimeout(fn, 0);
  }
  function settleChoice(id) {
    const c = choice;
    choice = null;
    if (c) { try { c.resolve(id); } catch (_) {} }
  }
  // May the user dismiss whatever is showing (×, Escape, backdrop)?
  function dismissible() {
    if (locked) return false;
    if (choice && !choice.dismissible) return false;
    return true;
  }

  function isOpen() {
    const m = $modal();
    return !!(m && !m.hasAttribute('hidden'));
  }

  // Everything tabbable inside the dialog, in DOM order. Recomputed per key
  // press — the body is re-rendered whenever the view changes.
  function focusables() {
    const m = $modal();
    if (!m) return [];
    const sel = 'a[href], button:not([disabled]), input:not([disabled]),'
      + ' select:not([disabled]), textarea:not([disabled]),'
      + ' [tabindex]:not([tabindex="-1"])';
    // getClientRects() rather than offsetParent — the backdrop is fixed.
    return Array.prototype.filter.call(m.querySelectorAll(sel),
      (n) => !n.hasAttribute('hidden') && n.getClientRects().length > 0);
  }

  function onKeydown(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); if (dismissible()) close(); return; }
    if (e.key !== 'Tab') return;
    // Focus trap: the background is inert while the dialog is up, so Tab has
    // to cycle between the first and last focusable elements.
    const items = focusables();
    if (!items.length) return;
    const m = $modal();
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !active || !m.contains(active);
    if (e.shiftKey && (outside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (outside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  // Tap/click the scrim to dismiss — but only the scrim itself, never a click
  // that bubbled out of the dialog.
  function onBackdropClick(e) {
    if (e.target === e.currentTarget && dismissible()) close();
  }

  function wire() {
    if (wired) return;
    const m = $modal();
    if (!m) return;
    wired = true;
    document.addEventListener('keydown', onKeydown);
    m.addEventListener('click', onBackdropClick);
  }

  // `force` is for the code paths that are themselves the way out of a
  // locked / non-dismissible view (Done, a choice button).
  function close(force) {
    if (force !== true && !dismissible()) return;
    // Closing an open choice without picking = its cancel answer.
    if (choice) settleChoice(choice.cancelId);
    const m = $modal();
    if (m) m.setAttribute('hidden', '');
    const back = lastFocused;
    lastFocused = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  function open() {
    const m = $modal();
    if (!m) return;
    // Only a real open records the trigger — switching views (login →
    // register) calls open() again while the modal is already visible, and
    // focus is inside the dialog by then.
    if (!isOpen()) {
      const active = document.activeElement;
      if (active && active !== document.body && !m.contains(active)) lastFocused = active;
    }
    m.removeAttribute('hidden');
    wire();
  }

  function setBody(node) {
    const m = $modal();
    if (!m) return;
    const inner = m.querySelector('.modal');
    if (!inner) return;
    // Render functions return a wrapper <div class="modal">. Unwrap it
    // so we don't nest .modal inside .modal — the inner one ignores the
    // outer's max-height: 80vh and pushes the footer (submit button)
    // below the viewport on small screens.
    if (node && node.classList && node.classList.contains('modal')) {
      inner.replaceChildren(...node.childNodes);
    } else {
      inner.replaceChildren(node);
    }
  }

  // opts.noClose: omit the × (locked / non-dismissible views).
  function header(title, opts) {
    if (opts && opts.noClose) {
      return el('div', { class: 'modal-header' }, [
        el('h3', { id: 'modal-auth-title', text: title }),
      ]);
    }
    const closeBtn = el('button', {
      class: 'modal-close', type: 'button', 'aria-label': 'Close',
      onClick: () => close(),
    });
    closeBtn.textContent = '×';
    return el('div', { class: 'modal-header' }, [
      el('h3', { id: 'modal-auth-title', text: title }),
      closeBtn,
    ]);
  }

  function footerBtns(children) {
    return el('div', { class: 'modal-footer' }, children);
  }

  // ── Login view ────────────────────────────────────────────────────────
  function renderLogin() {
    let userInput, passInput, errEl, submitBtn;
    const FORM_ID = 'auth-form-login';
    const form = el('form', { id: FORM_ID, class: 'auth-form', autocomplete: 'on' });

    userInput = el('input', {
      type: 'text', name: 'username', id: 'auth-login-user',
      class: 'form-input', autocomplete: 'username', required: 'required',
      maxlength: '32', placeholder: 'Username',
    });
    passInput = el('input', {
      type: 'password', name: 'password', id: 'auth-login-pass',
      class: 'form-input', autocomplete: 'current-password', required: 'required',
      maxlength: '128', placeholder: 'Password',
    });

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-login-user', class: 'form-label', text: 'Username' }),
      userInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-login-pass', class: 'form-label', text: 'Password' }),
      passInput,
    ]));

    errEl = el('div', { class: 'auth-error', hidden: 'hidden', role: 'alert' });
    form.appendChild(errEl);

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent auth-form-submit' }, 'Sign in');
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = (userInput.value || '').trim();
      const p = passInput.value || '';
      passInput.value = '';
      errEl.setAttribute('hidden', '');
      errEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in…';
      try {
        await App.Auth.login(u, p);
        close();
        if (window.UI && UI.toast) UI.toast('Signed in.', 'info', 2500);
      } catch (err) {
        // Surface server-reasoned errors. The 403 + `pending_approval`
        // shape is documented in docs/ADMIN_API.md — accounts can register
        // but not sign in until an admin approves them.
        if (err && err.status === 403 && err.data && err.data.error === 'pending_approval') {
          errEl.textContent = "Your account is awaiting admin approval. Try again later.";
        } else if (err && err.status === 403 && err.data && err.data.error === 'revoked') {
          errEl.textContent = "Your account has been revoked. Contact the site admin.";
        } else {
          errEl.textContent = 'Invalid credentials.';
        }
        errEl.removeAttribute('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }
    });

    const switchBtn = el('button', {
      type: 'button', class: 'btn btn-link',
      onClick: () => UI.showAuthModal('register'),
    }, 'Create an account');

    const recoverBtn = el('button', {
      type: 'button', class: 'btn btn-link',
      onClick: () => UI.showAuthModal('recover'),
    }, 'Forgot password? Use recovery code');

    return el('div', { class: 'modal' }, [
      header('Sign in'),
      el('div', { class: 'modal-body' }, [
        form,
        el('div', { class: 'auth-switch' }, [switchBtn, recoverBtn]),
      ]),
    ]);
  }

  // ── Register view ─────────────────────────────────────────────────────
  function renderRegister() {
    let userInput, passInput, pass2Input, errEl, submitBtn;
    const FORM_ID = 'auth-form-register';
    const form = el('form', { id: FORM_ID, class: 'auth-form', autocomplete: 'on' });

    userInput = el('input', {
      type: 'text', name: 'username', id: 'auth-reg-user',
      class: 'form-input', autocomplete: 'username', required: 'required',
      minlength: '3', maxlength: '32',
      pattern: '[A-Za-z0-9_.\\-]{3,32}',
      placeholder: '3–32 chars: letters, numbers, _.-',
    });
    passInput = el('input', {
      type: 'password', name: 'new-password', id: 'auth-reg-pass',
      class: 'form-input', autocomplete: 'new-password', required: 'required',
      minlength: '8', maxlength: '128', placeholder: 'At least 8 characters',
    });
    pass2Input = el('input', {
      type: 'password', name: 'new-password-confirm', id: 'auth-reg-pass2',
      class: 'form-input', autocomplete: 'new-password', required: 'required',
      minlength: '8', maxlength: '128', placeholder: 'Repeat password',
    });

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-reg-user', class: 'form-label', text: 'Pick a username' }),
      userInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-reg-pass', class: 'form-label', text: 'Password' }),
      passInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-reg-pass2', class: 'form-label', text: 'Confirm password' }),
      pass2Input,
    ]));

    const notice = el('p', { class: 'auth-notice' });
    notice.textContent = 'No email is collected. If you forget your password, you’ll need the one-time recovery code shown after signup.';
    form.appendChild(notice);

    errEl = el('div', { class: 'auth-error', hidden: 'hidden', role: 'alert' });
    form.appendChild(errEl);

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent auth-form-submit' }, 'Create account');
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = (userInput.value || '').trim();
      const p = passInput.value || '';
      const p2 = pass2Input.value || '';
      passInput.value = '';
      pass2Input.value = '';
      errEl.setAttribute('hidden', '');
      errEl.textContent = '';
      if (p !== p2) {
        errEl.textContent = 'Passwords do not match.';
        errEl.removeAttribute('hidden');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      try {
        const data = await App.Auth.register(u, p);
        if (data && data.recoveryCode) {
          renderRecoveryCode(data.recoveryCode, data.username || u, !!(data && data.pending));
        } else {
          close();
          if (window.UI && UI.toast) {
            UI.toast(data && data.pending
              ? 'Account created — awaiting admin approval.'
              : 'Account created.', 'info', 4000);
          }
        }
      } catch (err) {
        if (err && err.status === 409) {
          errEl.textContent = 'That username is taken. Try another.';
        } else if (err && err.status === 400) {
          errEl.textContent = (err.data && err.data.error) || 'Invalid username or password.';
        } else {
          errEl.textContent = 'Could not create account. Try again.';
        }
        errEl.removeAttribute('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create account';
      }
    });

    const switchBtn = el('button', {
      type: 'button', class: 'btn btn-link',
      onClick: () => UI.showAuthModal('login'),
    }, 'I already have an account');

    return el('div', { class: 'modal' }, [
      header('Create account'),
      el('div', { class: 'modal-body' }, [
        form,
        el('div', { class: 'auth-switch' }, [switchBtn]),
      ]),
    ]);
  }

  // ── Recovery code (one-time view, post-register) ──────────────────────
  // opts.recovered: shown after /auth/recover (the old code is now dead).
  function renderRecoveryCode(code, username, pending, opts) {
    const recovered = !!(opts && opts.recovered);
    // If a choice dialog was open (it cannot be, normally), it yields: the
    // code is shown once and wins. Its caller gets the cancel answer.
    if (choice) settleChoice(choice.cancelId);
    lock();
    const codeEl = el('pre', { class: 'auth-recovery-code', tabindex: '0' });
    codeEl.textContent = code; // textContent is critical for security

    const copyBtn = el('button', {
      type: 'button', class: 'btn btn-outline',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(code);
          if (UI.toast) UI.toast('Recovery code copied.', 'info', 1800);
        } catch (_) {
          if (UI.toast) UI.toast('Copy failed — select and copy manually.', 'warning', 2500);
        }
      },
    }, 'Copy');

    const dlBtn = el('button', {
      type: 'button', class: 'btn btn-accent',
      onClick: () => {
        const blob = new Blob(
          [`yaab recovery code\nusername: ${username}\ncode: ${code}\n\nKeep this safe. Without it, a forgotten password cannot be recovered.\n`],
          { type: 'text/plain' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yaab-recovery-${username}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
    }, 'Download as .txt');

    let savedChk, dismissBtn;
    savedChk = el('input', {
      type: 'checkbox', id: 'auth-saved-confirm',
      onChange: () => { dismissBtn.disabled = !savedChk.checked; },
    });
    const savedLbl = el('label', { for: 'auth-saved-confirm', class: 'auth-saved-lbl' }, [
      savedChk,
      ' I have saved this code somewhere safe. I understand it cannot be shown again.',
    ]);

    dismissBtn = el('button', {
      type: 'button', class: 'btn btn-accent',
      disabled: 'disabled',
      onClick: () => {
        if (!savedChk.checked) return;
        close(true);
        unlock();
        if (recovered && UI.toast) UI.toast('Password reset — you are signed in.', 'info', 3500);
      },
    }, 'Done');

    const title = recovered
      ? 'Save your new recovery code'
      : (pending ? 'Save your recovery code (pending approval)' : 'Save your recovery code');
    setBody(el('div', { class: 'modal' }, [
      header(title, { noClose: true }),
      el('div', { class: 'modal-body' }, [
        recovered
          ? el('p', { class: 'auth-warning', text:
              'Your password has been reset and you are signed in. Your old recovery code no longer works — this new one replaces it.' })
          : null,
        pending
          ? el('p', { class: 'auth-warning', text:
              'Your account is created but awaiting admin approval. You will not be able to sign in until you have been approved. The recovery code below works whenever you do sign in.' })
          : null,
        el('p', { class: 'auth-warning', text:
          'This is shown ONCE. Without email recovery, this code is the only way to reset a forgotten password. Save it now.' }),
        codeEl,
        el('div', { class: 'auth-recovery-actions' }, [copyBtn, dlBtn]),
        savedLbl,
      ].filter(Boolean)),
      footerBtns([dismissBtn]),
    ]));
    // Make sure it is actually showing (the recover form calls this while
    // the modal is open; the 'recovery-code' mode opens it fresh).
    open();
    setTimeout(() => { try { codeEl.focus(); } catch (_) {} }, 0);
  }

  // ── Recover (use recovery code to set new password) ───────────────────
  function renderRecover() {
    let userInput, codeInput, passInput, errEl, submitBtn;
    const FORM_ID = 'auth-form-recover';
    const form = el('form', { id: FORM_ID, class: 'auth-form', autocomplete: 'on' });

    userInput = el('input', {
      type: 'text', name: 'username', id: 'auth-rec-user', class: 'form-input',
      autocomplete: 'username', required: 'required', maxlength: '32',
    });
    codeInput = el('input', {
      type: 'text', name: 'recovery-code', id: 'auth-rec-code', class: 'form-input',
      autocomplete: 'off', required: 'required', maxlength: '64',
      placeholder: 'Recovery code from signup',
    });
    passInput = el('input', {
      type: 'password', name: 'new-password', id: 'auth-rec-pass', class: 'form-input',
      autocomplete: 'new-password', required: 'required', minlength: '8', maxlength: '128',
    });

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-rec-user', class: 'form-label', text: 'Username' }),
      userInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-rec-code', class: 'form-label', text: 'Recovery code' }),
      codeInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-rec-pass', class: 'form-label', text: 'New password' }),
      passInput,
    ]));

    errEl = el('div', { class: 'auth-error', hidden: 'hidden', role: 'alert' });
    form.appendChild(errEl);

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent auth-form-submit' }, 'Reset password');
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = (userInput.value || '').trim();
      const c = (codeInput.value || '').trim();
      const p = passInput.value || '';
      passInput.value = '';
      codeInput.value = '';
      errEl.setAttribute('hidden', '');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Resetting…';
      // Lock BEFORE the request: a successful recover signs the user in, and
      // the sign-in can open another dialog (sync's account-switch question)
      // in the same tick. Locked, that dialog waits until the new code has
      // been acknowledged instead of replacing it.
      lock();
      try {
        const data = await App.Auth.recover(u, c, p);
        if (data && data.recoveryCode) {
          // The server rotated the code; the old one is dead. Show the new
          // one exactly like signup does.
          renderRecoveryCode(data.recoveryCode, data.username || u, false, { recovered: true });
        } else {
          unlock();
          close(true);
          if (UI.toast) UI.toast('Password reset — you are signed in.', 'info', 3500);
        }
      } catch (err) {
        unlock();
        if (err && err.status === 403 && err.data && err.data.error === 'pending_approval') {
          errEl.textContent = 'Your account is awaiting admin approval. Try again later.';
        } else if (err && err.status === 403 && err.data && err.data.error === 'revoked') {
          errEl.textContent = 'Your account has been revoked. Contact the site admin.';
        } else {
          errEl.textContent = 'Could not reset — check the username and recovery code.';
        }
        errEl.removeAttribute('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset password';
      }
    });

    const backBtn = el('button', {
      type: 'button', class: 'btn btn-link',
      onClick: () => UI.showAuthModal('login'),
    }, 'Back to sign in');

    return el('div', { class: 'modal' }, [
      header('Recover account'),
      el('div', { class: 'modal-body' }, [form, el('div', { class: 'auth-switch' }, [backBtn])]),
    ]);
  }

  // ── Change password (logged-in) ───────────────────────────────────────
  function renderChangePassword() {
    let oldInput, newInput, new2Input, errEl, submitBtn;
    const FORM_ID = 'auth-form-change-password';
    const form = el('form', { id: FORM_ID, class: 'auth-form', autocomplete: 'on' });

    oldInput = el('input', {
      type: 'password', id: 'auth-cp-old', class: 'form-input',
      autocomplete: 'current-password', required: 'required', maxlength: '128',
    });
    newInput = el('input', {
      type: 'password', id: 'auth-cp-new', class: 'form-input',
      autocomplete: 'new-password', required: 'required', minlength: '8', maxlength: '128',
    });
    new2Input = el('input', {
      type: 'password', id: 'auth-cp-new2', class: 'form-input',
      autocomplete: 'new-password', required: 'required', minlength: '8', maxlength: '128',
    });

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-cp-old', class: 'form-label', text: 'Current password' }),
      oldInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-cp-new', class: 'form-label', text: 'New password' }),
      newInput,
    ]));
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { for: 'auth-cp-new2', class: 'form-label', text: 'Confirm new password' }),
      new2Input,
    ]));

    errEl = el('div', { class: 'auth-error', hidden: 'hidden', role: 'alert' });
    form.appendChild(errEl);

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent auth-form-submit' }, 'Update password');
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldP = oldInput.value || '';
      const newP = newInput.value || '';
      const new2 = new2Input.value || '';
      oldInput.value = '';
      newInput.value = '';
      new2Input.value = '';
      errEl.setAttribute('hidden', '');
      if (newP !== new2) {
        errEl.textContent = 'New passwords do not match.';
        errEl.removeAttribute('hidden');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating…';
      try {
        await App.Auth.changePassword(oldP, newP);
        close();
        if (UI.toast) UI.toast('Password updated.', 'info', 2500);
      } catch (err) {
        if (err && err.sessionExpired) {
          // Auth.changePassword confirmed the session is gone (it has
          // already flipped the app to signed out).
          errEl.textContent = 'You have been signed out. Sign in again, then change your password.';
        } else if (err && err.status === 401) {
          errEl.textContent = 'Current password is incorrect.';
        } else if (err && err.status === 429) {
          errEl.textContent = 'Too many attempts. Wait a few minutes and try again.';
        } else {
          errEl.textContent = 'Could not update password.';
        }
        errEl.removeAttribute('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update password';
      }
    });

    return el('div', { class: 'modal' }, [
      header('Change password'),
      el('div', { class: 'modal-body' }, [form]),
    ]);
  }

  // ── Choice dialog (sign out, account switch) ──────────────────────────
  // opts: { title, message: string | string[], choices: [{ id, label,
  //   className }], cancelId?, dismissible? (default true) }
  // Resolves with the chosen id, or cancelId when dismissed (×, Escape,
  // backdrop — only when dismissible). Every choice is a real .btn button.
  function renderChoice(opts) {
    const dismiss = opts.dismissible !== false;
    const paras = [].concat(opts.message || []).filter(Boolean)
      .map(t => el('p', { class: 'auth-notice', text: String(t) }));
    const btns = (opts.choices || []).map(c => el('button', {
      type: 'button',
      class: c.className || 'btn btn-outline',
      'data-choice': c.id,
      onClick: () => {
        const ch = choice;
        choice = null;
        close(true);
        if (ch) { try { ch.resolve(c.id); } catch (_) {} }
      },
    }, c.label));
    const footer = footerBtns(btns);
    footer.classList.add('auth-choice-footer');
    // Three buttons side by side: let them wrap rather than overflow on a
    // narrow desktop window (phones already wrap via css/mobile.css). Set
    // through the CSSOM so no CSS file is needed for it.
    footer.style.flexWrap = 'wrap';
    footer.style.gap = '8px';
    return el('div', { class: 'modal auth-choice' }, [
      header(opts.title || 'Are you sure?', { noClose: !dismiss }),
      el('div', { class: 'modal-body' }, paras),
      footer,
    ]);
  }

  UI.showAuthChoice = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const go = () => {
        // The recovery code is up: wait for it to be acknowledged.
        if (locked) { unlockWaiters.push(go); return; }
        const m = $modal();
        if (!m) { resolve(opts.cancelId != null ? opts.cancelId : null); return; }
        // Another choice already open: it yields as cancelled.
        if (choice) settleChoice(choice.cancelId);
        // The Settings drawer sits above modals (z-index 1100 vs 1000) and
        // its Sign out row awaits signOut() before closing itself, so the
        // dialog would open hidden behind it. Close it first.
        const sd = window.App && App.settingsDrawer;
        if (sd && typeof sd.isOpen === 'function' && sd.isOpen() && typeof sd.close === 'function') {
          try { sd.close(); } catch (_) {}
        }
        choice = {
          resolve,
          cancelId: opts.cancelId != null ? opts.cancelId : null,
          dismissible: opts.dismissible !== false,
        };
        setBody(renderChoice(opts));
        open();
        setTimeout(() => {
          const first = m.querySelector('.modal-footer button');
          if (first) first.focus();
        }, 0);
      };
      // Deferred a tick so a view being rendered in the same task (the
      // recovery code after a recover) is in place — and locked — first.
      setTimeout(go, 0);
    });
  };

  UI.showAuthModal = function (mode, opts) {
    const m = $modal();
    if (!m) return;
    // Never replace the one-time recovery code, or an account question that
    // must be answered.
    if (!dismissible()) return;
    if (choice) settleChoice(choice.cancelId);
    let body;
    switch (mode) {
      case 'register':         body = renderRegister(); break;
      case 'recover':          body = renderRecover(); break;
      case 'recovery-code':    renderRecoveryCode((opts && opts.code) || '', (opts && opts.username) || ''); return;
      case 'change-password':  body = renderChangePassword(); break;
      case 'login':
      default:                 body = renderLogin(); break;
    }
    setBody(body);
    open();
    // Focus first input for keyboard users.
    setTimeout(() => {
      const first = m.querySelector('input');
      if (first) first.focus();
    }, 0);
  };
})();
