import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import GuestPicker from './GuestPicker';

// Host-only: invite / un-invite people for an existing event. Each change is
// saved immediately. RLS restricts writes to hosts; this is just the interface.
function InviteManager({ eventId, onChange }) {
  const [invited, setInvited] = useState(null); // Set of user ids
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function loadInvites() {
      const { data, error } = await supabase
        .from('invitations')
        .select('user_id')
        .eq('event_id', eventId);

      if (error) {
        console.error('Error loading invitations:', error);
        setError(error.message);
        return;
      }
      setInvited(new Set(data.map((r) => r.user_id)));
    }

    loadInvites();
  }, [eventId]);

  async function handleChange(userIds, checked) {
    if (userIds.length === 0) return;
    setBusy(true);
    setError(null);

    const { error } = checked
      ? await supabase.from('invitations').upsert(
          userIds.map((user_id) => ({ event_id: eventId, user_id })),
          { onConflict: 'event_id,user_id', ignoreDuplicates: true },
        )
      : await supabase
          .from('invitations')
          .delete()
          .eq('event_id', eventId)
          .in('user_id', userIds);

    setBusy(false);

    if (error) {
      console.error('Error updating invitations:', error);
      setError(error.message);
      return;
    }

    setInvited((prev) => {
      const next = new Set(prev);
      userIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
    onChange();
  }

  return (
    <div className="mt-3">
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {invited ? (
        <GuestPicker selectedIds={invited} onChange={handleChange} disabled={busy} />
      ) : (
        !error && <p className="text-sm text-gray-500">Loading invitations...</p>
      )}
    </div>
  );
}

export default InviteManager;
