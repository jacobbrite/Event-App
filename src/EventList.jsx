import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { formatEventTime } from './formatEventTime';
import { typeLabel, ONE_TIME } from './clubTypes';
import Avatar from './Avatar';

// Events stay listed for this long after they start, so a party in progress
// doesn't vanish from the list (the owner may still be checking who came).
const EVENT_GRACE_MS = 6 * 60 * 60 * 1000;

// Home screen: upcoming events across your clubs and one-time events (title,
// club and time only; location and description load when you open one), and the
// clubs you belong to. What appears is decided by RLS: you see what you've been
// invited to, admins see everything.
function EventList({
  profile,
  session,
  onOpenEvent,
  onOpenClub,
  onCreateClub,
  onCreateEvent,
  onOpenPoll,
  onOpenRound,
  onProfile,
  onLogout,
}) {
  const [events, setEvents] = useState(null);
  const [clubs, setClubs] = useState(null);
  const [polls, setPolls] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [myRsvps, setMyRsvps] = useState({});
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function load() {
      const cutoff = new Date(Date.now() - EVENT_GRACE_MS).toISOString();

      const [eventsRes, rsvpsRes, clubsRes, pollsRes, roundsRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, title, event_time, club_id, clubs(name, type)')
          .gte('event_time', cutoff)
          .order('event_time', { ascending: true }),
        supabase.from('rsvps').select('event_id, status').eq('user_id', session.user.id),
        // One-time events live in hidden clubs; those are events, not clubs.
        supabase
          .from('clubs')
          .select('id, name, type')
          .neq('type', ONE_TIME)
          .order('name', { ascending: true }),
        supabase
          .from('meeting_polls')
          .select('id, title, clubs(name)')
          .eq('status', 'open')
          .order('created_at', { ascending: false }),
        supabase
          .from('book_rounds')
          .select('id, title, status, clubs(name)')
          .neq('status', 'closed')
          .order('created_at', { ascending: false }),
      ]);

      const failure =
        eventsRes.error || rsvpsRes.error || clubsRes.error || pollsRes.error || roundsRes.error;
      if (failure) {
        console.error('Error loading home screen:', failure);
        setError(failure.message);
        return;
      }

      setError(null);
      setMyRsvps(Object.fromEntries(rsvpsRes.data.map((r) => [r.event_id, r.status])));
      setEvents(eventsRes.data);
      setClubs(clubsRes.data);
      setPolls(pollsRes.data);
      setRounds(roundsRes.data);
    }

    load();
  }, [session.user.id, attempt]);

  function retry() {
    setError(null);
    setEvents(null);
    setClubs(null);
    setAttempt((n) => n + 1);
  }

  // Organizers are the people allowed to create clubs (beta access); admins too.
  const canOrganize = profile.is_organizer || profile.is_admin;
  const canCreate = (type) => profile.is_admin || (profile.allowed_types ?? []).includes(type);
  const loaded = events && clubs;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">My events</h1>
            <p className="text-sm text-gray-500">Hi {profile.first_name ?? 'there'}!</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-600">
              Log out
            </button>
            <button
              onClick={onProfile}
              aria-label="Your profile"
              className="rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <Avatar profile={profile} size={40} />
            </button>
          </div>
        </div>

        {error && (
          <div className="text-center">
            <p className="text-sm text-red-600 mb-3">Couldn't load your events: {error}</p>
            <button onClick={retry} className="text-sm text-blue-600 underline">
              Try again
            </button>
          </div>
        )}

        {!error && !loaded && <p className="text-center text-gray-500">Loading...</p>}

        {loaded && events.length === 0 && (
          <p className="text-center text-gray-600">
            {clubs.length === 0
              ? canOrganize
                ? 'Create a club or an event to get started.'
                : "Nothing here yet. Ask the club's owner for their invite link."
              : 'No upcoming events.'}
          </p>
        )}

        {loaded && rounds.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-2">Book vote</h2>
            <ul className="space-y-2">
              {rounds.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onOpenRound(r.id)}
                    className="w-full text-left border border-purple-300 bg-purple-50 rounded-xl px-4 py-3 hover:bg-purple-100 transition"
                  >
                    <span className="block font-semibold text-gray-900">{r.title}</span>
                    <span className="block text-xs text-purple-800">
                      {r.clubs?.name} ·{' '}
                      {r.status === 'suggesting' ? 'suggest a book' : 'vote now'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loaded && polls.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-2">Vote on a time</h2>
            <ul className="space-y-2">
              {polls.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => onOpenPoll(p.id)}
                    className="w-full text-left border border-amber-300 bg-amber-50 rounded-xl px-4 py-3 hover:bg-amber-100 transition"
                  >
                    <span className="block font-semibold text-gray-900">{p.title}</span>
                    <span className="block text-xs text-amber-800">
                      {p.clubs?.name} · tap to vote
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loaded && events.length > 0 && (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onOpenEvent(e.id, e.club_id)}
                  className="w-full text-left border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition"
                >
                  <span className="block font-semibold text-gray-900">{e.title}</span>
                  <span className="block text-xs text-gray-500">
                    {e.clubs?.type === ONE_TIME ? 'One-time event' : e.clubs?.name}
                  </span>
                  <span className="block text-sm text-blue-600">{formatEventTime(e.event_time)}</span>
                  {myRsvps[e.id] === 'going' && (
                    <span className="inline-block mt-1 text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                      You're going
                    </span>
                  )}
                  {myRsvps[e.id] === 'maybe' && (
                    <span className="inline-block mt-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                      Maybe
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {loaded && clubs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-gray-500 mb-2">Your clubs</h2>
            <ul className="space-y-2">
              {clubs.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onOpenClub(c.id)}
                    className="w-full text-left flex items-center justify-between border border-gray-200 rounded-xl px-4 py-2 hover:border-blue-400 hover:bg-blue-50 transition"
                  >
                    <span className="font-medium text-gray-900">{c.name}</span>
                    <span className="text-xs text-gray-400">{typeLabel(c.type)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canOrganize && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={onCreateClub}
              className="bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
            >
              New club
            </button>
            {canCreate(ONE_TIME) ? (
              <button
                onClick={onCreateEvent}
                className="border border-blue-600 text-blue-700 font-semibold py-3 rounded-xl hover:bg-blue-50 transition"
              >
                New event
              </button>
            ) : (
              <button
                disabled
                className="border border-gray-200 text-gray-400 font-semibold py-2 rounded-xl cursor-not-allowed leading-tight"
              >
                New event
                <span className="block text-xs font-normal">Coming soon</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default EventList;
