import Auth from './Auth';
import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

function App() {
  const [isGoing, setIsGoing] = useState(false);
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

useEffect(() => {
  if (!session) return;

  async function checkRSVP() {
    const { data } = await supabase
      .from('rsvps')
      .select('id')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (data) {
      setIsGoing(true);
    }
  }

  checkRSVP();
}, [session]);

  const event = {
    title: "New Year's Eve Party",
    date: "Thursday, December 31, 2026",
    time: "8:00 PM",
    location: "Salt Lake City, UT (venue TBD)",
    description: "A New Year's event to kickoff a year of making connections and deepening relationships.",
  };

  async function handleRSVP() {
    const name = session.user.user_metadata.name;
    const email = session.user.email;

    const { error } = await supabase.from('rsvps').insert({ name, email });

    if (error) {
      console.error('Error saving RSVP:', error);
      alert('Something went wrong. Please try again.');
      return;
    }

    setIsGoing(true);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.title}</h1>
        <p className="text-blue-600 font-medium mb-1">
          {event.date} · {event.time}
        </p>
        <p className="text-gray-500 mb-4">{event.location}</p>
        <p className="text-gray-700">{event.description}</p>

        {isGoing ? (
          <p className="mt-6 text-center text-green-600 font-semibold">
            You're going! 🎉
          </p>
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