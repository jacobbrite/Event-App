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
- `src/App.jsx` — main app: session state, loads the user's profile, fetches the
  next upcoming event, RSVP/un-RSVP logic, routes between Auth / CreateEvent /
  event page based on state (host check uses `profile.is_host`)
- `src/Auth.jsx` — signup/login form (email, password, first/last name on signup)
- `src/ResetPassword.jsx` — new-password form shown after following a reset email link
- `src/CreateEvent.jsx` — event creation form, only reachable by the host
- `src/GuestList.jsx` — host-only guest list (going count, going + cancelled RSVPs)
- `src/supabaseClient.js` — Supabase client setup, reads from `.env`

## Database schema (Supabase)
**events**
- id (int8, pk), created_at, host_id (uuid, defaults to auth.uid()),
  title (text), event_time (timestamptz), location (text), description (text)

**rsvps**
- id (int8, pk), created_at, name (text), email (text),
  user_id (uuid, defaults to auth.uid(), references auth.users),
  event_id (int8, fk -> events.id),
  status (text, not null, default 'going', CHECK in ('going','cancelled'))
- Composite UNIQUE constraint on (user_id, event_id) — one RSVP per user per event

**profiles** (migration: `supabase/migrations/001_profiles.sql`)
- id (uuid, pk, references auth.users on delete cascade), created_at,
  first_name, last_name, is_host (bool, default false)
- Rows are created by the `on_auth_user_created` trigger (`handle_new_user`,
  security definer) from signup metadata — clients never insert

## RLS policies
- events: SELECT open to anon+authenticated; INSERT restricted to users whose
  profile has `is_host = true`
- profiles: SELECT and UPDATE restricted to `auth.uid() = id`. UPDATE is also
  limited by column-level grant to first_name/last_name only — RLS is per-row,
  so without this a user could set their own `is_host = true`. No INSERT/DELETE
  policies (trigger creates rows)
- rsvps (migrations 002 + 003): INSERT authenticated only, and only as
  yourself (`auth.uid() = user_id`) — the old open-to-anon policy let anyone
  insert rows for any user_id. SELECT: own rows, plus all rows for hosts
  (`profiles.is_host`); policies are OR'd so guests still can't see each other.
  UPDATE: own rows, and by column-level grant only the `status` column (again
  RLS is per-row, so without the grant a user could rewrite event_id/email).
  DELETE: none — cancelling sets `status = 'cancelled'`, history is kept

## Known temporary decisions (not bugs, just not-yet-generalized)
- `is_host` is a single boolean on profiles — fine for one host, not a per-event
  roles/ownership model yet (any host can create events, nobody is scoped to
  "their" events)
- rsvps.name is still a copy of the name at RSVP time, not joined from profiles
- Only one event can exist meaningfully at a time in the UI's current fetch
  logic (`.limit(1)`, soonest upcoming, from 6 hours before now so a running
  event stays visible) — no event list/browse view yet, and the host create form
  only appears when there is no upcoming event

## Roadmap (not yet built, in rough priority order)
1. Recurring/multi-event support (currently one-off events only; needed for the
   book club and for test events — a host can only create an event when none
   are upcoming, and guests only ever see the single soonest event)

Done: error/loading states (retry screens, inline RSVP errors, busy buttons,
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