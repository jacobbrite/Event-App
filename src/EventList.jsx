import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { formatEventTime } from './formatEventTime';
import { typeLabel } from './clubTypes';
import Avatar from './Avatar';

// Events stay listed for this long after they start, so a party in progress
// doesn't vanish from the list (the host may still be checking who came).
const EVENT_GRACE_MS = 6 * 60 * 60 * 1000;

// Home screen: upcoming events across your clubs (title, club and time only;
// location and description load when you open one), and the clubs you belong to.
// What appears is decided by RLS: members see their clubs' events, admins see all.
function EventList({
  profile,
  session,
  onOpenEvent,
  onOpenClub,
  onCreateClub,
  onProfile,
  onLogout,
}) {
  const [events, setEvents] = useState(null);
  const [clubs, setClubs] = useState(null);
  const [myRsvps, setMyRsvps] = useState({});
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function load() {
      const cutoff = new Date(Date.now() - EVENT_GRACE_MS).toISOString();

      const [eventsRes, rsvpsRes, clubsRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, title, event_time, club_id, clubs(name)')
          .gte('event_time', cutoff)
          .order('event_time', { ascending: true }),
        supabase.from('rsvps').select('event_id, status').eq('user_id', session.user.id),
        supabase.from('clubs').select('id, name, type').order('name', { ascending: true }),
      ]);

      const failure = eventsRes.error || rsvpsRes.error || clubsRes.error;
      if (failure) {
        console.error('Error loading home screen:', failure);
        setError(failure.message);
        return;
      }

      setError(null);
      setMyRsvps(Object.fromEntries(rsvpsRes.data.map((r) => [r.event_id, r.status])));
      setEvents(eventsRes.data);
      setClubs(clubsRes.data);
    }

    load();
  }, [session.user.id, attempt]);

  function retry() {
    setError(null);
    setEvents(null);
    setClubs(null);
    setAttempt((n) => n + 1);
  }

  const canHost = profile.is_host || profile.is_admin;
  const loaded = events && clubs;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Upcoming events</h1>
            <p className="text-sm text-gray-500">Hi {profile.first_name ?? 'there'}!</p>
          </div>
          <button
            onClick={onProfile}
            aria-label="Your profile"
            className="rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Avatar profile={profile} size={40} />
          </button>
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
              ? canHost
                ? 'Create a club to get started.'
                : "You're not in any clubs yet. Ask a host for their invite link."
              : 'No upcoming events.'}
          </p>
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
                  {e.clubs?.name && (
                    <span className="block text-xs text-gray-500">{e.clubs.name}</span>
                  )}
                  <span className="block text-sm text-blue-600">{formatEventTime(e.event_time)}</span>
                  {myRsvps[e.id] === 'going' && (
                    <span className="inline-block mt-1 text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                      You're going
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

        {canHost && (
          <button
            onClick={onCreateClub}
            className="mt-6 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
          >
            New club
          </button>
        )}

        <button
          onClick={onLogout}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}

export default EventList;
