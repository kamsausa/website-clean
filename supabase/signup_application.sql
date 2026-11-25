-- One-step membership application.
-- The sign-up form now collects the whole profile; it travels in the sign-up request's
-- user metadata under "profile". Accounts are only created when that profile is valid.
-- When the applicant confirms their email, the profile is copied onto their member row
-- and they enter the board's review queue (which also triggers the board email webhook).

-- 0. Switch: once the new sign-up page is live, every new account must include an application.
--    (Off until the site update is merged, so the old sign-up page keeps working meanwhile.)
create or replace function public.kamsa_signup_requires_application()
returns boolean language sql stable set search_path to '' as $$ select false $$;

-- 1. Validate a submitted profile (raises a friendly error when something is wrong).
create or replace function public.kamsa_validate_signup_profile(p jsonb)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_first   text := public.kamsa_clean(p ->> 'first_name', 80);
  v_last    text := public.kamsa_clean(p ->> 'last_name', 80);
  v_school  text := public.kamsa_clean(p ->> 'school_institution', 160);
  v_year    int;
  v_status  text := public.kamsa_clean(p ->> 'current_status', 40);
  v_chapter text := public.kamsa_clean(p ->> 'regional_chapter', 40);
  v_li      text := public.kamsa_clean(p ->> 'linkedin_profile', 240);
  v_semail  text := lower(public.kamsa_clean(p ->> 'school_email', 254));
  v_specs   text[];
  v_consent boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Please complete the membership application.' using errcode = '22023';
  end if;
  begin
    v_year := (p ->> 'graduation_year')::int;
  exception when others then
    v_year := null;
  end;
  select coalesce(array_agg(distinct public.kamsa_clean(x, 60)) filter (where public.kamsa_clean(x, 60) is not null), '{}')
    into v_specs
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'specialty_interest') = 'array' then p -> 'specialty_interest' else '[]'::jsonb end) as x;
  v_consent := case p ->> 'consent_membership_directory' when 'true' then true when 'false' then false end;

  if v_first is null or v_last is null then
    raise exception 'Please enter your first and last name.' using errcode = '22023';
  end if;
  if v_school is null then
    raise exception 'Please enter your school or institution.' using errcode = '22023';
  end if;
  if v_year is null or v_year < 1960 or v_year > extract(year from now())::int + 10 then
    raise exception 'Please enter a valid graduation year.' using errcode = '22023';
  end if;
  if v_status is null or not (v_status = any (public.kamsa_allowed_statuses())) then
    raise exception 'Please choose your current status.' using errcode = '22023';
  end if;
  if v_semail is not null and v_semail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter a valid school email, or leave it blank.' using errcode = '22023';
  end if;
  if v_consent is null then
    raise exception 'Please choose whether to be listed in the directory.' using errcode = '22023';
  end if;
  if p ->> 'chapter_choice' is null then
    raise exception 'Please choose a regional chapter.' using errcode = '22023';
  end if;
  perform public.kamsa_check_optional_fields(v_chapter, v_specs, v_li, null);

  return jsonb_build_object(
    'first_name', v_first, 'last_name', v_last, 'school_institution', v_school,
    'graduation_year', v_year, 'current_status', v_status, 'regional_chapter', v_chapter,
    'specialty_interest', to_jsonb(v_specs), 'linkedin_profile', v_li, 'school_email', v_semail,
    'consent_membership_directory', v_consent);
end $$;

-- 2. New accounts: require a complete, valid application.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  prof jsonb;
begin
  if meta ? 'profile' then
    prof := public.kamsa_validate_signup_profile(meta -> 'profile');   -- raises → account is not created
  elsif public.kamsa_signup_requires_application()
        and coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email'
        and new.is_sso_user is not true then
    raise exception 'Please complete the full membership application.' using errcode = '22023';
  end if;
  if meta ->> 'terms_accepted' is distinct from 'true' and prof is not null then
    raise exception 'Please agree to the privacy notice.' using errcode = '22023';
  end if;

  insert into public.members (
    user_id, first_name, last_name, personal_email,
    membership_status, membership_tier, terms_accepted_at
  ) values (
    new.id,
    coalesce(prof ->> 'first_name', public.kamsa_clean(meta ->> 'first_name', 80)),
    coalesce(prof ->> 'last_name',  public.kamsa_clean(meta ->> 'last_name', 80)),
    new.email, 'pending', 'Standard',
    case when meta ->> 'terms_accepted' = 'true' then now() end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

-- 3. Email confirmed: copy the application onto the member row and queue it for review.
create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  prof jsonb;
begin
  if not (coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'profile') then
    return new;   -- older accounts finish their profile on the onboarding page instead
  end if;
  begin
    prof := public.kamsa_validate_signup_profile(new.raw_user_meta_data -> 'profile');
  exception when others then
    return new;   -- never block email confirmation; onboarding page will ask for fixes
  end;

  update public.members set
    first_name                   = prof ->> 'first_name',
    last_name                    = prof ->> 'last_name',
    school_institution           = prof ->> 'school_institution',
    graduation_year              = (prof ->> 'graduation_year')::int,
    current_status               = prof ->> 'current_status',
    regional_chapter             = prof ->> 'regional_chapter',
    specialty_interest           = array(select jsonb_array_elements_text(prof -> 'specialty_interest')),
    linkedin_profile             = prof ->> 'linkedin_profile',
    school_email                 = prof ->> 'school_email',
    consent_membership_directory = (prof ->> 'consent_membership_directory')::boolean,
    consent_updated_at           = now(),
    profile_completed_at         = coalesce(profile_completed_at, now())
  where user_id = new.id and profile_completed_at is null;

  -- The application now lives on the member row; drop the copy in the account metadata.
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'profile' where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_email_confirmed();

revoke all on function public.kamsa_validate_signup_profile(jsonb) from public, anon, authenticated;
revoke all on function public.handle_email_confirmed() from public, anon, authenticated;

-- 4. Applications that are never confirmed are deleted after 7 days.
create extension if not exists pg_cron;
select cron.unschedule('kamsa-delete-unconfirmed-signups')
  where exists (select 1 from cron.job where jobname = 'kamsa-delete-unconfirmed-signups');
select cron.schedule(
  'kamsa-delete-unconfirmed-signups',
  '17 9 * * *',
  $job$
    delete from auth.users
     where email_confirmed_at is null
       and created_at < now() - interval '7 days'
       and created_at >= timestamptz '2026-11-25 00:00:00+00'
  $job$
);
