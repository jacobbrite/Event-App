import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Host-only view of every RSVP for an event. RLS enforces the "host-only" part
// on the database side; this component is just the display.
function GuestList({ eventId, refreshKey }) {
  const [rsvps, setRsvps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadRsvps() {
      const { data, error } = await supabase
        .from('rsvps')
        .select('id, name, email, status, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading guest list:', error);
        setError(error.message);
        return;
      }

      setError(null);
      setRsvps(data);
    }

    loadRsvps();
  }, [eventId, refreshKey]);

  if (error) {
    return <p className="mt-6 text-sm text-red-600">Couldn't load guest list: {error}</p>;
  }

  if (!rsvps) {
    return <p className="mt-6 text-sm text-gray-500">Loading guest list...</p>;
  }

  const going = rsvps.filter((r) => r.status === 'going');
  const cancelled = rsvps.filter((r) => r.status === 'cancelled');

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Guest list · {going.length} going
      </h2>

      {going.length === 0 ? (
        <p className="text-sm text-gray-500">No RSVPs yet.</p>
      ) : (
        <ul className="space-y-1">
          {going.map((r) => (
            <li key={r.id} className="text-sm text-gray-800">
              {r.name} <span className="text-gray-400">· {r.email}</span>
            </li>
          ))}
        </ul>
      )}

      {cancelled.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-500 mt-5 mb-2">
            Cancelled ({cancelled.length})
          </h3>
          <ul className="space-y-1">
            {cancelled.map((r) => (
              <li key={r.id} className="text-sm text-gray-400">
                {r.name} · {r.email}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default GuestList;
