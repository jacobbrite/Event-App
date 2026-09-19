-- Turn off hard-deleting RSVPs from the client.
-- Run this AFTER the soft-delete app code (which cancels via UPDATE) is live.
-- If run earlier, the old app's "Cancel RSVP" button would silently do nothing:
-- with no DELETE policy, RLS just matches zero rows and returns no error.

-- I don't know the old DELETE policy's name, so drop whatever exists.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'rsvps' and cmd = 'DELETE'
  loop
    execute format('drop policy %I on public.rsvps', p.policyname);
  end loop;
end $$;

-- Belt and braces: also remove the table privilege, so a policy added by
-- mistake later still can't let clients delete history.
revoke delete on public.rsvps from anon, authenticated;
