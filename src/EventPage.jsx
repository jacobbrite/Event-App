import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import BookCard from './BookCard';
import BookSearch from './BookSearch';
import GuestList from './GuestList';
import InviteLink from './InviteLink';
import { Centered, ErrorScreen, PageHeader } from './Screens';
import { ONE_TIME } from './clubTypes';
import { formatEventTime } from './formatEventTime';
import { fullName } from './names';
import { RSVP_OPTIONS, RSVP_MESSAGES } from './rsvp';

function EventPage({
  eventId,
  profile,
  session,
  onBack,
  onOpenClub,
  onScheduleNext,
  onEdit,
  onLogout,
}) {
  const [event, setEvent] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [memberNames, setMemberNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [fetchedRsvp, setRsvp] = useState(null);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState(null);
  const [pickingBook, setPickingBook] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState(null);

  useEffect(() => {
    async function load() {
      const [eventRes, rsvpRes] = await Promise.all([
        supabase
          .from('events')
          .select('*, clubs(id, name, owner_id, type), books(*)')
          .eq('id', eventId)
          .maybeSingle(),
        supabase
          .from('rsvps')
          .select('id, user_id, status')
          .eq('user_id', session.user.id)
          .eq('event_id', eventId)
          .maybeSingle(),
      ]);

      // Whether you're an owner of this club (its creator or a co-owner).
      let owner = false;
      let names = {};
      if (eventRes.data) {
        const [ownerRes, dirRes] = await Promise.all([
          supabase.rpc('is_club_owner', { p_club_id: eventRes.data.club_id }),
          supabase.rpc('club_directory', { p_club_id: eventRes.data.club_id }),
        ]);
        owner = ownerRes.data === true;
        names = Object.fromEntries((dirRes.data ?? []).map((m) => [m.user_id, fullName(m)]));
      }

      const failure = eventRes.error || rsvpRes.error;
      if (failure) console.error('Error loading event:', failure);
      setLoadError(failure ? failure.message : null);
      setEvent(eventRes.data);
      setRsvp(rsvpRes.data);
      setIsOwner(owner);
      setMemberNames(names);
      setLoading(false);
    }

    load();
  }, [eventId, session.user.id, attempt]);

  function retry() {
    setLoading(true);
    setLoadError(null);
    setAttempt((n) => n + 1);
  }

  const rsvp = fetchedRsvp?.user_id === session.user.id ? fetchedRsvp : null;
  const club = event?.clubs;
  const isOneTime = club?.type === ONE_TIME;
  // Admins can look at any event (guest list included) but only a club's own
  // owners can change anything: choose the book, invite people, schedule the next one.
  const canView = isOwner || profile.is_admin;
  const hasBooks = club?.type === 'book_club';
  // A club owner can edit everything; the host of this particular meeting can
  // edit its location and description.
  const isMeetingHost = event?.hosted_by === session.user.id;
  const canEditDetails = isOwner || isMeetingHost;

  async function answer(status) {
    if (rsvp?.status === status) return;
    setRsvpBusy(true);
    setRsvpError(null);

    // One RSVP per person per event, so changing your answer updates that row
    // (the history of your answer is the row itself, never deleted).
    const request = rsvp
      ? supabase.from('rsvps').update({ status }).eq('id', rsvp.id)
      : supabase.from('rsvps').insert({
          name: fullName(profile),
          email: session.user.email,
          event_id: event.id,
          status,
        });

    const { data, error } = await request.select('id, user_id, status').single();
    setRsvpBusy(false);

    if (error) {
      console.error('Error saving RSVP:', error);
      setRsvpError("Couldn't save your answer. Please try again.");
      return;
    }

    setRsvp(data);
  }

  async function setBook(book) {
    setBookBusy(true);
    setBookError(null);

    let bookId = null;
    if (book) {
      const { data, error } = await supabase.rpc('upsert_book', {
        p_source: book.source,
        p_source_id: book.source_id,
        p_title: book.title,
        p_author: book.author,
        p_year: book.first_publish_year,
        p_pages: book.page_count,
        p_isbn: book.isbn,
        p_cover_url: book.cover_url,
      });
      if (error) {
        console.error('Error saving book:', error);
        setBookBusy(false);
        setBookError(error.message);
        return;
      }
      bookId = data;
    }

    const { error } = await supabase.from('events').update({ book_id: bookId }).eq('id', event.id);
    setBookBusy(false);

    if (error) {
      console.error('Error setting book:', error);
      setBookError(error.message);
      return;
    }

    setPickingBook(false);
    setAttempt((n) => n + 1);
  }

  if (loading) {
    return (
      <Centered>
        <p>Loading...</p>
      </Centered>
    );
  }

  if (loadError) {
    return (
      <ErrorScreen
        title="Couldn't load the event"
        detail={loadError}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  if (!event) {
    return (
      <Centered>
        <p>This event doesn't exist, or you haven't been invited to it.</p>
        <button onClick={onBack} className="mt-6 text-sm text-blue-600 underline">
          ← My events
        </button>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader
          backLabel={isOneTime ? 'My events' : (club?.name ?? 'Club')}
          onBack={isOneTime ? onBack : () => onOpenClub(event.club_id)}
          onLogout={onLogout}
        />

        <h1 className="text-3xl font-bold text-gray-900 mb-2">{event.title}</h1>
        <p className="text-blue-600 font-medium mb-1">{formatEventTime(event.event_time)}</p>
        <p className="text-gray-500 mb-2">{event.location}</p>
        {event.hosted_by && (
          <p className="text-sm text-purple-700 mb-2">
            {isMeetingHost
              ? "You're hosting this meeting"
              : `Hosted by ${memberNames[event.hosted_by] ?? 'a club member'}`}
          </p>
        )}
        <p className="text-gray-700 mt-2">{event.description}</p>
        {canEditDetails && (
          <button onClick={onEdit} className="mt-3 text-sm text-blue-600 hover:underline">
            Edit details
          </button>
        )}

        {hasBooks && (
          <div className="mt-6 border-t border-gray-200 pt-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">Book of the month</h2>
            {event.books ? (
              <BookCard book={event.books} />
            ) : (
              <p className="text-sm text-gray-500">
                {isOwner ? 'No book chosen yet.' : "The club owner hasn't chosen a book yet."}
              </p>
            )}

            {isOwner && !pickingBook && (
              <div className="mt-3 flex gap-4 text-sm">
                <button
                  onClick={() => setPickingBook(true)}
                  className="text-blue-600 hover:underline"
                >
                  {event.books ? 'Change book' : 'Choose a book'}
                </button>
                {event.books && (
                  <button
                    onClick={() => setBook(null)}
                    disabled={bookBusy}
                    className="text-gray-500 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
            {pickingBook && (
              <BookSearch
                onPick={setBook}
                onCancel={() => setPickingBook(false)}
                busy={bookBusy}
              />
            )}
            {bookError && <p className="mt-2 text-sm text-red-600">{bookError}</p>}
          </div>
        )}

        <div className="mt-6 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">Will you be there?</h2>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Your RSVP">
            {RSVP_OPTIONS.map((o) => {
              const selected = rsvp?.status === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => answer(o.value)}
                  disabled={rsvpBusy}
                  aria-pressed={selected}
                  className={`border font-semibold py-2 rounded-xl transition disabled:opacity-50 ${
                    selected
                      ? o.selected
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {rsvp && (
            <p className="mt-3 text-center text-sm text-gray-600">{RSVP_MESSAGES[rsvp.status]}</p>
          )}
          {rsvpError && <p className="mt-2 text-center text-sm text-red-600">{rsvpError}</p>}
        </div>

        {canView && (
          <GuestList
            eventId={event.id}
            clubId={event.club_id}
            isOneTime={isOneTime}
            refreshKey={rsvp?.status}
          />
        )}

        {isOwner && isOneTime && <InviteLink clubId={event.club_id} subject="this event" />}

        {isOwner && !isOneTime && (
          <button
            onClick={() => onScheduleNext({ id: club.id, name: club.name }, event)}
            className="mt-6 w-full border border-purple-300 text-purple-700 font-semibold py-2 rounded-lg hover:bg-purple-50 transition"
          >
            Schedule the next meeting
          </button>
        )}
      </div>
    </div>
  );
}

export default EventPage;
