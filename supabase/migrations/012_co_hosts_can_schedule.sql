-- Fix: co-hosts couldn't schedule meetings or start polls.
--
-- 009 (events INSERT) and 011 (create_meeting_poll) required BOTH can_host()
-- (a platform-level "may host" flag on the profile) AND being a host of the club.
-- A co-host is an ordinary member who was promoted inside one club, so they are a
-- club host without being a platform host, and were refused.
--
-- The platform flag exists to gate CREATING new things (a new club, a one-time
-- event; both still check can_host()). Once someone is a host of a club, managing
-- that club is up to the club. One transaction: all or nothing.

drop policy "Club owners can create events" on public.events;
create policy "Club owners can create events"
  on public.events for insert to authenticated
  with check (public.is_club_owner(club_id));

-- Same function as in 011, minus the can_host() requirement.
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
    raise exception 'Only a host of this club can propose meeting times.';
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
    raise exception 'The person hosting must be a member of the club.';
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
