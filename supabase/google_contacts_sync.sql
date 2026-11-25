-- Keep the "Active KAMSA Members" label in the kamsa.usa@gmail.com Google Contacts in step
-- with active membership. The Google side is google-apps-script/KamsaContactsSync.gs.
--
-- The web app URL and shared secret live in Supabase Vault (never in this repo):
--   select vault.create_secret('<web app /exec URL>', 'google_contacts_url');
--   select vault.create_secret('<shared secret>',     'google_contacts_secret');
-- Until both exist, everything here quietly does nothing.

create or replace function public.kamsa_google_contacts_post(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'google_contacts_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'google_contacts_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := p_payload || jsonb_build_object('secret', v_secret),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

create or replace function public.kamsa_contact_payload(m public.members)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'email', m.personal_email, 'first_name', m.first_name, 'last_name', m.last_name,
    'school', m.school_institution, 'status', m.current_status, 'membership_id', m.membership_id)
$$;

-- Approved / renewed → add. Lapsed / deactivated / rejected → remove. Email changed → move.
create or replace function public.kamsa_members_google_contacts()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  was_active boolean := old.membership_status = 'active' and old.profile_completed_at is not null;
  is_active  boolean := new.membership_status = 'active' and new.profile_completed_at is not null;
begin
  if is_active and not was_active then
    perform public.kamsa_google_contacts_post(jsonb_build_object('action', 'add', 'member', public.kamsa_contact_payload(new)));
  elsif was_active and not is_active then
    perform public.kamsa_google_contacts_post(jsonb_build_object('action', 'remove', 'email', old.personal_email));
  elsif is_active and new.personal_email is distinct from old.personal_email then
    perform public.kamsa_google_contacts_post(jsonb_build_object('action', 'remove', 'email', old.personal_email));
    perform public.kamsa_google_contacts_post(jsonb_build_object('action', 'add', 'member', public.kamsa_contact_payload(new)));
  end if;
  return new;
exception when others then
  return new;   -- a contacts problem must never block a membership change
end $$;

drop trigger if exists members_google_contacts on public.members;
create trigger members_google_contacts
  after update of membership_status, personal_email, profile_completed_at on public.members
  for each row execute function public.kamsa_members_google_contacts();

-- Full sync: the label ends up matching the active member list exactly.
create or replace function public.kamsa_sync_google_contacts()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.kamsa_google_contacts_post(jsonb_build_object(
    'action', 'sync',
    'members', coalesce((
      select jsonb_agg(public.kamsa_contact_payload(m) order by m.created_at)
        from public.members m
       where m.membership_status = 'active' and m.profile_completed_at is not null
         and m.personal_email is not null), '[]'::jsonb)));
end $$;

revoke all on function public.kamsa_google_contacts_post(jsonb) from public, anon, authenticated;
revoke all on function public.kamsa_contact_payload(public.members) from public, anon, authenticated;
revoke all on function public.kamsa_members_google_contacts() from public, anon, authenticated;
revoke all on function public.kamsa_sync_google_contacts() from public, anon, authenticated;

-- Nightly safety net (2:41 a.m. Central).
select cron.schedule('kamsa-sync-google-contacts', '41 8 * * *', $job$ select public.kamsa_sync_google_contacts() $job$);
