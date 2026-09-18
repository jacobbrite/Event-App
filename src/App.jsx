import Auth from './Auth';
import CreateEvent from './CreateEvent';
import ResetPassword from './ResetPassword';
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [fetchedProfile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [event, setEvent] = useState(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [isGoing, setIsGoing] = useState(false);

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
      setProfileError(error ? error.message : data ? null : 'No profile row found for this user.');
      setProfile(data);
    }

    fetchProfile();
  }, [session]);

  async function fetchEvent() {
    setLoadingEvent(true);
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('event_time', { ascending: true })
      .limit(1)
      .maybeSingle();

    setEvent(data);
    setLoadingEvent(false);
  }

  useEffect(() => {
    fetchEvent();
  }, []);

  useEffect(() => {
    if (!session || !event) return;

    async function checkRSVP() {
      const { data } = await supabase
        .from('rsvps')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('event_id', event.id)
        .maybeSingle();

      setIsGoing(!!data);
    }

    checkRSVP();
  }, [session, event]);

  async function handleRSVP() {
    const name = `${profile.first_name} ${profile.last_name}`;
    const email = session.user.email;

    const { error } = await supabase.from('rsvps').insert({
      name,
      email,
      event_id: event.id,
    });

    if (error) {
      console.error('Error saving RSVP:', error);
      alert('Something went wrong. Please try again.');
      return;
    }

    setIsGoing(true);
  }

  async function handleUnRSVP() {
    const { error } = await supabase
      .from('rsvps')
      .delete()
      .eq('user_id', session.user.id)
      .eq('event_id', event.id);

    if (error) {
      console.error('Error removing RSVP:', error);
      alert('Something went wrong. Please try again.');
      return;
    }

    setIsGoing(false);
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

  if (profileError) {
    return <p className="text-center mt-20">Couldn't load your profile: {profileError}</p>;
  }

  if (loadingEvent || !profile) {
    return <p className="text-center mt-20">Loading...</p>;
  }

  if (!event) {
    if (profile.is_host) {
      return <CreateEvent onEventCreated={fetchEvent} />;
    }
    return <p className="text-center mt-20">No upcoming events yet — check back soon!</p>;
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
              className="text-sm text-gray-500 hover:text-red-600 underline"
            >
              Cancel RSVP
            </button>
          </div>
        ) : (
          <button
            onClick={handleRSVP}
            className="mt-6 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
          >
            RSVP
          </button>
        )}

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