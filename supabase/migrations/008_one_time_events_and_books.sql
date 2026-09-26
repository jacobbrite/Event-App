-- One-time events (distinct from clubs) and the book of the month.
-- Run BEFORE deploying the matching app code. One transaction: all or nothing.
--
-- 1. One-time events. Rather than a second access system, a one-time event lives
--    in a hidden club of type 'one_time' (its "guests" are that club's members and
--    it reuses the join link + all the RLS already verified for clubs). The app
--    lists these as events, never as clubs.
-- 2. Books: a shared table of book metadata (from Open Library) and events.book_id.

-- 1. One-time events -----------------------------------------------------------
alter table public.clubs drop constraint clubs_type_check;
alter table public.clubs add constraint clubs_type_check
  check (type in ('book_club', 'dinner_party', 'custom', 'one_time'));

-- Admins may create every type. Everyone else only what's in profiles.allowed_types
-- (beta hosts default to '{book_club}', so one-time events stay "coming soon" for
-- them until you add 'one_time' to their list).
create or replace function public.allowed_club_types()
returns text[] language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when is_admin
                 then array['book_club', 'dinner_party', 'custom', 'one_time']
                 else allowed_types end
     from public.profiles where id = auth.uid()),
    '{}'::text[]);
$$;

-- Existing one-off clubs (converted from old single events by 006, still 'custom')
-- become one-time events. Clubs you've already relabelled are left alone.
update public.clubs c
set type = 'one_time'
where c.type = 'custom'
  and (select count(*) from public.events e where e.club_id = c.id) <= 1;

-- Creating a club and its event must succeed or fail together (otherwise a failed
-- second step leaves an orphaned hidden club), so it's one function. It repeats
-- the permission checks the clubs INSERT policy would make.
create function public.create_one_time_event(
  p_title text, p_event_time timestamptz, p_location text, p_description text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_club  bigint;
  v_event bigint;
begin
  if not public.can_host() or not ('one_time' = any (public.allowed_club_types())) then
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

revoke execute on function public.create_one_time_event(text, timestamptz, text, text)
  from public, anon;
grant  execute on function public.create_one_time_event(text, timestamptz, text, text)
  to authenticated;

-- 2. Books ---------------------------------------------------------------------
-- Shared, non-sensitive metadata, so any signed-in user can read it. Nobody
-- writes it directly: upsert_book() validates input first.
create table public.books (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  ol_key             text unique,   -- Open Library work id, e.g. /works/OL20965973W
  title              text not null,
  author             text,
  first_publish_year int,
  page_count         int,
  isbn               text,
  cover_url          text
);

alter table public.books enable row level security;

create policy "Signed-in users can read books"
  on public.books for select to authenticated
  using (true);

revoke all on public.books from anon;
revoke insert, update, delete on public.books from authenticated;

-- Adds a book (or returns the existing one with the same Open Library key).
-- Validation stops a client storing arbitrary links or huge strings: covers must
-- come from Open Library, keys/ISBNs must look like keys/ISBNs. Existing rows are
-- never overwritten, so one user can't change how a book shows up for everyone.
create function public.upsert_book(
  p_ol_key text, p_title text, p_author text, p_year int,
  p_pages int, p_isbn text, p_cover_url text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 300 then
    raise exception 'A book needs a title (300 characters at most).';
  end if;
  if p_author is not null and char_length(p_author) > 300 then
    raise exception 'That author name is too long.';
  end if;
  if p_ol_key is not null and p_ol_key !~ '^/works/OL[0-9]+W$' then
    raise exception 'That is not a valid Open Library key.';
  end if;
  if p_isbn is not null and p_isbn !~ '^[0-9]{9}[0-9X]$|^[0-9]{13}$' then
    raise exception 'That is not a valid ISBN.';
  end if;
  if p_cover_url is not null and p_cover_url !~ '^https://covers\.openlibrary\.org/' then
    raise exception 'Covers must come from Open Library.';
  end if;
  if p_year is not null and p_year not between 0 and 3000 then
    raise exception 'That publication year does not look right.';
  end if;
  if p_pages is not null and p_pages not between 1 and 10000 then
    raise exception 'That page count does not look right.';
  end if;

  if p_ol_key is not null then
    insert into public.books (ol_key, title, author, first_publish_year, page_count, isbn, cover_url)
    values (p_ol_key, trim(p_title), p_author, p_year, p_pages, p_isbn, p_cover_url)
    on conflict (ol_key) do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id from public.books where ol_key = p_ol_key;
    end if;
  else
    insert into public.books (title, author, first_publish_year, page_count, isbn, cover_url)
    values (trim(p_title), p_author, p_year, p_pages, p_isbn, p_cover_url)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.upsert_book(text, text, text, int, int, text, text)
  from public, anon;
grant  execute on function public.upsert_book(text, text, text, int, int, text, text)
  to authenticated;

-- The book of the month for a meeting.
alter table public.events add column book_id bigint references public.books (id);

-- First UPDATE policy on events. The column grant limits it to book_id only, so
-- an owner can't move an event to another club or change who it belongs to.
create policy "Club owners and admins can set the book"
  on public.events for update to authenticated
  using (public.is_admin() or public.is_club_owner(club_id))
  with check (public.is_admin() or public.is_club_owner(club_id));

revoke update on public.events from anon, authenticated;
grant  update (book_id) on public.events to authenticated;
