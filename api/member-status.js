// Vercel Function: POST /api/member-status
// Called by a Supabase Database Webhook whenever a row in public.members is updated.
//   • profile just completed  → emails the board that a new member is ready to review
//   • first approval            → emails the member (Brevo template) + adds them to the Brevo members list
//   • renewal reminders         → renewal_notice set by the daily renewal job (due_soon / due / lapsed)
//   • renewal completed         → renewed_at changed (self-renewal or board reactivation)
//   • list upkeep               → lapsed/deactivated members leave the Brevo members list; reactivated members rejoin
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

function equalBytes(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Node reads HTTP header values byte-for-byte as Latin-1. Supabase sends the secret as
// UTF-8, so a secret with a character like "£" arrives garbled unless we turn the header
// back into its original bytes before comparing.
function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const want = Buffer.from(String(expected), 'utf8');
  return equalBytes(Buffer.from(String(given), 'latin1'), want)
      || equalBytes(Buffer.from(String(given), 'utf8'), want);
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

// Removing someone who is already off the list (or not in Brevo) returns 400; that's fine.
async function brevoRemoveFromList(listId, email) {
  const res = await fetch(`${BREVO}/contacts/lists/${listId}/contacts/remove`, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ emails: [email] }),
  });
  if (res.ok || res.status === 400 || res.status === 404) return;
  throw new Error(`Brevo list remove failed (${res.status}): ${await res.text()}`);
}

const clean = (v, max = 120) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const longDate = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

// Simple branded email body for renewal messages.
function renewalEmail({ first, heading, paragraphs, button, url }) {
  const ps = paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#26405f">${esc(p)}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:36px 32px">
<tr><td>
<p style="margin:0 0 22px;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#c8102e">KAMSA Membership</p>
<h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;color:#0b2545">${esc(heading)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#26405f">Hi ${esc(first || 'there')},</p>
${ps}
${button ? `<p style="margin:26px 0 8px"><a href="${esc(url)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#c8102e;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">${esc(button)}</a></p>` : ''}
<p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#5c7291">Questions? Reply to kamsa.usa@gmail.com.<br>Korean American Medical Student Association</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [`Hi ${first || 'there'},`, '', ...paragraphs, '', button ? `${button}: ${url}` : '', '', 'KAMSA — kamsa.usa@gmail.com'].join('\n');
  return { htmlContent: html, textContent: text };
}

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
        `Membership ID: ${clean(record.membership_id, 40)}`,
        '',
        `Review it in the admin page: ${site}/admin.html`,
      ].join('\n'),
    }));
  }

  // 2. The board approved the member for the first time.
  if (old?.membership_status !== 'active' && record.membership_status === 'active' && !old?.approved_at && email) {
    tasks.push(brevo('/smtp/email', {
      sender,
      to: [{ email, name: `${first} ${last}`.trim() || undefined }],
      templateId: Number(process.env.BREVO_TEMPLATE_APPROVED),
      params: { FIRSTNAME: first || 'there', PORTAL_URL: `${site}/portal.html`, MEMBERSHIP_ID: clean(record.membership_id, 40) },
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

  // 3. Yearly renewal reminders (set by the daily renewal job).
  const base = record.renewed_at || record.approved_at;
  const due = base ? new Date(new Date(base).getTime() + 365 * DAY) : null;
  const renewUrl = `${site}/portal.html?renew=1`;
  const notice = record.renewal_notice;
  if (notice && notice !== old?.renewal_notice && email && due) {
    const graceEnds = new Date(due.getTime() + 30 * DAY);
    const copy = {
      due_soon: {
        subject: 'Time to renew your KAMSA membership',
        heading: 'Time to renew your membership',
        paragraphs: [
          `Your KAMSA membership renews on ${longDate(due)}. Renewing is free and takes about a minute.`,
          "When you renew, you'll confirm your profile and update anything that has changed: your status (for example, pre-med to medical student), school, graduation year, specialty interests, or LinkedIn.",
        ],
        button: 'Renew my membership',
      },
      due: {
        subject: 'Your KAMSA membership is due for renewal',
        heading: 'Your membership is due for renewal',
        paragraphs: [
          `Your KAMSA membership was due for renewal on ${longDate(due)}. Renew by ${longDate(graceEnds)} to keep access to the member directory, resources, and partner perks.`,
          'It only takes a minute: confirm your details, update anything that has changed, and you are set for another year.',
        ],
        button: 'Renew now',
      },
      lapsed: {
        subject: 'Your KAMSA membership has lapsed',
        heading: 'Your membership has lapsed',
        paragraphs: [
          "We didn't receive your renewal, so your KAMSA membership is now inactive and the member directory, resources, and partner perks are paused.",
          'You can renew at any time. Your membership is active again as soon as you do, with the same membership ID.',
        ],
        button: 'Renew my membership',
      },
    }[notice];
    if (copy) {
      tasks.push(brevo('/smtp/email', {
        sender,
        to: [{ email, name: `${first} ${last}`.trim() || undefined }],
        subject: copy.subject,
        ...renewalEmail({ first, heading: copy.heading, paragraphs: copy.paragraphs, button: copy.button, url: renewUrl }),
      }));
    }
  }

  // 4. Renewal completed (the member renewed, or the board reactivated them).
  if (record.renewed_at && record.renewed_at !== old?.renewed_at && record.membership_status === 'active' && email && due) {
    tasks.push(brevo('/smtp/email', {
      sender,
      to: [{ email, name: `${first} ${last}`.trim() || undefined }],
      subject: 'Your KAMSA membership is renewed',
      ...renewalEmail({
        first,
        heading: 'Thanks for renewing!',
        paragraphs: [
          `Your KAMSA membership is active through ${longDate(due)}. Your membership ID is ${clean(record.membership_id, 40)}.`,
          "We'll send you a reminder when it's time to renew again.",
        ],
        button: 'Go to the member portal',
        url: `${site}/portal.html`,
      }),
    }));
  }

  // 5. Keep the Brevo members list to active members only.
  //    Leaving active (lapsed, or set inactive by the board) → remove from the list.
  //    Coming back (renewal or board reactivation, not first approval) → add back.
  //    Re-adding never overrides an unsubscribe: Brevo keeps unsubscribed contacts blocked.
  const listId = Number(process.env.BREVO_LIST_MEMBERS);
  if (listId && email && old) {
    if (old.membership_status === 'active' && record.membership_status !== 'active') {
      tasks.push(brevoRemoveFromList(listId, email));
    } else if (old.membership_status !== 'active' && record.membership_status === 'active' && old.approved_at) {
      tasks.push(brevo('/contacts', {
        email,
        attributes: { FIRSTNAME: first, LASTNAME: last },
        listIds: [listId],
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
