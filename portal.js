// portal.html — member portal. Shows the right view for the member's stage:
// pending review, inactive, or resources, a link to the directory, and perks for active members.
// Access is enforced by the database; this page only decides what to display.
(function () {
  'use strict';
  const K = window.KAMSA;
  const { $, $$, el } = K;
  const sb = K.sb();
  const msg = $('#message');

  let state = null;

  $('#logout').addEventListener('click', K.signOut);
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') K.go(K.PAGES.login); });

  // ---------------------------------------------------------------------------
  // Member resources (links stored in the database; only active members can read them)
  // ---------------------------------------------------------------------------
  async function loadResources() {
    const grid = $('#resourceGrid');
    const { data, error } = await sb.from('member_resources')
      .select('title, description, url, link_label')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      grid.replaceChildren(el('p', { class: 'empty' }, 'We could not load member resources right now. Please refresh the page.'));
      return;
    }
    const items = (data || []).filter((r) => K.safeHttpsUrl(r.url));
    if (!items.length) {
      $('#resourcesSection').hidden = true;
      return;
    }
    grid.replaceChildren(...items.map((r) => el('article', { class: 'resource-card' },
      el('div', {}, el('h3', {}, r.title), el('p', {}, r.description)),
      el('a', { class: 'btn btn-primary', href: K.safeHttpsUrl(r.url), target: '_blank', rel: 'noopener noreferrer' },
        (r.link_label || 'Open') + ' ↗'))));
  }

  // ---------------------------------------------------------------------------
  // Perks (stored in the database; only active members can read them)
  // ---------------------------------------------------------------------------
  async function loadPerks() {
    const grid = $('#perkGrid');
    const { data, error } = await sb.from('partner_perks')
      .select('partner, description, code, url, link_label')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      grid.replaceChildren(el('p', { class: 'empty' }, 'We could not load partner perks right now.'));
      return;
    }
    if (!data.length) {
      grid.replaceChildren(el('p', { class: 'empty' }, 'New partner perks are coming soon.'));
      return;
    }
    grid.replaceChildren(...data.map((p) => {
      const card = el('article', { class: 'perk' }, el('h3', {}, p.partner), el('p', {}, p.description));
      if (p.code) {
        const copy = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Copy code');
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(p.code); copy.textContent = 'Copied'; } catch (_) { copy.textContent = 'Select and copy'; }
          setTimeout(() => { copy.textContent = 'Copy code'; }, 1800);
        });
        card.append(el('div', { class: 'code-row' }, el('span', { class: 'code' }, p.code), copy));
      }
      const href = K.safeHttpsUrl(p.url);
      if (href) {
        card.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer', style: 'font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase' },
          `${p.link_label || 'Visit ' + p.partner} →`));
      }
      return card;
    }));
  }

  // ---------------------------------------------------------------------------
  // Profile dialog
  // ---------------------------------------------------------------------------
  const dialog = $('#profileDialog');
  const pmsg = $('#profileMessage');
  let profileForm = null;

  function openProfile() {
    K.showMessage(pmsg, '');
    profileForm = K.ProfileForm.mount($('#profileFields'), {
      member: state.member,
      userId: state.user.id,
      lockCore: state.stage === 'active',
    });
    profileForm.onError = (t) => K.showMessage(pmsg, t, 'error');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeProfile() {
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  }

  $('#closeProfile').addEventListener('click', closeProfile);
  $('#cancelProfile').addEventListener('click', closeProfile);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeProfile(); });

  $('#profileDialogForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    K.showMessage(pmsg, '');
    if (!profileForm.validate()) return K.showMessage(pmsg, 'A few fields need your attention.', 'error');
    const btn = $('#saveProfile');
    K.setBusy(btn, true, 'Saving…');
    try {
      const updated = await profileForm.save({ mode: state.stage === 'active' ? 'update' : 'complete' });
      state.member = updated;
      K.setBusy(btn, false);
      K.showMessage(pmsg, 'Your profile has been updated.', 'success');
      renderStage();
      setTimeout(closeProfile, 800);
    } catch (err) {
      K.setBusy(btn, false);
      K.showMessage(pmsg, K.friendlyError(err, 'We could not save your profile. Please try again.'), 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // Stage rendering
  // ---------------------------------------------------------------------------
  function renderStage() {
    const m = state.member || {};
    $('#loading').hidden = true;
    $('#openProfile').hidden = false;
    $('#adminLink').hidden = !state.isAdmin;
    $$('[data-membership-id]').forEach((n) => { n.textContent = m.membership_id || 'being assigned'; });

    const showMembers = state.stage === 'active' || state.isAdmin;
    $('#memberArea').hidden = !showMembers;
    $('#pendingPanel').hidden = showMembers || state.stage !== 'pending';
    $('#inactivePanel').hidden = showMembers || state.stage !== 'inactive';

    if (state.stage === 'pending') {
      $('#pendingHeading').textContent = m.first_name ? `You're all set, ${m.first_name}` : "You're all set";
      $('#pendingEmail').textContent = state.user.email;
      $('#pendingChapter').textContent = m.regional_chapter && m.regional_chapter !== 'Not sure yet'
        ? `Once you're approved, we'll introduce you to the ${m.regional_chapter} chapter leads.`
        : m.regional_chapter === 'Not sure yet'
          ? "Once you're approved, we'll help you find the right regional chapter."
          : '';
    }
    if (showMembers) {
      $('#welcome').textContent = m.first_name ? `Welcome back, ${m.first_name}` : 'Member Portal';
      if (state.isAdmin && state.stage !== 'active') {
        K.showMessage(msg, `You're viewing the portal as an admin. Your own membership is ${m.membership_status || 'not set up'}.`, '');
      }
    }
  }

  $$('[data-open-profile]').forEach((b) => b.addEventListener('click', openProfile));
  $('#openProfile').addEventListener('click', openProfile);

  (async function init() {
    state = await K.getState({ verify: true });
    if (state.stage === 'signed_out' || state.stage === 'unconfirmed' || state.stage === 'needs_profile') {
      return K.go(K.pageForStage(state.stage));
    }
    if (state.stage === 'error') {
      $('#loading').hidden = true;
      return K.showMessage(msg, K.friendlyError(state.error, 'We could not load your account. Please refresh the page.'), 'error');
    }
    renderStage();
    // directory.html sends people here with ?profile=1 to change their listing.
    if (new URLSearchParams(location.search).get('profile') === '1') {
      history.replaceState(null, '', location.pathname);
      openProfile();
    }
    if (state.stage === 'active' || state.isAdmin) {
      await Promise.all([loadResources(), loadPerks()]);
    }
  })().catch((err) => {
    $('#loading').hidden = true;
    K.showMessage(msg, K.friendlyError(err, 'We could not load the portal. Please refresh the page.'), 'error');
  });
})();
