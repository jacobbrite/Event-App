function App() {
  const event = {
    title: "New Year's Eve Party",
    date: "Thursday, December 31, 2026",
    time: "8:00 PM",
    location: "Salt Lake City, UT (venue TBD)",
    description: "A New Year's event to kickoff a year of making connections and deepening relationships.",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.title}</h1>
        <p className="text-blue-600 font-medium mb-1">
          {event.date} · {event.time}
        </p>
        <p className="text-gray-500 mb-4">{event.location}</p>
        <p className="text-gray-700">{event.description}</p>
      </div>
    </div>
  );
}

export default App;