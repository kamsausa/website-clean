/**
 * KAMSA → Google Contacts sync
 *
 * Runs inside the kamsa.usa@gmail.com Google account. The KAMSA membership database
 * calls this web app to keep the "Active KAMSA Members" contact label up to date:
 *   - a member is approved or renews   → added to the label (contact created if needed)
 *   - a member lapses or is deactivated → removed from the label (the contact itself is kept)
 *   - once a night, a full sync         → the label matches the active member list exactly
 *
 * Setup (one time, signed in as kamsa.usa@gmail.com):
 *   1. script.google.com → New project → paste this file → name it "KAMSA Contacts Sync".
 *   2. Left sidebar → Services (+) → "People API" → Add.
 *   3. Run the `setup` function once and approve the permissions it asks for.
 *   4. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *   5. Copy the Web app URL (ends in /exec) and send it to whoever manages the website.
 */

const SECRET = 'PASTE_THE_SHARED_SECRET_HERE';
const LABEL = 'Active KAMSA Members';

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Run once from the editor: grants permissions and creates the label. */
function setup() {
  const group = groupResourceName_();
  Logger.log('Ready. Label "%s" is %s', LABEL, group);
}

/** Health check (no data). */
function doGet() {
  return json_({ ok: true, service: 'KAMSA Contacts Sync' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  if (!req || typeof req.secret !== 'string' || req.secret !== SECRET) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const group = groupResourceName_();
    if (req.action === 'add') return json_(addMembers_(group, [req.member]));
    if (req.action === 'remove') return json_(removeEmails_(group, [req.email]));
    if (req.action === 'sync') return json_(sync_(group, req.members || []));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Add members to the label, creating contacts for people not in Contacts yet. */
function addMembers_(group, members) {
  members = (members || []).filter((m) => m && validEmail_(m.email));
  const index = contactIndex_();
  const toLabel = [];
  const toCreate = [];
  const seen = {};
  members.forEach((m) => {
    const email = m.email.trim().toLowerCase();
    if (seen[email]) return;
    seen[email] = true;
    const existing = index[email];
    if (existing) {
      if (existing.groups.indexOf(group) === -1) toLabel.push(existing.resourceName);
    } else {
      toCreate.push(m);
    }
  });

  // Create new contacts, already in the label (up to 200 per call).
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 200) {
    const batch = toCreate.slice(i, i + 200).map((m) => ({ contactPerson: personFor_(m, group) }));
    People.People.batchCreateContacts({ contacts: batch, readMask: 'emailAddresses' });
    created += batch.length;
  }
  // Label existing contacts (up to 1000 per call).
  for (let i = 0; i < toLabel.length; i += 1000) {
    People.ContactGroups.Members.modify({ resourceNamesToAdd: toLabel.slice(i, i + 1000) }, group);
  }
  return { ok: true, created: created, labeled: toLabel.length };
}

/** Take people off the label. Their contact stays in Google Contacts. */
function removeEmails_(group, emails) {
  const wanted = {};
  (emails || []).forEach((e) => { if (validEmail_(e)) wanted[e.trim().toLowerCase()] = true; });
  const index = contactIndex_();
  const names = [];
  Object.keys(wanted).forEach((email) => {
    const c = index[email];
    if (c && c.groups.indexOf(group) !== -1) names.push(c.resourceName);
  });
  for (let i = 0; i < names.length; i += 1000) {
    People.ContactGroups.Members.modify({ resourceNamesToRemove: names.slice(i, i + 1000) }, group);
  }
  return { ok: true, removed: names.length };
}

/** Make the label match the given list of active members exactly. */
function sync_(group, members) {
  const active = {};
  members.forEach((m) => { if (m && validEmail_(m.email)) active[m.email.trim().toLowerCase()] = true; });
  const added = addMembers_(group, members);

  // Anyone in the label whose emails are all off the active list comes off the label.
  const index = contactIndex_();
  const stale = {};
  Object.keys(index).forEach((email) => {
    const c = index[email];
    if (c.groups.indexOf(group) === -1) return;
    const stillActive = c.emails.some((e) => active[e]);
    if (!stillActive) stale[c.resourceName] = true;
  });
  const names = Object.keys(stale);
  for (let i = 0; i < names.length; i += 1000) {
    People.ContactGroups.Members.modify({ resourceNamesToRemove: names.slice(i, i + 1000) }, group);
  }
  return { ok: true, created: added.created, labeled: added.labeled, removed: names.length, active: Object.keys(active).length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function personFor_(m, group) {
  const person = {
    names: [{ givenName: clean_(m.first_name, 80), familyName: clean_(m.last_name, 80) }],
    emailAddresses: [{ value: m.email.trim(), type: 'other' }],
    memberships: [{ contactGroupMembership: { contactGroupResourceName: group } }],
  };
  const school = clean_(m.school, 160);
  const status = clean_(m.status, 60);
  if (school || status) person.organizations = [{ name: school || undefined, title: status || undefined }];
  if (m.membership_id) person.userDefined = [{ key: 'KAMSA membership ID', value: clean_(m.membership_id, 20) }];
  return person;
}

/** email (lowercase) → { resourceName, emails, groups } for every contact in the account. */
function contactIndex_() {
  const index = {};
  let pageToken;
  do {
    const page = People.People.Connections.list('people/me', {
      personFields: 'emailAddresses,memberships',
      pageSize: 1000,
      pageToken: pageToken,
    });
    (page.connections || []).forEach((p) => {
      const emails = (p.emailAddresses || []).map((e) => String(e.value || '').trim().toLowerCase()).filter(Boolean);
      const groups = (p.memberships || [])
        .map((x) => x.contactGroupMembership && x.contactGroupMembership.contactGroupResourceName)
        .filter(Boolean);
      const entry = { resourceName: p.resourceName, emails: emails, groups: groups };
      emails.forEach((e) => { if (!index[e]) index[e] = entry; });
    });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return index;
}

/** Resource name of the "Active KAMSA Members" label, creating it the first time. */
function groupResourceName_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('GROUP');
  if (cached) {
    try {
      People.ContactGroups.get(cached);
      return cached;
    } catch (err) {
      props.deleteProperty('GROUP'); // label was deleted or renamed away; find or recreate it
    }
  }
  let pageToken;
  do {
    const page = People.ContactGroups.list({ pageSize: 1000, pageToken: pageToken });
    const found = (page.contactGroups || []).find((g) => g.groupType === 'USER_CONTACT_GROUP' && (g.name === LABEL || g.formattedName === LABEL));
    if (found) {
      props.setProperty('GROUP', found.resourceName);
      return found.resourceName;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  const created = People.ContactGroups.create({ contactGroup: { name: LABEL } });
  props.setProperty('GROUP', created.resourceName);
  return created.resourceName;
}

function validEmail_(e) {
  return typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
