-- Clean-up after the club-based app is deployed.
-- Run this AFTER 006 and AFTER the matching app code is live. Before that, the
-- old app still reads `invitations` and `events.series_id`, so dropping them
-- would break it.
--
-- Everything in `invitations` was already converted into club members by 006.

-- Every event now belongs to a club (006 back-filled them all).
alter table public.events alter column club_id set not null;

-- Recurrence is now "another event in the same club", so series_id is obsolete.
drop index if exists public.events_series_id_idx;
alter table public.events drop column series_id;

-- Old per-event invitations (policies on it go with the table).
drop table public.invitations;

-- The old super-user helper. Nothing uses it any more (006 replaced every policy
-- that did); dropping it also stops it being reused by mistake.
drop function public.is_host();
