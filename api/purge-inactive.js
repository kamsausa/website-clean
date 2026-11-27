// Vercel Cron: GET /api/purge-inactive  (schedule in vercel.json, runs daily)
// Deletes members whose membership has been inactive (lapsed) for 2 years, as promised
// in privacy.html §7:
//   • profile photos in the private "member-avatars" bucket (via the Storage API)
//   • their contact in Brevo (mailing list)
//   • their Supabase auth user → cascades to public.members
// Members the board set to inactive on purpose (no lapsed_at) are left for the board to handle.
// Google Contacts needs no step here: the daily sync only includes active members.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   CRON_SECRET                long random string; Vercel sends it as "Authorization: Bearer …"
//   SUPABASE_URL               https://rhrdfdxhdyxceofpsioc.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API Keys → service_role / secret key.
//                              Server-only. Never put it in any file in this repo.
//   BREVO_API_KEY              already set for /api/member-status
import crypto from 'node:crypto';

const RETENTION_DAYS = 730; // 2 years
const BUCKET = 'member-avatars';
const MAX_PER_RUN = 50;

function authorized(req) {
  const want = process.env.CRON_SECRET;
  const got = req.headers.authorization || '';
  if (!want) return false;
  const a = Buffer.from(got), b = Buffer.from(`Bearer ${want}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sbUrl = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const sbHeaders = (extra = {}) => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  ...extra,
});

async function sb(path, init = {}) {
  const res = await fetch(sbUrl() + path, { ...init, headers: sbHeaders(init.headers) });
  if (!res.ok) throw new Error(`Supabase ${init.method || 'GET'} ${path.split('?')[0]} failed (${res.status}): ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function deletePhotos(userId) {
  // Photos are stored under "<user_id>/…".
  const objects = await sb(`/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }),
  });
  const prefixes = (objects || []).filter((o) => o.name).map((o) => `${userId}/${o.name}`);
  if (prefixes.length) {
    await sb(`/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes }),
    });
  }
  return prefixes.length;
}

async function deleteBrevoContact(email) {
  if (!email || !process.env.BREVO_API_KEY) return;
  const res = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}?identifierType=email_id`, {
    method: 'DELETE',
    headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Brevo delete failed (${res.status}): ${await res.text()}`);
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set' });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  const due = await sb(
    `/rest/v1/members?select=user_id,personal_email,school_email`
    + `&membership_status=eq.inactive&lapsed_at=not.is.null&lapsed_at=lt.${encodeURIComponent(cutoff)}`
    + `&order=lapsed_at.asc&limit=${MAX_PER_RUN}`,
  );

  let deleted = 0;
  const failed = [];
  for (const m of due || []) {
    try {
      await deletePhotos(m.user_id);
      await deleteBrevoContact(m.personal_email);
      if (m.school_email && m.school_email !== m.personal_email) await deleteBrevoContact(m.school_email);
      // Deleting the auth user cascades to public.members.
      await sb(`/auth/v1/admin/users/${m.user_id}`, { method: 'DELETE' });
      deleted += 1;
    } catch (err) {
      failed.push({ user_id: m.user_id, error: String(err.message || err).slice(0, 300) });
    }
  }

  if (failed.length) console.error('purge-inactive failures', failed);
  return res.status(failed.length ? 502 : 200).json({ ok: !failed.length, checked: (due || []).length, deleted, failed: failed.length });
}
