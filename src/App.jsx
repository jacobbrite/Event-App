import Auth from './Auth';
import ClubPage from './ClubPage';
import CreateClub from './CreateClub';
import CreateEvent from './CreateEvent';
import CreatePoll from './CreatePoll';
import CreateRound from './CreateRound';
import EditEvent from './EditEvent';
import EventList from './EventList';
import EventPage from './EventPage';
import JoinScreen from './JoinScreen';
import PollPage from './PollPage';
import RoundPage from './RoundPage';
import ProfilePage from './ProfilePage';
import ResetPassword from './ResetPassword';
import { Centered, ErrorScreen } from './Screens';
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// A club's join link looks like https://events.britewing.com/?join=<code>.
// The code is stashed in localStorage so it survives signing up, the Google
// redirect and email confirmation, then removed from the address bar.
function readPendingJoin() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('join');
    if (fromUrl) {
      localStorage.setItem('pendingJoin', fromUrl);
      window.history.replaceState({}, '', window.location.pathname);
      return fromUrl;
    }
    return localStorage.getItem('pendingJoin');
  } catch {
    return null;
  }
}

function App() {
  const [session, setSession] = useState(null);
  const [fetchedProfile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingJoin, setPendingJoin] = useState(readPendingJoin);
  // Which screen is showing (plain state, no router yet):
  // { name: 'list' } | { name: 'club', clubId } | { name: 'event', eventId, clubId }
  // | { name: 'createClub' } | { name: 'createEvent', club?, template? } | { name: 'profile' }
  // | { name: 'editEvent', eventId } | { name: 'poll', pollId } | { name: 'createPoll', club, template? }
  // | { name: 'round', roundId } | { name: 'createRound', club }
  const [view, setView] = useState({ name: 'list' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((authEvent, session) => {
      // Arriving from a password-reset email signs the user in with a temporary
      // session; hold them on the new-password form until they finish.
      if (authEvent === 'PASSWORD_RECOVERY') setIsRecovering(true);
      // Don't let the next person to log in land inside the last person's club.
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
        .select('id, first_name, last_name, is_organizer, is_admin, allowed_types, avatar_url')
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

  function clearPendingJoin() {
    try {
      localStorage.removeItem('pendingJoin');
    } catch {
      // storage unavailable: nothing to clear
    }
    setPendingJoin(null);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (!session) {
    return <Auth joinCode={pendingJoin} />;
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

  if (pendingJoin) {
    return (
      <JoinScreen
        code={pendingJoin}
        onJoined={(clubId, eventId) => {
          clearPendingJoin();
          setView(eventId ? { name: 'event', eventId, clubId } : { name: 'club', clubId });
        }}
        onCancel={clearPendingJoin}
      />
    );
  }

  const goHome = () => setView({ name: 'list' });

  if (view.name === 'profile') {
    return (
      <ProfilePage
        profile={profile}
        email={session.user.email}
        onBack={goHome}
        onSaved={(updates) => setProfile({ ...profile, ...updates })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'createClub') {
    return (
      <CreateClub
        profile={profile}
        onCancel={goHome}
        onCreated={(clubId) => setView({ name: 'club', clubId })}
        onLogout={handleLogout}
      />
    );
  }

  // A one-time event has no club (club is null); a meeting belongs to `view.club`.
  if (view.name === 'createEvent') {
    return (
      <CreateEvent
        club={view.club ?? null}
        template={view.template}
        onCancel={() => (view.club ? setView({ name: 'club', clubId: view.club.id }) : goHome())}
        onCreated={(eventId) => setView({ name: 'event', eventId })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'editEvent') {
    return (
      <EditEvent
        eventId={view.eventId}
        session={session}
        onBack={() => setView({ name: 'event', eventId: view.eventId })}
        onSaved={() => setView({ name: 'event', eventId: view.eventId })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'createPoll') {
    return (
      <CreatePoll
        club={view.club}
        template={view.template}
        onCancel={() => setView({ name: 'club', clubId: view.club.id })}
        onCreated={(pollId) => setView({ name: 'poll', pollId })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'createRound') {
    return (
      <CreateRound
        club={view.club}
        onCancel={() => setView({ name: 'club', clubId: view.club.id })}
        onCreated={(roundId) => setView({ name: 'round', roundId })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'round') {
    return (
      <RoundPage
        roundId={view.roundId}
        session={session}
        onBack={(clubId) => setView({ name: 'club', clubId })}
        onOpenEvent={(eventId) => setView({ name: 'event', eventId })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'poll') {
    return (
      <PollPage
        pollId={view.pollId}
        session={session}
        onBack={(clubId) => setView({ name: 'club', clubId })}
        onOpenEvent={(eventId) => setView({ name: 'event', eventId })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'club') {
    return (
      <ClubPage
        clubId={view.clubId}
        session={session}
        onBack={goHome}
        onOpenEvent={(eventId) => setView({ name: 'event', eventId, clubId: view.clubId })}
        onSchedule={(club, template) => setView({ name: 'createEvent', club, template })}
        onOpenPoll={(pollId) => setView({ name: 'poll', pollId })}
        onCreatePoll={(club, template) => setView({ name: 'createPoll', club, template })}
        onOpenRound={(roundId) => setView({ name: 'round', roundId })}
        onCreateRound={(club) => setView({ name: 'createRound', club })}
        onLogout={handleLogout}
      />
    );
  }

  if (view.name === 'event') {
    return (
      <EventPage
        eventId={view.eventId}
        profile={profile}
        session={session}
        onBack={goHome}
        onOpenClub={(clubId) => setView({ name: 'club', clubId })}
        onScheduleNext={(club, template) => setView({ name: 'createEvent', club, template })}
        onEdit={() => setView({ name: 'editEvent', eventId: view.eventId })}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <EventList
      profile={profile}
      session={session}
      onOpenEvent={(eventId, clubId) => setView({ name: 'event', eventId, clubId })}
      onOpenClub={(clubId) => setView({ name: 'club', clubId })}
      onCreateClub={() => setView({ name: 'createClub' })}
      onCreateEvent={() => setView({ name: 'createEvent' })}
      onOpenPoll={(pollId) => setView({ name: 'poll', pollId })}
      onOpenRound={(roundId) => setView({ name: 'round', roundId })}
      onProfile={() => setView({ name: 'profile' })}
      onLogout={handleLogout}
    />
  );
}

export default App;
