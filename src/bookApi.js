// Book search. Google Books is the main source: it answers in ~100ms, has good
// covers and covers new releases. It needs an API key (VITE_GOOGLE_BOOKS_API_KEY,
// restricted to our site in Google Cloud). Open Library is the fallback: free and
// keyless, but often slow, so every request has a hard timeout and nothing here
// can leave the screen "Searching..." forever.
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;

export const HAS_GOOGLE_BOOKS = Boolean(GOOGLE_KEY);

// fetch() that gives up after `timeoutMs`. If the caller aborts (they typed
// another letter), that AbortError is passed through untouched.
async function fetchJson(url, callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const relay = () => controller.abort();
  callerSignal.addEventListener('abort', relay);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (timedOut) throw new Error('timed out', { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal.removeEventListener('abort', relay);
  }
}

// The same book often appears as several editions (hardback, ebook...). Keep the
// first of each title + author so the list is short enough to scan.
function dedupe(books) {
  const seen = new Set();
  return books.filter((b) => {
    const key = `${b.title}|${b.author}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchGoogle(query, signal) {
  const params = new URLSearchParams({
    q: query,
    maxResults: '20',
    printType: 'books',
    fields:
      'items(id,volumeInfo(title,authors,publishedDate,pageCount,industryIdentifiers,imageLinks))',
    key: GOOGLE_KEY,
  });
  const json = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?${params}`,
    signal,
    5000,
  );

  const books = (json.items ?? [])
    .filter((item) => item.volumeInfo?.title)
    .map((item) => {
      const v = item.volumeInfo;
      const ids = v.industryIdentifiers ?? [];
      const isbn =
        ids.find((i) => i.type === 'ISBN_13')?.identifier ??
        ids.find((i) => i.type === 'ISBN_10')?.identifier ??
        null;
      const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null;
      const year = parseInt(v.publishedDate?.slice(0, 4), 10);

      return {
        source: 'google',
        source_id: item.id,
        title: v.title,
        author: v.authors?.[0] ?? null,
        first_publish_year: Number.isNaN(year) ? null : year,
        page_count: v.pageCount > 0 ? v.pageCount : null,
        isbn,
        // Google serves these over http and adds a page-curl effect; ask for plain https.
        cover_url: thumb ? thumb.replace('http://', 'https://').replace('&edge=curl', '') : null,
      };
    });

  return dedupe(books).slice(0, 10);
}

async function searchOpenLibrary(query, signal) {
  const fields = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,isbn';
  const json = await fetchJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=${fields}`,
    signal,
    8000,
  );

  return json.docs.map((doc) => {
    const isbns = doc.isbn ?? [];
    return {
      source: 'openlibrary',
      source_id: doc.key,
      title: doc.title,
      author: doc.author_name?.[0] ?? null,
      first_publish_year: doc.first_publish_year ?? null,
      page_count: doc.number_of_pages_median ?? null,
      isbn:
        isbns.find((i) => /^\d{13}$/.test(i)) ?? isbns.find((i) => /^\d{9}[\dX]$/.test(i)) ?? null,
      cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    };
  });
}

// Returns { source, books }. Throws if every source failed (or if `signal` was
// aborted, which callers should treat as "ignore this search").
export async function searchBooks(query, signal) {
  if (GOOGLE_KEY) {
    try {
      return { source: 'google', books: await searchGoogle(query, signal) };
    } catch (err) {
      if (signal.aborted) throw err;
      console.warn('Google Books search failed, trying Open Library:', err);
    }
  }
  return { source: 'openlibrary', books: await searchOpenLibrary(query, signal) };
}
