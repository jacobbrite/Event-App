import { useState } from 'react';
import { supabase } from './supabaseClient';

function App() {
  const [isGoing, setIsGoing] = useState(false);
  const [name, setName] = useState('');
const [email, setEmail] = useState('');
  const event = {
    title: "New Year's Eve Party",
    date: "Thursday, December 31, 2026",
    time: "8:00 PM",
    location: "Salt Lake City, UT (venue TBD)",
    description: "A New Year's event to kickoff a year of making connections and deepening relationships.",
  };
async function handleSubmit(e) {
  e.preventDefault();

  const { error } = await supabase.from('rsvps').insert({ name, email });

  if (error) {
    console.error('Error saving RSVP:', error);
    alert('Something went wrong. Please try again.');
    return;
  }

  setIsGoing(true);
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
  <form onSubmit={handleSubmit} className="mt-6 space-y-3">
    <input
      type="text"
      placeholder="Your name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      required
      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    <input
      type="email"
      placeholder="Your email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      required
      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    <button
      type="submit"
      className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
    >
      RSVP
    </button>
  </form>
)}
      </div>
    </div>
  );
}

export default App;