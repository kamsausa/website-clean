// signup.html — log in, sign up, "check your email", forgot password, set new password.
(function () {
  'use strict';
  const K = window.KAMSA;
  const { $, $$ } = K;
  const sb = K.sb();
  const PENDING_KEY = 'kamsa.pendingEmail';
  const RESEND_COOLDOWN = 60;

  const COPY = {
    login: ['Member login', 'Welcome back', 'Log in to reach the member directory and partner perks.'],
    signup: ['New member', 'Join KAMSA', 'Membership is free. Create your account, confirm your email, then set up your profile.'],
    'check-email': ['Almost there', 'Check your email', 'One quick step before you set up your profile.'],
    forgot: ['Account help', 'Reset your password', "Enter the email you signed up with and we'll send you a link to choose a new password."],
    reset: ['Account help', 'Choose a new password', `Use at least ${K.CONFIG.minPasswordLength || 10} characters, with a letter and a number.`],
  };
  const FORMS = {
    login: 'loginForm', signup: 'signupForm', 'check-email': 'checkEmailPanel', forgot: 'forgotForm', reset: 'resetForm',
  };
  const STEP_FOR_MODE = { signup: 'account', 'check-email': 'email' };

  const msg = $('#message');
  let mode = null;

  function pendingEmail(v) {
    try {
      if (v === undefined) return sessionStorage.getItem(PENDING_KEY) || '';
      if (v) sessionStorage.setItem(PENDING_KEY, v); else sessionStorage.removeItem(PENDING_KEY);
    } catch (_) { return ''; }
    return v;
  }

  function setMode(next, { keepMessage = false, focus = true } = {}) {
    if (!COPY[next]) next = 'signup';
    mode = next;
    const [kicker, heading, intro] = COPY[next];
    $('#kicker').textContent = kicker;
    $('#heading').textContent = heading;
    $('#intro').textContent = intro;
    document.title = `${heading} | KAMSA`;

    Object.entries(FORMS).forEach(([m, id]) => { $('#' + id).hidden = m !== next; });
    $('#tabs').hidden = !(next === 'login' || next === 'signup');
    $('#tab-login').setAttribute('aria-selected', String(next === 'login'));
    $('#tab-signup').setAttribute('aria-selected', String(next === 'signup'));

    const step = STEP_FOR_MODE[next];
    $('#steps').hidden = !step;
    if (step) {
      const order = ['account', 'email', 'profile', 'review'];
      $$('#steps li').forEach((li) => {
        const i = order.indexOf(li.dataset.step);
        const cur = order.indexOf(step);
        li.className = i < cur ? 'done' : i === cur ? 'current' : '';
        if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
    }

    if (next === 'check-email') $('#pendingEmail').textContent = pendingEmail() || 'your email';

    const url = new URL(window.location.href);
    url.search = next === 'signup' ? '' : `?mode=${next}`;
    url.hash = '';
    history.replaceState(null, '', url);

    if (!keepMessage) K.showMessage(msg, '');
    K.clearInvalid();
    const container = $('#' + FORMS[next]);
    $$('[data-captcha]', container).forEach((c) => {
      if (!c.dataset.mounted) { c.dataset.mounted = '1'; K.captcha.mount(c).catch(() => {}); }
    });
    if (focus) {
      const first = $('input:not([type=hidden]):not([readonly])', container) || $('button', container);
      if (first) first.focus({ preventScroll: true });
    }
  }

  function captchaFor(form) {
    const c = $('[data-captcha]', form);
    const token = K.captcha.token(c);
    if (K.captcha.enabled && !token) {
      throw Object.assign(new Error('Please complete the verification check.'), { code: 'captcha_failed' });
    }
    return { token, reset: () => K.captcha.reset(c) };
  }

  // ---------------------------------------------------------------------------
  // Mode switching
  // ---------------------------------------------------------------------------
  $('#tab-login').addEventListener('click', () => setMode('login'));
  $('#tab-signup').addEventListener('click', () => setMode('signup'));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.mode;
    const known = $('#loginEmail').value || $('#signupEmail').value || pendingEmail();
    if (target === 'forgot' && known && !$('#forgotEmail').value) $('#forgotEmail').value = known;
    if (target === 'login' && known && !$('#loginEmail').value) $('#loginEmail').value = known;
    if (target === 'signup') pendingEmail('');
    setMode(target);
  }));

  // Tabs: arrow-key support
  $('#tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = mode === 'login' ? 'signup' : 'login';
    setMode(next, { focus: false });
    $('#tab-' + next).focus();
  });

  K.bindPasswordToggles();
  [['#signupPassword', '#pwMeter'], ['#newPassword', '#newPwMeter']].forEach(([i, m]) => {
    $(i).addEventListener('input', () => { $(m).dataset.score = String(K.passwordScore($(i).value)); });
  });

  // ---------------------------------------------------------------------------
  // Log in
  // ---------------------------------------------------------------------------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    K.clearInvalid();
    K.showMessage(msg, '');
    const email = K.normalizeEmail($('#loginEmail').value);
    const password = $('#loginPassword').value;
    if (!K.isEmail(email)) return K.markInvalid($('#loginEmail'), 'Enter the email you signed up with.');
    if (!password) return K.markInvalid($('#loginPassword'), 'Enter your password.');

    const btn = $('#loginButton');
    K.setBusy(btn, true, 'Logging in…');
    let cap;
    try {
      cap = captchaFor(e.currentTarget);
      const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken: cap.token } });
      if (error) throw error;
      pendingEmail('');
      const state = await K.getState();
      K.go(K.pageForStage(state.stage));
    } catch (err) {
      if (cap) cap.reset();
      K.setBusy(btn, false);
      if (err.code === 'email_not_confirmed') {
        pendingEmail(email);
        setMode('check-email', { keepMessage: true });
        K.showMessage(msg, "Your email isn't confirmed yet. Use the link we sent you, or resend it below.", 'error');
        return;
      }
      K.showMessage(msg, K.friendlyError(err), 'error',
        err.code === 'invalid_credentials' ? [{ label: 'Reset password', onClick: () => { $('#forgotEmail').value = email; setMode('forgot'); } }] : []);
    }
  });

  // ---------------------------------------------------------------------------
  // Sign up
  // ---------------------------------------------------------------------------
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    K.clearInvalid();
    K.showMessage(msg, '');

    const first = $('#firstName').value.trim();
    const last = $('#lastName').value.trim();
    const email = K.normalizeEmail($('#signupEmail').value);
    const pw = $('#signupPassword').value;
    const pw2 = $('#signupPasswordConfirm').value;

    let ok = true;
    const bad = (sel, text) => { if (ok) $(sel).focus(); ok = false; K.markInvalid($(sel), text); };
    if (!first) bad('#firstName', 'Please enter your first name.');
    if (!last) bad('#lastName', 'Please enter your last name.');
    if (!K.isEmail(email)) bad('#signupEmail', 'Please enter a valid email address.');
    const problem = K.passwordProblem(pw);
    if (problem) bad('#signupPassword', problem);
    else if (pw !== pw2) bad('#signupPasswordConfirm', "Passwords don't match.");
    if (!$('#terms').checked) bad('#terms', 'Please agree to continue.');
    if (!ok) return;

    const btn = $('#signupButton');
    K.setBusy(btn, true, 'Creating account…');
    let cap;
    try {
      cap = captchaFor(e.currentTarget);
      const { data, error } = await sb.auth.signUp({
        email,
        password: pw,
        options: {
          emailRedirectTo: K.pageUrl(K.PAGES.verify),
          captchaToken: cap.token,
          // Only the name and the terms flag are read by the database trigger.
          data: { first_name: first, last_name: last, terms_accepted: true },
        },
      });
      if (error) throw error;

      // If "Confirm email" is turned off in Supabase, a session comes back right away.
      if (data.session) {
        console.warn('KAMSA: email confirmation is disabled in Supabase. Turn on Authentication → Providers → Email → Confirm email.');
        K.go(K.PAGES.onboarding);
        return;
      }

      pendingEmail(email);
      $('#signupForm').reset();
      $('#pwMeter').dataset.score = '0';
      K.setBusy(btn, false);
      setMode('check-email');
      K.cooldown($('#resendButton'), RESEND_COOLDOWN, 'Resend email');
    } catch (err) {
      if (cap) cap.reset();
      K.setBusy(btn, false);
      const actions = (err.code === 'user_already_exists' || err.code === 'email_exists')
        ? [{ label: 'Log in instead', onClick: () => { $('#loginEmail').value = email; setMode('login'); } }]
        : [];
      K.showMessage(msg, K.friendlyError(err, 'We could not create your account. Please try again.'), 'error', actions);
    }
  });

  // ---------------------------------------------------------------------------
  // Check-email panel
  // ---------------------------------------------------------------------------
  $('#resendButton').addEventListener('click', async (e) => {
    const email = pendingEmail();
    if (!email) {
      setMode('signup');
      K.showMessage(msg, 'Enter your details again so we know where to send the link.', 'error');
      return;
    }
    const btn = e.currentTarget;
    K.setBusy(btn, true, 'Sending…');
    let cap;
    try {
      cap = captchaFor($('#checkEmailPanel'));
      const { error } = await sb.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: K.pageUrl(K.PAGES.verify), captchaToken: cap.token },
      });
      if (error) throw error;
      K.setBusy(btn, false);
      K.showMessage(msg, `A new confirmation link is on its way to ${email}.`, 'success');
      K.cooldown(btn, RESEND_COOLDOWN, 'Resend email');
    } catch (err) {
      if (cap) cap.reset();
      K.setBusy(btn, false);
      K.showMessage(msg, K.friendlyError(err, 'We could not resend the email. Please try again in a minute.'), 'error');
      if (err.code === 'over_email_send_rate_limit') K.cooldown(btn, RESEND_COOLDOWN, 'Resend email');
    }
  });

  $('#confirmedLogin').addEventListener('click', () => {
    $('#loginEmail').value = pendingEmail();
    setMode('login');
    $('#loginPassword').focus();
  });

  // ---------------------------------------------------------------------------
  // Forgot password
  // ---------------------------------------------------------------------------
  $('#forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    K.clearInvalid();
    const email = K.normalizeEmail($('#forgotEmail').value);
    if (!K.isEmail(email)) return K.markInvalid($('#forgotEmail'), 'Please enter a valid email address.');
    const btn = $('#forgotButton');
    K.setBusy(btn, true, 'Sending…');
    let cap;
    try {
      cap = captchaFor(e.currentTarget);
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: K.pageUrl(K.PAGES.verify),
        captchaToken: cap.token,
      });
      if (error && error.code !== 'user_not_found') throw error;
      K.setBusy(btn, false);
      // Same message whether or not the account exists, so emails can't be probed.
      K.showMessage(msg, `If ${email} has a KAMSA account, a reset link is on its way. It may take a minute — check Spam too.`, 'success');
      K.cooldown(btn, RESEND_COOLDOWN, 'Send reset link');
    } catch (err) {
      if (cap) cap.reset();
      K.setBusy(btn, false);
      K.showMessage(msg, K.friendlyError(err, 'We could not send the reset link. Please try again.'), 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // Set new password (user arrives here signed in via a recovery link)
  // ---------------------------------------------------------------------------
  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    K.clearInvalid();
    const pw = $('#newPassword').value;
    const pw2 = $('#newPasswordConfirm').value;
    const problem = K.passwordProblem(pw);
    if (problem) return K.markInvalid($('#newPassword'), problem);
    if (pw !== pw2) return K.markInvalid($('#newPasswordConfirm'), "Passwords don't match.");

    const btn = $('#resetButton');
    K.setBusy(btn, true, 'Saving…');
    try {
      const { data: s } = await sb.auth.getSession();
      if (!s.session) throw Object.assign(new Error(''), { code: 'otp_expired' });
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      K.showMessage(msg, 'Password updated. Taking you to your account…', 'success');
      const state = await K.getState();
      setTimeout(() => K.go(K.pageForStage(state.stage)), 900);
    } catch (err) {
      K.setBusy(btn, false);
      if (err.code === 'otp_expired' || err.code === 'session_not_found') {
        setMode('forgot', { keepMessage: true });
        K.showMessage(msg, 'Your reset link has expired. Enter your email to get a new one.', 'error');
        return;
      }
      K.showMessage(msg, K.friendlyError(err, 'We could not update your password. Please try again.'), 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') setMode('reset');
  });

  (async function init() {
    const requested = new URLSearchParams(window.location.search).get('mode') || 'signup';

    if (requested === 'reset') {
      const { data } = await sb.auth.getSession();
      if (data.session) return setMode('reset');
      setMode('forgot');
      K.showMessage(msg, 'Your reset link has expired or was already used. Enter your email to get a new one.', 'error');
      return;
    }

    // Already signed in? Skip the forms.
    const state = await K.getState().catch(() => ({ stage: 'signed_out' }));
    if (state.stage !== 'signed_out' && state.stage !== 'unconfirmed' && state.stage !== 'error') {
      K.go(K.pageForStage(state.stage));
      return;
    }
    if (requested === 'check-email' && !pendingEmail()) return setMode('login');
    setMode(requested, { focus: requested !== 'signup' });
  })();
})();
