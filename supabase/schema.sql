create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sport text not null,
  status text not null default 'soon' check (status in ('open', 'closed', 'soon')),
  event_date date not null,
  event_time time,
  location text,
  description text,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_state (
  id text primary key default 'active',
  is_active boolean not null default true,
  state jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_state_singleton check (id = 'active')
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_admin_profiles_updated_at on public.admin_profiles;
create trigger set_admin_profiles_updated_at
before update on public.admin_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row execute function public.set_updated_at();

drop trigger if exists set_tournament_state_updated_at on public.tournament_state;
create trigger set_tournament_state_updated_at
before update on public.tournament_state
for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.admin_profiles enable row level security;
alter table public.events enable row level security;
alter table public.tournament_state enable row level security;

drop policy if exists "Admins can read admin profiles" on public.admin_profiles;
create policy "Admins can read admin profiles"
on public.admin_profiles
for select
to authenticated
using (public.is_admin() or id = auth.uid());

drop policy if exists "Admins can manage admin profiles" on public.admin_profiles;
create policy "Admins can manage admin profiles"
on public.admin_profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read published events" on public.events;
create policy "Public can read published events"
on public.events
for select
to anon, authenticated
using (is_published = true);

drop policy if exists "Admins can manage events" on public.events;
create policy "Admins can manage events"
on public.events
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read active tournament" on public.tournament_state;
create policy "Public can read active tournament"
on public.tournament_state
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage tournament state" on public.tournament_state;
create policy "Admins can manage tournament state"
on public.tournament_state
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Bootstrap the first admin after creating a Supabase Auth user:
--
-- insert into public.admin_profiles (id, email, role)
-- values ('AUTH_USER_UUID', 'admin@example.com', 'admin')
-- on conflict (id) do update
-- set email = excluded.email,
--     role = excluded.role,
--     updated_at = now();
