// A book as members see it: cover, title, author, year and pages, plus links to
// find it or read about it elsewhere. Links are built from the ISBN when we have
// one (exact edition) and from the title and author otherwise.
function BookCard({ book }) {
  const query = encodeURIComponent([book.title, book.author].filter(Boolean).join(' '));

  const links = [
    {
      label: 'Goodreads',
      href: book.isbn
        ? `https://www.goodreads.com/book/isbn/${book.isbn}`
        : `https://www.goodreads.com/search?q=${query}`,
    },
    {
      label: 'StoryGraph',
      href: `https://app.thestorygraph.com/browse?search_term=${query}`,
    },
    { label: 'Bookshop', href: `https://bookshop.org/search?keywords=${query}` },
    {
      label: 'Find at a library',
      href: `https://search.worldcat.org/search?q=${book.isbn ?? query}`,
    },
  ];

  const facts = [
    book.first_publish_year && `First published ${book.first_publish_year}`,
    book.page_count && `${book.page_count} pages`,
  ].filter(Boolean);

  return (
    <div className="flex gap-4">
      {book.cover_url ? (
        <img
          src={book.cover_url}
          alt={`Cover of ${book.title}`}
          className="w-20 h-28 object-cover rounded-md shadow bg-gray-100 shrink-0"
        />
      ) : (
        <div className="w-20 h-28 rounded-md bg-gray-100 text-gray-400 text-xs flex items-center justify-center text-center p-2 shrink-0">
          No cover
        </div>
      )}
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 leading-snug">{book.title}</p>
        {book.author && <p className="text-sm text-gray-600">{book.author}</p>}
        {facts.length > 0 && <p className="text-xs text-gray-400 mt-1">{facts.join(' · ')}</p>}
        <p className="mt-2 text-xs leading-relaxed">
          {links.map((l, i) => (
            <span key={l.label}>
              {i > 0 && <span className="text-gray-300"> · </span>}
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {l.label}
              </a>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

export default BookCard;
