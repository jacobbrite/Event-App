import { useState, useEffect } from 'react';
import { searchBooks } from './bookApi';

const SOURCE_NAMES = { google: 'Google Books', openlibrary: 'Open Library' };

// Type-ahead book search. The cover, author, year and page count on each result
// are what let people tell apart books that share a title.
//   onPick(book): called with a book when someone taps a result or adds one by hand.
function BookSearch({ onPick, onCancel, busy }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // { source, books } for the latest search
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) return;

    const controller = new AbortController();
    // Wait for a pause in typing so we don't search on every keystroke.
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        setFound(await searchBooks(text, controller.signal));
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('Book search failed:', err);
          setFound(null);
          setError(
            "Book search isn't responding right now. Try again in a moment, or add the book by hand below.",
          );
        }
      }
      // Always clear the flag, including when this search was cancelled (e.g. the
      // text was deleted while it was running); otherwise it could stick on.
      setSearching(false);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const active = query.trim().length >= 3;
  const results = active ? found : null;

  return (
    <div className="border border-gray-200 rounded-xl p-4 mt-3">
      <input
        type="text"
        autoFocus
        placeholder="Search by title or author"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {active && searching && <p className="text-sm text-gray-500 mt-3">Searching...</p>}
      {active && error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {results && !searching && results.books.length === 0 && (
        <p className="text-sm text-gray-500 mt-3">No matches. Try fewer words, or add it by hand.</p>
      )}

      {results && !searching && results.books.length > 0 && (
        <>
          <p className="text-xs text-gray-400 mt-3 mb-2">
            Check the cover, author and year to be sure it's the right book.
          </p>
          <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {results.books.map((b) => (
              <li key={b.source_id}>
                <button
                  onClick={() => onPick(b)}
                  disabled={busy}
                  className="w-full flex gap-3 text-left py-2 px-1 hover:bg-blue-50 rounded disabled:opacity-50"
                >
                  {b.cover_url ? (
                    <img
                      src={b.cover_url}
                      alt=""
                      loading="lazy"
                      className="w-10 h-14 object-cover rounded bg-gray-100 shrink-0"
                    />
                  ) : (
                    <span className="w-10 h-14 rounded bg-gray-100 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 leading-snug">
                      {b.title}
                    </span>
                    <span className="block text-xs text-gray-600">{b.author ?? 'Unknown author'}</span>
                    <span className="block text-xs text-gray-400">
                      {[b.first_publish_year, b.page_count && `${b.page_count} pages`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 text-xs text-gray-400 flex items-center justify-between">
        <span>{results ? `Book data from ${SOURCE_NAMES[results.source]}` : ''}</span>
        <button onClick={onCancel} className="text-gray-500 hover:underline">
          Cancel
        </button>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        {!manual ? (
          <button onClick={() => setManual(true)} className="text-sm text-blue-600 hover:underline">
            Can't find it? Add it yourself
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onPick({
                source: null,
                source_id: null,
                title: manualTitle.trim(),
                author: manualAuthor.trim() || null,
                first_publish_year: null,
                page_count: null,
                isbn: null,
                cover_url: null,
              });
            }}
            className="space-y-2"
          >
            <input
              type="text"
              placeholder="Title"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              required
              maxLength={300}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="Author"
              value={manualAuthor}
              onChange={(e) => setManualAuthor(e.target.value)}
              maxLength={300}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !manualTitle.trim()}
              className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Use this book
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default BookSearch;
