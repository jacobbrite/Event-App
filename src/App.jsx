import Auth from './Auth';
import CreateEvent from './CreateEvent';
import GuestList from './GuestList';
import ResetPassword from './ResetPassword';
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Events stay visible for this long after they start, so the page doesn't
// disappear on guests (or the host checking the list) the moment a party begins.
const EVENT_GRACE_MS = 6 * 60 * 60 * 1000;

function Centered({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full text-center text-gray-700">{children}</div>
    </div>
  );
}

function ErrorScreen({ title, detail, onRetry, onLogout }) {
  return (
    <Centered>
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500 mb-6">{detail}</p>
        <button
          onClick={onRetry}
          className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
        >
          Try again
        </button>
        <button
          onClick={onLogout}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          Log Out
        </button>
      </div>
    </Centered>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [fetchedProfile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [event, setEvent] = useState(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [eventError, setEventError] = useState(null);
  const [eventAttempt, setEventAttempt] = useState(0);
  const [fetchedRsvp, setRsvp] = useState(null);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((authEvent, session) => {
      // Arriving from a password-reset email signs the user in with a temporary
      // session; hold them on the new-password form until they finish.
      if (authEvent === 'PASSWORD_RECOVERY') setIsRecovering(true);
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    async function fetchProfile() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, is_host')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) console.error('Error loading profile:', error);
      setProfileError(error ? error.message : data ? null : 'No profile was found for this account.');
      setProfile(data);
    }

    fetchProfile();
  }, [session, profileAttempt]);

  useEffect(() => {
    async function fetchEvent() {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .gte('event_time', new Date(Date.now() - EVENT_GRACE_MS).toISOString())
        .order('event_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) console.error('Error loading event:', error);
      setEventError(error ? error.message : null);
      setEvent(data);
      setLoadingEvent(false);
    }

    fetchEvent();
  }, [eventAttempt]);

  function refreshEvent() {
    setLoadingEvent(true);
    setEventError(null);
    setEventAttempt((n) => n + 1);
  }

  function retryProfile() {
    setProfileError(null);
    setProfileAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (!session || !event) return;

    async function checkRSVP() {
      const { data, error } = await supabase
        .from('rsvps')
        .select('id, user_id, status')
        .eq('user_id', session.user.id)
        .eq('event_id', event.id)
        .maybeSingle();

      if (error) console.error('Error checking RSVP:', error);
      setRsvp(data);
    }

    checkRSVP();
  }, [session, event]);

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

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (!session) {
    return <Auth />;
  }

  if (isRecovering) {
    return <ResetPassword onDone={() => setIsRecovering(false)} />;
  }

  // Ignore a profile left over from a previous login until the new one loads.
  const profile = fetchedProfile?.id === session.user.id ? fetchedProfile : null;
  const rsvp = fetchedRsvp?.user_id === session.user.id ? fetchedRsvp : null;
  const isGoing = rsvp?.status === 'going';

  if (profileError) {
    return (
      <ErrorScreen
        title="Couldn't load your account"
        detail={profileError}
        onRetry={retryProfile}
        onLogout={handleLogout}
      />
    );
  }

  if (eventError) {
    return (
      <ErrorScreen
        title="Couldn't load the event"
        detail={eventError}
        onRetry={refreshEvent}
        onLogout={handleLogout}
      />
    );
  }

  if (loadingEvent || !profile) {
    return (
      <Centered>
        <p>Loading...</p>
      </Centered>
    );
  }

  if (!event) {
    if (profile.is_host) {
      return <CreateEvent onEventCreated={refreshEvent} />;
    }
    return (
      <Centered>
        <p>No upcoming events yet — check back soon!</p>
        <button
          onClick={handleLogout}
          className="mt-6 text-sm text-gray-500 hover:underline"
        >
          Log Out
        </button>
      </Centered>
    );
  }

  const eventDate = new Date(event.event_time);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.title}</h1>
        <p className="text-blue-600 font-medium mb-1">
          {eventDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}{' '}
          ·{' '}
          {eventDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
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

        {rsvpError && (
          <p className="mt-3 text-center text-sm text-red-600">{rsvpError}</p>
        )}

        {profile.is_host && <GuestList eventId={event.id} refreshKey={rsvp?.status} />}

        <button
          onClick={handleLogout}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}

export default App;
