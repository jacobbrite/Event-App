import Auth from './Auth';
import CreateEvent from './CreateEvent';
import EventList from './EventList';
import EventPage from './EventPage';
import ResetPassword from './ResetPassword';
import { Centered, ErrorScreen } from './Screens';
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

function App() {
  const [session, setSession] = useState(null);
  const [fetchedProfile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  // Which screen is showing: { name: 'list' } | { name: 'event', eventId }
  // | { name: 'create', template? }. Plain state, no router yet.
  const [view, setView] = useState({ name: 'list' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((authEvent, session) => {
      // Arriving from a password-reset email signs the user in with a temporary
      // session; hold them on the new-password form until they finish.
      if (authEvent === 'PASSWORD_RECOVERY') setIsRecovering(true);
      // Don't let the next person to log in land inside the last person's event.
      if (authEvent === 'SIGNED_OUT') setView({ name: 'list' });
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

  function retryProfile() {
    setProfileError(null);
    setProfileAttempt((n) => n + 1);
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
    return (
      <ErrorScreen
        title="Couldn't load your account"
        detail={profileError}
        onRetry={retryProfile}
        onLogout={handleLogout}
      />
    );
  }

  if (!profile) {
    return (
      <Centered>
        <p>Loading...</p>
      </Centered>
    );
  }

  if (view.name === 'create') {
    return (
      <CreateEvent
        template={view.template}
        onCancel={() => setView({ name: 'list' })}
        onCreated={(eventId) => setView({ name: 'event', eventId })}
      />
    );
  }

  if (view.name === 'event') {
    return (
      <EventPage
        eventId={view.eventId}
        profile={profile}
        session={session}
        onBack={() => setView({ name: 'list' })}
        onScheduleNext={(template) => setView({ name: 'create', template })}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <EventList
      profile={profile}
      session={session}
      onOpen={(eventId) => setView({ name: 'event', eventId })}
      onCreate={() => setView({ name: 'create' })}
      onLogout={handleLogout}
    />
  );
}

export default App;
