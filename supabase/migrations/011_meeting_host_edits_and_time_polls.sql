-- 1. A host for each meeting ("hosting this time"), and editing events.
-- 2. Time polls: hosts propose several times, members vote, a host picks the winner.
-- Run after 010, BEFORE deploying the matching app code. One transaction.

-- 1. Per-meeting host and event editing ------------------------------------------------
-- events.host_id (who created the row) already exists; hosted_by is different: it
-- is the member who is hosting THIS meeting (a rotating host).
alter table public.events
  add column hosted_by uuid references public.profiles (id) on delete set null;

-- Events can't be edited directly (the only UPDATE grant is book_id), because RLS
-- and column grants can't say "owners may change everything, the meeting's host
-- only the location". This function can:
--   * a club host (founder or co-host) may change everything, including who hosts
--   * the person hosting the meeting may change ONLY location and description
create function public.update_event(
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
  e            public.events%rowtype;
  v_owner      boolean;
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
    raise exception 'Only a host of this club, or whoever is hosting this meeting, can edit it.';
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
      raise exception 'Whoever is hosting a meeting can change its location and description. Ask a club host to change anything else.';
    end if;
  end if;

  if p_hosted_by is not null and not exists (
    select 1 from public.club_members
    where club_id = e.club_id and user_id = p_hosted_by
  ) then
    raise exception 'The person hosting must be a member of the club.';
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

revoke execute on function public.update_event(bigint, text, timestamptz, text, text, uuid)
  from public, anon;
grant  execute on function public.update_event(bigint, text, timestamptz, text, text, uuid)
  to authenticated;

-- 2. Time polls ------------------------------------------------------------------------------
-- A poll holds the details of the meeting to be created plus the candidate times.
-- When a host picks a time, an event is created from it and the poll is closed.
create table public.meeting_polls (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  club_id     bigint not null references public.clubs (id) on delete cascade,
  created_by  uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  title       text   not null check (char_length(trim(title)) between 1 and 120),
  location    text   not null,
  description text   not null,
  hosted_by   uuid   references public.profiles (id) on delete set null,
  status      text   not null default 'open' check (status in ('open', 'closed')),
  event_id    bigint references public.events (id) on delete set null
);
create index meeting_polls_club_idx on public.meeting_polls (club_id);

create table public.poll_options (
  id        bigint generated always as identity primary key,
  poll_id   bigint not null references public.meeting_polls (id) on delete cascade,
  starts_at timestamptz not null,
  unique (poll_id, starts_at)
);

create table public.poll_votes (
  option_id  bigint not null references public.poll_options (id) on delete cascade,
  user_id    uuid   not null references public.profiles (id) on delete cascade,
  vote       text   not null check (vote in ('yes', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (option_id, user_id)
);
create index poll_votes_user_idx on public.poll_votes (user_id);

alter table public.meeting_polls enable row level security;
alter table public.poll_options  enable row level security;
alter table public.poll_votes    enable row level security;

-- Reading -----------------------------------------------------------------------------------
create policy "Members and admins can read polls"
  on public.meeting_polls for select to authenticated
  using (public.is_admin() or public.is_club_member(club_id));

-- If you can see the poll you can see its times (the subquery runs under the
-- polls policy above).
create policy "Members can read poll times"
  on public.poll_options for select to authenticated
  using (exists (select 1 from public.meeting_polls p where p.id = poll_options.poll_id));

-- Your own votes, and every vote for a club's hosts (and admins), who need to see
-- who voted for what. Other members only ever get totals (poll_results below).
create policy "Read own votes; hosts and admins read all"
  on public.poll_votes for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.poll_options o
      join public.meeting_polls p on p.id = o.poll_id
      where o.id = poll_votes.option_id
        and (public.is_admin() or public.is_club_owner(p.club_id))
    )
  );

-- A club's hosts can delete a poll (its times and votes go with it).
create policy "Hosts can delete polls"
  on public.meeting_polls for delete to authenticated
  using (public.is_club_owner(club_id));

-- Everything else goes through the functions below, which check who is asking.
revoke all on public.meeting_polls, public.poll_options, public.poll_votes from anon;
revoke insert, update on public.meeting_polls from authenticated;
revoke insert, update, delete on public.poll_options, public.poll_votes from authenticated;

-- Creating a poll -----------------------------------------------------------------------------
create function public.create_meeting_poll(
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
  if not public.can_host() or not public.is_club_owner(p_club_id) then
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

-- Voting ------------------------------------------------------------------------------------------
-- Pass null to take a vote back.
create function public.cast_poll_vote(p_option_id bigint, p_vote text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.poll_options%rowtype;
  p public.meeting_polls%rowtype;
begin
  select * into o from public.poll_options where id = p_option_id;
  if not found then
    raise exception 'That time does not exist.';
  end if;
  select * into p from public.meeting_polls where id = o.poll_id;

  if not public.is_club_member(p.club_id) then
    raise exception 'Only members of this club can vote.';
  end if;
  if p.status <> 'open' then
    raise exception 'This poll is closed.';
  end if;

  if p_vote is null then
    delete from public.poll_votes where option_id = p_option_id and user_id = auth.uid();
  elsif p_vote not in ('yes', 'maybe', 'no') then
    raise exception 'Vote must be yes, maybe or no.';
  else
    insert into public.poll_votes (option_id, user_id, vote)
    values (p_option_id, auth.uid(), p_vote)
    on conflict (option_id, user_id)
    do update set vote = excluded.vote, updated_at = now();
  end if;
end;
$$;

-- Totals per time: what ordinary members see (names are for hosts only).
create function public.poll_results(p_poll_id bigint)
returns table (option_id bigint, starts_at timestamptz, yes_count int, maybe_count int, no_count int)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.starts_at,
         (count(*) filter (where v.vote = 'yes'))::int,
         (count(*) filter (where v.vote = 'maybe'))::int,
         (count(*) filter (where v.vote = 'no'))::int
  from public.poll_options o
  join public.meeting_polls p on p.id = o.poll_id
  left join public.poll_votes v on v.option_id = o.id
  where o.poll_id = p_poll_id
    and (public.is_admin() or public.is_club_member(p.club_id))
  group by o.id, o.starts_at
  order by o.starts_at;
$$;

-- Picking the winner: creates the meeting and closes the poll in one step.
create function public.finalize_meeting_poll(p_poll_id bigint, p_option_id bigint)
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
    raise exception 'Only a host of this club can choose the time.';
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

revoke execute on function
  public.create_meeting_poll(bigint, text, text, text, uuid, timestamptz[]),
  public.cast_poll_vote(bigint, text),
  public.poll_results(bigint),
  public.finalize_meeting_poll(bigint, bigint)
  from public, anon;
grant execute on function
  public.create_meeting_poll(bigint, text, text, text, uuid, timestamptz[]),
  public.cast_poll_vote(bigint, text),
  public.poll_results(bigint),
  public.finalize_meeting_poll(bigint, bigint)
  to authenticated;
