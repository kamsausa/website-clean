// verify.html — landing page for links in KAMSA emails (confirm sign-up,
// password reset, email change).
//
// Links look like: verify.html?token_hash=...&type=email  (see email-templates/)
// The token is only used when the person presses the button. Many school and
// hospital inboxes (e.g. Microsoft Safe Links) open links automatically to scan
// them; confirming on page load would let the scanner use up the one-time link.
(function () {
  'use strict';
  const K = window.KAMSA;
  const { $ } = K;
  const sb = K.sb();
  const msg = $('#message');

  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const tokenHash = q.get('token_hash');
  const type = (q.get('type') || '').toLowerCase();
  const code = q.get('code');
  const errCode = q.get('error_code') || h.get('error_code') || q.get('error') || h.get('error');

  let sawRecoveryEvent = false;
  sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') sawRecoveryEvent = true; });

  const TYPES = {
    email: { verifyType: 'email', heading: 'Confirm your email', button: 'Confirm my email', text: 'Press the button below to confirm your email address and continue to your profile.' },
    signup: { verifyType: 'email', heading: 'Confirm your email', button: 'Confirm my email', text: 'Press the button below to confirm your email address and continue to your profile.' },
    invite: { verifyType: 'invite', heading: 'Accept your invitation', button: 'Accept invitation', text: 'Press the button below to accept your KAMSA invitation.' },
    recovery: { verifyType: 'recovery', heading: 'Reset your password', button: 'Continue', text: 'Press continue to choose a new password.' },
    email_change: { verifyType: 'email_change', heading: 'Confirm your new email', button: 'Confirm new email', text: 'Press the button below to confirm the change to your KAMSA login email.' },
  };

  function show(panel) {
    ['#loading', '#confirmPanel', '#donePanel', '#expiredPanel'].forEach((id) => { $(id).hidden = id !== panel; });
  }

  // Remove the one-time token from the address bar and browser history.
  function stripUrl() {
    history.replaceState(null, '', window.location.pathname);
  }

  function setHeading(kicker, heading) {
    $('#kicker').textContent = kicker;
    $('#heading').textContent = heading;
    document.title = `${heading} | KAMSA`;
  }

  function hideSteps() { $('#steps').hidden = true; }

  function markEmailStepDone() {
    $('#stepEmail').className = 'done';
    $('#stepEmail').removeAttribute('aria-current');
    $('#stepProfile').className = 'current';
    $('#stepProfile').setAttribute('aria-current', 'step');
  }

  function showExpired(text) {
    stripUrl();
    setHeading('Link expired', 'Let’s get you a new link');
    hideSteps();
    if (text) $('#expiredText').textContent = text;
    try { $('#resendEmail').value = sessionStorage.getItem('kamsa.pendingEmail') || ''; } catch (_) {}
    show('#expiredPanel');
    const c = $('#expiredPanel [data-captcha]');
    K.captcha.mount(c).catch(() => {});
  }

  async function finishSignedIn(doneText) {
    const state = await K.getState();
    const next = K.pageForStage(state.stage);
    const label = state.stage === 'needs_profile' ? 'Set up my profile' : 'Go to the member portal';
    $('#continueLink').href = next;
    $('#continueLink').textContent = label;
    $('#doneText').textContent = doneText;
    setHeading('Confirmed', state.stage === 'needs_profile' ? 'You’re confirmed' : 'All set');
    markEmailStepDone();
    show('#donePanel');
    // Move on automatically; the button is there if the redirect is blocked.
    setTimeout(() => K.go(next), 1600);
  }

  async function handleTokenHash() {
    const cfg = TYPES[type];
    if (!cfg) return showExpired('This link is not valid. Please request a new one.');

    setHeading(type === 'recovery' ? 'Account help' : 'Almost there', cfg.heading);
    if (type === 'recovery' || type === 'email_change') hideSteps();
    $('#confirmText').textContent = cfg.text;
    $('#confirmButton').textContent = cfg.button;
    show('#confirmPanel');
    $('#confirmButton').focus();

    $('#confirmButton').addEventListener('click', async () => {
      const btn = $('#confirmButton');
      K.setBusy(btn, true, 'Confirming…');
      K.showMessage(msg, '');
      const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: cfg.verifyType });
      if (error) {
        K.setBusy(btn, false);
        if (error.code === 'otp_expired' || error.status === 403 || /expired|invalid/i.test(error.message)) {
          return showExpired('This link has expired or has already been used.');
        }
        K.showMessage(msg, K.friendlyError(error, 'We could not confirm this link. Please try again.'), 'error');
        return;
      }
      stripUrl();
      try { sessionStorage.removeItem('kamsa.pendingEmail'); } catch (_) {}

      if (type === 'recovery') return K.go(K.PAGES.resetPassword);
      if (type === 'email_change') {
        const email = data && data.user ? data.user.email : '';
        return finishSignedIn(email
          ? `Your login email is now ${email}. If we also sent a link to your other address, open that one too to finish the change.`
          : 'Your new email is confirmed.');
      }
      return finishSignedIn('Your email is confirmed. Next, tell us a bit about yourself so we can connect you with your chapter.');
    }, { once: false });
  }

  // Fallback for Supabase's default email templates (PKCE "?code=" links).
  async function handleCode() {
    const { data } = await sb.auth.getSession(); // supabase-js exchanges the code during start-up
    stripUrl();
    if (data.session) {
      if (sawRecoveryEvent) return K.go(K.PAGES.resetPassword);
      return finishSignedIn('Your email is confirmed.');
    }
    // The exchange only works in the browser where the account was created.
    // The email itself is already confirmed at this point, so logging in works.
    setHeading('Confirmed', 'Your email is confirmed');
    markEmailStepDone();
    $('#doneText').textContent = 'You opened the link in a different browser or device, so we could not sign you in here. Log in to continue setting up your profile. (Resetting a password? Request a new link from this browser.)';
    $('#continueLink').href = K.PAGES.login;
    $('#continueLink').textContent = 'Log in';
    show('#donePanel');
  }

  $('#resendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    K.clearInvalid();
    const email = K.normalizeEmail($('#resendEmail').value);
    if (!K.isEmail(email)) return K.markInvalid($('#resendEmail'), 'Please enter a valid email address.');
    const btn = $('#resendButton');
    const c = $('#expiredPanel [data-captcha]');
    const token = K.captcha.token(c);
    if (K.captcha.enabled && !token) return K.showMessage(msg, 'Please complete the verification check.', 'error');
    K.setBusy(btn, true, 'Sending…');
    try {
      // Password-reset links get a new reset email; everything else gets a new confirmation.
      const { error } = type === 'recovery'
        ? await sb.auth.resetPasswordForEmail(email, { redirectTo: K.pageUrl(K.PAGES.verify), captchaToken: token })
        : await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: K.pageUrl(K.PAGES.verify), captchaToken: token } });
      if (error) throw error;
      K.setBusy(btn, false);
      K.showMessage(msg, `If ${email} needs a new link, it's on its way. Check Spam too. Already confirmed? Just log in.`, 'success');
      K.cooldown(btn, 60, 'Send a new link');
    } catch (err) {
      K.captcha.reset(c);
      K.setBusy(btn, false);
      K.showMessage(msg, K.friendlyError(err, 'We could not send a new link. Please try again in a minute.'), 'error');
    }
  });

  (async function init() {
    if (errCode) {
      const expired = /expired|otp/i.test(errCode);
      return showExpired(expired ? 'This link has expired or has already been used.' : 'This link is not valid. Please request a new one.');
    }
    if (tokenHash) return handleTokenHash();
    if (code) return handleCode();

    // Opened directly with no link details.
    const state = await K.getState().catch(() => ({ stage: 'signed_out' }));
    if (state.stage === 'signed_out' || state.stage === 'unconfirmed') {
      return showExpired('Open the confirmation link from your email to continue.');
    }
    K.go(K.pageForStage(state.stage));
  })();
})();
