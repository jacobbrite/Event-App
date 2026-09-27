import { useState } from 'react';
import { supabase } from './supabaseClient';
import { PageHeader } from './Screens';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

// An owner starts a book vote: how many books each member may suggest, then the
// club suggests, votes, and the owner closes it and picks the winner.
function CreateRound({ club, onCancel, onCreated, onLogout }) {
  const [title, setTitle] = useState('');
  const [maxPerMember, setMaxPerMember] = useState(2);
  const [method, setMethod] = useState('approval');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const { data, error } = await supabase.rpc('create_book_round', {
      p_club_id: club.id,
      p_title: title,
      p_max_per_member: maxPerMember,
      p_method: method,
    });
    setBusy(false);

    if (error) {
      console.error('Error starting book vote:', error);
      setError(error.message);
      return;
    }
    onCreated(data);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader backLabel={club.name} onBack={onCancel} onLogout={onLogout} />
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Start a book vote</h1>
        <p className="text-sm text-gray-500 mb-6">
          Members suggest books, then everyone votes. You close the vote and pick the winner.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="What are we choosing? (e.g. November pick)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
            className={inputClass}
          />

          <label className="block">
            <span className="block text-sm font-semibold text-gray-700 mb-1">
              Books each member can suggest
            </span>
            <select
              value={maxPerMember}
              onChange={(e) => setMaxPerMember(Number(e.target.value))}
              className={`${inputClass} bg-white`}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="text-sm font-semibold text-gray-700 mb-2">How will you vote?</legend>
            <div className="space-y-2">
              {[
                [
                  'approval',
                  'Approval vote',
                  "Everyone ticks every book they'd be happy to read. Most ticks wins.",
                ],
                [
                  'bracket',
                  'Bracket',
                  'Head-to-head matches, round by round, until one book is left. Great in person.',
                ],
              ].map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`block border rounded-xl px-4 py-3 text-sm cursor-pointer ${
                    method === value ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={value}
                    checked={method === value}
                    onChange={() => setMethod(value)}
                    className="sr-only"
                  />
                  <span className="block font-semibold text-gray-900">{label}</span>
                  <span className="block text-xs text-gray-600">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Starting...' : 'Start the vote'}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default CreateRound;
