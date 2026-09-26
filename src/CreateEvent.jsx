import { useState } from 'react';
import { supabase } from './supabaseClient';
import HostPicker from './HostPicker';
import { PageHeader } from './Screens';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Two uses:
//  - with `club`: schedule a meeting in that club (pre-filled from `template`,
//    the previous meeting, so you only pick a new date);
//  - without a club: create a one-time event on its own.
function CreateEvent({ club, template, onCancel, onCreated, onLogout }) {
  const [title, setTitle] = useState(template?.title ?? '');
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState(template?.location ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [hostedBy, setHostedBy] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    // datetime-local has no timezone; convert from the browser's local time so
    // the stored moment is right for everyone.
    const when = new Date(eventTime).toISOString();

    let eventId;
    let failure;

    if (club) {
      const { data, error } = await supabase
        .from('events')
        .insert({
          club_id: club.id,
          title,
          event_time: when,
          location,
          description,
          hosted_by: hostedBy,
        })
        .select('id')
        .single();
      eventId = data?.id;
      failure = error;
    } else {
      // One function creates the hidden club and the event together, so a
      // failure can't leave one without the other.
      const { data, error } = await supabase.rpc('create_one_time_event', {
        p_title: title,
        p_event_time: when,
        p_location: location,
        p_description: description,
      });
      eventId = data;
      failure = error;
    }

    setBusy(false);

    if (failure) {
      console.error('Error creating event:', failure);
      setError(failure.message);
      return;
    }

    onCreated(eventId);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader
          backLabel={club ? club.name : 'My events'}
          onBack={onCancel}
          onLogout={onLogout}
        />
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {!club ? 'Create an event' : template ? 'Schedule the next meeting' : 'Schedule a meeting'}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {club
            ? `Everyone in ${club.name} will be able to see it and RSVP.`
            : "It's a single event. You'll get a private link to invite guests once it's created."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder={club ? 'Title (e.g. October meeting)' : 'Event title'}
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
          {club && <HostPicker clubId={club.id} value={hostedBy} onChange={setHostedBy} />}
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
