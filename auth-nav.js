(function () {
  const SUPABASE_READY_TIMEOUT = 10000;

  function addLink(nav, { href, label, primary = false, id }) {
    if (id && document.getElementById(id)) return;
    const a = document.createElement('a');
    if (id) a.id = id;
    a.href = href;
    a.textContent = label;
    a.setAttribute('data-auth-nav', 'true');
    a.style.cssText = primary
      ? 'display:inline-flex;align-items:center;padding:11px 18px;border-radius:999px;background:#c8102e;color:#fff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;box-shadow:0 8px 22px -8px rgba(200,16,46,.55);'
      : 'font-size:12.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;color:#26405f;';
    nav.appendChild(a);
  }

  function addButton(nav, { label, id, danger = false }) {
    if (id && document.getElementById(id)) return;
    const button = document.createElement('button');
    if (id) button.id = id;
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('data-auth-nav', 'true');
    button.style.cssText = danger
      ? 'border:0;background:transparent;color:#7a1022;font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;padding:0;'
      : 'border:0;background:transparent;color:#26405f;font-size:12.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;cursor:pointer;padding:0;';
    nav.appendChild(button);
    return button;
  }

  function findPrimaryNav() {
    return document.querySelector('nav[aria-label="Primary"]');
  }

  async function waitForSupabase() {
    const start = Date.now();
    while (Date.now() - start < SUPABASE_READY_TIMEOUT) {
      if (window.supabaseClient && window.supabaseClient.auth) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  async function initAuthNav() {
    const ready = await waitForSupabase();
    if (!ready) return;

    const nav = findPrimaryNav();
    if (!nav) return;

    // Avoid duplicate initialization when a dynamic page rerenders.
    if (nav.dataset.authNavReady === 'true') return;
    nav.dataset.authNavReady = 'true';

    const existingSignUp = Array.from(nav.querySelectorAll('a')).find((a) =>
      /sign up|join us/i.test(a.textContent || '')
    );

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    let isAdmin = false;

    if (user) {
      try {
        const { data } = await window.supabaseClient.rpc('is_admin');
        isAdmin = data === true;
      } catch (error) {
        console.warn('KAMSA auth navigation admin check failed:', error);
      }
    }

    const path = (window.location.pathname || '').toLowerCase();
    const isSignup = path.endsWith('/signup.html') || path.endsWith('signup.html');
    const isPortal = path.endsWith('/portal.html') || path.endsWith('portal.html');
    const isAdminPage = path.endsWith('/admin.html') || path.endsWith('admin.html');
    const isHome = path === '/' || path.endsWith('/index.html') || path === '';

    // Remove previous dynamically-added controls before rebuilding.
    nav.querySelectorAll('[data-auth-nav="true"]').forEach((el) => el.remove());

    if (user) {
      // On the public site, replace the old sign-up CTA with authenticated destinations.
      if (isHome && existingSignUp) {
        existingSignUp.textContent = 'Member Portal';
        existingSignUp.href = 'portal.html';
      }

      if (!isPortal && !isSignup) {
        addLink(nav, { href: 'portal.html', label: 'Member Portal', id: 'auth-nav-portal' });
      }

      if (isAdmin && !isAdminPage) {
        addLink(nav, { href: 'admin.html', label: 'Admin', primary: false, id: 'auth-nav-admin' });
      }

      if (!isAdminPage) {
        const button = addButton(nav, { label: 'Log out', id: 'auth-nav-logout' });
        button.addEventListener('click', async function () {
          button.disabled = true;
          button.textContent = 'Logging out...';
          await window.supabaseClient.auth.signOut();
          window.location.href = isHome ? './index.html' : './signup.html?mode=login';
        });
      }
    } else {
      if (!isSignup && !isPortal && !isAdminPage) {
        addLink(nav, { href: 'signup.html?mode=login', label: 'Member Login', id: 'auth-nav-login' });
      }

      if (isPortal) {
        // Portal page will redirect unauthenticated visitors, but keep a friendly fallback.
        addLink(nav, { href: 'signup.html?mode=login', label: 'Member Login', id: 'auth-nav-login' });
      }
    }
  }

  function start() {
    // Generated pages may render their header asynchronously, so retry a few times.
    let attempts = 0;
    const timer = setInterval(async function () {
      attempts += 1;
      if (document.querySelector('nav[aria-label="Primary"]')) {
        clearInterval(timer);
        await initAuthNav();
      } else if (attempts >= 100) {
        clearInterval(timer);
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
