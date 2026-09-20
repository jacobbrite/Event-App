import { useState } from 'react';
import { supabase } from './supabaseClient';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Schedule an event (a meeting) in a club. With `template` (the club's previous
// event) the details are pre-filled so you only need to pick a new date.
function CreateEvent({ club, template, onCancel, onCreated }) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState(template?.location ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const { data, error } = await supabase
      .from('events')
      .insert({
        club_id: club.id,
        title,
        // datetime-local has no timezone; convert from the browser's local time
        // so the stored moment is right for everyone.
        event_time: new Date(eventTime).toISOString(),
        location,
        description,
      })
      .select('id')
      .single();

    setBusy(false);

    if (error) {
      console.error('Error creating event:', error);
      setError(error.message);
      return;
    }

    onCreated(data.id);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:underline mb-4">
          ← {club.name}
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {template ? 'Schedule the next meeting' : 'Schedule a meeting'}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Everyone in {club.name} will be able to see it and RSVP.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Title (e.g. October meeting)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={inputClass}
          />
          <input
            type="datetime-local"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
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
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Create event'}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default CreateEvent;
