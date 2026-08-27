// KAMSA Supabase browser configuration.
// Use your existing working values here.
// NEVER put the Supabase service-role/secret key in this file.

const SUPABASE_URL = "https://eylvmfzkowythuxludkx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7GySnJdVM1tGkOb7DaT9Wg_FfH6IHQy";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
