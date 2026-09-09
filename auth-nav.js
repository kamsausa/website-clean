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

  function makeLink(text, href, emphasis) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.dataset.kamsaAuthNav = text.toLowerCase().replace(/\s+/g, '-');
    a.style.cssText = [
      'font-size:12.5px',
      'font-weight:700',
      'letter-spacing:.09em',
      'text-transform:uppercase',
      'white-space:nowrap',
      'text-decoration:none',
      emphasis ? 'color:#c8102e' : 'color:#26405f'
    ].join(';');
    return a;
  }

  function makeLogout() {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Log out';
    button.dataset.kamsaAuthNav = 'logout';
    button.style.cssText = [
      'border:0',
      'background:transparent',
      'padding:0',
      'font:inherit',
      'font-size:12.5px',
      'font-weight:700',
      'letter-spacing:.09em',
      'text-transform:uppercase',
      'white-space:nowrap',
      'color:#26405f',
      'cursor:pointer'
    ].join(';');
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

  async function renderNav() {
    try {
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError) {
        console.error('KAMSA auth lookup failed:', authError);
        return;
      }

      const nav = findNav();
      if (!nav) return;

      nav.querySelectorAll('[data-kamsa-auth-nav]').forEach(el => el.remove());

      if (!user) {
        nav.appendChild(makeLink('Member Login', LOGIN_HREF, true));
        return;
      }

      nav.appendChild(makeLink('Member Portal', PORTAL_HREF, false));

      const { data: isAdmin, error: adminError } = await supabaseClient.rpc('is_admin');
      if (!adminError && isAdmin === true) {
        nav.appendChild(makeLink('Admin', ADMIN_HREF, true));
      }

      nav.appendChild(makeLogout());
    } catch (error) {
      console.error('KAMSA auth navigation error:', error);
    }
  }

  function start() {
    renderNav();
    const observer = new MutationObserver(function () {
      const nav = findNav();
      if (nav && !nav.querySelector('[data-kamsa-auth-nav]')) {
        renderNav();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    supabaseClient.auth.onAuthStateChange(function () {
      window.setTimeout(renderNav, 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
