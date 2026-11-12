-- =============================================================================
-- KAMSA membership IDs (run once in Supabase → SQL Editor; safe to re-run)
--
-- Every member gets a permanent ID like  KAMSA-2026-0042
--   • the year is the year they signed up
--   • the number counts up across all members and never repeats
-- New sign-ups get one automatically; existing members are numbered in the
-- order they signed up. IDs cannot be edited afterwards.
-- =============================================================================

begin;

create sequence if not exists public.member_number_seq;

alter table public.members add column if not exists membership_id text;
create unique index if not exists members_membership_id_key on public.members (membership_id);

create or replace function public.kamsa_next_membership_id(p_at timestamptz default now())
returns text language sql volatile security definer set search_path = '' as $$
  select 'KAMSA-'
      || to_char(coalesce(p_at, now()) at time zone 'America/New_York', 'YYYY')
      || '-'
      || lpad(nextval('public.member_number_seq')::text, 4, '0');
$$;

create or replace function public.kamsa_assign_membership_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_id is null then
    new.membership_id := public.kamsa_next_membership_id(coalesce(new.created_at, now()));
  end if;
  return new;
end $$;

drop trigger if exists members_assign_membership_id on public.members;
create trigger members_assign_membership_id
  before insert on public.members
  for each row execute function public.kamsa_assign_membership_id();

create or replace function public.kamsa_lock_membership_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.membership_id is not null and new.membership_id is distinct from old.membership_id then
    raise exception 'Membership IDs cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists members_lock_membership_id on public.members;
create trigger members_lock_membership_id
  before update of membership_id on public.members
  for each row execute function public.kamsa_lock_membership_id();

-- Number existing members in sign-up order.
do $$
declare r record;
begin
  for r in select id, created_at from public.members where membership_id is null order by created_at, id loop
    update public.members set membership_id = public.kamsa_next_membership_id(r.created_at) where id = r.id;
  end loop;
end $$;

alter table public.members alter column membership_id set not null;

revoke all on function public.kamsa_next_membership_id(timestamptz) from public, anon, authenticated;
revoke all on function public.kamsa_assign_membership_id() from public, anon, authenticated;
revoke all on function public.kamsa_lock_membership_id() from public, anon, authenticated;

commit;
