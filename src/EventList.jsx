import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { formatEventTime } from './formatEventTime';
import Avatar from './Avatar';

// Events stay listed for this long after they start, so a party in progress
// doesn't vanish from the list (the host may still be checking who came).
const EVENT_GRACE_MS = 6 * 60 * 60 * 1000;

// Deliberately minimal: title and time only. Location and description are
// fetched by EventPage when a guest opens the event. Which events show up at all
// is decided by RLS (hosts see all, guests only the ones they're invited to).
function EventList({ profile, session, onOpen, onCreate, onProfile, onLogout }) {
  const [events, setEvents] = useState(null);
  const [myRsvps, setMyRsvps] = useState({});
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function load() {
      const cutoff = new Date(Date.now() - EVENT_GRACE_MS).toISOString();

      const [eventsRes, rsvpsRes] = await Promise.all([
        supabase
          .from('events')
          .select('id, title, event_time')
          .gte('event_time', cutoff)
          .order('event_time', { ascending: true }),
        supabase.from('rsvps').select('event_id, status').eq('user_id', session.user.id),
      ]);

      const failure = eventsRes.error || rsvpsRes.error;
      if (failure) {
        console.error('Error loading events:', failure);
        setError(failure.message);
        return;
      }

      setError(null);
      setMyRsvps(Object.fromEntries(rsvpsRes.data.map((r) => [r.event_id, r.status])));
      setEvents(eventsRes.data);
    }

    load();
  }, [session.user.id, attempt]);

  function retry() {
    setError(null);
    setEvents(null);
    setAttempt((n) => n + 1);
  }

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
            <p className="text-sm text-red-600 mb-3">Couldn't load events: {error}</p>
            <button onClick={retry} className="text-sm text-blue-600 underline">
              Try again
            </button>
          </div>
        )}

        {!error && !events && <p className="text-center text-gray-500">Loading...</p>}

        {events && events.length === 0 && (
          <p className="text-center text-gray-600">
            {profile.is_host
              ? 'No upcoming events yet.'
              : "You haven't been invited to any upcoming events yet. If you're expecting one, ask the host to invite you."}
          </p>
        )}

        {events && events.length > 0 && (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onOpen(e.id)}
                  className="w-full text-left border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition"
                >
                  <span className="block font-semibold text-gray-900">{e.title}</span>
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

        {profile.is_host && (
          <button
            onClick={onCreate}
            className="mt-6 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
          >
            New event
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
