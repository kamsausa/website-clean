-- =============================================================================
-- KAMSA membership IDs (run once in Supabase → SQL Editor; safe to re-run)
--
-- Every member gets a permanent, random 7-digit ID (e.g. 4337863).
--   • unique: no two members share an ID, and IDs are never reused
--   • new sign-ups get one automatically; existing members without one get one
--   • IDs cannot be edited afterwards
-- (Already applied to the kamsa-membership project on 2026-11-12.)
-- =============================================================================

begin;

alter table public.members add column if not exists membership_id text;
create unique index if not exists members_membership_id_key on public.members (membership_id);

create or replace function public.kamsa_random_membership_id()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare candidate text;
begin
  loop
    candidate := (1000000 + floor(random() * 9000000))::int::text;
    exit when not exists (select 1 from public.members m where m.membership_id = candidate);
  end loop;
  return candidate;
end $$;

create or replace function public.kamsa_assign_membership_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_id is null then
    new.membership_id := public.kamsa_random_membership_id();
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

-- Give an ID to any member who doesn't have one yet.
do $$
declare r record;
begin
  for r in select id from public.members where membership_id is null order by created_at, id loop
    update public.members set membership_id = public.kamsa_random_membership_id() where id = r.id;
  end loop;
end $$;

alter table public.members alter column membership_id set not null;
alter table public.members drop constraint if exists members_membership_id_format;
alter table public.members add constraint members_membership_id_format check (membership_id ~ '^[1-9][0-9]{6}$');

revoke all on function public.kamsa_random_membership_id() from public, anon, authenticated;
revoke all on function public.kamsa_assign_membership_id() from public, anon, authenticated;
revoke all on function public.kamsa_lock_membership_id() from public, anon, authenticated;

commit;
