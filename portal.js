// portal.html — member portal. Shows the right view for the member's stage:
// pending review, inactive, or the full directory + perks for active members.
// Access is enforced by the database; this page only decides what to display.
(function () {
  'use strict';
  const K = window.KAMSA;
  const { $, $$, el } = K;
  const sb = K.sb();
  const msg = $('#message');

  let state = null;
  let allRows = [];
  let avatarUrls = {};
  let filtersBound = false;

  $('#logout').addEventListener('click', K.signOut);
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') K.go(K.PAGES.login); });

  // ---------------------------------------------------------------------------
  // Directory
  // ---------------------------------------------------------------------------
  const FILTERS = [
    { id: 'fStatus', key: 'current_status', all: 'All statuses' },
    { id: 'fChapter', key: 'regional_chapter', all: 'All chapters' },
    { id: 'fSchool', key: 'school_institution', all: 'All schools' },
    { id: 'fSpecialty', key: 'specialty_interest', all: 'All specialties' },
  ];

  function buildFilters(rows) {
    FILTERS.forEach(({ id, key, all }) => {
      const values = new Set();
      rows.forEach((r) => {
        const v = r[key];
        (Array.isArray(v) ? v : [v]).forEach((x) => { if (x) values.add(String(x)); });
      });
      const select = $('#' + id);
      select.replaceChildren(el('option', { value: '' }, all),
        ...Array.from(values).sort((a, b) => a.localeCompare(b)).map((v) => el('option', { value: v }, v)));
      if (!filtersBound) select.addEventListener('change', applyFilters);
    });
    if (filtersBound) return;
    filtersBound = true;
    $('#fSearch').addEventListener('input', applyFilters);
    $('#clearFilters').addEventListener('click', () => {
      FILTERS.forEach(({ id }) => { $('#' + id).value = ''; });
      $('#fSearch').value = '';
      applyFilters();
    });
  }

  function applyFilters() {
    const q = $('#fSearch').value.trim().toLowerCase();
    const active = FILTERS.map(({ id, key }) => ({ key, value: $('#' + id).value })).filter((f) => f.value);
    const rows = allRows.filter((r) => {
      if (q) {
        const hay = `${r.first_name || ''} ${r.last_name || ''} ${r.school_institution || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return active.every(({ key, value }) => {
        const v = r[key];
        return Array.isArray(v) ? v.map(String).includes(value) : String(v || '') === value;
      });
    });
    $('#clearFilters').hidden = !(q || active.length);
    renderDirectory(rows);
  }

  function memberCard(m) {
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'KAMSA member';
    const avatar = el('div', { class: 'avatar', 'aria-hidden': 'true' });
    const url = m.profile_image_path && avatarUrls[m.profile_image_path];
    if (url) avatar.append(el('img', { src: url, alt: '', loading: 'lazy' }));
    else avatar.append(K.initials(m.first_name, m.last_name));

    const meta = [m.graduation_year ? `Class of ${m.graduation_year}` : '', m.regional_chapter || ''].filter(Boolean).join(' · ');
    const specs = Array.isArray(m.specialty_interest) ? m.specialty_interest.join(', ') : '';
    const links = el('div', { class: 'links' });
    if (m.email) links.append(el('a', { href: 'mailto:' + encodeURIComponent(m.email).replace(/%40/g, '@') }, 'Email'));
    const li = K.safeHttpsUrl(m.linkedin_profile);
    if (li && /(^|\.)linkedin\.com$/i.test(new URL(li).hostname)) {
      links.append(el('a', { href: li, target: '_blank', rel: 'noopener noreferrer' }, 'LinkedIn ↗'));
    }

    return el('article', { class: 'member-card' },
      el('div', { class: 'top' }, avatar,
        el('div', {}, el('h3', {}, name),
          m.current_status ? el('span', { class: 'badge' }, m.current_status) : null)),
      m.school_institution ? el('small', {}, m.school_institution) : null,
      meta ? el('small', {}, meta) : null,
      m.regional_chapter_role ? el('small', {}, `Chapter role: ${m.regional_chapter_role}`) : null,
      specs ? el('small', { class: 'spec' }, specs) : null,
      links.childNodes.length ? links : null);
  }

  function renderDirectory(rows) {
    const grid = $('#dirGrid');
    grid.replaceChildren(...rows.map(memberCard));
    if (!rows.length) {
      grid.append(el('p', { class: 'empty' }, allRows.length
        ? 'No members match these filters.'
        : 'No one is listed in the directory yet. Be the first — turn on your listing under My profile.'));
    }
    $('#dirCount').textContent = `${rows.length} member${rows.length === 1 ? '' : 's'} shown`;
  }

  async function loadDirectory() {
    $('#dirGrid').replaceChildren(el('div', { class: 'loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading members…'));
    const { data, error } = await sb.rpc('get_member_directory');
    if (error) {
      $('#dirGrid').replaceChildren(el('p', { class: 'empty' }, 'We could not load the directory right now. Please refresh the page.'));
      console.error('KAMSA directory error:', error);
      return;
    }
    allRows = Array.isArray(data) ? data : [];
    avatarUrls = await K.signedAvatarUrls(allRows.map((r) => r.profile_image_path));
    buildFilters(allRows);
    applyFilters();
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
      if (state.stage === 'active') loadDirectory();
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
    if (state.stage === 'active' || state.isAdmin) {
      await Promise.all([loadDirectory(), loadPerks()]);
    }
  })().catch((err) => {
    $('#loading').hidden = true;
    K.showMessage(msg, K.friendlyError(err, 'We could not load the portal. Please refresh the page.'), 'error');
  });
})();
