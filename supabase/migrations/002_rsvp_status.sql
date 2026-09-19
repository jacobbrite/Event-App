-- RSVP status (soft-delete) + host guest list + tighter RSVP INSERT policy.
-- Safe to run BEFORE deploying the matching app code: the old app only inserts
-- and hard-deletes rows, and both still work after this migration.
-- Run 003_rsvp_no_hard_delete.sql AFTER the new app code is deployed.
--
-- rsvps.status already existed in the live database (text, default 'going',
-- nullable, unknown constraints), so this tightens it rather than adding it.
-- The whole script runs as one transaction: if any statement fails, nothing
-- is applied.

-- 1. Tighten the status column -----------------------------------------------
update public.rsvps set status = 'going' where status is null;

alter table public.rsvps alter column status set default 'going';
alter table public.rsvps alter column status set not null;

-- Only allow the two values the app understands (skipped if a constraint with
-- this name already exists).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rsvps'::regclass and conname = 'rsvps_status_check'
  ) then
    alter table public.rsvps
      add constraint rsvps_status_check check (status in ('going', 'cancelled'));
  end if;
end $$;

-- 2. Let users change their own RSVP status ----------------------------------
-- Cancelling / re-RSVPing is now an UPDATE of the user's existing row (the
-- UNIQUE (user_id, event_id) constraint means there is only ever one row).
create policy "Users can update own rsvp"
  on public.rsvps for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Same lesson as profiles.is_host: RLS is per row, so on its own the policy
-- above would let a user rewrite name, email, event_id or user_id on their own
-- RSVP (e.g. move it to a different event). Column-level grants limit UPDATE to
-- the status column only.
revoke update on public.rsvps from anon, authenticated;
grant  update (status) on public.rsvps to authenticated;

-- 3. Hosts can read every RSVP ------------------------------------------------
-- SELECT policies are additive (OR'd): guests still match only "own row" and
-- can't see each other, while hosts match this one too.
create policy "Hosts can read all rsvps"
  on public.rsvps for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_host
    )
  );

-- 4. Only logged-in users can RSVP, and only as themselves ---------------------
-- The old "Anyone can RSVP" policy had WITH CHECK (true) for anon too, so anyone
-- could insert a row with any user_id (or none). With a host guest list that
-- means junk entries. user_id defaults to auth.uid(), so the app (which doesn't
-- send user_id) keeps working.
drop policy "Anyone can RSVP" on public.rsvps;

create policy "Users can RSVP as themselves"
  on public.rsvps for insert
  to authenticated
  with check (auth.uid() = user_id);
