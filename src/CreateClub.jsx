import { useState } from 'react';
import { supabase } from './supabaseClient';
import { CLUB_TYPES } from './clubTypes';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Create a club. Types you aren't allowed to host yet are shown as "Coming soon";
// the database enforces the same rule (clubs INSERT policy), this is just the UI.
function CreateClub({ profile, onCancel, onCreated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('book_club');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isAllowed = (value) => profile.is_admin || (profile.allowed_types ?? []).includes(value);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const { data, error } = await supabase
      .from('clubs')
      .insert({ name: name.trim(), type })
      .select('id')
      .single();

    setBusy(false);

    if (error) {
      console.error('Error creating club:', error);
      setError(error.message);
      return;
    }

    onCreated(data.id);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:underline mb-4">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Create a club</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-gray-700 mb-2">What kind?</legend>
            <div className="space-y-2">
              {CLUB_TYPES.map((t) => {
                const allowed = isAllowed(t.value);
                return (
                  <label
                    key={t.value}
                    className={`flex items-center justify-between border rounded-xl px-4 py-3 text-sm ${
                      !allowed
                        ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                        : type === t.value
                          ? 'border-blue-500 bg-blue-50 cursor-pointer'
                          : 'border-gray-300 cursor-pointer'
                    }`}
                  >
                    <span>
                      <span className="block font-semibold">{t.label}</span>
                      <span className="block text-xs">{t.blurb}</span>
                    </span>
                    {allowed ? (
                      <input
                        type="radio"
                        name="type"
                        value={t.value}
                        checked={type === t.value}
                        onChange={() => setType(t.value)}
                        className="sr-only"
                      />
                    ) : (
                      <span className="text-xs font-medium bg-gray-200 text-gray-500 rounded-full px-2 py-0.5">
                        Coming soon
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <input
            type="text"
            placeholder="Club name (e.g. Tuesday Night Book Club)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className={inputClass}
          />

          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Create club'}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default CreateClub;
