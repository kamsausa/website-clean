// admin.html — member management for national board admins.
// Who can see and change what is enforced by the database (admins table + policies);
// this page only displays it.
(function () {
  'use strict';
  const K = window.KAMSA;
  const { $, el } = K;
  const sb = K.sb();
  const msg = $('#message');

  let members = [];
  let current = null; // member open in the dialog

  $('#logout').addEventListener('click', K.signOut);
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') K.go(K.PAGES.login); });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  // Display stage: unfinished sign-ups are 'pending' in the database but have no profile yet.
  function stageOf(m) {
    if (!m.profile_completed_at && m.membership_status === 'pending') return 'incomplete';
    return m.membership_status || 'pending';
  }
  const STAGE_LABEL = { active: 'Active', pending: 'Awaiting review', incomplete: 'Unfinished', inactive: 'Inactive', rejected: 'Rejected' };

  function fullName(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ') || '(no name)';
  }
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function pill(m) {
    const st = stageOf(m);
    return el('span', { class: 'pill ' + st }, STAGE_LABEL[st] || st);
  }
  function nameCell(m) {
    return el('td', {}, el('strong', {}, fullName(m)), el('span', { class: 'sub' }, m.personal_email || ''));
  }
  function schoolCell(m) {
    return el('td', {}, m.school_institution || '—',
      m.graduation_year ? el('span', { class: 'sub' }, `Class of ${m.graduation_year}${m.current_status ? ' · ' + m.current_status : ''}`) : null);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderStats() {
    $('#statActive').textContent = members.filter((m) => m.membership_status === 'active').length;
    $('#statReview').textContent = members.filter((m) => stageOf(m) === 'pending').length;
    $('#statIncomplete').textContent = members.filter((m) => stageOf(m) === 'incomplete').length;
    $('#statDirectory').textContent = members.filter((m) => m.membership_status === 'active' && m.consent_membership_directory).length;
  }

  function renderReview() {
    const rows = members
      .filter((m) => stageOf(m) === 'pending')
      .sort((a, b) => String(a.profile_completed_at).localeCompare(String(b.profile_completed_at)));
    $('#reviewCount').textContent = `${rows.length} waiting`;
    const body = $('#reviewRows');
    if (!rows.length) {
      body.replaceChildren(el('tr', { class: 'empty-row' }, el('td', { colspan: '7' }, 'No one is waiting for review.')));
      return;
    }
    body.replaceChildren(...rows.map((m) => {
      const approve = el('button', { type: 'button', class: 'btn btn-primary btn-small' }, 'Approve');
      approve.addEventListener('click', () => setStatus(m, 'active', approve));
      const details = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Details');
      details.addEventListener('click', () => openDetail(m));
      return el('tr', {},
        nameCell(m),
        el('td', { class: 'mono' }, m.membership_id || '—'),
        schoolCell(m),
        el('td', {}, m.current_status || '—'),
        el('td', {}, m.regional_chapter || '—'),
        el('td', {}, fmtDate(m.profile_completed_at)),
        el('td', {}, el('div', { class: 'row-actions' }, approve, details)));
    }));
  }

  function filtered() {
    const q = $('#fSearch').value.trim().toLowerCase();
    const st = $('#fStatus').value;
    const ch = $('#fChapter').value;
    return members.filter((m) => {
      if (st && stageOf(m) !== st) return false;
      if (ch && m.regional_chapter !== ch) return false;
      if (!q) return true;
      const hay = [fullName(m), m.personal_email, m.school_email, m.school_institution, m.membership_id].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderAll() {
    const rows = filtered();
    $('#allCount').textContent = `${rows.length} of ${members.length} shown`;
    const body = $('#allRows');
    if (!rows.length) {
      body.replaceChildren(el('tr', { class: 'empty-row' }, el('td', { colspan: '8' }, members.length ? 'No members match these filters.' : 'No sign-ups yet.')));
      return;
    }
    body.replaceChildren(...rows.map((m) => {
      const details = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Details');
      details.addEventListener('click', () => openDetail(m));
      return el('tr', {},
        nameCell(m),
        el('td', { class: 'mono' }, m.membership_id || '—'),
        schoolCell(m),
        el('td', {}, m.regional_chapter || '—', m.regional_chapter_role ? el('span', { class: 'sub' }, m.regional_chapter_role) : null),
        el('td', {}, pill(m)),
        el('td', {}, m.consent_membership_directory ? 'Listed' : 'Private'),
        el('td', {}, fmtDate(m.created_at)),
        el('td', {}, details));
    }));
  }

  function buildChapterFilter() {
    const select = $('#fChapter');
    const keep = select.value;
    const chapters = Array.from(new Set(members.map((m) => m.regional_chapter).filter(Boolean))).sort();
    select.replaceChildren(el('option', { value: '' }, 'All chapters'), ...chapters.map((c) => el('option', { value: c }, c)));
    select.value = chapters.includes(keep) ? keep : '';
  }

  function renderEverything() {
    renderStats();
    renderReview();
    buildChapterFilter();
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  async function loadMembers() {
    const { data, error } = await sb.from('members').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    members = data || [];
    renderEverything();
  }

  function replaceMember(updated) {
    members = members.map((m) => (m.id === updated.id ? { ...m, ...updated } : m));
    renderEverything();
  }

  async function setStatus(m, status, button) {
    K.setBusy(button, true, status === 'active' ? 'Approving…' : 'Saving…');
    const { data, error } = await sb.rpc('admin_set_member_status', { p_member_id: m.id, p_status: status });
    K.setBusy(button, false);
    if (error) {
      K.showMessage(msg, K.friendlyError(error, 'That change could not be saved.'), 'error');
      return null;
    }
    replaceMember(data);
    K.showMessage(msg, status === 'active'
      ? `${fullName(m)} is approved. Their approval email is on its way.`
      : `${fullName(m)} is now ${STAGE_LABEL[status] || status}.`, 'success');
    return data;
  }

  // ---------------------------------------------------------------------------
  // Detail dialog
  // ---------------------------------------------------------------------------
  const dialog = $('#detailDialog');
  const dmsg = $('#detailMessage');

  function addDetail(list, label, value) {
    list.append(el('dt', {}, label), el('dd', {}, value == null || value === '' ? '—' : value));
  }

  function openDetail(m) {
    current = m;
    K.showMessage(dmsg, '');
    $('#detailTitle').textContent = fullName(m);
    $('#detailId').textContent = m.membership_id || 'Member';
    const list = $('#detailList');
    list.replaceChildren();
    addDetail(list, 'Status', pill(m));
    addDetail(list, 'Login email', m.personal_email);
    addDetail(list, 'School email', m.school_email);
    addDetail(list, 'School', m.school_institution);
    addDetail(list, 'Graduation year', m.graduation_year);
    addDetail(list, 'Current status', m.current_status);
    addDetail(list, 'Regional chapter', m.regional_chapter);
    addDetail(list, 'Specialty interests', Array.isArray(m.specialty_interest) && m.specialty_interest.length ? m.specialty_interest.join(', ') : '');
    const li = K.safeHttpsUrl(m.linkedin_profile);
    addDetail(list, 'LinkedIn', li ? el('a', { href: li, target: '_blank', rel: 'noopener noreferrer' }, li) : '');
    addDetail(list, 'Directory', m.consent_membership_directory ? 'Listed' : 'Private');
    addDetail(list, 'Signed up', fmtDate(m.created_at));
    addDetail(list, 'Profile completed', fmtDate(m.profile_completed_at));
    addDetail(list, 'Approved', fmtDate(m.approved_at));
    $('#detailStatus').value = m.membership_status || 'pending';
    $('#detailRole').value = m.regional_chapter_role || '';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  function closeDetail() {
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    current = null;
  }
  $('#closeDetail').addEventListener('click', closeDetail);
  $('#cancelDetail').addEventListener('click', closeDetail);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDetail(); });

  $('#detailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return;
    const m = current;
    const btn = $('#saveDetail');
    const status = $('#detailStatus').value;
    const role = $('#detailRole').value.trim();
    K.setBusy(btn, true, 'Saving…');
    try {
      if (status !== m.membership_status) {
        const { data, error } = await sb.rpc('admin_set_member_status', { p_member_id: m.id, p_status: status });
        if (error) throw error;
        replaceMember(data);
      }
      if (role !== (m.regional_chapter_role || '')) {
        const { data, error } = await sb.from('members').update({ regional_chapter_role: role || null }).eq('id', m.id).select().single();
        if (error) throw error;
        replaceMember(data);
      }
      K.setBusy(btn, false);
      closeDetail();
      K.showMessage(msg, `Saved changes for ${fullName(m)}.${status === 'active' && m.membership_status !== 'active' ? ' Their approval email is on its way.' : ''}`, 'success');
    } catch (err) {
      K.setBusy(btn, false);
      K.showMessage(dmsg, K.friendlyError(err, 'That change could not be saved.'), 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // CSV export (of the members currently shown)
  // ---------------------------------------------------------------------------
  function csvCell(v) {
    let s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $('#exportCsv').addEventListener('click', () => {
    const cols = [
      ['Membership ID', 'membership_id'], ['First name', 'first_name'], ['Last name', 'last_name'],
      ['Login email', 'personal_email'], ['School email', 'school_email'], ['School', 'school_institution'],
      ['Graduation year', 'graduation_year'], ['Current status', 'current_status'], ['Chapter', 'regional_chapter'],
      ['Chapter role', 'regional_chapter_role'], ['Specialty interests', 'specialty_interest'], ['LinkedIn', 'linkedin_profile'],
      ['Membership status', 'membership_status'], ['Directory', 'consent_membership_directory'],
      ['Signed up', 'created_at'], ['Profile completed', 'profile_completed_at'], ['Approved', 'approved_at'],
    ];
    const lines = [cols.map((c) => csvCell(c[0])).join(',')]
      .concat(filtered().map((m) => cols.map((c) => csvCell(m[c[1]])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `kamsa-members-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
  });

  ['#fSearch', '#fStatus', '#fChapter'].forEach((id) => $(id).addEventListener(id === '#fSearch' ? 'input' : 'change', renderAll));
  $('#clearFilters').addEventListener('click', () => {
    $('#fSearch').value = '';
    $('#fStatus').value = '';
    $('#fChapter').value = '';
    renderAll();
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  (async function init() {
    const state = await K.getState({ verify: true });
    if (state.stage === 'signed_out' || state.stage === 'unconfirmed') return K.go(K.pageForStage(state.stage));
    $('#loading').hidden = true;
    if (!state.isAdmin) {
      K.showMessage(msg, 'This page is for KAMSA national board admins only.', 'error');
      return;
    }
    try {
      await loadMembers();
      $('#adminArea').hidden = false;
    } catch (err) {
      K.showMessage(msg, K.friendlyError(err, 'Members could not be loaded. Please refresh the page.'), 'error');
    }
  })().catch((err) => {
    $('#loading').hidden = true;
    K.showMessage(msg, K.friendlyError(err, 'The admin page could not load. Please refresh.'), 'error');
  });
})();
