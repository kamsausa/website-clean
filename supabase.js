// KAMSA Supabase client + site settings.
//
// 1. Paste your project URL and PUBLISHABLE (anon) key below
//    (Supabase Dashboard → Project Settings → API Keys).
// 2. NEVER put the service_role / secret key here. This file is public:
//    anyone can open it in their browser. The check below refuses to start
//    if a secret key is pasted by mistake.

window.KAMSA_CONFIG = Object.freeze({
  supabaseUrl: 'https://rhrdfdxhdyxceofpsioc.supabase.co',
  supabaseKey: 'sb_publishable_8wgo1Ty4Y9vwQy0tUAjYhQ_dijJSViM',

  // Optional bot protection. Create a Cloudflare Turnstile widget, paste its
  // SITE key here, and add the SECRET key under Supabase → Authentication →
  // Attack Protection → CAPTCHA. Leave '' to turn it off.
  turnstileSiteKey: '',

  // Keep in sync with Supabase → Authentication → Providers → Email →
  // "Minimum password length".
  minPasswordLength: 10,

  supportEmail: 'kamsa.usa@gmail.com',
});

(function () {
  const { supabaseUrl, supabaseKey } = window.KAMSA_CONFIG;

  function looksSecret(key) {
    if (/^sb_secret_/i.test(key)) return true;
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'service_role';
    } catch (_) {
      return false;
    }
  }

  if (looksSecret(supabaseKey)) {
    document.documentElement.innerHTML =
      '<p style="font:16px system-ui;padding:40px;color:#8f1125">Configuration error: a secret Supabase key was ' +
      'placed in supabase.js. Remove it, rotate it in the Supabase dashboard, and use the publishable/anon key.</p>';
    throw new Error('KAMSA: refusing to run with a service_role / secret key in the browser.');
  }

  window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
