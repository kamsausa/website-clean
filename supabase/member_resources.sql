-- Members-only resources shown in the portal's "Member resources" section.
-- Links live in the database (readable only by approved members and admins),
-- not in the public page code. Already applied to the kamsa-membership project.
-- To add another resource later, insert a row here (or in Table Editor).
create table if not exists public.member_resources (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  description text not null,
  url         text not null check (url ~* '^https://'),
  link_label  text,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.member_resources enable row level security;

drop policy if exists "resources: active members read" on public.member_resources;
create policy "resources: active members read" on public.member_resources
  for select to authenticated
  using (is_active and (public.is_active_member() or public.is_admin()));

drop policy if exists "resources: admins manage" on public.member_resources;
create policy "resources: admins manage" on public.member_resources
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.member_resources from anon;

insert into public.member_resources (title, description, url, link_label, sort_order) values (
  'KAMSA Opportunities Database',
  'Scholarships, research programs, mentorship, volunteering, and member discounts collected by KAMSA members, with deadlines and eligibility in one place.',
  'https://docs.google.com/spreadsheets/d/1fItskALhqwrv9acenSP_Jrw7S4Y91zlzn7KEE8Yin5M/edit',
  'Open the Opportunities Database',
  10
) on conflict (title) do update set url = excluded.url, description = excluded.description, link_label = excluded.link_label;
