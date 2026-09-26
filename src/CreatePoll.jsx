import { useState } from 'react';
import { supabase } from './supabaseClient';
import HostPicker from './HostPicker';
import { PageHeader } from './Screens';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

const MIN_TIMES = 2;
const MAX_TIMES = 8;

// A club owner proposes several possible times for the next meeting; members vote;
// an owner then picks one, which creates the meeting. Details are pre-filled from the
// previous meeting (`template`) like "schedule the next meeting".
function CreatePoll({ club, template, onCancel, onCreated, onLogout }) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [location, setLocation] = useState(template?.location ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [hostedBy, setHostedBy] = useState(null);
  const [times, setTimes] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function setTimeAt(index, value) {
    setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // datetime-local has no timezone; convert from the browser's local time.
    const isos = times.filter(Boolean).map((t) => new Date(t).toISOString());
    if (new Set(isos).size < MIN_TIMES) {
      setError(`Propose at least ${MIN_TIMES} different times.`);
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc('create_meeting_poll', {
      p_club_id: club.id,
      p_title: title,
      p_location: location,
      p_description: description,
      p_hosted_by: hostedBy,
      p_times: isos,
    });
    setBusy(false);

    if (error) {
      console.error('Error creating poll:', error);
      setError(error.message);
      return;
    }

    onCreated(data);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader backLabel={club.name} onBack={onCancel} onLogout={onLogout} />
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Find a time</h1>
        <p className="text-sm text-gray-500 mb-6">
          Propose a few times. Members vote, then you pick the winner and the meeting is created.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Title (e.g. November meeting)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
            className={inputClass}
          />
          <textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={3}
            className={inputClass}
          />
          <HostPicker clubId={club.id} value={hostedBy} onChange={setHostedBy} />

          <fieldset className="pt-2">
            <legend className="text-sm font-semibold text-gray-700 mb-2">Possible times</legend>
            <div className="space-y-2">
              {times.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={t}
                    onChange={(e) => setTimeAt(i, e.target.value)}
                    required={i < MIN_TIMES}
                    className={inputClass}
                  />
                  {times.length > MIN_TIMES && (
                    <button
                      type="button"
                      onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove this time"
                      className="text-gray-400 hover:text-red-600 px-2"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {times.length < MAX_TIMES && (
              <button
                type="button"
                onClick={() => setTimes((prev) => [...prev, ''])}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                + Add another time
              </button>
            )}
          </fieldset>

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Start the poll'}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default CreatePoll;
