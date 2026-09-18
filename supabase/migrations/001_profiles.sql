-- Profiles table: moves name out of user_metadata and adds a real host flag,
-- replacing the hardcoded HOST_ID in App.jsx.
-- Run this in the Supabase SQL editor BEFORE deploying the matching App.jsx.

-- 1. Table -------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  first_name text,
  last_name  text,
  is_host    boolean not null default false
);

alter table public.profiles enable row level security;

-- 2. RLS ---------------------------------------------------------------------
-- Users can read their own profile. There is deliberately NO insert policy
-- (the trigger below creates rows) and NO delete policy.
create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- RLS works per ROW, not per column, so the update policy above alone would let
-- a user run `update profiles set is_host = true where id = <me>` and make
-- themselves a host. Column-level privileges close that hole: clients may only
-- ever change the name columns.
revoke update on public.profiles from anon, authenticated;
grant  update (first_name, last_name) on public.profiles to authenticated;

-- 3. Auto-create a profile on signup -----------------------------------------
-- security definer: runs with the function owner's rights so it can insert past
-- RLS. search_path is pinned to '' so a malicious schema can't hijack lookups.
-- is_host is never read from metadata (users can edit their own metadata).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Backfill existing users + mark the current host --------------------------
insert into public.profiles (id, first_name, last_name)
select id,
       raw_user_meta_data ->> 'first_name',
       raw_user_meta_data ->> 'last_name'
from auth.users
on conflict (id) do nothing;

update public.profiles
set is_host = true
where id = '2862f4b4-479f-466c-bfd1-e150f4bb33fa';  -- the old HOST_ID

-- 5. Swap the events INSERT policy from hardcoded UID to the host flag --------
-- I don't know the old policy's name, so drop whatever INSERT policies exist.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'events' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.events', p.policyname);
  end loop;
end $$;

create policy "Hosts can create events"
  on public.events for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_host
    )
  );
