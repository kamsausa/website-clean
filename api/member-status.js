// Vercel Function: POST /api/member-status
// Called by a Supabase Database Webhook whenever a row in public.members is updated.
//   • profile just completed  → emails the board that a new member is ready to review
//   • status just became active → emails the member (Brevo template) + adds them to the Brevo members list
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   WEBHOOK_SECRET          long random string; the same value goes in the Supabase webhook header
//   BREVO_API_KEY           Brevo → Settings → SMTP & API → API Keys (NOT the SMTP key)
//   BREVO_SENDER_EMAIL      verified Brevo sender, e.g. no-reply@kamsaus.org
//   BREVO_TEMPLATE_APPROVED numeric ID of the "Membership approved" template in Brevo
//   BREVO_LIST_MEMBERS      numeric ID of the "KAMSA Members" contact list in Brevo
//   BOARD_NOTIFY_EMAIL      where new-application alerts go, e.g. kamsa.usa@gmail.com
//   SITE_URL                https://kamsaus.org
import crypto from 'node:crypto';

const BREVO = 'https://api.brevo.com/v3';

function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function brevo(path, body) {
  const res = await fetch(BREVO + path, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo ${path} failed (${res.status}): ${await res.text()}`);
}

const clean = (v, max = 120) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!sameSecret(req.headers['x-webhook-secret'], process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { type, table, record, old_record: old } = body;
  if (table !== 'members' || type !== 'UPDATE' || !record) return res.status(200).json({ skipped: true });

  const first = clean(record.first_name, 80);
  const last = clean(record.last_name, 80);
  const email = clean(record.personal_email, 254);
  const site = process.env.SITE_URL || 'https://kamsaus.org';
  const sender = { email: process.env.BREVO_SENDER_EMAIL, name: 'KAMSA' };
  const tasks = [];

  // 1. A new profile is ready for board review.
  if (!old?.profile_completed_at && record.profile_completed_at && process.env.BOARD_NOTIFY_EMAIL) {
    tasks.push(brevo('/smtp/email', {
      sender,
      to: [{ email: process.env.BOARD_NOTIFY_EMAIL }],
      subject: `New KAMSA member to review: ${first} ${last}`.trim(),
      textContent: [
        `${first} ${last} finished their profile and is waiting for approval.`,
        '',
        `School: ${clean(record.school_institution, 160)}`,
        `Graduation year: ${clean(record.graduation_year, 4)}`,
        `Status: ${clean(record.current_status, 40)}`,
        `Chapter: ${clean(record.regional_chapter, 40) || 'none'}`,
        `Email: ${email}`,
        '',
        `Review it in the admin page: ${site}/admin.html`,
      ].join('\n'),
    }));
  }

  // 2. The board approved the member.
  if (old?.membership_status !== 'active' && record.membership_status === 'active' && email) {
    tasks.push(brevo('/smtp/email', {
      sender,
      to: [{ email, name: `${first} ${last}`.trim() || undefined }],
      templateId: Number(process.env.BREVO_TEMPLATE_APPROVED),
      params: { FIRSTNAME: first || 'there', PORTAL_URL: `${site}/portal.html` },
    }));
    if (process.env.BREVO_LIST_MEMBERS) {
      tasks.push(brevo('/contacts', {
        email,
        attributes: { FIRSTNAME: first, LASTNAME: last },
        listIds: [Number(process.env.BREVO_LIST_MEMBERS)],
        updateEnabled: true,
      }));
    }
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (failed.length) {
    console.error('member-status:', failed);
    return res.status(502).json({ ok: false, failed });
  }
  return res.status(200).json({ ok: true, sent: tasks.length });
}
