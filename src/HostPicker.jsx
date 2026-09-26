import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { fullName } from './names';

// "Who's hosting this meeting?" dropdown, filled from the club's member list.
// The person picked can edit that meeting's location and description.
function HostPicker({ clubId, value, onChange, disabled }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadMembers() {
      const { data, error } = await supabase.rpc('club_directory', { p_club_id: clubId });
      if (error) {
        console.error('Error loading members:', error);
        setError(error.message);
        return;
      }
      setMembers(data);
    }

    loadMembers();
  }, [clubId]);

  if (error) return <p className="text-sm text-red-600">Couldn't load members: {error}</p>;

  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-700 mb-1">Who's hosting?</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || !members}
        className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      >
        <option value="">No one in particular</option>
        {(members ?? []).map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {fullName(m)}
            {m.is_owner ? ' (owner)' : ''}
          </option>
        ))}
      </select>
      <span className="block text-xs text-gray-400 mt-1">
        Whoever hosts a meeting can edit its location and description.
      </span>
    </label>
  );
}

export default HostPicker;
