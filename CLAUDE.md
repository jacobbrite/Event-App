# Event App

## What this is
A web app for hosting recurring events with RSVP, starting as a personal tool
for a weekly event (first one: NYE party, Dec 31 2026), eventually meant to
become a product other people can use to host their own events.

## Stack
- React + Vite + Tailwind CSS (frontend)
- Supabase (Postgres database + auth)
- GitHub (version control)
- Vercel (hosting, auto-deploys on push to main)

## Architecture
- `src/App.jsx` — main app: session state, loads the user's profile, fetches the
  next upcoming event, RSVP/un-RSVP logic, routes between Auth / CreateEvent /
  event page based on state (host check uses `profile.is_host`)
- `src/Auth.jsx` — signup/login form (email, password, first/last name on signup)
- `src/ResetPassword.jsx` — new-password form shown after following a reset email link
- `src/CreateEvent.jsx` — event creation form, only reachable by the host
- `src/supabaseClient.js` — Supabase client setup, reads from `.env`

## Database schema (Supabase)
**events**
- id (uuid, pk), created_at, host_id (uuid, defaults to auth.uid()),
  title (text), event_time (timestamptz), location (text), description (text)

**rsvps**
- id (int8, pk), created_at, name (text), email (text),
  user_id (uuid, references auth.users), event_id (uuid, fk -> events.id)
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
- rsvps: INSERT open to anon+authenticated; SELECT and DELETE restricted to
  `auth.uid() = user_id` (users can only see/remove their own RSVP)

## Known temporary decisions (not bugs, just not-yet-generalized)
- `is_host` is a single boolean on profiles — fine for one host, not a per-event
  roles/ownership model yet (any host can create events, nobody is scoped to
  "their" events)
- rsvps.name is still a copy of the name at RSVP time, not joined from profiles
- Un-RSVP hard-deletes the row rather than soft-deleting with a status column
  — history of cancellations isn't preserved yet
- Supabase's built-in email sender is used for auth emails — has a low rate
  limit (a few/hour), fine for dev, needs custom SMTP (e.g. Resend) before
  real launch
- Only one event can exist meaningfully at a time in the UI's current fetch
  logic (`.limit(1)`, soonest upcoming) — no event list/browse view yet

## Roadmap (not yet built, in rough priority order)
1. Soft-delete status on rsvps (`status: going/cancelled`) instead of hard delete
2. Custom SMTP for auth emails before going live
3. Recurring/multi-event support (currently one-off events only)
4. Error/empty state polish (e.g. profile load failure currently shows a raw message)

Done: `profiles` table + `is_host` flag (replaced hardcoded HOST_ID); password
reset flow (Auth.jsx "Forgot password?" -> emailed link -> `PASSWORD_RECOVERY`
event in App.jsx -> ResetPassword.jsx). Reset links only work for URLs on the
Supabase Auth -> URL Configuration redirect allowlist (localhost + prod).

## Working style
I'm learning to code through this project — I understand the concepts covered
so far (React state/effects, Supabase auth, RLS policies, basic SQL) reasonably
well. Feel free to move faster and make more decisions autonomously than a
teaching-focused assistant would, but still explain non-obvious choices,
especially around security (RLS) and database design, since I want to keep
understanding the "why," not just get working code.