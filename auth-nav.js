// Compact account menu in the top-right of the main navigation.
//   Signed out: [person icon] Sign in ▾  →  Log in · Become a member
//   Signed in:  [person icon] <First name> ▾  →  Member portal · Admin (admins) · Log out
// When someone is signed in, the big "Join us" button is hidden.
//
// Several things can ask for a redraw at nearly the same moment (page load, the
// sign-in event, the page re-rendering its header). Each redraw builds the menu
// first and swaps it in one step, and only the newest redraw finishes, so the
// menu can never appear twice.
(function () {
  'use strict';

  const supabaseClient = window.supabaseClient;
  if (!supabaseClient) {
    console.error('KAMSA account menu: supabaseClient is not available.');
    return;
  }

  const LINKS = {
    login: './signup.html?mode=login',
    signup: './signup.html',
    portal: './portal.html',
    admin: './admin.html',
    home: './index.html',
  };

  let latestRender = 0;
  let cached = null; // { signedIn, isAdmin, firstName }

  // ---------------------------------------------------------------------------
  // Styles (injected once; the public pages don't load the account stylesheet)
  // ---------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('kamsa-acct-style')) return;
    const style = document.createElement('style');
    style.id = 'kamsa-acct-style';
    style.textContent = `
      .kamsa-acct { position: relative; display: inline-flex; font-family: inherit; }
      .kamsa-acct-btn {
        display: inline-flex; align-items: center; gap: 8px; padding: 7px 10px 7px 7px;
        border: 0; border-radius: 999px; background: transparent; cursor: pointer;
        font: inherit; font-size: 14px; font-weight: 600; letter-spacing: 0; text-transform: none;
        color: #0b2545; white-space: nowrap;
      }
      .kamsa-acct-btn:hover, .kamsa-acct-btn[aria-expanded="true"] { background: rgba(11,37,69,.06); }
      .kamsa-acct-btn:focus-visible { outline: 2px solid #c8102e; outline-offset: 2px; }
      .kamsa-acct-btn svg { flex: 0 0 auto; }
      .kamsa-acct-name { max-width: 12ch; overflow: hidden; text-overflow: ellipsis; }
      .kamsa-acct-chev { transition: transform .15s ease; }
      .kamsa-acct-btn[aria-expanded="true"] .kamsa-acct-chev { transform: rotate(180deg); }
      .kamsa-acct-menu {
        position: fixed; z-index: 1000; min-width: 200px;
        padding: 6px; border-radius: 14px; background: #fff;
        box-shadow: 0 20px 44px -18px rgba(11,37,69,.45), 0 0 0 1px rgba(11,37,69,.08);
      }
      .kamsa-acct-menu[hidden] { display: none; }
      .kamsa-acct-menu a, .kamsa-acct-menu button {
        display: block; width: 100%; padding: 10px 12px; border: 0; border-radius: 9px; background: none;
        font: inherit; font-size: 14px; font-weight: 600; letter-spacing: 0; text-transform: none;
        text-align: left; color: #26405f; text-decoration: none; cursor: pointer;
      }
      .kamsa-acct-menu a:hover, .kamsa-acct-menu button:hover,
      .kamsa-acct-menu a:focus-visible, .kamsa-acct-menu button:focus-visible { background: rgba(200,16,46,.08); color: #c8102e; outline: none; }
      .kamsa-acct-menu .kamsa-acct-strong { color: #c8102e; }
      .kamsa-acct-menu hr { margin: 6px 4px; border: 0; border-top: 1px solid rgba(11,37,69,.1); }
      .kamsa-acct-menu .kamsa-acct-who { padding: 8px 12px 6px; font-size: 12px; color: #5c7291; }
    `;
    document.head.appendChild(style);
  }

  const ICON_USER = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#c8102e" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="10.2"/><circle cx="12" cy="9.6" r="3.4"/><path d="M5.6 18.7c1.4-2.4 3.7-3.7 6.4-3.7s5 1.3 6.4 3.7"/></svg>';
  const ICON_CHEVRON = '<svg class="kamsa-acct-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function menuLink(text, href, strong) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.setAttribute('role', 'menuitem');
    if (strong) a.className = 'kamsa-acct-strong';
    return a;
  }

  function buildMenu(state) {
    const wrap = document.createElement('div');
    wrap.className = 'kamsa-acct';
    wrap.dataset.kamsaAuthNav = 'menu';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kamsa-acct-btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'kamsa-acct-name';
    label.textContent = state.signedIn ? (state.firstName || 'My account') : 'Sign in';
    btn.innerHTML = ICON_USER; // static icon markup only
    btn.append(label);
    btn.insertAdjacentHTML('beforeend', ICON_CHEVRON);
    btn.setAttribute('aria-label', state.signedIn ? `Account menu for ${label.textContent}` : 'Sign in or join');

    const menu = document.createElement('div');
    menu.className = 'kamsa-acct-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    if (!state.signedIn) {
      menu.append(menuLink('Log in', LINKS.login, false), menuLink('Become a member', LINKS.signup, true));
    } else {
      menu.append(menuLink('Member portal', LINKS.portal, false));
      if (state.isAdmin) menu.append(menuLink('Admin', LINKS.admin, true));
      menu.append(document.createElement('hr'));
      const out = document.createElement('button');
      out.type = 'button';
      out.setAttribute('role', 'menuitem');
      out.textContent = 'Log out';
      out.addEventListener('click', async () => {
        out.disabled = true;
        const { error } = await supabaseClient.auth.signOut();
        if (error) { console.error('KAMSA logout failed:', error); out.disabled = false; return; }
        window.location.href = LINKS.home;
      });
      menu.append(out);
    }

    const items = () => Array.from(menu.querySelectorAll('[role="menuitem"]'));
    // The nav row can scroll sideways on phones, which would clip a normal
    // dropdown, so the menu is pinned to the window just under the button.
    function position() {
      const r = btn.getBoundingClientRect();
      menu.style.top = Math.round(r.bottom + 8) + 'px';
      menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    }
    function open(focusFirst) {
      position();
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) items()[0]?.focus();
    }
    function close(returnFocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (returnFocus) btn.focus();
    }
    btn.addEventListener('click', () => (menu.hidden ? open(false) : close(false)));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(true); return; }
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(true); }
    });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Tab') close(false);
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(false); });
    // Keep the menu attached to the button if the page or nav row scrolls.
    const follow = () => { if (!menu.hidden) position(); };
    window.addEventListener('scroll', follow, { passive: true, capture: true });
    window.addEventListener('resize', follow);

    wrap.append(btn, menu);
    return wrap;
  }

  function findNav() {
    return document.querySelector('nav[aria-label="Primary"]');
  }

  // Put the menu at the end of the nav (top-right), replacing any earlier one.
  function place(state) {
    const nav = findNav();
    if (!nav) return;
    injectStyles();
    nav.querySelectorAll('[data-kamsa-auth-nav]').forEach((el) => el.remove());
    nav.appendChild(buildMenu(state));
    // Members don't need the big "Join us" button.
    nav.querySelectorAll('a[href="signup.html"], a[href="./signup.html"]').forEach((a) => {
      a.style.display = state.signedIn ? 'none' : '';
    });
  }

  async function renderNav() {
    const ticket = ++latestRender;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const state = { signedIn: Boolean(session), isAdmin: false, firstName: '' };
      if (session) {
        const { data, error } = await supabaseClient.rpc('get_my_membership');
        if (!error && data) {
          state.isAdmin = data.is_admin === true;
          state.firstName = ((data.member && data.member.first_name) || '').trim();
        }
      }
      if (ticket !== latestRender) return; // a newer redraw started; let it win
      cached = state;
      place(state);
    } catch (error) {
      console.error('KAMSA account menu error:', error);
    }
  }

  function start() {
    renderNav();

    // If the page re-renders its header and drops the menu, put it back right away.
    const observer = new MutationObserver(() => {
      const nav = findNav();
      if (cached && nav && !nav.querySelector('[data-kamsa-auth-nav]')) place(cached);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        window.setTimeout(renderNav, 0);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
