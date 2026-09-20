# Event App

## Near-term plans (as of Sep 2026)
- Before Dec 31 the owner will create a handful of test events, and will also
  use the app for a real recurring event — their book club — within about a
  week of Sep 18. So multi-event support is now the top priority, ahead of the
  original "one event at a time" assumption. Guests get one link:
  https://events.britewing.com

## What this is
A web app for hosting recurring events with RSVP, starting as a personal tool
for a weekly event (first one: NYE party, Dec 31 2026), eventually meant to
become a product other people can use to host their own events.

## Stack
- React + Vite + Tailwind CSS (frontend)
- Supabase (Postgres database + auth)
- GitHub (version control)
- Vercel (hosting, auto-deploys on push to main)
- Live site (the URL given to guests): https://events.britewing.com — a CNAME
  in Squarespace DNS -> Vercel. The old event-app-nine-kappa.vercel.app still
  works. Both plus http://localhost:5173 must stay on Supabase's redirect allowlist.

## Architecture
- `src/App.jsx` — session, recovery flow, profile load; switches between the
  list / event / create views with plain state (no router yet)
- `src/EventList.jsx` — upcoming events (title + time only). Which events appear
  is decided by RLS: hosts see all, guests only events they're invited to
- `src/EventPage.jsx` — one event (fetches full details on open), RSVP/cancel,
  and for hosts: guest list, invitations, "Schedule next occurrence"
- `src/CreateEvent.jsx` — host-only form: one-time vs recurring, details, guest
  picker. With a `template` it copies details + guest list from a recurring event
- `src/GuestPicker.jsx` / `src/InviteManager.jsx` / `src/GuestList.jsx` —
  host tools: pick people, save invitations to an event, see who's going
- `src/Auth.jsx` — signup/login/forgot-password form
- `src/ResetPassword.jsx` — new-password form shown after following a reset email link
- `src/Screens.jsx`, `src/formatEventTime.js` — shared loading/error screens, date format
- `src/supabaseClient.js` — Supabase client setup, reads from `.env`

## Database schema (Supabase)
**events**
- id (int8, pk), created_at, host_id (uuid, defaults to auth.uid()),
  title (text), event_time (timestamptz), location (text), description (text),
  series_id (uuid, null = one-time; events sharing a series_id are occurrences
  of one recurring event — there is no separate series table yet)

**invitations** (migration 004)
- id (int8, pk), created_at, event_id (fk -> events.id, cascade),
  user_id (fk -> profiles.id, cascade), UNIQUE (event_id, user_id)
- An invitation is what lets a guest see and RSVP to an event

**rsvps**
- id (int8, pk), created_at, name (text), email (text),
  user_id (uuid, defaults to auth.uid(), references auth.users),
  event_id (int8, fk -> events.id),
  status (text, not null, default 'going', CHECK in ('going','cancelled'))
- Composite UNIQUE constraint on (user_id, event_id) — one RSVP per user per event

**profiles** (migration: `supabase/migrations/001_profiles.sql`)
- id (uuid, pk, references auth.users on delete cascade), created_at,
  first_name, last_name, is_host (bool, default false),
  email (text, copied at signup by the trigger; not synced if the user later
  changes their auth email)
- Rows are created by the `on_auth_user_created` trigger (`handle_new_user`,
  security definer) from signup metadata — clients never insert

## RLS policies
- `public.is_host()` (security definer) is used by policies instead of querying
  profiles directly — a profiles policy that queries profiles recurses forever
- events: SELECT for hosts and for users with an invitation (no longer public);
  INSERT for hosts only. No UPDATE/DELETE policy yet — edit/delete test events
  in the Supabase dashboard
- invitations: SELECT own rows (hosts: all); INSERT/DELETE hosts only; no UPDATE
- profiles: SELECT own row, plus all rows for hosts (to pick guests). UPDATE
  restricted to `auth.uid() = id`. UPDATE is also
  limited by column-level grant to first_name/last_name only — RLS is per-row,
  so without this a user could set their own `is_host = true`. No INSERT/DELETE
  policies (trigger creates rows)
- rsvps (migrations 002-004): INSERT authenticated only, as yourself
  (`auth.uid() = user_id`), and only for events you're invited to (hosts exempt)
  — the old open-to-anon policy let anyone insert rows for any user_id. SELECT: own rows, plus all rows for hosts
  (`profiles.is_host`); policies are OR'd so guests still can't see each other.
  UPDATE: own rows, and by column-level grant only the `status` column (again
  RLS is per-row, so without the grant a user could rewrite event_id/email).
  DELETE: none — cancelling sets `status = 'cancelled'`, history is kept

## Known temporary decisions (not bugs, just not-yet-generalized)
- `is_host` is a single boolean on profiles — fine for one host, not a per-event
  roles/ownership model yet (any host can create events, nobody is scoped to
  "their" events)
- rsvps.name is still a copy of the name at RSVP time, not joined from profiles
- Guests are invited by picking from people who have already signed up — no
  invite-by-email for people without an account yet
- Recurring = "duplicate the last occurrence" (details + guest list copied, new
  date). No automatic rules like "every 2nd Tuesday", no edit-whole-series
- Upcoming lists include events up to 6 hours past their start, so a running
  event stays visible
- Events created before Sep 20 2026 used a datetime-local value with no timezone,
  which Postgres read as UTC, so their stored time can be off by the creator's
  UTC offset. New events convert from local time correctly

## Roadmap (not yet built, in rough priority order)
1. Invite by email (people who haven't signed up yet), and share a link straight
   to one event (needs a router)
2. Edit / delete / cancel events from the app; "every 2nd Tuesday" style rules

Done: multi-event list, invite-only events, recurring via duplicate; error/loading states (retry screens, inline RSVP errors, busy buttons,
friendlier auth errors); `profiles` table + `is_host` flag (replaced hardcoded HOST_ID); RSVP
soft-delete (`status`) with a host guest list; password
reset flow (Auth.jsx "Forgot password?" -> emailed link -> `PASSWORD_RECOVERY`
event in App.jsx -> ResetPassword.jsx). Reset links only work for URLs on the
Supabase Auth -> URL Configuration redirect allowlist (localhost + prod).
Custom SMTP: auth emails go out via Resend (smtp.resend.com:465, user `resend`,
API key stored only in Supabase's SMTP settings) from
`noreply@events.britewing.com`. DNS (DKIM TXT + two SPF CNAMEs on the `events`
subdomain) is managed in Squarespace Domains for britewing.com, which also
runs Google Workspace mail — don't touch the root-domain records. Supabase
email rate limit raised to 60/h; Resend free tier is ~100 emails/day.

## Working style
I'm learning to code through this project — I understand the concepts covered
so far (React state/effects, Supabase auth, RLS policies, basic SQL) reasonably
well. Feel free to move faster and make more decisions autonomously than a
teaching-focused assistant would, but still explain non-obvious choices,
especially around security (RLS) and database design, since I want to keep
understanding the "why," not just get working code.