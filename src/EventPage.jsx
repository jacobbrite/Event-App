import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import GuestList from './GuestList';
import InviteManager from './InviteManager';
import { Centered, ErrorScreen } from './Screens';
import { formatEventTime } from './formatEventTime';

function EventPage({ eventId, profile, session, onBack, onScheduleNext, onLogout }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [fetchedRsvp, setRsvp] = useState(null);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState(null);
  const [showInvites, setShowInvites] = useState(false);
  const [guestVersion, setGuestVersion] = useState(0);

  useEffect(() => {
    async function load() {
      const [eventRes, rsvpRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
        supabase
          .from('rsvps')
          .select('id, user_id, status')
          .eq('user_id', session.user.id)
          .eq('event_id', eventId)
          .maybeSingle(),
      ]);

      const failure = eventRes.error || rsvpRes.error;
      if (failure) console.error('Error loading event:', failure);
      setLoadError(failure ? failure.message : null);
      setEvent(eventRes.data);
      setRsvp(rsvpRes.data);
      setLoading(false);
    }

    load();
  }, [eventId, session.user.id, attempt]);

  function retry() {
    setLoading(true);
    setLoadError(null);
    setAttempt((n) => n + 1);
  }

  const rsvp = fetchedRsvp?.user_id === session.user.id ? fetchedRsvp : null;
  const isGoing = rsvp?.status === 'going';

  async function handleRSVP() {
    setRsvpBusy(true);
    setRsvpError(null);

    // A guest who cancelled already has a row (one per user per event), so
    // re-RSVPing flips that row back instead of inserting a new one.
    const request = rsvp
      ? supabase.from('rsvps').update({ status: 'going' }).eq('id', rsvp.id)
      : supabase.from('rsvps').insert({
          name: `${profile.first_name} ${profile.last_name}`,
          email: session.user.email,
          event_id: event.id,
        });

    const { data, error } = await request.select('id, user_id, status').single();
    setRsvpBusy(false);

    if (error) {
      console.error('Error saving RSVP:', error);
      setRsvpError("Couldn't save your RSVP. Please try again.");
      return;
    }

    setRsvp(data);
  }

  async function handleUnRSVP() {
    setRsvpBusy(true);
    setRsvpError(null);

    const { data, error } = await supabase
      .from('rsvps')
      .update({ status: 'cancelled' })
      .eq('id', rsvp.id)
      .select('id, user_id, status')
      .single();
    setRsvpBusy(false);

    if (error) {
      console.error('Error cancelling RSVP:', error);
      setRsvpError("Couldn't cancel your RSVP. Please try again.");
      return;
    }

    setRsvp(data);
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
      <ErrorScreen
        title="Couldn't load the event"
        detail={loadError}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  if (!event) {
    return (
      <Centered>
        <p>This event doesn't exist, or you haven't been invited to it.</p>
        <button onClick={onBack} className="mt-6 text-sm text-blue-600 underline">
          ← All events
        </button>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <button onClick={onBack} className="text-sm text-gray-500 hover:underline mb-4">
          ← All events
        </button>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.title}</h1>
        {event.series_id && profile.is_host && (
          <p className="text-xs font-medium text-purple-700 bg-purple-50 rounded-full px-2 py-0.5 inline-block mb-2">
            Recurring
          </p>
        )}
        <p className="text-blue-600 font-medium mb-1">{formatEventTime(event.event_time)}</p>
        <p className="text-gray-500 mb-4">{event.location}</p>
        <p className="text-gray-700">{event.description}</p>

        {isGoing ? (
          <div className="mt-6 text-center">
            <p className="text-green-600 font-semibold mb-3">You're going! 🎉</p>
            <button
              onClick={handleUnRSVP}
              disabled={rsvpBusy}
              className="text-sm text-gray-500 hover:text-red-600 underline disabled:opacity-50"
            >
              {rsvpBusy ? 'Cancelling...' : 'Cancel RSVP'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleRSVP}
            disabled={rsvpBusy}
            className="mt-6 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {rsvpBusy ? 'Saving...' : 'RSVP'}
          </button>
        )}

        {rsvpError && <p className="mt-3 text-center text-sm text-red-600">{rsvpError}</p>}

        {profile.is_host && (
          <>
            <GuestList eventId={event.id} refreshKey={`${rsvp?.status}-${guestVersion}`} />

            <button
              onClick={() => setShowInvites(!showInvites)}
              className="mt-4 w-full border border-gray-300 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
            >
              {showInvites ? 'Hide invitations' : 'Manage invitations'}
            </button>
            {showInvites && (
              <InviteManager
                eventId={event.id}
                onChange={() => setGuestVersion((n) => n + 1)}
              />
            )}

            {event.series_id && (
              <button
                onClick={() => onScheduleNext(event)}
                className="mt-3 w-full border border-purple-300 text-purple-700 font-semibold py-2 rounded-lg hover:bg-purple-50 transition"
              >
                Schedule next occurrence
              </button>
            )}
          </>
        )}

        <button
          onClick={onLogout}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}

export default EventPage;
