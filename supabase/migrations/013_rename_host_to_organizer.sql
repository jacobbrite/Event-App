-- Vocabulary clean-up. "Host" had three meanings; now each has its own word:
--   owner / co-owner : runs a club           (club_members.role = 'owner')
--   host             : hosts ONE meeting     (events.hosted_by)
--   organizer        : allowed to create clubs (was profiles.is_host / can_host())
--   admin            : the app's owner       (profiles.is_admin)
--
-- This renames the last of those and rewords error messages that said "host".
-- Run BEFORE deploying the matching app code, and deploy right away: the live app
-- (older code) selects profiles.is_host and will fail to load profiles until then.
-- One transaction: all or nothing.

-- 1. Organizer ---------------------------------------------------------------------------
alter table public.profiles rename column is_host to is_organizer;

-- Policies follow a rename automatically (they hold references, not text), but the
-- body of a SQL/plpgsql function is stored as text, so it must be rewritten.
alter function public.can_host() rename to can_organize;

create or replace function public.can_organize()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select is_organizer or is_admin from public.profiles where id = auth.uid()),
    false);
$$;

alter policy "Hosts can create clubs of allowed types" on public.clubs
  rename to "Organizers can create clubs of allowed types";
alter policy "Hosts can delete polls" on public.meeting_polls
  rename to "Owners can delete polls";
alter policy "Read own votes; hosts and admins read all" on public.poll_votes
  rename to "Read own votes; owners and admins read all";

-- 2. Functions: same logic, wording that matches the new names --------------------------
create or replace function public.create_one_time_event(
  p_title text, p_event_time timestamptz, p_location text, p_description text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_club  bigint;
  v_event bigint;
begin
  if not public.can_organize() or not ('one_time' = any (public.allowed_club_types())) then
    raise exception 'You are not allowed to create one-time events yet.';
  end if;
  if p_title is null or trim(p_title) = '' then
    raise exception 'Give the event a title.';
  end if;

  insert into public.clubs (owner_id, name, type)
  values (auth.uid(), left(trim(p_title), 80), 'one_time')
  returning id into v_club;

  insert into public.events (club_id, title, event_time, location, description)
  values (v_club, trim(p_title), p_event_time, p_location, p_description)
  returning id into v_event;

  return v_event;
end;
$$;

create or replace function public.set_club_owner(p_club_id bigint, p_user_id uuid, p_is_owner boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_club_owner(p_club_id) then
    raise exception 'Only an owner of this club can do that.';
  end if;

  if not p_is_owner
     and p_user_id = (select owner_id from public.clubs where id = p_club_id) then
    raise exception 'The person who created the club always stays an owner.';
  end if;

  update public.club_members
  set role = case when p_is_owner then 'owner' else 'member' end
  where club_id = p_club_id and user_id = p_user_id;

  if not found then
    raise exception 'That person is not a member of this club.';
  end if;
end;
$$;

create or replace function public.update_event(
  p_event_id    bigint,
  p_title       text,
  p_event_time  timestamptz,
  p_location    text,
  p_description text,
  p_hosted_by   uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e              public.events%rowtype;
  v_owner        boolean;
  v_meeting_host boolean;
begin
  select * into e from public.events where id = p_event_id;
  if not found then
    raise exception 'That event does not exist.';
  end if;

  v_owner        := public.is_club_owner(e.club_id);
  v_meeting_host := e.hosted_by is not null
                    and e.hosted_by = auth.uid()
                    and public.is_club_member(e.club_id);

  if not v_owner and not v_meeting_host then
    raise exception 'Only an owner of this club, or the host of this meeting, can edit it.';
  end if;

  if p_title is null or trim(p_title) = '' then
    raise exception 'Give the event a title.';
  end if;
  if p_event_time is null then
    raise exception 'Choose a date and time.';
  end if;
  if p_location is null or trim(p_location) = '' then
    raise exception 'Add a location.';
  end if;
  if p_description is null or trim(p_description) = '' then
    raise exception 'Add a description.';
  end if;

  if not v_owner then
    if trim(p_title) is distinct from trim(e.title)
       or p_event_time is distinct from e.event_time
       or p_hosted_by is distinct from e.hosted_by then
      raise exception 'The host of a meeting can change its location and description. Ask a club owner to change anything else.';
    end if;
  end if;

  if p_hosted_by is not null and not exists (
    select 1 from public.club_members
    where club_id = e.club_id and user_id = p_hosted_by
  ) then
    raise exception 'The host of a meeting must be a member of the club.';
  end if;

  update public.events
  set title       = trim(p_title),
      event_time  = p_event_time,
      location    = trim(p_location),
      description = trim(p_description),
      hosted_by   = p_hosted_by
  where id = p_event_id;
end;
$$;

create or replace function public.create_meeting_poll(
  p_club_id     bigint,
  p_title       text,
  p_location    text,
  p_description text,
  p_hosted_by   uuid,
  p_times       timestamptz[]
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_poll bigint;
  v_distinct int;
begin
  if not public.is_club_owner(p_club_id) then
    raise exception 'Only an owner of this club can propose meeting times.';
  end if;
  if (select type from public.clubs where id = p_club_id) = 'one_time' then
    raise exception 'A one-time event already has its time.';
  end if;

  if p_title is null or trim(p_title) = '' then raise exception 'Give the meeting a title.'; end if;
  if p_location is null or trim(p_location) = '' then raise exception 'Add a location.'; end if;
  if p_description is null or trim(p_description) = '' then raise exception 'Add a description.'; end if;

  if p_hosted_by is not null and not exists (
    select 1 from public.club_members where club_id = p_club_id and user_id = p_hosted_by
  ) then
    raise exception 'The host of a meeting must be a member of the club.';
  end if;

  select count(distinct t) into v_distinct from unnest(coalesce(p_times, '{}')) as t;
  if v_distinct not between 2 and 10 then
    raise exception 'Propose between 2 and 10 different times.';
  end if;
  if exists (select 1 from unnest(p_times) as t where t <= now()) then
    raise exception 'Every proposed time must be in the future.';
  end if;

  insert into public.meeting_polls (club_id, title, location, description, hosted_by)
  values (p_club_id, trim(p_title), trim(p_location), trim(p_description), p_hosted_by)
  returning id into v_poll;

  insert into public.poll_options (poll_id, starts_at)
  select v_poll, t from (select distinct unnest(p_times) as t) x;

  return v_poll;
end;
$$;

create or replace function public.finalize_meeting_poll(p_poll_id bigint, p_option_id bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  p       public.meeting_polls%rowtype;
  o       public.poll_options%rowtype;
  v_event bigint;
begin
  select * into p from public.meeting_polls where id = p_poll_id;
  if not found then
    raise exception 'That poll does not exist.';
  end if;
  if not public.is_club_owner(p.club_id) then
    raise exception 'Only an owner of this club can choose the time.';
  end if;
  if p.status <> 'open' then
    raise exception 'This poll is already closed.';
  end if;

  select * into o from public.poll_options where id = p_option_id and poll_id = p_poll_id;
  if not found then
    raise exception 'That time is not part of this poll.';
  end if;
  if o.starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;

  insert into public.events (club_id, title, event_time, location, description, hosted_by)
  values (p.club_id, p.title, o.starts_at, p.location, p.description, p.hosted_by)
  returning id into v_event;

  update public.meeting_polls set status = 'closed', event_id = v_event where id = p_poll_id;
  return v_event;
end;
$$;
