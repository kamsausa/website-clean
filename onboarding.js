// onboarding.html — first-time profile setup after the email is confirmed.
(function () {
  'use strict';
  const K = window.KAMSA;
  const { $ } = K;
  const sb = K.sb();
  const msg = $('#message');

  $('#logout').addEventListener('click', K.signOut);
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') K.go(K.PAGES.login); });

  (async function init() {
    const state = await K.getState({ verify: true });

    if (state.stage === 'signed_out' || state.stage === 'unconfirmed') return K.go(K.pageForStage(state.stage));
    if (state.stage === 'error') {
      $('#loading').hidden = true;
      return K.showMessage(msg, K.friendlyError(state.error, 'We could not load your account. Please refresh the page.'), 'error');
    }
    if (state.stage !== 'needs_profile') return K.go(K.PAGES.portal); // profile already set up

    $('#accountEmail').textContent = state.user.email;
    if (state.member && state.member.first_name) {
      $('#heading').textContent = `Welcome, ${state.member.first_name}`;
      document.title = 'Set up your profile | KAMSA';
    }

    const form = K.ProfileForm.mount($('#profileFields'), {
      member: state.member || {},
      userId: state.user.id,
      lockCore: false,
    });
    form.onError = (text) => K.showMessage(msg, text, 'error');

    $('#loading').hidden = true;
    $('#profileForm').hidden = false;

    $('#profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      K.showMessage(msg, '');
      if (!form.validate()) {
        K.showMessage(msg, 'A few fields need your attention.', 'error');
        return;
      }
      const btn = $('#saveButton');
      K.setBusy(btn, true, 'Submitting…');
      try {
        await form.save({ mode: 'complete' });
        K.go(K.PAGES.portal);
      } catch (err) {
        K.setBusy(btn, false);
        K.showMessage(msg, K.friendlyError(err, 'We could not save your profile. Please try again.'), 'error');
      }
    });
  })().catch((err) => {
    $('#loading').hidden = true;
    K.showMessage(msg, K.friendlyError(err, 'We could not load your account. Please refresh the page.'), 'error');
  });
})();
