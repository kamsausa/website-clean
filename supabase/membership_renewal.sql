-- Yearly membership renewal.
--
--   Renewal date  = 365 days after approval, or after the last renewal.
--   30 days before → renewal opens in the portal, reminder email ("due_soon").
--   On the date    → second reminder ("due"). Members keep access for a 30-day grace period.
--   30 days after  → membership lapses: status becomes inactive, "lapsed" email.
--   Lapsed members can renew themselves at any time and are active again immediately.
--   Members the board set to inactive on purpose (no lapsed_at) cannot self-renew.
--
-- Emails are sent by /api/member-status (the existing members webhook) when renewal_notice
-- or renewed_at changes.

alter table public.members
  add column if not exists renewed_at     timestamptz,
  add column if not exists lapsed_at      timestamptz,
  add column if not exists renewal_notice text;

alter table public.members drop constraint if exists members_renewal_notice_check;
alter table public.members add constraint members_renewal_notice_check
  check (renewal_notice is null or renewal_notice in ('due_soon', 'due', 'lapsed'));

-- When the next renewal is due.
create or replace function public.kamsa_renewal_due_at(p_renewed_at timestamptz, p_approved_at timestamptz)
returns timestamptz language sql immutable set search_path to '' as $$
  select coalesce(p_renewed_at, p_approved_at) + interval '365 days'
$$;

-- Reactivating someone (board or self-renewal) clears the lapse and restarts the year.
create or replace function public.kamsa_members_on_reactivate()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.membership_status = 'active' and old.membership_status is distinct from 'active' then
    new.lapsed_at := null;
    new.renewal_notice := null;
    if old.approved_at is not null and new.renewed_at is not distinct from old.renewed_at then
      new.renewed_at := now();   -- board reactivation of a former member
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_on_reactivate on public.members;
create trigger members_on_reactivate
  before update of membership_status on public.members
  for each row execute function public.kamsa_members_on_reactivate();

-- The member renews and confirms or updates their profile in one step.
-- Unlike update_my_profile, school, graduation year and status may change here
-- (e.g. pre-med → medical student). Names still require emailing the board.
create or replace function public.renew_my_membership(
  p_school_institution text,
  p_graduation_year integer,
  p_current_status text,
  p_regional_chapter text DEFAULT NULL,
  p_specialty_interest text[] DEFAULT '{}',
  p_linkedin_profile text DEFAULT NULL,
  p_school_email text DEFAULT NULL,
  p_profile_image_path text DEFAULT NULL,
  p_consent_membership_directory boolean DEFAULT false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     public.members%rowtype;
  v_due     timestamptz;
  v_school  text := public.kamsa_clean(p_school_institution, 160);
  v_status  text := public.kamsa_clean(p_current_status, 40);
  v_chapter text := public.kamsa_clean(p_regional_chapter, 40);
  v_li      text := public.kamsa_clean(p_linkedin_profile, 240);
  v_semail  text := lower(public.kamsa_clean(p_school_email, 254));
  v_img     text := public.kamsa_clean(p_profile_image_path, 200);
  v_specs   text[];
  v_consent boolean := coalesce(p_consent_membership_directory, false);
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  select * into v_row from public.members where user_id = v_uid for update;
  if not found or v_row.profile_completed_at is null then
    raise exception 'Membership record not found.' using errcode = 'P0002';
  end if;
  if not (v_row.membership_status = 'active'
          or (v_row.membership_status = 'inactive' and v_row.lapsed_at is not null)) then
    raise exception 'Your membership can''t be renewed online. Please email kamsa.usa@gmail.com.' using errcode = '42501';
  end if;
  v_due := public.kamsa_renewal_due_at(v_row.renewed_at, v_row.approved_at);
  if v_row.membership_status = 'active' and v_due - now() > interval '30 days' then
    raise exception 'Renewal opens on %.', to_char(v_due - interval '30 days', 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct public.kamsa_clean(x, 60)) filter (where public.kamsa_clean(x, 60) is not null), '{}')
    into v_specs from unnest(coalesce(p_specialty_interest, '{}')) as x;
  if v_school is null then
    raise exception 'Please enter your school or institution.' using errcode = '22023';
  end if;
  if p_graduation_year is null or p_graduation_year < 1960 or p_graduation_year > extract(year from now())::int + 10 then
    raise exception 'Please enter a valid graduation year.' using errcode = '22023';
  end if;
  if v_status is null or not (v_status = any (public.kamsa_allowed_statuses())) then
    raise exception 'Please choose your current status.' using errcode = '22023';
  end if;
  if v_semail is not null and v_semail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter a valid school email, or leave it blank.' using errcode = '22023';
  end if;
  perform public.kamsa_check_optional_fields(v_chapter, v_specs, v_li, v_img);

  update public.members set
    school_institution           = v_school,
    graduation_year              = p_graduation_year,
    current_status               = v_status,
    regional_chapter             = v_chapter,
    specialty_interest           = v_specs,
    linkedin_profile             = v_li,
    school_email                 = v_semail,
    profile_image_path           = v_img,
    consent_updated_at           = case when consent_membership_directory is distinct from v_consent
                                        then now() else consent_updated_at end,
    consent_membership_directory = v_consent,
    renewed_at                   = now(),
    renewal_notice               = null,
    lapsed_at                    = null,
    membership_status            = 'active'
  where user_id = v_uid
  returning * into v_row;

  return to_jsonb(v_row) - 'approved_by'
    || jsonb_build_object('renewal_due_at', public.kamsa_renewal_due_at(v_row.renewed_at, v_row.approved_at));
end $$;

revoke all on function public.renew_my_membership(text, integer, text, text, text[], text, text, text, boolean) from public, anon;
grant execute on function public.renew_my_membership(text, integer, text, text, text[], text, text, text, boolean) to authenticated;

-- The portal needs the renewal date.
create or replace function public.get_my_membership()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_user   auth.users%rowtype;
  v_member jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select * into v_user from auth.users where id = v_uid;

  insert into public.members (user_id, first_name, last_name, personal_email, membership_status, membership_tier)
  values (
    v_uid,
    public.kamsa_clean(v_user.raw_user_meta_data ->> 'first_name', 80),
    public.kamsa_clean(v_user.raw_user_meta_data ->> 'last_name', 80),
    v_user.email, 'pending', 'Standard'
  )
  on conflict (user_id) do nothing;

  select to_jsonb(m) - 'approved_by'
         || jsonb_build_object('renewal_due_at', public.kamsa_renewal_due_at(m.renewed_at, m.approved_at))
    into v_member
    from public.members m where m.user_id = v_uid;

  return jsonb_build_object(
    'member',          v_member,
    'is_admin',        public.is_admin(),
    'email_confirmed', v_user.email_confirmed_at is not null
  );
end $$;

-- Daily: send reminders and lapse memberships past the grace period.
-- Each UPDATE fires the members webhook, which emails the member.
create or replace function public.kamsa_process_renewals()
returns void language plpgsql security definer set search_path to '' as $$
begin
  -- 30 days past the renewal date: lapse.
  update public.members set membership_status = 'inactive', lapsed_at = now(), renewal_notice = 'lapsed'
   where membership_status = 'active' and approved_at is not null
     and now() >= public.kamsa_renewal_due_at(renewed_at, approved_at) + interval '30 days';

  -- Renewal date reached.
  update public.members set renewal_notice = 'due'
   where membership_status = 'active' and approved_at is not null
     and renewal_notice is distinct from 'due'
     and now() >= public.kamsa_renewal_due_at(renewed_at, approved_at);

  -- Renewal window opens (30 days before).
  update public.members set renewal_notice = 'due_soon'
   where membership_status = 'active' and approved_at is not null
     and renewal_notice is null
     and now() >= public.kamsa_renewal_due_at(renewed_at, approved_at) - interval '30 days';
end $$;

revoke all on function public.kamsa_process_renewals() from public, anon, authenticated;
revoke all on function public.kamsa_renewal_due_at(timestamptz, timestamptz) from anon;

select cron.schedule('kamsa-process-renewals', '23 14 * * *', $job$ select public.kamsa_process_renewals() $job$);
