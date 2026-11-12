// Member profile form, shared by onboarding.html (first-time setup) and the
// "My profile" dialog in portal.html.
//
//   const form = KAMSA.ProfileForm.mount(container, { member, userId, lockCore });
//   if (form.validate()) await form.save();   // returns the updated member row
//
// lockCore = true once a member is approved: name, school, graduation year and
// status become read-only (the database enforces the same rule).
(function () {
  'use strict';
  const K = window.KAMSA;
  const { el, $, $$ } = K;

  const TEMPLATE = `
    <div class="stack">
      <p class="hint" style="margin:0">All fields are required unless marked optional.</p>
      <div class="row2">
        <label class="field">
          <span class="field-label">First name</span>
          <input id="pf-first" type="text" autocomplete="given-name" maxlength="80" required>
        </label>
        <label class="field">
          <span class="field-label">Last name</span>
          <input id="pf-last" type="text" autocomplete="family-name" maxlength="80" required>
        </label>
      </div>

      <label class="field">
        <span class="field-label">School / institution</span>
        <input id="pf-school" type="text" autocomplete="organization" maxlength="160" required
               placeholder="e.g., Icahn School of Medicine at Mount Sinai">
      </label>

      <div class="row2">
        <label class="field">
          <span class="field-label">Graduation year</span>
          <input id="pf-year" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="2028">
          <p class="hint">Expected year you finish your current program.</p>
        </label>
        <label class="field" data-core-only>
          <span class="field-label">School email <span class="opt">(optional)</span></span>
          <input id="pf-school-email" type="email" autocomplete="off" maxlength="254" placeholder="you@school.edu">
          <p class="hint">Helps the board confirm student status faster. Not shown in the directory.</p>
        </label>
      </div>

      <fieldset id="pf-status-set">
        <legend class="field-label">Current status</legend>
        <div class="choice-grid" id="pf-status"></div>
      </fieldset>

      <label class="field">
        <span class="field-label">Regional chapter</span>
        <select id="pf-chapter" required></select>
        <p class="hint">We'll pass your details to that chapter's leads so they can add you to their roster and group chats.</p>
      </label>

      <fieldset>
        <legend class="field-label">Specialty interests <span class="opt">(up to 3, optional)</span></legend>
        <input id="pf-spec-search" type="search" placeholder="Search specialties" aria-label="Search specialties" style="margin-bottom:10px">
        <div class="chips" id="pf-specs" role="group" aria-describedby="pf-spec-count"></div>
        <p class="hint" id="pf-spec-count" aria-live="polite"></p>
      </fieldset>

      <label class="field">
        <span class="field-label">LinkedIn <span class="opt">(optional)</span></span>
        <input id="pf-linkedin" type="url" inputmode="url" autocomplete="url" maxlength="240" placeholder="linkedin.com/in/your-name">
      </label>

      <div class="field">
        <span class="field-label">Profile photo <span class="opt">(optional)</span></span>
        <div class="avatar-row">
          <div class="avatar" id="pf-avatar" aria-hidden="true">K</div>
          <div>
            <div class="avatar-actions">
              <label class="btn btn-secondary btn-small" for="pf-photo" tabindex="0" id="pf-photo-label">Upload photo</label>
              <input id="pf-photo" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only">
              <button type="button" class="btn-link" id="pf-photo-remove" hidden>Remove</button>
            </div>
            <p class="hint" style="margin-top:8px">JPG, PNG, or WebP. We resize it and remove location data before uploading.</p>
          </div>
        </div>
      </div>

      <fieldset id="pf-consent-set">
        <legend class="field-label">Membership directory</legend>
        <p class="hint" style="margin:0 0 10px">Listed members can see your name, school, class year, chapter, specialty interests, email, and LinkedIn. Only approved members can see the directory, and you can change this anytime.</p>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="pf-consent" value="yes"><span>Yes, include me</span></label>
          <label class="choice"><input type="radio" name="pf-consent" value="no"><span>No, keep me private</span></label>
        </div>
      </fieldset>
    </div>`;

  function mount(container, { member = {}, userId, lockCore = false } = {}) {
    container.innerHTML = TEMPLATE; // static markup only; values are set below via DOM properties

    const f = {
      first: $('#pf-first', container),
      last: $('#pf-last', container),
      school: $('#pf-school', container),
      year: $('#pf-year', container),
      schoolEmail: $('#pf-school-email', container),
      status: $('#pf-status', container),
      chapter: $('#pf-chapter', container),
      specSearch: $('#pf-spec-search', container),
      specs: $('#pf-specs', container),
      specCount: $('#pf-spec-count', container),
      linkedin: $('#pf-linkedin', container),
      avatar: $('#pf-avatar', container),
      photo: $('#pf-photo', container),
      photoLabel: $('#pf-photo-label', container),
      photoRemove: $('#pf-photo-remove', container),
    };

    // Status choices
    K.STATUSES.forEach((s) => {
      f.status.append(el('label', { class: 'choice' },
        el('input', { type: 'radio', name: 'pf-status', value: s.value }),
        el('span', {}, s.value, el('small', {}, s.hint))));
    });

    // Chapter options
    f.chapter.append(
      el('option', { value: '' }, 'Choose one'),
      ...K.CHAPTERS.map((c) => el('option', { value: c }, c)),
      el('option', { value: 'Not sure yet' }, 'Not sure yet — help me find one'),
      el('option', { value: 'none' }, 'No chapter for now'));

    // Specialty chips
    K.SPECIALTIES.forEach((s) => {
      f.specs.append(el('label', { class: 'chip', 'data-name': s.toLowerCase() },
        el('input', { type: 'checkbox', value: s }), el('span', {}, s)));
    });
    const specBoxes = () => $$('input[type="checkbox"]', f.specs);
    function updateSpecLimit() {
      const checked = specBoxes().filter((b) => b.checked).length;
      specBoxes().forEach((b) => { b.disabled = !b.checked && checked >= K.MAX_SPECIALTIES; });
      f.specCount.textContent = `${checked} of ${K.MAX_SPECIALTIES} selected`;
    }
    f.specs.addEventListener('change', updateSpecLimit);
    f.specSearch.addEventListener('input', () => {
      const q = f.specSearch.value.trim().toLowerCase();
      $$('.chip', f.specs).forEach((c) => { c.hidden = q && !c.dataset.name.includes(q); });
    });
    f.photoLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.photo.click(); }
    });

    // ---- Fill current values ----
    f.first.value = member.first_name || '';
    f.last.value = member.last_name || '';
    f.school.value = member.school_institution || '';
    f.year.value = member.graduation_year || '';
    f.schoolEmail.value = member.school_email || '';
    const st = $$(`input[name="pf-status"]`, container).find((r) => r.value === member.current_status);
    if (st) st.checked = true;
    if (member.regional_chapter) f.chapter.value = member.regional_chapter;
    else if (member.profile_completed_at) f.chapter.value = 'none';
    const chosen = new Set(Array.isArray(member.specialty_interest) ? member.specialty_interest : []);
    specBoxes().forEach((b) => { b.checked = chosen.has(b.value); });
    updateSpecLimit();
    f.linkedin.value = member.linkedin_profile || '';
    if (member.profile_completed_at) {
      const c = $(`input[name="pf-consent"][value="${member.consent_membership_directory ? 'yes' : 'no'}"]`, container);
      if (c) c.checked = true;
    }

    if (lockCore) {
      [f.first, f.last, f.school, f.year].forEach((i) => { i.readOnly = true; i.required = false; });
      $$('input[name="pf-status"]', container).forEach((r) => { r.disabled = true; });
      $$('[data-core-only]', container).forEach((n) => { n.hidden = true; });
      $('#pf-status-set', container).after(
        el('p', { class: 'hint' }, 'Name, school, class year, and status are locked after approval. Email ',
          el('a', { href: `mailto:${K.CONFIG.supportEmail || 'kamsa.usa@gmail.com'}` }, K.CONFIG.supportEmail || 'kamsa.usa@gmail.com'),
          ' to change them.'));
    }

    // ---- Avatar ----
    let existingPath = member.profile_image_path || null;
    let pendingBlob = null;
    let removeRequested = false;

    function showInitials() {
      f.avatar.replaceChildren(K.initials(f.first.value, f.last.value));
    }
    function showImage(src) {
      f.avatar.replaceChildren(el('img', { src, alt: '' }));
    }
    async function loadExisting() {
      if (!existingPath) { showInitials(); f.photoRemove.hidden = true; return; }
      const urls = await K.signedAvatarUrls([existingPath]);
      if (urls[existingPath]) showImage(urls[existingPath]); else showInitials();
      f.photoRemove.hidden = false;
    }
    loadExisting();
    [f.first, f.last].forEach((i) => i.addEventListener('input', () => {
      if (!pendingBlob && (!existingPath || removeRequested)) showInitials();
    }));

    f.photo.addEventListener('change', async () => {
      const file = f.photo.files && f.photo.files[0];
      f.photo.value = '';
      if (!file) return;
      try {
        pendingBlob = await K.prepareAvatar(file);
        removeRequested = false;
        showImage(URL.createObjectURL(pendingBlob));
        f.photoRemove.hidden = false;
        f.photoLabel.textContent = 'Change photo';
      } catch (e) {
        api.onError && api.onError(e.message);
      }
    });
    f.photoRemove.addEventListener('click', () => {
      pendingBlob = null;
      removeRequested = true;
      showInitials();
      f.photoRemove.hidden = true;
      f.photoLabel.textContent = 'Upload photo';
    });

    // ---- Validation ----
    function consentValue() {
      const r = $('input[name="pf-consent"]:checked', container);
      return r ? r.value === 'yes' : null;
    }

    function validate() {
      K.clearInvalid(container);
      let firstBad = null;
      const bad = (input, msg) => { K.markInvalid(input, msg); firstBad = firstBad || input; };

      if (!lockCore) {
        if (!f.first.value.trim()) bad(f.first, 'Please enter your first name.');
        if (!f.last.value.trim()) bad(f.last, 'Please enter your last name.');
        if (!f.school.value.trim()) bad(f.school, 'Please enter your school or institution.');
        const y = Number(f.year.value);
        const now = new Date().getFullYear();
        if (!/^\d{4}$/.test(f.year.value.trim()) || y < 1960 || y > now + 10) {
          bad(f.year, `Enter a four-digit year between 1960 and ${now + 10}.`);
        }
        const se = f.schoolEmail.value.trim();
        if (se && !K.isEmail(se)) bad(f.schoolEmail, 'Enter a valid email, or leave this blank.');
        if (!$('input[name="pf-status"]:checked', container)) {
          bad($('input[name="pf-status"]', container), 'Please choose your current status.');
        }
      }
      if (!f.chapter.value) bad(f.chapter, 'Please choose a chapter, or "No chapter for now".');
      try { K.normalizeLinkedIn(f.linkedin.value); } catch (e) { bad(f.linkedin, e.message); }
      if (consentValue() === null) {
        bad($('input[name="pf-consent"]', container), 'Please choose whether to be listed in the directory.');
      }

      if (firstBad) {
        firstBad.focus({ preventScroll: true });
        firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
      return true;
    }

    // ---- Save ----
    // mode 'complete' → complete_my_profile (onboarding, or edits while pending)
    // mode 'update'   → update_my_profile   (approved members)
    async function save({ mode = lockCore ? 'update' : 'complete' } = {}) {
      const linkedin = K.normalizeLinkedIn(f.linkedin.value) || null;
      const chapter = f.chapter.value === 'none' ? null : f.chapter.value;
      const specialties = specBoxes().filter((b) => b.checked).map((b) => b.value);
      const consent = consentValue() === true;

      let imagePath = removeRequested ? null : existingPath;
      let uploaded = null;
      if (pendingBlob) {
        uploaded = await K.uploadAvatar(userId, pendingBlob);
        imagePath = uploaded;
      }

      const rpc = mode === 'update'
        ? K.sb().rpc('update_my_profile', {
          p_linkedin_profile: linkedin,
          p_regional_chapter: chapter,
          p_specialty_interest: specialties,
          p_profile_image_path: imagePath,
          p_consent_membership_directory: consent,
        })
        : K.sb().rpc('complete_my_profile', {
          p_first_name: f.first.value.trim(),
          p_last_name: f.last.value.trim(),
          p_school_institution: f.school.value.trim(),
          p_graduation_year: Number(f.year.value),
          p_current_status: ($('input[name="pf-status"]:checked', container) || {}).value || null,
          p_regional_chapter: chapter,
          p_specialty_interest: specialties,
          p_linkedin_profile: linkedin,
          p_school_email: K.normalizeEmail(f.schoolEmail.value) || null,
          p_profile_image_path: imagePath,
          p_consent_membership_directory: consent,
        });

      const { data, error } = await rpc;
      if (error) {
        if (uploaded) await K.removeAvatar(uploaded); // don't leave orphaned uploads
        throw error;
      }

      // Clean up the previous photo once the new path is saved.
      if (existingPath && existingPath !== imagePath) await K.removeAvatar(existingPath);
      existingPath = imagePath;
      pendingBlob = null;
      removeRequested = false;
      return data;
    }

    const api = { validate, save, onError: null, fields: f };
    return api;
  }

  K.ProfileForm = { mount };
})();
