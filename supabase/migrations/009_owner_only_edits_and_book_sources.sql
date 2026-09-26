-- 1. Only a club's owner can change it (admins can look, not touch).
-- 2. Books can come from Google Books as well as Open Library.
-- Run BEFORE deploying the matching app code. One transaction: all or nothing.

-- 1. Owner-only writes ---------------------------------------------------------------
-- Admins keep READ access everywhere (clubs, events, members, RSVPs, member
-- emails) for support and oversight, but can no longer create meetings in,
-- edit, or manage someone else's club. Being an admin is not the same as being
-- the host. (Admins can still create their own clubs and events, and then they
-- ARE the owner of those.)
drop policy "Club owners and admins can create events" on public.events;
create policy "Club owners can create events"
  on public.events for insert to authenticated
  with check (public.can_host() and public.is_club_owner(club_id));

drop policy "Club owners and admins can set the book" on public.events;
create policy "Club owners can set the book"
  on public.events for update to authenticated
  using (public.is_club_owner(club_id))
  with check (public.is_club_owner(club_id));

drop policy "Owners can rename their clubs" on public.clubs;
create policy "Owners can rename their clubs"
  on public.clubs for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- The join link is a way to add people, so it's the owner's alone.
drop policy "Owners and admins can read the join code" on public.club_invite_links;
create policy "Owners can read the join code"
  on public.club_invite_links for select to authenticated
  using (public.is_club_owner(club_id));

drop policy "Owners and admins can reset the join code" on public.club_invite_links;
create policy "Owners can reset the join code"
  on public.club_invite_links for update to authenticated
  using (public.is_club_owner(club_id))
  with check (public.is_club_owner(club_id));

-- 2. Book sources -----------------------------------------------------------------------
-- Open Library was too slow and unreliable for search-as-you-type, so books can now
-- come from Google Books too. A book is identified by (source, source_id).
alter table public.books add column source    text;
alter table public.books add column source_id text;

update public.books
set source = 'openlibrary', source_id = ol_key
where ol_key is not null;

alter table public.books drop column ol_key;

create unique index books_source_key
  on public.books (source, source_id)
  where source_id is not null;

drop function public.upsert_book(text, text, text, int, int, text, text);

create function public.upsert_book(
  p_source text, p_source_id text, p_title text, p_author text,
  p_year int, p_pages int, p_isbn text, p_cover_url text
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

  -- A source and its id go together; books added by hand have neither.
  if (p_source is null) <> (p_source_id is null) then
    raise exception 'Book source and id must be given together.';
  end if;
  if p_source is not null and p_source not in ('google', 'openlibrary') then
    raise exception 'Unknown book source.';
  end if;
  if p_source = 'google' and p_source_id !~ '^[A-Za-z0-9_-]{5,32}$' then
    raise exception 'That is not a valid Google Books id.';
  end if;
  if p_source = 'openlibrary' and p_source_id !~ '^/works/OL[0-9]+W$' then
    raise exception 'That is not a valid Open Library key.';
  end if;

  if p_isbn is not null and p_isbn !~ '^[0-9]{9}[0-9X]$|^[0-9]{13}$' then
    raise exception 'That is not a valid ISBN.';
  end if;
  -- Covers may only come from these two places, so a client can't store links to
  -- arbitrary servers that every member's browser would then load.
  if p_cover_url is not null
     and p_cover_url !~ '^https://(covers\.openlibrary\.org|books\.google\.com)/' then
    raise exception 'Covers must come from Google Books or Open Library.';
  end if;
  if p_year is not null and p_year not between 0 and 3000 then
    raise exception 'That publication year does not look right.';
  end if;
  if p_pages is not null and p_pages not between 1 and 10000 then
    raise exception 'That page count does not look right.';
  end if;

  if p_source is not null then
    -- Existing rows are never overwritten, so one user can't change how a book
    -- looks for everybody.
    insert into public.books
      (source, source_id, title, author, first_publish_year, page_count, isbn, cover_url)
    values
      (p_source, p_source_id, trim(p_title), p_author, p_year, p_pages, p_isbn, p_cover_url)
    on conflict (source, source_id) where source_id is not null do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id from public.books
      where source = p_source and source_id = p_source_id;
    end if;
  else
    insert into public.books (title, author, first_publish_year, page_count, isbn, cover_url)
    values (trim(p_title), p_author, p_year, p_pages, p_isbn, p_cover_url)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.upsert_book(text, text, text, text, int, int, text, text)
  from public, anon;
grant  execute on function public.upsert_book(text, text, text, text, int, int, text, text)
  to authenticated;
