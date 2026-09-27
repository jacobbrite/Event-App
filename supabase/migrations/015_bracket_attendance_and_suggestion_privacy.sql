-- Book votes, part 2:
--   * suggestions are private until you've made one yourself, and only their author
--     can remove one (not even an owner can)
--   * "who's here": owners mark members as not present; they can't vote and their
--     votes are ignored, so an in-person vote never waits on people who aren't there
--   * bracket voting: head-to-head rounds until one book is left
-- Run BEFORE deploying the matching app code. One transaction: all or nothing.

-- 1. Bracket support on rounds -------------------------------------------------------------
alter table public.book_rounds drop constraint book_rounds_method_check;
alter table public.book_rounds
  add constraint book_rounds_method_check check (method in ('approval', 'bracket'));
alter table public.book_rounds add column bracket_stage int not null default 0;

create table public.round_absent (
  round_id bigint not null references public.book_rounds (id) on delete cascade,
  user_id  uuid   not null references public.profiles (id) on delete cascade,
  primary key (round_id, user_id)
);

-- One row per head-to-head. book_b is null for a "bye" (an odd book out advances
-- without a match), which is stored already won.
create table public.bracket_matches (
  id       bigint generated always as identity primary key,
  round_id bigint not null references public.book_rounds (id) on delete cascade,
  stage    int    not null,
  slot     int    not null,
  book_a   bigint not null references public.round_books (id) on delete cascade,
  book_b   bigint references public.round_books (id) on delete cascade,
  winner   bigint references public.round_books (id) on delete cascade,
  unique (round_id, stage, slot)
);

create table public.bracket_votes (
  match_id bigint not null references public.bracket_matches (id) on delete cascade,
  user_id  uuid   not null references public.profiles (id) on delete cascade,
  choice   bigint not null references public.round_books (id) on delete cascade,
  primary key (match_id, user_id)
);

alter table public.round_absent    enable row level security;
alter table public.bracket_matches enable row level security;
alter table public.bracket_votes   enable row level security;

-- 2. Helpers for policies --------------------------------------------------------------------
-- security definer so a policy on round_books can ask questions about round_books
-- without recursing through its own policy.
create function public.has_suggested(p_round_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.round_books
    where round_id = p_round_id and suggested_by = auth.uid());
$$;

create function public.round_status(p_round_id bigint)
returns text language sql stable security definer set search_path = ''
as $$ select status from public.book_rounds where id = p_round_id; $$;

revoke execute on function public.has_suggested(bigint), public.round_status(bigint)
  from public, anon;
grant  execute on function public.has_suggested(bigint), public.round_status(bigint)
  to authenticated;

-- 3. Suggestions are private until you've made your own ------------------------------------------
-- While suggestions are open you see only your own books, until you have suggested
-- at least one; then you see everyone's. Once voting starts everyone sees all of
-- them (they have to, to vote). No exceptions for owners or admins.
drop policy "Members can read suggested books" on public.round_books;
create policy "Members can read suggested books"
  on public.round_books for select to authenticated
  using (
    exists (select 1 from public.book_rounds r where r.id = round_books.round_id)
    and (
      round_books.suggested_by = auth.uid()
      or public.round_status(round_books.round_id) <> 'suggesting'
      or public.has_suggested(round_books.round_id)
    )
  );

-- Only the person who suggested a book can take it back, and only while
-- suggestions are open. Owners can no longer remove other people's suggestions
-- (they can still delete the whole vote).
create or replace function public.remove_suggestion(p_round_book_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rb public.round_books%rowtype;
  r  public.book_rounds%rowtype;
begin
  select * into rb from public.round_books where id = p_round_book_id;
  if not found then
    raise exception 'That suggestion does not exist.';
  end if;
  select * into r from public.book_rounds where id = rb.round_id;

  if r.status <> 'suggesting' then
    raise exception 'Suggestions are closed for this vote.';
  end if;
  if rb.suggested_by <> auth.uid() then
    raise exception 'You can only remove your own suggestion.';
  end if;

  delete from public.round_books where id = p_round_book_id;
end;
$$;

-- 4. Policies for the new tables ----------------------------------------------------------------------
-- You can see whether YOU were marked absent; owners can see everyone's.
create policy "Read own attendance; owners read all"
  on public.round_absent for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.book_rounds r
      where r.id = round_absent.round_id and public.is_club_owner(r.club_id)
    )
  );

create policy "Members can read bracket matches"
  on public.bracket_matches for select to authenticated
  using (exists (select 1 from public.book_rounds r where r.id = bracket_matches.round_id));

-- Secret ballot: only ever your own picks.
create policy "Read only your own bracket votes"
  on public.bracket_votes for select to authenticated
  using (user_id = auth.uid());

revoke all on public.round_absent, public.bracket_matches, public.bracket_votes from anon;
revoke insert, update, delete on
  public.round_absent, public.bracket_matches, public.bracket_votes from authenticated;

-- 5. Choosing the method when a vote is created ----------------------------------------------------------
drop function public.create_book_round(bigint, text, int);

create function public.create_book_round(
  p_club_id bigint, p_title text, p_max_per_member int, p_method text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.is_club_owner(p_club_id) then
    raise exception 'Only an owner of this club can start a book vote.';
  end if;
  if (select type from public.clubs where id = p_club_id) <> 'book_club' then
    raise exception 'Book votes are for book clubs.';
  end if;
  if p_title is null or trim(p_title) = '' then
    raise exception 'Give the vote a title.';
  end if;
  if p_method not in ('approval', 'bracket') then
    raise exception 'Unknown voting method.';
  end if;
  if exists (select 1 from public.book_rounds where club_id = p_club_id and status <> 'closed') then
    raise exception 'There is already a book vote in progress. Finish or delete it first.';
  end if;

  insert into public.book_rounds (club_id, title, max_per_member, method)
  values (p_club_id, trim(p_title), p_max_per_member, p_method)
  returning id into v_id;
  return v_id;
end;
$$;

-- 6. Who's here ------------------------------------------------------------------------------------------------
create function public.set_round_attendance(
  p_round_id bigint, p_user_ids uuid[], p_present boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.book_rounds%rowtype;
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then raise exception 'That book vote does not exist.'; end if;
  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can say who is here.';
  end if;
  if r.status = 'closed' then
    raise exception 'This vote is already closed.';
  end if;

  if p_present then
    delete from public.round_absent
    where round_id = p_round_id and user_id = any (p_user_ids);
  else
    insert into public.round_absent (round_id, user_id)
    select p_round_id, u
    from unnest(p_user_ids) as u
    where exists (select 1 from public.club_members m where m.club_id = r.club_id and m.user_id = u)
    on conflict do nothing;
  end if;
end;
$$;

-- Absent members can't approve books. (Approvals they made earlier stay stored but
-- are ignored by the tally, so marking someone present again restores them.)
create or replace function public.set_book_approval(p_round_book_id bigint, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rb public.round_books%rowtype;
  r  public.book_rounds%rowtype;
begin
  select * into rb from public.round_books where id = p_round_book_id;
  if not found then raise exception 'That book is not in the vote.'; end if;
  select * into r from public.book_rounds where id = rb.round_id;

  if not public.is_club_member(r.club_id) then
    raise exception 'Only members of this club can vote.';
  end if;
  if r.status <> 'voting' then
    raise exception 'Voting is not open.';
  end if;
  if r.method <> 'approval' then
    raise exception 'This vote is a bracket, so you vote on matches.';
  end if;
  if exists (select 1 from public.round_absent where round_id = r.id and user_id = auth.uid()) then
    raise exception 'You are marked as not here for this vote, so you can''t vote.';
  end if;

  if p_approve then
    insert into public.round_votes (round_book_id, user_id)
    values (p_round_book_id, auth.uid())
    on conflict do nothing;
  else
    delete from public.round_votes
    where round_book_id = p_round_book_id and user_id = auth.uid();
  end if;
end;
$$;

-- Totals and participation now ignore anyone marked as not here.
create or replace function public.round_tally(p_round_id bigint)
returns table (round_book_id bigint, approvals int)
language sql stable security definer set search_path = ''
as $$
  select rb.id,
         case when public.is_club_owner(r.club_id) or r.status = 'closed'
              then (select count(*)::int from public.round_votes v
                    where v.round_book_id = rb.id
                      and not exists (select 1 from public.round_absent a
                                      where a.round_id = rb.round_id and a.user_id = v.user_id))
         end
  from public.round_books rb
  join public.book_rounds r on r.id = rb.round_id
  where rb.round_id = p_round_id
    and (public.is_admin() or public.is_club_member(r.club_id))
  order by rb.id;
$$;

-- suggestions / suggesters: how much has been suggested, without showing what
-- (people can't see each other's books until they've suggested their own).
drop function public.round_participation(bigint);

create function public.round_participation(p_round_id bigint)
returns table (voters int, eligible int, suggestions int, suggesters int, members int)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(distinct v.user_id)::int
       from public.round_votes v
       join public.round_books rb on rb.id = v.round_book_id
       where rb.round_id = p_round_id
         and not exists (select 1 from public.round_absent a
                         where a.round_id = p_round_id and a.user_id = v.user_id)),
    (select count(*)::int from public.club_members m
       where m.club_id = r.club_id
         and not exists (select 1 from public.round_absent a
                         where a.round_id = p_round_id and a.user_id = m.user_id)),
    (select count(*)::int from public.round_books where round_id = p_round_id),
    (select count(distinct suggested_by)::int from public.round_books where round_id = p_round_id),
    (select count(*)::int from public.club_members m where m.club_id = r.club_id)
  from public.book_rounds r
  where r.id = p_round_id
    and (public.is_admin() or public.is_club_member(r.club_id));
$$;

-- 7. Bracket ---------------------------------------------------------------------------------------------------------
-- Pairs the given books (in order) into matches for one stage; an odd one out gets
-- a bye. Internal: only the functions below call it.
create function public.build_bracket_stage(p_round_id bigint, p_stage int, p_ids bigint[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  i int := 1;
  s int := 1;
  n int := coalesce(array_length(p_ids, 1), 0);
begin
  while i <= n loop
    if i < n then
      insert into public.bracket_matches (round_id, stage, slot, book_a, book_b)
      values (p_round_id, p_stage, s, p_ids[i], p_ids[i + 1]);
    else
      insert into public.bracket_matches (round_id, stage, slot, book_a, book_b, winner)
      values (p_round_id, p_stage, s, p_ids[i], null, p_ids[i]);
    end if;
    i := i + 2;
    s := s + 1;
  end loop;
end;
$$;

-- Votes for each side of one match. Only counts people who are here. Internal.
create function public.bracket_counts(p_match_id bigint)
returns table (a_votes int, b_votes int)
language sql stable security definer set search_path = ''
as $$
  select (count(*) filter (where v.choice = m.book_a))::int,
         (count(*) filter (where v.choice = m.book_b))::int
  from public.bracket_matches m
  left join public.bracket_votes v
    on v.match_id = m.id
   and not exists (select 1 from public.round_absent a
                   where a.round_id = m.round_id and a.user_id = v.user_id)
  where m.id = p_match_id;
$$;

revoke execute on function
  public.build_bracket_stage(bigint, int, bigint[]),
  public.bracket_counts(bigint)
  from public, anon, authenticated;

-- Starting the voting: for a bracket this shuffles the books and draws stage 1.
create or replace function public.start_book_voting(p_round_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r     public.book_rounds%rowtype;
  v_ids bigint[];
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then raise exception 'That book vote does not exist.'; end if;
  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can start the voting.';
  end if;
  if r.status <> 'suggesting' then
    raise exception 'Voting has already started.';
  end if;

  v_ids := array(select id from public.round_books where round_id = p_round_id order by random());
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'At least two books are needed before voting can start.';
  end if;

  if r.method = 'bracket' then
    perform public.build_bracket_stage(p_round_id, 1, v_ids);
    update public.book_rounds set status = 'voting', bracket_stage = 1 where id = p_round_id;
  else
    update public.book_rounds set status = 'voting' where id = p_round_id;
  end if;
end;
$$;

create function public.cast_bracket_vote(p_match_id bigint, p_choice bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.bracket_matches%rowtype;
  r public.book_rounds%rowtype;
begin
  select * into m from public.bracket_matches where id = p_match_id;
  if not found then raise exception 'That match does not exist.'; end if;
  select * into r from public.book_rounds where id = m.round_id;

  if not public.is_club_member(r.club_id) then
    raise exception 'Only members of this club can vote.';
  end if;
  if r.status <> 'voting' or m.stage <> r.bracket_stage then
    raise exception 'This match is not open for voting.';
  end if;
  if m.book_b is null or m.winner is not null then
    raise exception 'This match has already been decided.';
  end if;
  if exists (select 1 from public.round_absent where round_id = r.id and user_id = auth.uid()) then
    raise exception 'You are marked as not here for this vote, so you can''t vote.';
  end if;

  if p_choice is null then
    delete from public.bracket_votes where match_id = p_match_id and user_id = auth.uid();
  elsif p_choice not in (m.book_a, m.book_b) then
    raise exception 'That book is not in this match.';
  else
    insert into public.bracket_votes (match_id, user_id, choice)
    values (p_match_id, auth.uid(), p_choice)
    on conflict (match_id, user_id) do update set choice = excluded.choice;
  end if;
end;
$$;

-- Every match with its result. Counts are withheld (null) from members until a
-- match has a winner; owners see them live.
create function public.bracket_results(p_round_id bigint)
returns table (
  match_id bigint, stage int, slot int, book_a bigint, book_b bigint,
  winner bigint, a_votes int, b_votes int
)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.stage, m.slot, m.book_a, m.book_b, m.winner,
         case when public.is_club_owner(r.club_id) or m.winner is not null then c.a_votes end,
         case when public.is_club_owner(r.club_id) or m.winner is not null then c.b_votes end
  from public.bracket_matches m
  join public.book_rounds r on r.id = m.round_id
  cross join lateral public.bracket_counts(m.id) c
  where m.round_id = p_round_id
    and (public.is_admin() or public.is_club_member(r.club_id))
  order by m.stage, m.slot;
$$;

-- "3 of 5 here have finished voting this round".
create function public.bracket_progress(p_round_id bigint)
returns table (finished int, eligible int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r      public.book_rounds%rowtype;
  v_need int;
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then return; end if;
  if not (public.is_admin() or public.is_club_member(r.club_id)) then return; end if;

  select count(*) into v_need
  from public.bracket_matches
  where round_id = p_round_id and stage = r.bracket_stage and book_b is not null;

  return query
  select
    (select count(*)::int
       from public.club_members cm
       where cm.club_id = r.club_id
         and not exists (select 1 from public.round_absent a
                         where a.round_id = p_round_id and a.user_id = cm.user_id)
         and v_need > 0
         and (select count(*) from public.bracket_votes bv
              join public.bracket_matches bm on bm.id = bv.match_id
              where bm.round_id = p_round_id and bm.stage = r.bracket_stage
                and bv.user_id = cm.user_id) >= v_need),
    (select count(*)::int
       from public.club_members cm
       where cm.club_id = r.club_id
         and not exists (select 1 from public.round_absent a
                         where a.round_id = p_round_id and a.user_id = cm.user_id));
end;
$$;

-- A tied match is the owner's call.
create function public.resolve_bracket_tie(p_match_id bigint, p_winner bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.bracket_matches%rowtype;
  r public.book_rounds%rowtype;
  v_a int;
  v_b int;
begin
  select * into m from public.bracket_matches where id = p_match_id;
  if not found then raise exception 'That match does not exist.'; end if;
  select * into r from public.book_rounds where id = m.round_id;

  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can break a tie.';
  end if;
  if r.status <> 'voting' or m.stage <> r.bracket_stage or m.book_b is null or m.winner is not null then
    raise exception 'This match is not waiting for a result.';
  end if;

  select a_votes, b_votes into v_a, v_b from public.bracket_counts(p_match_id);
  if v_a <> v_b then
    raise exception 'This match is not tied.';
  end if;
  if p_winner not in (m.book_a, m.book_b) then
    raise exception 'That book is not in this match.';
  end if;

  update public.bracket_matches set winner = p_winner where id = p_match_id;
end;
$$;

-- Ends the current bracket round: decides every match by its votes (a tie must have
-- been broken first), then either draws the next round or, when one book is left,
-- closes the vote with that book as the winner.
create function public.advance_bracket_round(p_round_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r         public.book_rounds%rowtype;
  m         record;
  v_a       int;
  v_b       int;
  v_winners bigint[];
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then raise exception 'That book vote does not exist.'; end if;
  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can advance the bracket.';
  end if;
  if r.status <> 'voting' or r.method <> 'bracket' then
    raise exception 'This is not a bracket vote in progress.';
  end if;

  -- If any match is tied this raises and nothing is changed.
  for m in
    select * from public.bracket_matches
    where round_id = p_round_id and stage = r.bracket_stage order by slot
  loop
    if m.winner is null then
      select a_votes, b_votes into v_a, v_b from public.bracket_counts(m.id);
      if v_a = v_b then
        raise exception 'Match % is tied. Pick a winner for it first.', m.slot;
      end if;
      update public.bracket_matches
      set winner = case when v_a > v_b then m.book_a else m.book_b end
      where id = m.id;
    end if;
  end loop;

  select array_agg(winner order by slot) into v_winners
  from public.bracket_matches
  where round_id = p_round_id and stage = r.bracket_stage;

  if array_length(v_winners, 1) = 1 then
    update public.book_rounds
    set status = 'closed',
        winner_book_id = (select book_id from public.round_books where id = v_winners[1])
    where id = p_round_id;
  else
    perform public.build_bracket_stage(p_round_id, r.bracket_stage + 1, v_winners);
    update public.book_rounds set bracket_stage = r.bracket_stage + 1 where id = p_round_id;
  end if;
end;
$$;

-- 8. Closing / attaching the winner ------------------------------------------------------------------------------------
-- An approval vote is closed by the owner naming the winner (as before). A bracket
-- closes itself when its final is decided.
create or replace function public.close_book_round(
  p_round_id bigint, p_round_book_id bigint, p_event_id bigint
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r      public.book_rounds%rowtype;
  v_book bigint;
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then raise exception 'That book vote does not exist.'; end if;
  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can close the vote.';
  end if;
  if r.status <> 'voting' then
    raise exception 'Only a vote that is in the voting stage can be closed.';
  end if;
  if r.method <> 'approval' then
    raise exception 'A bracket finishes when its final round is decided.';
  end if;

  select book_id into v_book
  from public.round_books where id = p_round_book_id and round_id = p_round_id;
  if v_book is null then
    raise exception 'That book is not one of the suggestions.';
  end if;

  if p_event_id is not null then
    if not exists (select 1 from public.events where id = p_event_id and club_id = r.club_id) then
      raise exception 'That meeting is not in this club.';
    end if;
    update public.events set book_id = v_book where id = p_event_id;
  end if;

  update public.book_rounds
  set status = 'closed', winner_book_id = v_book, event_id = p_event_id
  where id = p_round_id;
end;
$$;

-- Once a vote (either kind) has a winner, an owner can set it as a meeting's book.
create function public.attach_round_winner(p_round_id bigint, p_event_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.book_rounds%rowtype;
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then raise exception 'That book vote does not exist.'; end if;
  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can do that.';
  end if;
  if r.status <> 'closed' or r.winner_book_id is null then
    raise exception 'This vote has no winner yet.';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and club_id = r.club_id) then
    raise exception 'That meeting is not in this club.';
  end if;

  update public.events set book_id = r.winner_book_id where id = p_event_id;
  update public.book_rounds set event_id = p_event_id where id = p_round_id;
end;
$$;

-- 9. Grants ------------------------------------------------------------------------------------------------------------------
revoke execute on function
  public.create_book_round(bigint, text, int, text),
  public.set_round_attendance(bigint, uuid[], boolean),
  public.round_participation(bigint),
  public.cast_bracket_vote(bigint, bigint),
  public.bracket_results(bigint),
  public.bracket_progress(bigint),
  public.resolve_bracket_tie(bigint, bigint),
  public.advance_bracket_round(bigint),
  public.attach_round_winner(bigint, bigint)
  from public, anon;
grant execute on function
  public.create_book_round(bigint, text, int, text),
  public.set_round_attendance(bigint, uuid[], boolean),
  public.round_participation(bigint),
  public.cast_bracket_vote(bigint, bigint),
  public.bracket_results(bigint),
  public.bracket_progress(bigint),
  public.resolve_bracket_tie(bigint, bigint),
  public.advance_bracket_round(bigint),
  public.attach_round_winner(bigint, bigint)
  to authenticated;
