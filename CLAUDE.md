# Event App

## Near-term plans (as of Sep 2026)
- Before Dec 31 the owner will create a handful of test events, and will also
  use the app for a real recurring event — their book club — within about a
  week of Sep 18. Guests get one link: https://events.britewing.com
- Product focus: book clubs. The owner wants to invite a limited set of beta
  hosts who may only create the "book club" type; other types (dinner party,
  custom) show "Coming soon" for them. The owner (admin) can create any type.

## Access model (migrations 006 + 007)
- `profiles.is_admin` = the app owner: sees everything. `is_host` = may create
  clubs (beta hosts + admin). `allowed_types` = which club types a host may
  create (default `{book_club}`; admins get all). Clients can never change any
  of these — set them in the Supabase dashboard / SQL editor.
- **To add a beta host:** `update public.profiles set is_host = true where email = '...';`
  They can then create book clubs only, and see only their own clubs and members.
- Everything hangs off clubs: a club has members and events. Members see the
  club's events; hosts see only clubs they own; admins see all. Nobody gets
  another user's profile row — names/emails come through `club_directory()`,
  which gives emails only to the club's owner (or an admin).
- Joining: each club has a private link `?join=<code>`. The code is kept in
  localStorage across sign-up / Google redirect, then the user confirms on the
  JoinScreen (`join_club(code)`). Signed-out visitors can only learn the club's
  name via `club_preview(code)`.
- One-off events (NYE party) are just a club with one event.

## Book club direction and setup notes
- Book features, in build order: host picks a book -> members submit books
  (host sets max per person) with type-ahead book search (Google Books / Open
  Library: cover, author, ISBN, page count; generated Goodreads/Libby/Bookshop
  links; paste-a-link and manual fallbacks) -> approval or ranked-choice vote ->
  bracket voting -> reading history + ratings, reminders, date availability poll.
- Profiles (done, migration 005): edit name + avatar (public Storage bucket
  `avatars`, path `<user-id>/avatar.jpg`, users can only write their own folder).
- Google sign-in (done): Supabase OAuth provider -> Google Cloud project
  `event-app` under the britewing.com organization, OAuth client type Web
  application, redirect URI `https://<supabase-project-ref>.supabase.co/auth/v1/callback`
  (a typo here gives `redirect_uri_mismatch`). Consent screen audience is
  External and published. The signup trigger reads Google's metadata
  (full_name / given_name / picture). Signing in with Google using an email that
  already has an account links to that account.
- Google account chooser currently says "to continue to <ref>.supabase.co".
  Fix = Google brand verification (Auth Platform -> Branding: app name, home
  page, privacy + terms links, authorized domain britewing.com verified in
  Search Console) or a paid Supabase custom auth domain. Not done yet.
- Legal: draft `public/privacy.html` and `public/terms.html` (AI-written from how
  the app works, NOT reviewed by a lawyer). Keep them in sync with what data the
  app collects. Contact email in them is jacob@britewing.com.

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
- `src/App.jsx` — session, recovery flow, profile load, pending club join link;
  switches between screens with plain state (no router yet)
- `src/EventList.jsx` — home: upcoming events across your clubs (title, club, time
  only) + your clubs. Which appear is decided by RLS
- `src/ClubPage.jsx` — one club: meetings, members, host-only invite link
  (copy / reset), leave/remove, "schedule the next meeting"
- `src/CreateClub.jsx` — pick a club type (types you're not allowed show "Coming
  soon") and name it
- `src/CreateEvent.jsx` — schedule a meeting in a club; pre-filled from the
  previous meeting
- `src/EventPage.jsx` — one event (details load on open), RSVP/cancel, and for the
  club's host: guest list + "schedule the next meeting"
- `src/GuestList.jsx` — host view: club members and how each answered
- `src/JoinScreen.jsx` — confirm joining after opening an invite link
- `src/ProfilePage.jsx` / `src/Avatar.jsx` / `src/names.js` — edit name + photo;
  round avatar; name helpers (Google users may have no last name)
- `src/Auth.jsx` — signup/login/forgot-password, "Continue with Google", and a
  banner naming the club when arriving via an invite link
- `src/ResetPassword.jsx` — new-password form shown after following a reset email link
- `src/Screens.jsx`, `src/formatEventTime.js`, `src/clubTypes.js` — shared screens,
  date format, club type labels
- `src/supabaseClient.js` — Supabase client setup, reads from `.env`

## Database schema (Supabase)
**events**
- id (int8, pk), created_at, host_id (uuid, defaults to auth.uid()),
  title, event_time (timestamptz), location, description,
  club_id (int8, fk -> clubs.id, cascade; NOT NULL after migration 007)

**clubs** (migration 006)
- id (int8), created_at, owner_id (uuid -> profiles, default auth.uid()),
  name, type ('book_club' | 'dinner_party' | 'custom'). A recurring event is just a
  club with several events; a one-off event is a club with one.

**club_members** — (club_id, user_id) PK, joined_at. The owner is added by the
`on_club_created` trigger; everyone else joins through `join_club(code)`.

**club_invite_links** — club_id PK, code (random, unique). Separate table so only
the club's host can read the code (RLS is per row, a column on clubs would be
visible to every member). "Reset link" = the owner writes a new code.

**rsvps**
- id (int8, pk), created_at, name (text), email (text),
  user_id (uuid, defaults to auth.uid(), references auth.users),
  event_id (int8, fk -> events.id),
  status (text, not null, default 'going', CHECK in ('going','cancelled'))
- Composite UNIQUE constraint on (user_id, event_id) — one RSVP per user per event

**profiles** (migration: `supabase/migrations/001_profiles.sql`)
- id (uuid, pk, references auth.users on delete cascade), created_at,
  first_name, last_name, is_host (bool, default false), is_admin (bool, default false),
  allowed_types (text[], default {book_club}), avatar_url,
  email (text, copied at signup by the trigger; not synced if the user later
  changes their auth email)
- Rows are created by the `on_auth_user_created` trigger (`handle_new_user`,
  security definer) from signup metadata — clients never insert

## RLS policies
- Helpers (all security definer, `search_path = ''`, so a policy can consult
  profiles/clubs/club_members without recursing through its own RLS):
  `is_admin()`, `can_host()`, `allowed_club_types()`, `is_club_member(id)`,
  `is_club_owner(id)`. A profiles policy that queries profiles directly
  recurses forever, hence the functions.
- clubs: SELECT for admins, the owner, and members (the `owner_id = auth.uid()`
  clause matters: an INSERT ... RETURNING is checked before the trigger adds the
  owner as a member). INSERT only as yourself, if `can_host()` and the type is in
  `allowed_club_types()`. UPDATE (name only, by column grant) for owner/admin.
- club_members: SELECT own rows; owners/admins all their club's. No INSERT policy
  (joining goes through `join_club`). DELETE: members may leave, owners may
  remove others (owners can't remove themselves).
- club_invite_links: SELECT/UPDATE(code) for the club's owner or an admin only.
- events: SELECT for members of the club and admins; INSERT for the club's owner
  (who can still `can_host()`) and admins. No UPDATE/DELETE policy yet — fix or
  delete test events in the Supabase dashboard.
- profiles: SELECT own row, plus all rows for admins. UPDATE by `auth.uid() = id`
  and, by column-level grant, only first_name / last_name / avatar_url — RLS is
  per-row, so without the grant a user could set their own `is_admin`. No
  INSERT/DELETE policies (the trigger creates rows).
- rsvps: INSERT as yourself for any event you can see (events RLS decides).
  SELECT own rows, plus all RSVPs for events in clubs you own (admins: all).
  UPDATE own rows, `status` column only (column grant). DELETE: none — cancelling
  sets `status = 'cancelled'`, history is kept.
- Storage `avatars`: public bucket; users can only write inside `<their-user-id>/`.

## Known temporary decisions (not bugs, just not-yet-generalized)
- rsvps.name / email are copies from RSVP time, not joined from profiles
- Joining is by link only: no invite-by-email for people who haven't signed up,
  and no approval step (anyone with the link can join)
- Recurring = "schedule the next meeting" in the same club (details copied, new
  date). No automatic rules like "every 2nd Tuesday"
- Upcoming lists include events up to 6 hours past their start, so a running
  event stays visible
- Members can't yet see who else is going to a meeting (only the host sees the
  guest list); members can see who is in the club
- Events created before Sep 20 2026 used a datetime-local value with no timezone,
  which Postgres read as UTC, so their stored time can be off by the creator's
  UTC offset. New events convert from local time correctly
- Existing per-event invitations were converted to clubs of type 'custom' by
  migration 006 (one club per event or per old recurring series)

## Roadmap (not yet built, in rough priority order)
1. Book club features: pick/submit a book (with book search), vote, history and
   ratings, reminders, date polling (see "Book club direction" above)
2. Edit / delete events and clubs from the app; rename club UI
3. Invite by email, share a link straight to one event (needs a router)
4. Google brand verification + privacy policy review (see above)

Done: clubs with join links, scoped hosts, event types (migrations 006/007); error/loading states (retry screens, inline RSVP errors, busy buttons,
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