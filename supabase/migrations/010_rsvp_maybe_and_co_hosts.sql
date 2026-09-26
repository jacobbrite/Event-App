-- 1. RSVP answers: going / maybe / not_going (was going / cancelled).
-- 2. Co-hosts: a club can have several owners, not just its founder.
-- Run BEFORE deploying the matching app code. One transaction: all or nothing.

-- 1. RSVP statuses -------------------------------------------------------------------
-- The old CHECK constraint's name/definition isn't certain (the status column
-- predates our migrations), so drop any CHECK on rsvps that mentions status.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.rsvps'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.rsvps drop constraint %I', c.conname);
  end loop;
end $$;

-- "cancelled" is now "not_going": same meaning, and the row (history) is kept.
update public.rsvps set status = 'not_going' where status = 'cancelled';

alter table public.rsvps
  add constraint rsvps_status_check check (status in ('going', 'maybe', 'not_going'));

-- 2. Co-hosts --------------------------------------------------------------------------
-- club_members.role: 'owner' (a host) or 'member'. clubs.owner_id stays as the
-- club's founder, who can never be demoted or removed.
alter table public.club_members
  add column role text not null default 'member' check (role in ('owner', 'member'));

update public.club_members m
set role = 'owner'
from public.clubs c
where c.id = m.club_id and c.owner_id = m.user_id;

-- Every policy that checks ownership goes through this function, so redefining it
-- makes co-hosts count as owners everywhere at once (events, join links, ...).
create or replace function public.is_club_owner(p_club_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = auth.uid() and role = 'owner');
$$;

-- A new club's founder is added as an owner.
create or replace function public.handle_new_club()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.club_members (club_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  insert into public.club_invite_links (club_id) values (new.id)
    on conflict do nothing;
  return new;
end;
$$;

-- Promote / demote. There is deliberately no UPDATE policy or privilege on
-- club_members, so a role can only be changed here. Only an existing host may do
-- it, the person must already be a member, and the founder always stays a host.
create function public.set_club_owner(p_club_id bigint, p_user_id uuid, p_is_owner boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_club_owner(p_club_id) then
    raise exception 'Only a host of this club can do that.';
  end if;

  if not p_is_owner
     and p_user_id = (select owner_id from public.clubs where id = p_club_id) then
    raise exception 'The person who founded the club always stays a host.';
  end if;

  update public.club_members
  set role = case when p_is_owner then 'owner' else 'member' end
  where club_id = p_club_id and user_id = p_user_id;

  if not found then
    raise exception 'That person is not a member of this club.';
  end if;
end;
$$;

revoke execute on function public.set_club_owner(bigint, uuid, boolean) from public, anon;
grant  execute on function public.set_club_owner(bigint, uuid, boolean) to authenticated;

-- The member list marks every owner as a host, not just the founder.
create or replace function public.club_directory(p_club_id bigint)
returns table (
  user_id uuid, first_name text, last_name text,
  avatar_url text, email text, is_owner boolean
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.first_name, p.last_name, p.avatar_url,
         case when public.is_admin() or public.is_club_owner(p_club_id)
              then p.email end,
         m.role = 'owner'
  from public.club_members m
  join public.profiles p on p.id = m.user_id
  where m.club_id = p_club_id
    and (public.is_admin() or public.is_club_member(p_club_id))
  order by (m.role = 'owner') desc, p.first_name;
$$;

-- Policies that compared against clubs.owner_id directly must use the function,
-- or co-hosts would be locked out of them.
drop policy "Owners can rename their clubs" on public.clubs;
create policy "Owners can rename their clubs"
  on public.clubs for update to authenticated
  using (public.is_club_owner(id))
  with check (public.is_club_owner(id));

-- A host can remove ordinary members, but not another host (demote them first),
-- which also means nobody can remove the founder.
drop policy "Owners can remove other members" on public.club_members;
create policy "Owners can remove other members"
  on public.club_members for delete to authenticated
  using (public.is_club_owner(club_id) and role = 'member');

drop policy "Club owners and admins can read rsvps" on public.rsvps;
create policy "Club owners and admins can read rsvps"
  on public.rsvps for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.events e
      where e.id = rsvps.event_id and public.is_club_owner(e.club_id)
    )
  );
