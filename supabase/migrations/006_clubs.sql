-- Clubs, join links, scoped hosts and event types.
--
-- Before this, `is_host` was a super-user flag (read every profile, every event,
-- every guest list). That is unsafe once other people can host. After this:
--   * profiles.is_admin  = the owner of the app, can see everything
--   * profiles.is_host   = allowed to create clubs (beta hosts + admin)
--   * profiles.allowed_types = which club types a host may create
--   * clubs own events; members of a club see its events; a host sees only
--     their own clubs and members
--
-- Run BEFORE deploying the matching app code. It is additive: the old
-- `invitations` table and `events.series_id` are left alone (007 removes them
-- after the deploy). One transaction: if anything fails, nothing is applied.

-- 1. Roles on profiles ------------------------------------------------------------
alter table public.profiles add column is_admin boolean not null default false;
alter table public.profiles add column allowed_types text[] not null default array['book_club'];

-- Whoever is a host today is the owner of the app.
update public.profiles set is_admin = true where is_host;

-- Users can NOT change any of these: the UPDATE grant from 001/005 only names
-- first_name, last_name and avatar_url.

-- 2. Tables ------------------------------------------------------------------------
create table public.clubs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 80),
  type       text not null default 'book_club'
             check (type in ('book_club', 'dinner_party', 'custom'))
);

create table public.club_members (
  club_id   bigint not null references public.clubs (id) on delete cascade,
  user_id   uuid   not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_members_user_idx on public.club_members (user_id);

-- The join code lives in its own table so that only the club's host can read it
-- (RLS is per row, so a column on `clubs` would be visible to every member).
create table public.club_invite_links (
  club_id bigint primary key references public.clubs (id) on delete cascade,
  code    text not null unique default replace(gen_random_uuid()::text, '-', '')
);

alter table public.events
  add column club_id bigint references public.clubs (id) on delete cascade;
create index events_club_idx on public.events (club_id);

alter table public.clubs             enable row level security;
alter table public.club_members      enable row level security;
alter table public.club_invite_links enable row level security;

-- 3. Permission helpers ---------------------------------------------------------------
-- security definer so policies can consult profiles / clubs / club_members
-- without recursing through their own RLS. search_path is pinned to ''.
create function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false); $$;

create function public.can_host()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select is_host or is_admin from public.profiles where id = auth.uid()), false); $$;

create function public.allowed_club_types()
returns text[] language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when is_admin then array['book_club', 'dinner_party', 'custom']
                 else allowed_types end
     from public.profiles where id = auth.uid()),
    '{}'::text[]);
$$;

create function public.is_club_member(p_club_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = auth.uid());
$$;

create function public.is_club_owner(p_club_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clubs
    where id = p_club_id and owner_id = auth.uid());
$$;

revoke execute on function
  public.is_admin(), public.can_host(), public.allowed_club_types(),
  public.is_club_member(bigint), public.is_club_owner(bigint)
  from public, anon;
grant execute on function
  public.is_admin(), public.can_host(), public.allowed_club_types(),
  public.is_club_member(bigint), public.is_club_owner(bigint)
  to authenticated;

-- 4. New club: make the owner a member and create the join link -----------------------
create function public.handle_new_club()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.club_members (club_id, user_id) values (new.id, new.owner_id)
    on conflict do nothing;
  insert into public.club_invite_links (club_id) values (new.id)
    on conflict do nothing;
  return new;
end;
$$;

create trigger on_club_created
  after insert on public.clubs
  for each row execute function public.handle_new_club();

-- 5. Policies: clubs -------------------------------------------------------------------
-- `owner_id = auth.uid()` is deliberate: when a host creates a club the app asks
-- for the new row back (INSERT ... RETURNING), and Postgres checks this policy
-- BEFORE the trigger below has added the owner to club_members. Without the
-- owner check a non-admin host would get an RLS error on their own new club.
create policy "Members, owners and admins can read clubs"
  on public.clubs for select to authenticated
  using (public.is_admin() or owner_id = auth.uid() or public.is_club_member(id));

-- Hosts create clubs for themselves, only of the types they're allowed.
create policy "Hosts can create clubs of allowed types"
  on public.clubs for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.can_host()
    and type = any (public.allowed_club_types())
  );

create policy "Owners can rename their clubs"
  on public.clubs for update to authenticated
  using (public.is_admin() or owner_id = auth.uid())
  with check (public.is_admin() or owner_id = auth.uid());

revoke update on public.clubs from anon, authenticated;
grant  update (name) on public.clubs to authenticated;

-- 6. Policies: club_members --------------------------------------------------------------
-- No INSERT policy: people join through join_club() (below) and owners are added
-- by the trigger, so nobody can add someone else directly.
create policy "See own membership; owners and admins see all"
  on public.club_members for select to authenticated
  using (user_id = auth.uid() or public.is_club_owner(club_id) or public.is_admin());

create policy "Members can leave (owners cannot)"
  on public.club_members for delete to authenticated
  using (user_id = auth.uid() and not public.is_club_owner(club_id));

create policy "Owners can remove other members"
  on public.club_members for delete to authenticated
  using (public.is_club_owner(club_id) and user_id <> auth.uid());

revoke all on public.club_members from anon;
revoke insert, update on public.club_members from authenticated;

-- 7. Policies: club_invite_links -----------------------------------------------------------
create policy "Owners and admins can read the join code"
  on public.club_invite_links for select to authenticated
  using (public.is_club_owner(club_id) or public.is_admin());

-- "Reset link" = the owner sets a new code, which kills the old one.
create policy "Owners and admins can reset the join code"
  on public.club_invite_links for update to authenticated
  using (public.is_club_owner(club_id) or public.is_admin())
  with check (public.is_club_owner(club_id) or public.is_admin());

revoke all on public.club_invite_links from anon;
revoke insert, update, delete on public.club_invite_links from authenticated;
grant  update (code) on public.club_invite_links to authenticated;

-- 8. Joining and previewing ------------------------------------------------------------------
-- What a signed-out visitor sees behind an invite link: just the club's name.
create function public.club_preview(p_code text)
returns table (name text, type text)
language sql stable security definer set search_path = ''
as $$
  select c.name, c.type
  from public.club_invite_links l
  join public.clubs c on c.id = l.club_id
  where l.code = p_code;
$$;

create function public.join_club(p_code text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_club bigint;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in to join a club.';
  end if;

  select club_id into v_club from public.club_invite_links where code = p_code;
  if v_club is null then
    raise exception 'This invite link is no longer valid.';
  end if;

  insert into public.club_members (club_id, user_id) values (v_club, auth.uid())
    on conflict do nothing;
  return v_club;
end;
$$;

revoke execute on function public.club_preview(text), public.join_club(text) from public, anon;
grant  execute on function public.club_preview(text) to anon, authenticated;
grant  execute on function public.join_club(text) to authenticated;

-- 9. Member directory ---------------------------------------------------------------------------
-- Members may see who else is in their club (name + photo). Only the club's
-- owner (or an admin) also gets email addresses. Doing this in a function means
-- we never have to let members read other people's profile rows, which would
-- expose every column, email included.
create function public.club_directory(p_club_id bigint)
returns table (
  user_id uuid, first_name text, last_name text,
  avatar_url text, email text, is_owner boolean
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.first_name, p.last_name, p.avatar_url,
         case when public.is_admin() or public.is_club_owner(p_club_id)
              then p.email end,
         c.owner_id = p.id
  from public.club_members m
  join public.profiles p on p.id = m.user_id
  join public.clubs c    on c.id = m.club_id
  where m.club_id = p_club_id
    and (public.is_admin() or public.is_club_member(p_club_id))
  order by (c.owner_id = p.id) desc, p.first_name;
$$;

revoke execute on function public.club_directory(bigint) from public, anon;
grant  execute on function public.club_directory(bigint) to authenticated;

-- 10. Convert existing per-event invitations into clubs ----------------------------------------------
-- One club per recurring series (events sharing a series_id), otherwise one club
-- per event, owned by the event's host. Everyone who was invited becomes a member.
-- Type 'custom' since we don't know what these were.
do $$
declare
  admin_id uuid := (select id from public.profiles where is_admin order by created_at limit 1);
  g        record;
  new_club bigint;
begin
  if admin_id is null then
    raise exception 'No admin found: expected the existing host to have been marked is_admin above.';
  end if;

  for g in
    select coalesce(series_id::text, 'e' || id::text)              as grp,
           (array_agg(title   order by event_time desc))[1]        as club_name,
           (array_agg(host_id order by event_time))[1]             as owner
    from public.events
    where club_id is null
    group by 1
  loop
    -- An event's host_id can point at a user with no profile (e.g. a test account
    -- that was deleted); such clubs are given to the admin instead.
    insert into public.clubs (owner_id, name, type)
    values (
      coalesce((select p.id from public.profiles p where p.id = g.owner), admin_id),
      g.club_name,
      'custom'
    )
    returning id into new_club;

    update public.events
    set club_id = new_club
    where club_id is null
      and coalesce(series_id::text, 'e' || id::text) = g.grp;

    insert into public.club_members (club_id, user_id)
    select distinct new_club, i.user_id
    from public.invitations i
    join public.events e on e.id = i.event_id
    where e.club_id = new_club
    on conflict do nothing;
  end loop;
end $$;

-- 11. Replace the policies that made hosts super-users --------------------------------------------------
-- events: readable by members of the club (and admins); creatable by the
-- club's owner (and admins) as long as they can still host.
drop policy if exists "Hosts and invited users can read events" on public.events;
drop policy if exists "Hosts can create events" on public.events;

create policy "Members and admins can read events"
  on public.events for select to authenticated
  using (public.is_admin() or public.is_club_member(club_id));

create policy "Club owners and admins can create events"
  on public.events for insert to authenticated
  with check (
    public.can_host()
    and (public.is_admin() or public.is_club_owner(club_id))
  );

-- rsvps: if you can see the event, you can RSVP to it (events RLS decides).
-- Owners of the club (and admins) can read everyone's RSVP for their events.
drop policy if exists "Invited users can RSVP as themselves" on public.rsvps;
drop policy if exists "Hosts can read all rsvps" on public.rsvps;

create policy "Members can RSVP as themselves"
  on public.rsvps for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.events e where e.id = rsvps.event_id)
  );

create policy "Club owners and admins can read rsvps"
  on public.rsvps for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.events e
      join public.clubs c on c.id = e.club_id
      where e.id = rsvps.event_id and c.owner_id = auth.uid()
    )
  );

-- profiles: only admins can read everyone. (Hosts get their members' names and
-- emails through club_directory(), which checks club ownership.)
drop policy if exists "Hosts can read all profiles" on public.profiles;

create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());
