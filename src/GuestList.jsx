import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { fullName } from './names';

// Owner view: everyone who can see this event and how each answered. For a club
// that's its members; for a one-time event it's the people you invited.
// Membership + emails come from club_directory(), which only hands emails to the
// club's owners; RSVP rows are readable by owners through RLS.
function GuestList({ eventId, clubId, isOneTime, refreshKey }) {
  const [guests, setGuests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadGuests() {
      const [dirRes, rsvpRes] = await Promise.all([
        supabase.rpc('club_directory', { p_club_id: clubId }),
        supabase.from('rsvps').select('user_id, status').eq('event_id', eventId),
      ]);

      const failure = dirRes.error || rsvpRes.error;
      if (failure) {
        console.error('Error loading guest list:', failure);
        setError(failure.message);
        return;
      }

      const statusByUser = Object.fromEntries(rsvpRes.data.map((r) => [r.user_id, r.status]));
      setError(null);
      setGuests(
        dirRes.data.map((m) => ({
          id: m.user_id,
          name: fullName(m),
          email: m.email ?? '',
          // No RSVP row yet means they haven't answered.
          status: statusByUser[m.user_id] ?? 'no_response',
        })),
      );
    }

    loadGuests();
  }, [eventId, clubId, refreshKey]);

  if (error) {
    return <p className="mt-6 text-sm text-red-600">Couldn't load guest list: {error}</p>;
  }

  if (!guests) {
    return <p className="mt-6 text-sm text-gray-500">Loading guest list...</p>;
  }

  const by = (status) => guests.filter((g) => g.status === status);
  const going = by('going');
  const maybe = by('maybe');
  const total = guests.length;

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Guest list · {going.length} going
        {maybe.length > 0 && ` · ${maybe.length} maybe`} · {total}{' '}
        {isOneTime ? 'invited' : total === 1 ? 'member' : 'members'}
      </h2>

      <Group title="Going" people={going} tone="text-gray-800" />
      <Group title="Maybe" people={maybe} tone="text-gray-700" />
      <Group title="No response yet" people={by('no_response')} tone="text-gray-500" />
      <Group title="Can't go" people={by('not_going')} tone="text-gray-400" />
    </div>
  );
}

function Group({ title, people, tone }) {
  if (people.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-gray-500 mb-1">
        {title} ({people.length})
      </h3>
      <ul className="space-y-1">
        {people.map((p) => (
          <li key={p.id} className={`text-sm ${tone}`}>
            {p.name} {p.email && <span className="text-gray-400">· {p.email}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default GuestList;
