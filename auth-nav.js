// Adds account links (Member Login / Member Portal / Admin / Log out) to the
// main navigation on the public pages.
//
// Several things can ask for a redraw at nearly the same moment (page load, the
// sign-in state event, the page re-rendering its header). Each redraw builds its
// links first and then swaps them in one step, and only the newest redraw is
// allowed to finish, so links can never be added twice.
(function () {
  'use strict';

  const supabaseClient = window.supabaseClient;
  if (!supabaseClient) {
    console.error('KAMSA auth navigation: supabaseClient is not available.');
    return;
  }

  const ADMIN_HREF = './admin.html';
  const PORTAL_HREF = './portal.html';
  const LOGIN_HREF = './signup.html?mode=login';
  const HOME_HREF = './index.html';

  let latestRender = 0;
  let cached = null; // { signedIn, isAdmin }

  function baseStyle(color) {
    return [
      'font-size:12.5px', 'font-weight:700', 'letter-spacing:.09em', 'text-transform:uppercase',
      'white-space:nowrap', 'text-decoration:none', 'color:' + color,
    ].join(';');
  }

  function makeLink(text, href, emphasis) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.style.cssText = baseStyle(emphasis ? '#c8102e' : '#26405f');
    return a;
  }

  function makeLogout() {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Log out';
    button.style.cssText = baseStyle('#26405f') + ';border:0;background:transparent;padding:0;font-family:inherit;cursor:pointer';
    button.addEventListener('click', async function () {
      button.disabled = true;
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        console.error('KAMSA logout failed:', error);
        button.disabled = false;
        return;
      }
      window.location.href = HOME_HREF;
    });
    return button;
  }

  function findNav() {
    return document.querySelector('nav[aria-label="Primary"]');
  }

  // Put the account links into the nav as ONE group, replacing any earlier group.
  function place(state) {
    const nav = findNav();
    if (!nav) return;

    const group = document.createElement('span');
    group.dataset.kamsaAuthNav = 'group';
    group.style.cssText = 'display:inline-flex;align-items:center;gap:14px 18px;flex-wrap:wrap';

    if (!state.signedIn) {
      group.append(makeLink('Member Login', LOGIN_HREF, true));
    } else {
      group.append(makeLink('Member Portal', PORTAL_HREF, false));
      if (state.isAdmin) group.append(makeLink('Admin', ADMIN_HREF, true));
      group.append(makeLogout());
    }

    nav.querySelectorAll('[data-kamsa-auth-nav]').forEach((el) => el.remove());
    nav.appendChild(group);
  }

  async function renderNav() {
    const ticket = ++latestRender;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      let state = { signedIn: Boolean(session), isAdmin: false };
      if (session) {
        const { data: isAdmin, error } = await supabaseClient.rpc('is_admin');
        state.isAdmin = !error && isAdmin === true;
      }
      if (ticket !== latestRender) return; // a newer redraw started; let it win
      cached = state;
      place(state);
    } catch (error) {
      console.error('KAMSA auth navigation error:', error);
    }
  }

  function start() {
    renderNav();

    // If the page re-renders its header and drops our links, put the last known
    // links back right away (no network call, no duplicates).
    const observer = new MutationObserver(function () {
      const nav = findNav();
      if (cached && nav && !nav.querySelector('[data-kamsa-auth-nav]')) place(cached);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        window.setTimeout(renderNav, 0);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
