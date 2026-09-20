import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import GuestPicker from './GuestPicker';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Create an event, choosing one-time or recurring and who to invite.
// With `template` (an existing recurring event) this is "schedule the next
// occurrence": details and the guest list are copied, only the date is new.
function CreateEvent({ template, onCancel, onCreated }) {
  const [kind, setKind] = useState('one-time');
  const [title, setTitle] = useState(template?.title ?? '');
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState(template?.location ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [selected, setSelected] = useState(new Set());
  const [loadingInvitees, setLoadingInvitees] = useState(!!template);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, isError }
  const [createdId, setCreatedId] = useState(null);

  useEffect(() => {
    if (!template) return;

    async function loadInvitees() {
      const { data, error } = await supabase
        .from('invitations')
        .select('user_id')
        .eq('event_id', template.id);

      if (error) {
        console.error('Error loading previous guest list:', error);
        setMessage({
          text: `Couldn't copy the previous guest list: ${error.message}`,
          isError: true,
        });
      } else {
        setSelected(new Set(data.map((r) => r.user_id)));
      }
      setLoadingInvitees(false);
    }

    loadInvitees();
  }, [template]);

  function handlePickerChange(userIds, checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      userIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    // Events in a series share a series_id; one-time events have none.
    const seriesId = template
      ? template.series_id
      : kind === 'recurring'
        ? crypto.randomUUID()
        : null;

    const { data: created, error } = await supabase
      .from('events')
      .insert({
        title,
        // datetime-local has no timezone; convert from the browser's local time
        // so the stored moment is right for everyone.
        event_time: new Date(eventTime).toISOString(),
        location,
        description,
        series_id: seriesId,
      })
      .select('id')
      .single();

    if (error) {
      setBusy(false);
      setMessage({ text: error.message, isError: true });
      return;
    }

    if (selected.size > 0) {
      const { error: inviteError } = await supabase
        .from('invitations')
        .insert([...selected].map((user_id) => ({ event_id: created.id, user_id })));

      if (inviteError) {
        console.error('Error inviting guests:', inviteError);
        setBusy(false);
        setCreatedId(created.id);
        setMessage({
          text: `The event was created, but inviting guests failed: ${inviteError.message}. Open the event and use "Manage invitations".`,
          isError: true,
        });
        return;
      }
    }

    onCreated(created.id);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:underline mb-4">
          ← All events
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {template ? 'Schedule next occurrence' : 'Create an Event'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!template && (
            <fieldset className="grid grid-cols-2 gap-2 mb-1">
              {[
                ['one-time', 'One-time event', 'A single date'],
                ['recurring', 'Recurring event', 'Repeats; copy it to schedule the next one'],
              ].map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`border rounded-xl px-3 py-2 cursor-pointer text-sm ${
                    kind === value ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="sr-only"
                  />
                  <span className="block font-semibold text-gray-900">{label}</span>
                  <span className="block text-xs text-gray-500">{hint}</span>
                </label>
              ))}
            </fieldset>
          )}

          <input
            type="text"
            placeholder="Event title"
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

          <div className="pt-2">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Invite guests
              {template && (
                <span className="font-normal text-gray-400"> (copied from last time)</span>
              )}
            </h2>
            {loadingInvitees ? (
              <p className="text-sm text-gray-500">Loading previous guest list...</p>
            ) : (
              <GuestPicker
                selectedIds={selected}
                onChange={handlePickerChange}
                disabled={busy}
              />
            )}
          </div>

          <button
            type="submit"
            disabled={busy || loadingInvitees || createdId !== null}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Creating...' : 'Create Event'}
          </button>
        </form>

        {message && (
          <p
            className={`mt-4 text-center text-sm ${
              message.isError ? 'text-red-600' : 'text-green-700'
            }`}
          >
            {message.text}
          </p>
        )}

        {createdId !== null && (
          <button
            onClick={() => onCreated(createdId)}
            className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
          >
            Open the event
          </button>
        )}
      </div>
    </div>
  );
}

export default CreateEvent;
