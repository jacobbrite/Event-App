import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { fullName } from './names';

// Checklist of everyone who has signed up (hosts excluded), with a filter box.
// Purely a selector: the parent decides what a change means (remember it, or
// save it straight to the database).
//   selectedIds: Set of user ids currently invited
//   onChange(userIds, checked): called with the ids to add/remove
function GuestPicker({ selectedIds, onChange, disabled }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    async function loadPeople() {
      // RLS only lets hosts read other people's profiles.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .eq('is_host', false)
        .order('first_name', { ascending: true });

      if (error) {
        console.error('Error loading people:', error);
        setError(error.message);
        return;
      }
      setPeople(data);
    }

    loadPeople();
  }, []);

  if (error) return <p className="text-sm text-red-600">Couldn't load people: {error}</p>;
  if (!people) return <p className="text-sm text-gray-500">Loading people...</p>;
  if (people.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Nobody else has signed up yet. Share the site link, then invite them here.
      </p>
    );
  }

  const needle = filter.trim().toLowerCase();
  const visible = people.filter((p) =>
    `${p.first_name} ${p.last_name} ${p.email}`.toLowerCase().includes(needle),
  );
  const visibleIds = visible.map((p) => p.id);

  return (
    <div>
      <input
        type="text"
        placeholder="Search by name or email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex gap-3 text-xs mb-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(visibleIds, true)}
          className="text-blue-600 hover:underline disabled:opacity-50"
        >
          Select all shown
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(visibleIds, false)}
          className="text-blue-600 hover:underline disabled:opacity-50"
        >
          Clear shown
        </button>
        <span className="text-gray-400 ml-auto">{selectedIds.size} invited</span>
      </div>

      <ul className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {visible.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={selectedIds.has(p.id)}
                disabled={disabled}
                onChange={(e) => onChange([p.id], e.target.checked)}
              />
              <span>
                <span className="text-gray-900">{fullName(p)}</span>
                <span className="block text-xs text-gray-400">{p.email}</span>
              </span>
            </label>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-500">No matches.</li>
        )}
      </ul>
    </div>
  );
}

export default GuestPicker;
