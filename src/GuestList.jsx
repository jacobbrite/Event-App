import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Host-only overview of everyone invited to an event and how they answered.
// RLS enforces the "host-only" part on the database side; this component is
// just the display.
function GuestList({ eventId, refreshKey }) {
  const [guests, setGuests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadGuests() {
      const [invitesRes, rsvpsRes] = await Promise.all([
        supabase
          .from('invitations')
          .select('user_id, profiles(first_name, last_name, email)')
          .eq('event_id', eventId),
        supabase.from('rsvps').select('user_id, status').eq('event_id', eventId),
      ]);

      const failure = invitesRes.error || rsvpsRes.error;
      if (failure) {
        console.error('Error loading guest list:', failure);
        setError(failure.message);
        return;
      }

      const statusByUser = Object.fromEntries(rsvpsRes.data.map((r) => [r.user_id, r.status]));
      const merged = invitesRes.data.map((inv) => ({
        id: inv.user_id,
        name: `${inv.profiles?.first_name ?? ''} ${inv.profiles?.last_name ?? ''}`.trim(),
        email: inv.profiles?.email ?? '',
        // No RSVP row yet means they haven't answered.
        status: statusByUser[inv.user_id] ?? 'invited',
      }));
      merged.sort((a, b) => a.name.localeCompare(b.name));

      setError(null);
      setGuests(merged);
    }

    loadGuests();
  }, [eventId, refreshKey]);

  if (error) {
    return <p className="mt-6 text-sm text-red-600">Couldn't load guest list: {error}</p>;
  }

  if (!guests) {
    return <p className="mt-6 text-sm text-gray-500">Loading guest list...</p>;
  }

  const going = guests.filter((g) => g.status === 'going');
  const noResponse = guests.filter((g) => g.status === 'invited');
  const cancelled = guests.filter((g) => g.status === 'cancelled');

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Guest list · {going.length} going · {guests.length} invited
      </h2>

      {guests.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nobody is invited yet. Use "Manage invitations" below.
        </p>
      ) : (
        <>
          <Group title="Going" people={going} tone="text-gray-800" />
          <Group title="No response yet" people={noResponse} tone="text-gray-500" />
          <Group title="Cancelled" people={cancelled} tone="text-gray-400" />
        </>
      )}
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
            {p.name} <span className="text-gray-400">· {p.email}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default GuestList;
