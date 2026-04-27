// ui/auth-modal.js — UI.showAuthModal(mode) for login / register / recover /
// recovery-code / change-password. Single backdrop element (#modal-auth) in
// index.html; this module renders the body for the active view.
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

  function close() {
    const m = $modal();
    if (m) m.setAttribute('hidden', '');
  }

  function open() {
    const m = $modal();
    if (m) m.removeAttribute('hidden');
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

  function errorBanner(msg) {
    return el('div', { class: 'auth-error', role: 'alert', text: String(msg || '') });
  }

  function header(title, opts) {
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

    submitBtn = el('button', {
      type: 'submit', class: 'btn btn-accent', form: FORM_ID,
    }, 'Sign in');

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
        errEl.textContent = 'Invalid credentials.';
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
      footerBtns([submitBtn]),
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

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent', form: FORM_ID }, 'Create account');

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
          renderRecoveryCode(data.recoveryCode, data.username || u);
        } else {
          close();
          if (window.UI && UI.toast) UI.toast('Account created.', 'info', 2500);
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
      footerBtns([submitBtn]),
    ]);
  }

  // ── Recovery code (one-time view, post-register) ──────────────────────
  function renderRecoveryCode(code, username) {
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
      onClick: () => { close(); },
    }, 'Done');

    return setBody(el('div', { class: 'modal' }, [
      header('Save your recovery code'),
      el('div', { class: 'modal-body' }, [
        el('p', { class: 'auth-warning', text:
          'This is shown ONCE. Without email recovery, this code is the only way to reset a forgotten password. Save it now.' }),
        codeEl,
        el('div', { class: 'auth-recovery-actions' }, [copyBtn, dlBtn]),
        savedLbl,
      ]),
      footerBtns([dismissBtn]),
    ]));
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

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent', form: FORM_ID }, 'Reset password');

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
      try {
        await App.Auth.recover(u, c, p);
        close();
        if (UI.toast) UI.toast('Password reset. You can sign in now.', 'info', 3500);
        UI.showAuthModal('login');
      } catch (err) {
        errEl.textContent = 'Could not reset — check the username and recovery code.';
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
      footerBtns([submitBtn]),
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

    submitBtn = el('button', { type: 'submit', class: 'btn btn-accent', form: FORM_ID }, 'Update password');

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
        errEl.textContent = (err && err.status === 401)
          ? 'Current password is incorrect.'
          : 'Could not update password.';
        errEl.removeAttribute('hidden');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update password';
      }
    });

    return el('div', { class: 'modal' }, [
      header('Change password'),
      el('div', { class: 'modal-body' }, [form]),
      footerBtns([submitBtn]),
    ]);
  }

  UI.showAuthModal = function (mode, opts) {
    const m = $modal();
    if (!m) return;
    let body;
    switch (mode) {
      case 'register':         body = renderRegister(); break;
      case 'recover':          body = renderRecover(); break;
      case 'recovery-code':    body = renderRecoveryCode((opts && opts.code) || '', (opts && opts.username) || ''); return;
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
