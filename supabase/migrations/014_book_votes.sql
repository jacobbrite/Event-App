-- Book votes: members suggest books (up to a limit set by the owner), everyone
-- approves the ones they'd be happy to read, the owner closes the vote and picks
-- the winner (optionally attaching it to a meeting as its book of the month).
-- Secret ballot: approvals are private, and totals stay hidden from members until
-- the vote is closed. Only functions write to these tables.
-- Run BEFORE deploying the matching app code. One transaction: all or nothing.

-- Tables --------------------------------------------------------------------------------
create table public.book_rounds (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  club_id         bigint not null references public.clubs (id) on delete cascade,
  created_by      uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  title           text   not null check (char_length(trim(title)) between 1 and 120),
  max_per_member  int    not null default 2 check (max_per_member between 1 and 5),
  -- Only 'approval' for now; 'bracket' is planned and slots in here.
  method          text   not null default 'approval' check (method in ('approval')),
  status          text   not null default 'suggesting'
                  check (status in ('suggesting', 'voting', 'closed')),
  winner_book_id  bigint references public.books (id),
  event_id        bigint references public.events (id) on delete set null
);

-- One vote at a time per club, so nobody is ever unsure which one they're in.
create unique index book_rounds_one_active
  on public.book_rounds (club_id) where status <> 'closed';

create table public.round_books (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  round_id     bigint not null references public.book_rounds (id) on delete cascade,
  book_id      bigint not null references public.books (id),
  suggested_by uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  unique (round_id, book_id)
);

-- A row means "this member approves of this book". No row, no approval.
create table public.round_votes (
  round_book_id bigint not null references public.round_books (id) on delete cascade,
  user_id       uuid   not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (round_book_id, user_id)
);

alter table public.book_rounds enable row level security;
alter table public.round_books enable row level security;
alter table public.round_votes enable row level security;

-- Reading ---------------------------------------------------------------------------------
create policy "Members and admins can read book votes"
  on public.book_rounds for select to authenticated
  using (public.is_admin() or public.is_club_member(club_id));

-- If you can see the round you can see the books suggested in it.
create policy "Members can read suggested books"
  on public.round_books for select to authenticated
  using (exists (select 1 from public.book_rounds r where r.id = round_books.round_id));

-- Secret ballot: you can only ever read YOUR OWN approvals, whoever you are.
-- Totals come from round_tally(), which withholds them until the vote closes.
create policy "Read only your own approvals"
  on public.round_votes for select to authenticated
  using (user_id = auth.uid());

create policy "Owners can delete book votes"
  on public.book_rounds for delete to authenticated
  using (public.is_club_owner(club_id));

revoke all on public.book_rounds, public.round_books, public.round_votes from anon;
revoke insert, update on public.book_rounds from authenticated;
revoke insert, update, delete on public.round_books, public.round_votes from authenticated;

-- Starting a vote ------------------------------------------------------------------------------
create function public.create_book_round(
  p_club_id bigint, p_title text, p_max_per_member int
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
  if exists (select 1 from public.book_rounds where club_id = p_club_id and status <> 'closed') then
    raise exception 'There is already a book vote in progress. Finish or delete it first.';
  end if;

  insert into public.book_rounds (club_id, title, max_per_member)
  values (p_club_id, trim(p_title), p_max_per_member)
  returning id into v_id;
  return v_id;
end;
$$;

-- Suggesting a book -----------------------------------------------------------------------------
-- Adds the book to the shared books table (same validation as upsert_book) and
-- suggests it, in one step.
create function public.suggest_book(
  p_round_id bigint,
  p_source text, p_source_id text, p_title text, p_author text,
  p_year int, p_pages int, p_isbn text, p_cover_url text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  r      public.book_rounds%rowtype;
  v_book bigint;
  v_id   bigint;
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then
    raise exception 'That book vote does not exist.';
  end if;
  if not public.is_club_member(r.club_id) then
    raise exception 'Only members of this club can suggest books.';
  end if;
  if r.status <> 'suggesting' then
    raise exception 'Suggestions are closed for this vote.';
  end if;
  if (select count(*) from public.round_books
      where round_id = p_round_id and suggested_by = auth.uid()) >= r.max_per_member then
    raise exception 'You have used all % of your suggestions. Remove one to suggest another.', r.max_per_member;
  end if;

  v_book := public.upsert_book(p_source, p_source_id, p_title, p_author, p_year, p_pages, p_isbn, p_cover_url);

  if exists (select 1 from public.round_books where round_id = p_round_id and book_id = v_book) then
    raise exception 'That book has already been suggested. You can approve it once voting starts.';
  end if;

  insert into public.round_books (round_id, book_id) values (p_round_id, v_book)
  returning id into v_id;
  return v_id;
end;
$$;

-- Members can take back their own suggestion while suggestions are open; an owner
-- can remove any suggestion until the vote is closed.
create function public.remove_suggestion(p_round_book_id bigint)
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

  if r.status = 'closed' then
    raise exception 'This vote is already closed.';
  end if;
  if not public.is_club_owner(r.club_id)
     and not (rb.suggested_by = auth.uid() and r.status = 'suggesting') then
    raise exception 'You can only remove your own suggestion, before voting starts.';
  end if;

  delete from public.round_books where id = p_round_book_id;
end;
$$;

create function public.start_book_voting(p_round_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.book_rounds%rowtype;
begin
  select * into r from public.book_rounds where id = p_round_id;
  if not found then raise exception 'That book vote does not exist.'; end if;
  if not public.is_club_owner(r.club_id) then
    raise exception 'Only an owner of this club can start the voting.';
  end if;
  if r.status <> 'suggesting' then
    raise exception 'Voting has already started.';
  end if;
  if (select count(*) from public.round_books where round_id = p_round_id) < 2 then
    raise exception 'At least two books are needed before voting can start.';
  end if;

  update public.book_rounds set status = 'voting' where id = p_round_id;
end;
$$;

-- Approving a book (or taking the approval back) ---------------------------------------------------
create function public.set_book_approval(p_round_book_id bigint, p_approve boolean)
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

-- Totals: withheld (null) from everyone but the club's owners until the vote closes.
create function public.round_tally(p_round_id bigint)
returns table (round_book_id bigint, approvals int)
language sql stable security definer set search_path = ''
as $$
  select rb.id,
         case when public.is_club_owner(r.club_id) or r.status = 'closed'
              then (select count(*)::int from public.round_votes v where v.round_book_id = rb.id)
         end
  from public.round_books rb
  join public.book_rounds r on r.id = rb.round_id
  where rb.round_id = p_round_id
    and (public.is_admin() or public.is_club_member(r.club_id))
  order by rb.id;
$$;

-- "5 of 8 members have voted": how many have voted at all, never for what.
create function public.round_participation(p_round_id bigint)
returns table (voters int, members int)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(distinct v.user_id)::int
     from public.round_votes v
     join public.round_books rb on rb.id = v.round_book_id
     where rb.round_id = p_round_id),
    (select count(*)::int from public.club_members m where m.club_id = r.club_id)
  from public.book_rounds r
  where r.id = p_round_id
    and (public.is_admin() or public.is_club_member(r.club_id));
$$;

-- Closing the vote --------------------------------------------------------------------------------
-- The owner names the winner (the app preselects the top book; ties are their
-- call) and may attach it to a meeting as its book of the month.
create function public.close_book_round(
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

revoke execute on function
  public.create_book_round(bigint, text, int),
  public.suggest_book(bigint, text, text, text, text, int, int, text, text),
  public.remove_suggestion(bigint),
  public.start_book_voting(bigint),
  public.set_book_approval(bigint, boolean),
  public.round_tally(bigint),
  public.round_participation(bigint),
  public.close_book_round(bigint, bigint, bigint)
  from public, anon;
grant execute on function
  public.create_book_round(bigint, text, int),
  public.suggest_book(bigint, text, text, text, text, int, int, text, text),
  public.remove_suggestion(bigint),
  public.start_book_voting(bigint),
  public.set_book_approval(bigint, boolean),
  public.round_tally(bigint),
  public.round_participation(bigint),
  public.close_book_round(bigint, bigint, bigint)
  to authenticated;
