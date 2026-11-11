// Shared helpers for the KAMSA account pages (sign-up, verify, onboarding, portal).
// Security note: everything here is convenience and routing. The real access
// rules live in the database (row-level security + RPCs in kamsa_membership.sql).
(function () {
  'use strict';

  const CONFIG = window.KAMSA_CONFIG || {};

  // Keep these lists in sync with kamsa_allowed_statuses() / kamsa_allowed_chapters() in SQL.
  const STATUSES = [
    { value: 'Pre-medical student', hint: 'College or post-bacc' },
    { value: 'Medical student', hint: 'MD or DO, any year' },
    { value: 'Alumni', hint: 'Residents, fellows, and physicians' },
  ];
  const CHAPTERS = ['NY/NJ', 'New England', 'Pennsylvania', 'DMV', 'North Carolina', 'Georgia',
    'Ohio', 'Michigan', 'Chicago', 'Texas', 'SoCal'];
  const SPECIALTIES = [
    'Undecided', 'Allergy & Immunology', 'Anesthesiology', 'Cardiology', 'Child & Adolescent Psychiatry',
    'Colon & Rectal Surgery', 'Critical Care Medicine', 'Dermatology', 'Emergency Medicine',
    'Endocrinology', 'Family Medicine', 'Gastroenterology', 'General Surgery', 'Geriatric Medicine',
    'Hematology & Oncology', 'Infectious Disease', 'Internal Medicine', 'Interventional Radiology',
    'Medical Genetics', 'Nephrology', 'Neurological Surgery', 'Neurology', 'Nuclear Medicine',
    'Obstetrics & Gynecology', 'Occupational Medicine', 'Ophthalmology', 'Oral & Maxillofacial Surgery',
    'Orthopedic Surgery', 'Otolaryngology (ENT)', 'Pain Medicine', 'Palliative Care', 'Pathology',
    'Pediatrics', 'Physical Medicine & Rehabilitation', 'Plastic Surgery', 'Preventive Medicine',
    'Psychiatry', 'Pulmonology', 'Radiation Oncology', 'Radiology (Diagnostic)', 'Rheumatology',
    'Sleep Medicine', 'Sports Medicine', 'Thoracic Surgery', 'Urology', 'Vascular Surgery',
  ];
  const MAX_SPECIALTIES = 3;
  const AVATAR_BUCKET = 'member-avatars';

  const PAGES = {
    login: 'signup.html?mode=login',
    signup: 'signup.html',
    checkEmail: 'signup.html?mode=check-email',
    resetPassword: 'signup.html?mode=reset',
    verify: 'verify.html',
    onboarding: 'onboarding.html',
    portal: 'portal.html',
  };

  function sb() {
    if (!window.supabaseClient) throw new Error('Supabase client is not loaded.');
    return window.supabaseClient;
  }

  // Absolute URL for a page on this site (works on a custom domain or a sub-path).
  function pageUrl(page) {
    return new URL(page, window.location.href).href;
  }

  function go(page, { replace = true } = {}) {
    const url = pageUrl(page);
    if (replace) window.location.replace(url);
    else window.location.href = url;
  }

  // ---------------------------------------------------------------------------
  // Membership state → which page the visitor belongs on
  // stages: signed_out | unconfirmed | needs_profile | pending | active | inactive | error
  // ---------------------------------------------------------------------------
  async function getState({ verify = false } = {}) {
    const client = sb();
    let user = null;

    if (verify) {
      // Asks the auth server, so revoked or expired sessions are caught.
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
        return { stage: 'signed_out' };
      }
      user = data.user;
    } else {
      const { data } = await client.auth.getSession();
      user = data.session ? data.session.user : null;
      if (!user) return { stage: 'signed_out' };
    }

    if (!user.email_confirmed_at) return { stage: 'unconfirmed', user };

    const { data, error } = await client.rpc('get_my_membership');
    if (error) {
      if (error.code === '28000' || /jwt/i.test(error.message || '')) {
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
        return { stage: 'signed_out' };
      }
      return { stage: 'error', user, error };
    }

    const member = data.member || null;
    const isAdmin = data.is_admin === true;
    let stage;
    if (!member || !member.profile_completed_at) stage = 'needs_profile';
    else if (member.membership_status === 'active') stage = 'active';
    else if (member.membership_status === 'pending') stage = 'pending';
    else stage = 'inactive';

    return { stage, user, member, isAdmin };
  }

  function pageForStage(stage) {
    switch (stage) {
      case 'signed_out': return PAGES.login;
      case 'unconfirmed': return PAGES.checkEmail;
      case 'needs_profile': return PAGES.onboarding;
      default: return PAGES.portal;
    }
  }

  async function signOut() {
    try { await sb().auth.signOut(); } catch (_) { /* still leave */ }
    try { sessionStorage.removeItem('kamsa.pendingEmail'); } catch (_) {}
    go(PAGES.login);
  }

  // ---------------------------------------------------------------------------
  // Errors → plain language
  // ---------------------------------------------------------------------------
  function friendlyError(err, fallback) {
    if (!err) return fallback || 'Something went wrong. Please try again.';
    const code = err.code || err.error_code || '';
    const msg = String(err.message || '');
    const min = CONFIG.minPasswordLength || 10;

    if (err.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(msg)) {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    switch (code) {
      case 'invalid_credentials':
        return "That email and password don't match our records. Try again, or reset your password.";
      case 'email_not_confirmed':
        return 'Please confirm your email address before logging in.';
      case 'user_already_exists':
      case 'email_exists':
        return 'An account with this email already exists. Log in, or reset your password if you forgot it.';
      case 'weak_password':
        if (err.reasons && err.reasons.includes('pwned')) {
          return 'That password has appeared in a known data breach. Please choose a different one.';
        }
        return `Please choose a stronger password (at least ${min} characters, mixing letters, numbers, and symbols).`;
      case 'same_password':
        return 'Your new password must be different from your current one.';
      case 'over_email_send_rate_limit':
        return 'Too many emails have been sent to this address. Please wait a few minutes and try again.';
      case 'over_request_rate_limit':
        return 'Too many attempts. Please wait a minute and try again.';
      case 'otp_expired':
        return 'This link has expired or has already been used.';
      case 'captcha_failed':
        return 'Please complete the verification check and try again.';
      case 'signup_disabled':
        return 'New sign-ups are temporarily closed. Please email us for help.';
      case 'email_address_invalid':
        return 'That email address cannot be used. Please try a different one.';
      case 'session_not_found':
      case 'refresh_token_not_found':
        return 'Your session has ended. Please log in again.';
      // Messages raised on purpose by our SQL functions are already user-friendly.
      case '22023':
      case '42501':
      case 'P0002':
      case '28000':
        return msg;
      default:
        return fallback || msg || 'Something went wrong. Please try again.';
    }
  }

  // ---------------------------------------------------------------------------
  // Small UI helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // showMessage(box, text, 'error'|'success'|'', [{ label, onClick }])
  function showMessage(box, text, type = '', actions = []) {
    if (!box) return;
    box.replaceChildren();
    if (!text) { box.hidden = true; return; }
    box.className = 'message' + (type ? ' ' + type : '');
    box.setAttribute('role', type === 'error' ? 'alert' : 'status');
    box.append(document.createTextNode(text));
    actions.forEach((a) => {
      box.append(' ');
      box.append(el('button', { type: 'button', class: 'btn-link', onclick: a.onClick }, a.label));
    });
    box.hidden = false;
    if (type === 'error' && typeof box.scrollIntoView === 'function') {
      const r = box.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.dataset.label || button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLabel || 'Working…');
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  }

  // Disable a button for `seconds`, showing a countdown (used for "Resend email").
  function cooldown(button, seconds, label) {
    if (!button) return;
    const original = label || button.dataset.label || button.textContent;
    button.dataset.label = original;
    let left = seconds;
    button.disabled = true;
    button.textContent = `${original} (${left}s)`;
    const t = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(t);
        button.disabled = false;
        button.textContent = original;
      } else {
        button.textContent = `${original} (${left}s)`;
      }
    }, 1000);
  }

  function bindPasswordToggles(root = document) {
    $$('[data-pw-toggle]', root).forEach((btn) => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      if (!input) return;
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', String(show));
      });
    });
  }

  // 0–4 rough strength score. The server enforces the real minimum.
  function passwordScore(pw) {
    if (!pw) return 0;
    const min = CONFIG.minPasswordLength || 10;
    let s = 0;
    if (pw.length >= min) s++;
    if (pw.length >= min + 4) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    if (pw.length < min) s = Math.min(s, 1);
    return Math.max(1, s);
  }

  function passwordProblem(pw) {
    const min = CONFIG.minPasswordLength || 10;
    if (pw.length < min) return `Use at least ${min} characters.`;
    if (pw.length > 72) return 'Use 72 characters or fewer.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number.';
    return '';
  }

  let idSeq = 0;
  function markInvalid(input, message) {
    if (!input) return;
    // Radio/checkbox groups get one message at the end of their fieldset.
    const group = (input.type === 'radio' || input.type === 'checkbox') ? input.closest('fieldset') : null;
    const target = group || input;
    if (!target.id) target.id = 'kamsa-field-' + (++idSeq);
    const id = target.id + '-error';
    let note = document.getElementById(id);
    if (!note) {
      note = el('p', { id, class: 'field-error' });
      if (group) group.append(note);
      else (input.closest('.pw-wrap') || input).after(note);
    }
    note.textContent = message;
    target.setAttribute('aria-invalid', 'true');
    const described = (target.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    if (!described.includes(id)) target.setAttribute('aria-describedby', described.concat(id).join(' '));
  }

  function clearInvalid(root = document) {
    $$('[aria-invalid="true"]', root).forEach((i) => i.removeAttribute('aria-invalid'));
    $$('.field-error', root).forEach((n) => n.remove());
  }

  function normalizeEmail(v) {
    return String(v || '').trim().toLowerCase();
  }

  function isEmail(v) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  }

  // Accepts "linkedin.com/in/name" or full URLs; returns https URL, '' for blank, or throws.
  function normalizeLinkedIn(raw) {
    let v = String(raw || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    let u;
    try { u = new URL(v); } catch (_) { throw new Error('Please enter a valid LinkedIn link.'); }
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) throw new Error('Please enter a linkedin.com link.');
    u.protocol = 'https:';
    u.search = '';
    u.hash = '';
    const out = u.href.replace(/\/$/, '');
    if (!/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/[A-Za-z0-9_/%.~-]{1,200}$/i.test(out)) {
      throw new Error('Please paste your LinkedIn profile link, e.g. linkedin.com/in/your-name.');
    }
    return out;
  }

  // Only ever render http(s) links that came from the database.
  function safeHttpsUrl(v) {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' ? u.href : null;
    } catch (_) {
      return null;
    }
  }

  function initials(first, last) {
    return ((first || '').trim().charAt(0) + (last || '').trim().charAt(0)).toUpperCase() || 'K';
  }

  // Resize to max 512px and re-encode as JPEG. This also strips EXIF metadata
  // (phone photos can carry GPS location).
  async function prepareAvatar(file) {
    if (!file) return null;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Please choose a JPG, PNG, or WebP image.');
    }
    if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large. Please choose one under 15 MB.');
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error("We couldn't read that image. Please try another one.");
    });
    const max = 512;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) throw new Error("We couldn't process that image. Please try another one.");
    return blob;
  }

  async function uploadAvatar(userId, blob) {
    const path = `${userId}/avatar-${Date.now()}.jpg`;
    const { error } = await sb().storage.from(AVATAR_BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new Error('Your photo could not be uploaded. Please try again or skip it for now.');
    return path;
  }

  async function removeAvatar(path) {
    if (!path) return;
    await sb().storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
  }

  async function signedAvatarUrls(paths) {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (!unique.length) return {};
    const { data, error } = await sb().storage.from(AVATAR_BUCKET).createSignedUrls(unique, 3600);
    if (error || !data) return {};
    const map = {};
    data.forEach((d) => { if (d.signedUrl && !d.error) map[d.path] = d.signedUrl; });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Optional Cloudflare Turnstile (only active when a site key is configured)
  // ---------------------------------------------------------------------------
  const captcha = {
    enabled: Boolean(CONFIG.turnstileSiteKey),
    _ready: null,
    _widgets: new Map(),
    load() {
      if (!this.enabled) return Promise.resolve();
      if (this._ready) return this._ready;
      this._ready = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Verification check failed to load.'));
        document.head.append(s);
      });
      return this._ready;
    },
    async mount(container) {
      if (!this.enabled || !container) return;
      await this.load();
      const id = window.turnstile.render(container, { sitekey: CONFIG.turnstileSiteKey, theme: 'light' });
      this._widgets.set(container, id);
    },
    token(container) {
      if (!this.enabled) return undefined;
      const id = this._widgets.get(container);
      return id != null ? window.turnstile.getResponse(id) || undefined : undefined;
    },
    reset(container) {
      if (!this.enabled) return;
      const id = this._widgets.get(container);
      if (id != null) window.turnstile.reset(id);
    },
  };

  window.KAMSA = {
    CONFIG, STATUSES, CHAPTERS, SPECIALTIES, MAX_SPECIALTIES, PAGES,
    sb, pageUrl, go, getState, pageForStage, signOut,
    friendlyError, showMessage, setBusy, cooldown, bindPasswordToggles,
    passwordScore, passwordProblem, markInvalid, clearInvalid,
    normalizeEmail, isEmail, normalizeLinkedIn, safeHttpsUrl, initials,
    prepareAvatar, uploadAvatar, removeAvatar, signedAvatarUrls,
    captcha, $, $$, el,
  };
})();
