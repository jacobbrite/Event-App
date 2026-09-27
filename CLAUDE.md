# Event App

## Vocabulary — keep these words distinct (migration 013)
"Host" used to mean three different things; it now means exactly one:
- **Owner** — created a club and runs it. **Co-owner** — promoted by an owner; same
  powers except they can't demote/remove the owner. DB: `club_members.role = 'owner'`,
  `clubs.owner_id` (the creator), `is_club_owner()`, `set_club_owner()`.
- **Host** — the member hosting ONE particular meeting ("Hosted by Emma"). Can edit
  only that meeting's location + description. DB: `events.hosted_by`. Rotates.
- **Organizer** — allowed to create clubs/events (the beta-access permission; mostly
  invisible to users). DB: `profiles.is_organizer`, `can_organize()`.
  Add one with `update public.profiles set is_organizer = true where email = '...';`
- **Admin** — the app's owner (Jacob): sees everything, edits nothing of others'.
  DB: `profiles.is_admin`.
- **Member** — belongs to a club. **Guest** — anyone invited to an event.
Use these words in UI text, error messages, comments and docs. (`events.host_id` is
just "who created the row", unrelated to a meeting's host.)

## Near-term plans (as of Sep 2026)
- Before Dec 31 the owner will create a handful of test events, and will also
  use the app for a real recurring event — their book club — within about a
  week of Sep 18. Guests get one link: https://events.britewing.com
- Product focus: book clubs. The owner wants to invite a limited set of beta
  organizers (beta testers) who may only create the "book club" type; other types (dinner party,
  custom) show "Coming soon" for them. The owner (admin) can create any type.

## Access model (migrations 006 + 007)
- `profiles.is_admin` = the app owner: sees everything. `is_organizer` = may create
  clubs (beta testers + admin). `allowed_types` = which club types an organizer may
  create (default `{book_club}`; admins get all). Clients can never change any
  of these — set them in the Supabase dashboard / SQL editor.
- **To add a beta organizer:** `update public.profiles set is_organizer = true where email = '...';`
  They can then create book clubs only, and see only their own clubs and members.
- Everything hangs off clubs: a club has members and events. Members see the
  club's events; owners see only their own clubs' members; admins see all. Nobody gets
  another user's profile row — names/emails come through `club_directory()`,
  which gives emails only to the club's owner (or an admin).
- Joining: each club has a private link `?join=<code>`. The code is kept in
  localStorage across sign-up / Google redirect, then the user confirms on the
  JoinScreen (`join_club(code)`). Signed-out visitors can only learn the club's
  name via `club_preview(code)`.
- Clubs vs events (migration 008): a club is a recurring group; a one-time event
  is a single event. Under the hood a one-time event lives in a hidden club of
  type `one_time` (created together with the event by `create_one_time_event()`),
  so it reuses the join link, member/guest list and every RLS rule. The UI lists
  those as events, never as clubs; guests who use the link land on the event.
  Creating one needs `one_time` in `profiles.allowed_types` (admins always can;
  beta organizers see "New event - Coming soon" until you add it).

## Book club direction and setup notes
- Book features, in build order: owner picks a book -> members submit books
  (owner sets max per person) with type-ahead book search (Google Books / Open
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
- `src/ClubPage.jsx` — one club: meetings, members, owner-only invite link
  (copy / reset), leave/remove, "schedule the next meeting"
- `src/CreateClub.jsx` — pick a club type (types you're not allowed show "Coming
  soon") and name it
- `src/CreateEvent.jsx` — schedule a meeting in a club; pre-filled from the
  previous meeting
- `src/EventPage.jsx` — one event (details load on open), RSVP/cancel, book of the
  month (book clubs), and for owners: guest list, invite link (one-time events),
  "schedule the next meeting" (clubs)
- `src/BookSearch.jsx` / `src/bookApi.js` / `src/BookCard.jsx` — type-ahead book
  search (cover, author, year, pages so same-titled books can be told apart; manual
  entry as a fallback) and the book display with Goodreads / StoryGraph / Bookshop /
  WorldCat links. Never name a helper the same as a component ignoring case:
  macOS is case-insensitive, so `./BookSearch` once resolved to `bookSearch.js`
- `src/InviteLink.jsx` — owner-only join link with copy / reset
- `src/GuestList.jsx` — owner view: club members and how each answered
- `src/EditEvent.jsx` / `src/HostPicker.jsx` — edit an event (club owners: everything;
  the meeting's host: location + description only) and pick who's hosting
- `src/CreateRound.jsx` / `src/RoundPage.jsx` — book votes: owner starts one, members
  suggest (BookSearch) and approve, owner closes it and picks the winner
- `src/CreatePoll.jsx` / `src/PollPage.jsx` — time polls: owners propose 2-10 times,
  members vote yes/maybe/no, owners see who voted and pick the winner (creates the
  meeting)
- `src/JoinScreen.jsx` — confirm joining after opening an invite link
- `src/ProfilePage.jsx` / `src/Avatar.jsx` / `src/names.js` — edit name + photo;
  round avatar; name helpers (Google users may have no last name)
- `src/Auth.jsx` — signup/login/forgot-password, "Continue with Google", and a
  banner naming the club when arriving via an invite link
- `src/ResetPassword.jsx` — new-password form shown after following a reset email link
- `src/Screens.jsx` (incl. `PageHeader`: prominent back button left, small quiet
  "Log out" right — keep destructive/secondary actions small), `src/formatEventTime.js`,
  `src/clubTypes.js` — shared screens, date format, club type labels
- `src/supabaseClient.js` — Supabase client setup, reads from `.env`

## Database schema (Supabase)
**events**
- id (int8, pk), created_at, host_id (uuid, defaults to auth.uid()),
  title, event_time (timestamptz), location, description,
  club_id (int8, NOT NULL, fk -> clubs.id, cascade). `series_id` and the old
  `invitations` table / `is_host()` helper were removed by migration 007

**clubs** (migration 006)
- id (int8), created_at, owner_id (uuid -> profiles, default auth.uid()),
  name, type ('book_club' | 'dinner_party' | 'custom'). A recurring event is just a
  club with several events; a one-off event is a club with one.

**books** (migrations 008/009) — id, source ('google' | 'openlibrary' | null for
hand-entered) + source_id (unique together), title, author, first_publish_year,
page_count, isbn, cover_url. Readable by any signed-in
user; written only through `upsert_book()`, which validates input (covers must
be Google Books / Open Library URLs, ids/ISBNs must look right) and never
overwrites an existing row.
Search: Google Books first (fast; needs `VITE_GOOGLE_BOOKS_API_KEY`, an API key
restricted to the site's referrers and the Books API, set in `.env` AND in
Vercel's env vars). Open Library is only the fallback: it was timing out for
40s+ in testing and Google Books without a key is rejected (429), so every
request has a hard timeout. `events.book_id` -> books.id is the book of the month.

**club_members** — (club_id, user_id) PK, joined_at, role ('owner' | 'member').
The founder is added as an owner by the `on_club_created` trigger; everyone else
joins through `join_club(code)`. Several people can be owners (owner + co-owners):
`set_club_owner()` promotes/demotes (only an existing owner may call it, the
founder `clubs.owner_id` can never be demoted). Every ownership check goes through
`is_club_owner()` (role = 'owner'), so co-owners get owner powers everywhere. An owner
can remove ordinary members but not another owner (demote first).

**events.hosted_by** (migration 011) — the member hosting THIS meeting (rotating
host); distinct from `events.host_id`, which is just who created the row. Events
are edited only through `update_event()`: a club owner may change everything; the
meeting's host may change ONLY location + description (column grants can't express
"different columns for different users", so the function checks who is calling).

**meeting_polls / poll_options / poll_votes** (migration 011) — a poll holds the
details of the meeting to create plus candidate times; a vote is yes/maybe/no per
(option, user). Everything is written through functions: `create_meeting_poll()`
(club owners; 2-10 distinct future times), `cast_poll_vote()` (club members, open
polls; null takes a vote back), `finalize_meeting_poll()` (club owners; creates the
event and closes the poll), and `poll_results()` gives every member the totals.
RLS: members read polls/times and only their OWN votes; club owners (and admins)
read every vote so they can see who voted for what. Owners may delete a poll.

**book_rounds / round_books / round_votes** (migration 014) — a book vote. An owner
starts one per club (only one in progress at a time; book clubs only) and sets
`max_per_member` (1-5). Stages: `suggesting` (members add books) -> `voting` (each
member approves any books they'd be happy to read) -> `closed` (an owner picks the
winner, optionally attaching it to a meeting as `events.book_id`). Secret ballot:
`round_votes` rows are readable only by their own author; `round_tally()` withholds
totals (null) from everyone except the club's owners until the round is closed; and
`round_participation()` gives "5 of 8 have voted" without saying what for. All writes
go through functions: `create_book_round`, `suggest_book` (also upserts the book),
`remove_suggestion`, `start_book_voting`, `set_book_approval`, `close_book_round`
(approval only), plus the bracket and attendance functions below.
Migration 015 added: suggestions are private until you've suggested one yourself
(RLS on round_books via `has_suggested()` / `round_status()`; no exception for owners
or admins) and only their author can remove one (owners can't); "who's here" —
`round_absent` rows mark members as not present: they can't vote, their votes are
ignored by every tally, and "X of Y here have voted" counts only people who are
here (`set_round_attendance()`, owners only, changeable any time); and the bracket
method: `bracket_matches` (stage, slot, book_a, book_b, winner; book_b null = bye)
and `bracket_votes` (secret, own rows only). `start_book_voting()` shuffles the books
and draws stage 1 (an odd one out gets a bye); members `cast_bracket_vote()`;
`bracket_results()` withholds counts from members until a match has a winner; a tie
must be broken by an owner (`resolve_bracket_tie()`); `advance_bracket_round()` decides
the round and draws the next, and closes the vote when one book is left.
`attach_round_winner()` puts a closed vote's winner on a meeting. Known small leak:
`suggest_book()` refuses a duplicate with an error, which tells a member that book has
already been suggested.
PostgREST note: `book_rounds` reaches `books` two ways (winner_book_id and via
round_books), so embed the winner as `winner:books!winner_book_id(*)`.

**club_invite_links** — club_id PK, code (random, unique). Separate table so only
the club's owner can read the code (RLS is per row, a column on clubs would be
visible to every member). "Reset link" = the owner writes a new code.

**rsvps**
- id (int8, pk), created_at, name (text), email (text),
  user_id (uuid, defaults to auth.uid(), references auth.users),
  event_id (int8, fk -> events.id),
  status (text, not null, default 'going', CHECK in ('going','maybe','not_going')
  — migration 010 renamed the old 'cancelled' to 'not_going')
- Composite UNIQUE constraint on (user_id, event_id) — one RSVP per user per event

**profiles** (migration: `supabase/migrations/001_profiles.sql`)
- id (uuid, pk, references auth.users on delete cascade), created_at,
  first_name, last_name, is_organizer (bool, default false; was is_host before 013), is_admin (bool, default false),
  allowed_types (text[], default {book_club}), avatar_url,
  email (text, copied at signup by the trigger; not synced if the user later
  changes their auth email)
- Rows are created by the `on_auth_user_created` trigger (`handle_new_user`,
  security definer) from signup metadata — clients never insert

## RLS policies
- Helpers (all security definer, `search_path = ''`, so a policy can consult
  profiles/clubs/club_members without recursing through its own RLS):
  `is_admin()`, `can_organize()`, `allowed_club_types()`, `is_club_member(id)`,
  `is_club_owner(id)`. A profiles policy that queries profiles directly
  recurses forever, hence the functions.
- clubs: SELECT for admins, the owner, and members (the `owner_id = auth.uid()`
  clause matters: an INSERT ... RETURNING is checked before the trigger adds the
  owner as a member). INSERT only as yourself, if `can_organize()` and the type is in
  `allowed_club_types()`. UPDATE (name only, by column grant) for the owner.
- club_members: SELECT own rows; owners/admins all their club's. No INSERT policy
  (joining goes through `join_club`). DELETE: members may leave, owners may
  remove others (owners can't remove themselves).
- club_invite_links: SELECT/UPDATE(code) for the club's owner only.
- Admins are READ-ONLY on other people's clubs (migration 009): they can see clubs,
  events, members, emails and RSVPs, but only a club's owner can create meetings,
  set the book, rename, remove members or read/reset the join link.
  Admins can also read every poll vote.
- events: SELECT for members of the club and admins; INSERT for any owner of the
  club (creator or co-owner; migration 012 dropped the platform-level `can_organize()`
  requirement, which locked co-owners out). `can_organize()` still gates creating a NEW
  club or one-time event. UPDATE for the club's owner only, and only the
  `book_id` column (column grant). No DELETE policy, and no way yet to edit
  title/time/place — fix or delete test events in the Supabase dashboard.
- books: SELECT for signed-in users; no direct writes (`upsert_book()` only).
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
- Co-owners have the same powers as the owner (except demoting/removing the owner).
- Members can't yet see who else is going to a meeting (only owners see the
  guest list); members can see who is in the club
- Events created before Sep 20 2026 used a datetime-local value with no timezone,
  which Postgres read as UTC, so their stored time can be off by the creator's
  UTC offset. New events convert from local time correctly
- Existing per-event invitations were converted to clubs of type 'custom' by
  migration 006 (one club per event or per old recurring series)

## Roadmap (not yet built, in rough priority order)
1. Book club features, next steps: an optional deadline for votes, reading history +
   ratings, reminders, more voting methods (ranked choice). (Done: an owner picks the book with
   Open Library search.)
2. Delete events and clubs, rename a club, edit a book club's poll after creating it
3. Rotation helper: suggest who hasn't hosted yet; notify members of new polls
   and results (needs email reminders); invite by email; a router so one event
   has its own link
4. Google brand verification + privacy policy review (see above)

Done: clubs with join links, scoped hosts, event types (migrations 006/007); error/loading states (retry screens, inline RSVP errors, busy buttons,
friendlier auth errors); `profiles` table + organizer flag (replaced hardcoded HOST_ID); RSVP
soft-delete (`status`) with an owner guest list; password
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