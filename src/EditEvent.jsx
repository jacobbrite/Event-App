import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import HostPicker from './HostPicker';
import { Centered, PageHeader } from './Screens';
import { ONE_TIME } from './clubTypes';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500';

// An ISO timestamp as the "YYYY-MM-DDTHH:mm" text a datetime-local input wants,
// in the viewer's own timezone.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Edit an event. A club owner can change everything. The host of this
// particular meeting can change only the location and description (the database
// enforces this in update_event(); the disabled fields here just match it).
function EditEvent({ eventId, session, onBack, onSaved, onLogout }) {
  const [event, setEvent] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [title, setTitle] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [hostedBy, setHostedBy] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('events')
        .select('*, clubs(id, name, type)')
        .eq('id', eventId)
        .maybeSingle();

      if (error || !data) {
        setLoadError(error?.message ?? "This event doesn't exist, or you can't see it.");
        setLoading(false);
        return;
      }

      const { data: owner } = await supabase.rpc('is_club_owner', { p_club_id: data.club_id });

      setEvent(data);
      setIsOwner(owner === true);
      setTitle(data.title);
      setEventTime(toLocalInput(data.event_time));
      setLocation(data.location);
      setDescription(data.description);
      setHostedBy(data.hosted_by);
      setLoading(false);
    }

    load();
  }, [eventId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    // The host of a meeting can't change these three, so send the current values back
    // untouched (the database rejects any difference).
    const { error } = await supabase.rpc('update_event', {
      p_event_id: event.id,
      p_title: isOwner ? title : event.title,
      p_event_time: isOwner ? new Date(eventTime).toISOString() : event.event_time,
      p_location: location,
      p_description: description,
      p_hosted_by: isOwner ? hostedBy : event.hosted_by,
    });

    setBusy(false);
    if (error) {
      console.error('Error editing event:', error);
      setError(error.message);
      return;
    }

    onSaved();
  }

  if (loading) {
    return (
      <Centered>
        <p>Loading...</p>
      </Centered>
    );
  }

  if (loadError) {
    return (
      <Centered>
        <p>{loadError}</p>
        <button onClick={onBack} className="mt-6 text-sm text-blue-600 underline">
          ← Back
        </button>
      </Centered>
    );
  }

  const isOneTime = event.clubs?.type === ONE_TIME;
  const canEditAll = isOwner;
  const isMeetingHost = event.hosted_by === session.user.id;

  if (!canEditAll && !isMeetingHost) {
    return (
      <Centered>
        <p>Only an owner of this club, or the host of this meeting, can edit it.</p>
        <button onClick={onBack} className="mt-6 text-sm text-blue-600 underline">
          ← Back
        </button>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader backLabel="Back to event" onBack={onBack} onLogout={onLogout} />
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Edit event</h1>
        {!canEditAll && (
          <p className="text-sm text-gray-500 mb-6">
            You're hosting this meeting, so you can change the location and description. A club
            owner can change the rest.
          </p>
        )}
        {canEditAll && <div className="mb-6" />}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={!canEditAll}
            className={inputClass}
          />
          <input
            type="datetime-local"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
            required
            disabled={!canEditAll}
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
          {canEditAll && !isOneTime && (
            <HostPicker clubId={event.club_id} value={hostedBy} onChange={setHostedBy} />
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default EditEvent;
