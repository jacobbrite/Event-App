-- Invite-only events + recurring series.
--   * events.series_id groups the occurrences of a recurring event (null = one-time)
--   * invitations: which users may see / RSVP to which event
--   * events are readable only by hosts and invited users (was: anyone)
--   * hosts can read all profiles (to pick guests); profiles get an email column
--
-- Run BEFORE deploying the matching app code. Existing behaviour is preserved by
-- inviting every existing user to every existing event (section 6), so the
-- currently-live app keeps working. Runs as one transaction: if any statement
-- fails, nothing is applied.

-- 1. is_host() helper ----------------------------------------------------------
-- Policies on profiles that query profiles would recurse forever ("infinite
-- recursion detected in policy"). A security definer function reads the table
-- without going through RLS, which avoids that. search_path is pinned to ''
-- for the same hardening reason as handle_new_user().
create function public.is_host()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(
    (select is_host from public.profiles where id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_host() from public, anon;
grant  execute on function public.is_host() to authenticated;

-- 2. profiles: email column + hosts can read everyone ---------------------------
-- Lets the host tell two "Sam"s apart when picking guests. Not client-writable:
-- the UPDATE grant from 001 only covers first_name / last_name.
alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.email
  );
  return new;
end;
$$;

create policy "Hosts can read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_host());

-- 3. events.series_id -----------------------------------------------------------
alter table public.events add column series_id uuid;
create index events_series_id_idx on public.events (series_id);

-- 4. invitations ----------------------------------------------------------------
create table public.invitations (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_id   bigint not null references public.events (id) on delete cascade,
  user_id    uuid   not null references public.profiles (id) on delete cascade,
  unique (event_id, user_id)
);

alter table public.invitations enable row level security;

-- Guests see only their own invitations; hosts see all of them.
create policy "Read own invitations, hosts read all"
  on public.invitations for select
  to authenticated
  using (user_id = auth.uid() or public.is_host());

-- Only hosts can invite or un-invite. There is no UPDATE policy or privilege.
create policy "Hosts can invite"
  on public.invitations for insert
  to authenticated
  with check (public.is_host());

create policy "Hosts can uninvite"
  on public.invitations for delete
  to authenticated
  using (public.is_host());

revoke all    on public.invitations from anon;
revoke update on public.invitations from authenticated;

-- 5. events SELECT: hosts and invited users only --------------------------------
-- I don't know the old SELECT policy's name, so drop whatever exists.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'events' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.events', p.policyname);
  end loop;
end $$;

create policy "Hosts and invited users can read events"
  on public.events for select
  to authenticated
  using (
    public.is_host()
    or exists (
      select 1 from public.invitations i
      where i.event_id = events.id and i.user_id = auth.uid()
    )
  );

-- 6. RSVP INSERT: must be invited (hosts may RSVP to their own events) ----------
-- Without this a guest could RSVP to an event they can't even see, given its id.
drop policy "Users can RSVP as themselves" on public.rsvps;

create policy "Invited users can RSVP as themselves"
  on public.rsvps for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      public.is_host()
      or exists (
        select 1 from public.invitations i
        where i.event_id = rsvps.event_id and i.user_id = auth.uid()
      )
    )
  );

-- 7. Backfill: preserve today's behaviour --------------------------------------
-- Every existing (non-host) user is invited to every existing event, so nobody
-- loses access to what they can see right now. Trim it in the app afterwards.
insert into public.invitations (event_id, user_id)
select e.id, p.id
from public.events e
cross join public.profiles p
where not p.is_host
on conflict (event_id, user_id) do nothing;
