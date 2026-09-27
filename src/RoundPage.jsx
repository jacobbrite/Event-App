import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import BookCard from './BookCard';
import BookSearch from './BookSearch';
import { Centered, ErrorScreen, PageHeader } from './Screens';
import { formatEventTime } from './formatEventTime';
import { fullName } from './names';

// Meetings that started up to this long ago still count as current.
const EVENT_GRACE_MS = 6 * 60 * 60 * 1000;

const STAGE_TEXT = {
  suggesting: 'Suggestions are open',
  voting: 'Voting is open',
  closed: 'Voting is closed',
};

// One book vote. Stages: members suggest -> everyone here votes -> the winner is
// chosen. Two ways to vote:
//   approval: tick every book you'd be happy to read; most ticks wins (an owner
//             closes it)
//   bracket : head-to-head matches, round by round, until one book is left
// Both are secret ballots: nobody sees who voted for what, and members don't see
// totals until they're decided. In person, an owner marks who's here; people who
// aren't can't vote and their votes are ignored.
function RoundPage({ roundId, session, onBack, onOpenEvent, onLogout }) {
  const [round, setRound] = useState(null);
  const [books, setBooks] = useState([]); // round_books rows with the book attached
  const [tally, setTally] = useState({}); // approval: round_book_id -> approvals (null = hidden)
  const [participation, setParticipation] = useState({
    voters: 0,
    eligible: 0,
    suggestions: 0,
    suggesters: 0,
    members: 0,
  });
  const [mine, setMine] = useState(new Set()); // approval: round_book ids I approve
  const [members, setMembers] = useState([]); // { id, name, isOwner }
  const [absent, setAbsent] = useState(new Set()); // user ids marked "not here"
  const [matches, setMatches] = useState([]); // bracket matches with results
  const [picks, setPicks] = useState({}); // bracket: match_id -> the round_book I picked
  const [progress, setProgress] = useState({ finished: 0, eligible: 0 });
  const [isOwner, setIsOwner] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [searching, setSearching] = useState(false);
  const [closing, setClosing] = useState(false);
  const [winnerId, setWinnerId] = useState(null);
  const [attachTo, setAttachTo] = useState('');

  useEffect(() => {
    async function load() {
      const roundRes = await supabase
        .from('book_rounds')
        // `books!winner_book_id` names which link to follow: a round also reaches books
        // through its suggestions, and PostgREST won't guess between the two.
        .select('*, clubs(id, name), winner:books!winner_book_id(*)')
        .eq('id', roundId)
        .maybeSingle();

      if (roundRes.error || !roundRes.data) {
        setLoadError(roundRes.error?.message ?? "This vote doesn't exist, or you can't see it.");
        setLoading(false);
        return;
      }
      const r = roundRes.data;

      const [booksRes, tallyRes, partRes, mineRes, dirRes, ownerRes, absentRes] = await Promise.all([
        // While suggestions are open the database returns only your own books until
        // you've suggested one; after that (and once voting starts) everyone's.
        supabase
          .from('round_books')
          .select('id, suggested_by, created_at, books(*)')
          .eq('round_id', roundId)
          .order('created_at', { ascending: true }),
        supabase.rpc('round_tally', { p_round_id: roundId }),
        supabase.rpc('round_participation', { p_round_id: roundId }),
        // RLS returns only your own approvals, whoever you are.
        supabase.from('round_votes').select('round_book_id').eq('user_id', session.user.id),
        supabase.rpc('club_directory', { p_club_id: r.club_id }),
        supabase.rpc('is_club_owner', { p_club_id: r.club_id }),
        // Owners see everyone who's marked absent; anyone else just their own row.
        supabase.from('round_absent').select('user_id').eq('round_id', roundId),
      ]);

      let bracket = { matches: [], picks: {}, progress: { finished: 0, eligible: 0 } };
      let bracketFailure = null;
      if (r.method === 'bracket' && r.status !== 'suggesting') {
        const [mRes, pRes, prRes] = await Promise.all([
          supabase.rpc('bracket_results', { p_round_id: roundId }),
          supabase.from('bracket_votes').select('match_id, choice').eq('user_id', session.user.id),
          supabase.rpc('bracket_progress', { p_round_id: roundId }),
        ]);
        bracketFailure = mRes.error || pRes.error || prRes.error;
        bracket = {
          matches: mRes.data ?? [],
          picks: Object.fromEntries((pRes.data ?? []).map((v) => [v.match_id, v.choice])),
          progress: prRes.data?.[0] ?? { finished: 0, eligible: 0 },
        };
      }

      const failure =
        booksRes.error ||
        tallyRes.error ||
        partRes.error ||
        mineRes.error ||
        dirRes.error ||
        ownerRes.error ||
        absentRes.error ||
        bracketFailure;
      if (failure) {
        console.error('Error loading book vote:', failure);
        setLoadError(failure.message);
        setLoading(false);
        return;
      }

      // Meetings an owner can attach the winning book to.
      let upcoming = [];
      const needsMeetings =
        ownerRes.data === true &&
        ((r.status === 'voting' && r.method === 'approval') ||
          (r.status === 'closed' && !r.event_id));
      if (needsMeetings) {
        const cutoff = new Date(Date.now() - EVENT_GRACE_MS).toISOString();
        const meetingsRes = await supabase
          .from('events')
          .select('id, title, event_time, book_id')
          .eq('club_id', r.club_id)
          .gte('event_time', cutoff)
          .order('event_time', { ascending: true });
        upcoming = meetingsRes.data ?? [];
      }

      setLoadError(null);
      setRound(r);
      setBooks(booksRes.data);
      setTally(Object.fromEntries(tallyRes.data.map((t) => [t.round_book_id, t.approvals])));
      setParticipation(
        partRes.data?.[0] ?? { voters: 0, eligible: 0, suggestions: 0, suggesters: 0, members: 0 },
      );
      setMine(new Set(mineRes.data.map((v) => v.round_book_id)));
      setMembers(
        dirRes.data.map((m) => ({ id: m.user_id, name: fullName(m), isOwner: m.is_owner })),
      );
      setAbsent(new Set(absentRes.data.map((a) => a.user_id)));
      setMatches(bracket.matches);
      setPicks(bracket.picks);
      setProgress(bracket.progress);
      setIsOwner(ownerRes.data === true);
      setMeetings(upcoming);
      setLoading(false);
    }

    load();
  }, [roundId, session.user.id, attempt]);

  const reload = () => setAttempt((n) => n + 1);

  // Run a database action, then refresh. Every rule is enforced in the database;
  // the messages it raises are shown as-is.
  async function run(fn) {
    setBusy(true);
    setActionError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      console.error('Book vote action failed:', error);
      setActionError(error.message);
      return false;
    }
    reload();
    return true;
  }

  async function suggest(book) {
    const ok = await run(() =>
      supabase.rpc('suggest_book', {
        p_round_id: roundId,
        p_source: book.source,
        p_source_id: book.source_id,
        p_title: book.title,
        p_author: book.author,
        p_year: book.first_publish_year,
        p_pages: book.page_count,
        p_isbn: book.isbn,
        p_cover_url: book.cover_url,
      }),
    );
    if (ok) setSearching(false);
  }

  const removeSuggestion = (rb) => {
    if (!window.confirm(`Take back "${rb.books.title}"?`)) return;
    run(() => supabase.rpc('remove_suggestion', { p_round_book_id: rb.id }));
  };

  const startVoting = () => {
    const msg =
      round.method === 'bracket'
        ? 'Start the bracket? Suggestions will be locked and the books shuffled into matches.'
        : 'Start voting? Suggestions will be locked.';
    if (!window.confirm(msg)) return;
    run(() => supabase.rpc('start_book_voting', { p_round_id: roundId }));
  };

  const setAttendance = (userIds, present) =>
    run(() =>
      supabase.rpc('set_round_attendance', {
        p_round_id: roundId,
        p_user_ids: userIds,
        p_present: present,
      }),
    );

  const toggleApproval = (rb) =>
    run(() =>
      supabase.rpc('set_book_approval', { p_round_book_id: rb.id, p_approve: !mine.has(rb.id) }),
    );

  // Clicking the book you already picked takes your pick back.
  const voteInMatch = (match, roundBookId) =>
    run(() =>
      supabase.rpc('cast_bracket_vote', {
        p_match_id: match.match_id,
        p_choice: picks[match.match_id] === roundBookId ? null : roundBookId,
      }),
    );

  const breakTie = (match, roundBookId, title) => {
    if (!window.confirm(`Break the tie in favour of "${title}"?`)) return;
    run(() =>
      supabase.rpc('resolve_bracket_tie', { p_match_id: match.match_id, p_winner: roundBookId }),
    );
  };

  const advance = (isFinal) => {
    const msg = isFinal
      ? 'Decide the final and crown the winner?'
      : 'Finish this round and move on to the next?';
    if (!window.confirm(msg)) return;
    run(() => supabase.rpc('advance_bracket_round', { p_round_id: roundId }));
  };

  async function closeVote() {
    const winner = books.find((b) => b.id === winnerId);
    if (!winner) return;
    const meeting = meetings.find((m) => String(m.id) === attachTo);
    const where = meeting ? ` and set it as the book for "${meeting.title}"` : '';
    if (!window.confirm(`Close the vote and choose "${winner.books.title}"${where}?`)) return;

    const ok = await run(() =>
      supabase.rpc('close_book_round', {
        p_round_id: roundId,
        p_round_book_id: winner.id,
        p_event_id: meeting ? meeting.id : null,
      }),
    );
    if (ok) setClosing(false);
  }

  const attachWinner = () =>
    run(() =>
      supabase.rpc('attach_round_winner', { p_round_id: roundId, p_event_id: Number(attachTo) }),
    );

  async function deleteRound() {
    if (!window.confirm('Delete this book vote and everything in it?')) return;
    setBusy(true);
    const { error } = await supabase.from('book_rounds').delete().eq('id', roundId);
    setBusy(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    onBack(round.club_id);
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
        title="Couldn't load the book vote"
        detail={loadError}
        onRetry={() => {
          setLoading(true);
          reload();
        }}
        onLogout={onLogout}
      />
    );
  }

  const stage = round.status;
  const isBracket = round.method === 'bracket';
  const booksById = Object.fromEntries(books.map((b) => [b.id, b]));
  const myCount = books.filter((b) => b.suggested_by === session.user.id).length;
  const hasSubmitted = myCount > 0;
  const canSuggest = stage === 'suggesting' && myCount < round.max_per_member;
  const iAmAbsent = absent.has(session.user.id);
  const canVote = stage === 'voting' && !iAmAbsent;
  const countsVisible = isOwner || stage === 'closed';

  // Approval: once counts are visible, show the strongest books first.
  const shown =
    countsVisible && stage !== 'suggesting'
      ? [...books].sort((a, b) => (tally[b.id] ?? 0) - (tally[a.id] ?? 0))
      : books;
  const topCount = Math.max(0, ...books.map((b) => tally[b.id] ?? 0));
  const leaders = books.filter((b) => (tally[b.id] ?? 0) === topCount);

  // Bracket: how many rounds there are, and the round we're in.
  const totalStages = Math.max(1, Math.ceil(Math.log2(Math.max(2, books.length))));
  const stageName = (k) =>
    k === totalStages ? 'Final' : k === totalStages - 1 ? 'Semifinal' : `Round ${k}`;
  const currentMatches = matches.filter((m) => m.stage === round.bracket_stage);
  const earlierStages = [...new Set(matches.map((m) => m.stage))]
    .filter((k) => stage === 'closed' || k < round.bracket_stage)
    .sort((a, b) => a - b);
  const canAdvance = currentMatches.every(
    (m) => m.winner != null || m.a_votes !== m.b_votes,
  );

  function openClosePanel() {
    // Preselect the leader when there's a clear one; a tie is the owner's call.
    setWinnerId(topCount > 0 && leaders.length === 1 ? leaders[0].id : null);
    setAttachTo('');
    setClosing(true);
  }

  const winnerBook = round.winner;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader
          backLabel={round.clubs?.name ?? 'Club'}
          onBack={() => onBack(round.club_id)}
          onLogout={onLogout}
        />

        <h1 className="text-3xl font-bold text-gray-900 mb-1">{round.title}</h1>
        <p className="text-sm text-gray-500">
          {STAGE_TEXT[stage]} · {isBracket ? 'bracket' : 'approval vote'}
          {isBracket && stage === 'voting' && ` · ${stageName(round.bracket_stage)}`}
        </p>

        {iAmAbsent && stage !== 'closed' && (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            You're marked as not here for this vote, so you can't vote. If that's a mistake, ask
            an owner of the club.
          </div>
        )}

        {stage === 'closed' && winnerBook && (
          <div className="mt-6 rounded-xl border border-green-300 bg-green-50 p-4">
            <p className="text-xs font-semibold text-green-700 mb-3">🎉 The club chose</p>
            <BookCard book={winnerBook} />
            {round.event_id && (
              <button
                onClick={() => onOpenEvent(round.event_id)}
                className="mt-3 text-sm text-blue-600 underline"
              >
                See the meeting
              </button>
            )}
          </div>
        )}

        {/* ---------- Stage: suggesting ---------- */}
        {stage === 'suggesting' && (
          <>
            <p className="mt-4 text-sm text-gray-600">
              Suggest up to {round.max_per_member} book{round.max_per_member === 1 ? '' : 's'}.
              You've suggested {myCount}.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {participation.suggestions} book{participation.suggestions === 1 ? '' : 's'} suggested
              by {participation.suggesters} of {participation.members} members.
            </p>
            {!hasSubmitted && (
              <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                To keep it fair, you'll see what everyone else suggested once you've suggested
                your own.
              </div>
            )}
          </>
        )}

        {/* ---------- Stage: voting (explanations) ---------- */}
        {stage === 'voting' && !isBracket && (
          <>
            <p className="mt-4 text-sm text-gray-600">
              Tick <strong>every</strong> book you'd be happy to read. It's a secret ballot.
              {!isOwner && ' Totals are revealed when voting closes.'}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {participation.voters} of {participation.eligible} here have voted.
            </p>
          </>
        )}
        {stage === 'voting' && isBracket && (
          <>
            <p className="mt-4 text-sm text-gray-600">
              Pick the book you'd rather read in each match. It's a secret ballot, and the results
              appear when a match is decided.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {progress.finished} of {progress.eligible} here have voted this round.
            </p>
          </>
        )}

        {/* ---------- Bracket matches ---------- */}
        {isBracket && stage === 'voting' && (
          <>
            <h2 className="text-sm font-semibold text-gray-500 mt-8 mb-3">
              {stageName(round.bracket_stage)}
            </h2>
            <ul className="space-y-4">
              {currentMatches.map((m) => (
                <li key={m.match_id}>
                  <MatchCard
                    match={m}
                    label={`Match ${m.slot}`}
                    booksById={booksById}
                    pick={picks[m.match_id]}
                    canVote={canVote}
                    isOwner={isOwner}
                    busy={busy}
                    onVote={(rbId) => voteInMatch(m, rbId)}
                    onTieBreak={(rbId, title) => breakTie(m, rbId, title)}
                  />
                </li>
              ))}
            </ul>

            {isOwner && (
              <button
                onClick={() => advance(round.bracket_stage === totalStages)}
                disabled={busy || !canAdvance}
                className="mt-6 w-full border border-blue-600 text-blue-700 font-semibold py-2 rounded-xl hover:bg-blue-50 transition disabled:opacity-50"
              >
                {round.bracket_stage === totalStages
                  ? 'Decide the final'
                  : 'Finish this round'}
                {!canAdvance && (
                  <span className="block text-xs font-normal">Break the tied matches first</span>
                )}
              </button>
            )}
          </>
        )}

        {isBracket && earlierStages.length > 0 && (
          <details className="mt-6" open={stage === 'closed'}>
            <summary className="text-sm font-semibold text-gray-500 cursor-pointer">
              {stage === 'closed' ? 'The bracket' : 'Earlier rounds'}
            </summary>
            <div className="mt-3 space-y-4">
              {earlierStages.map((k) => (
                <div key={k}>
                  <h3 className="text-xs font-semibold text-gray-400 mb-1">{stageName(k)}</h3>
                  <ul className="space-y-1 text-sm">
                    {matches
                      .filter((m) => m.stage === k)
                      .map((m) => (
                        <ResultLine key={m.match_id} match={m} booksById={booksById} />
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* ---------- Books list (suggesting + approval voting + approval results) ---------- */}
        {(!isBracket || stage === 'suggesting') && (stage !== 'suggesting' || hasSubmitted) && (
          <>
            <h2 className="text-sm font-semibold text-gray-500 mt-8 mb-3">
              {stage === 'closed' ? 'Final results' : `Books (${books.length})`}
            </h2>
            {books.length === 0 && <p className="text-sm text-gray-500">No suggestions yet.</p>}
            <ul className="space-y-4">
              {shown.map((rb) => {
                const approved = mine.has(rb.id);
                const count = tally[rb.id];
                const isWinner = stage === 'closed' && round.winner_book_id === rb.books.id;
                // Only the person who suggested a book can take it back.
                const canRemove = stage === 'suggesting' && rb.suggested_by === session.user.id;
                return (
                  <li
                    key={rb.id}
                    className={`border rounded-xl p-4 ${isWinner ? 'border-green-400' : 'border-gray-200'}`}
                  >
                    <BookCard book={rb.books} />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-400">
                        Suggested by{' '}
                        {rb.suggested_by === session.user.id
                          ? 'you'
                          : (members.find((m) => m.id === rb.suggested_by)?.name ?? 'a member')}
                      </span>
                      {!isBracket && countsVisible && count != null && (
                        <span className="text-xs font-semibold text-gray-700">
                          {count} approval{count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>

                    {stage === 'voting' && !isBracket && (
                      <button
                        onClick={() => toggleApproval(rb)}
                        disabled={busy || !canVote}
                        aria-pressed={approved}
                        className={`mt-3 w-full border font-semibold py-2 rounded-lg text-sm transition disabled:opacity-50 ${
                          approved
                            ? 'bg-green-600 border-green-600 text-white'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {approved ? "✓ I'd read this" : "I'd read this"}
                      </button>
                    )}

                    {canRemove && (
                      <button
                        onClick={() => removeSuggestion(rb)}
                        disabled={busy}
                        className="mt-2 text-xs text-gray-400 hover:text-red-600 underline disabled:opacity-50"
                      >
                        Take back my suggestion
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {stage === 'suggesting' && (
          <div className="mt-6">
            {canSuggest && !searching && (
              <button
                onClick={() => setSearching(true)}
                className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
              >
                {hasSubmitted ? 'Suggest another book' : 'Suggest a book'}
              </button>
            )}
            {!canSuggest && (
              <p className="text-sm text-gray-500 text-center">
                You've used all your suggestions. Take one back to suggest a different book.
              </p>
            )}
            {searching && (
              <BookSearch onPick={suggest} onCancel={() => setSearching(false)} busy={busy} />
            )}
          </div>
        )}

        {isOwner && stage === 'suggesting' && (
          <button
            onClick={startVoting}
            disabled={busy || participation.suggestions < 2}
            className="mt-4 w-full border border-blue-600 text-blue-700 font-semibold py-2 rounded-xl hover:bg-blue-50 transition disabled:opacity-50"
          >
            {isBracket ? 'Start the bracket' : 'Start voting'}
            {participation.suggestions < 2 && (
              <span className="block text-xs font-normal">Needs at least 2 books</span>
            )}
          </button>
        )}

        {/* ---------- Approval: closing panel ---------- */}
        {isOwner && stage === 'voting' && !isBracket && !closing && (
          <button
            onClick={openClosePanel}
            className="mt-6 w-full border border-blue-600 text-blue-700 font-semibold py-2 rounded-xl hover:bg-blue-50 transition"
          >
            Close voting and choose the winner
          </button>
        )}

        {isOwner && stage === 'voting' && !isBracket && closing && (
          <div className="mt-6 border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-1">Choose the winner</h3>
            {topCount > 0 && leaders.length > 1 && (
              <p className="text-xs text-amber-700 mb-2">
                It's a tie between {leaders.map((b) => `"${b.books.title}"`).join(' and ')}. Your
                call.
              </p>
            )}
            {topCount === 0 && <p className="text-xs text-amber-700 mb-2">Nobody has voted yet.</p>}
            <ul className="space-y-1 mb-4">
              {shown.map((rb) => (
                <li key={rb.id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="winner"
                      checked={winnerId === rb.id}
                      onChange={() => setWinnerId(rb.id)}
                    />
                    <span className="text-gray-900">{rb.books.title}</span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {tally[rb.id] ?? 0} approval{(tally[rb.id] ?? 0) === 1 ? '' : 's'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {meetings.length > 0 && (
              <MeetingSelect meetings={meetings} value={attachTo} onChange={setAttachTo} />
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={closeVote}
                disabled={busy || winnerId == null}
                className="flex-1 bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                Choose this book
              </button>
              <button onClick={() => setClosing(false)} className="text-sm text-gray-500 hover:underline">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ---------- After the vote: put the winner on a meeting ---------- */}
        {isOwner && stage === 'closed' && !round.event_id && meetings.length > 0 && (
          <div className="mt-6 border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Set it as a meeting's book</h3>
            <MeetingSelect meetings={meetings} value={attachTo} onChange={setAttachTo} />
            <button
              onClick={attachWinner}
              disabled={busy || !attachTo}
              className="mt-3 w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              Set the book
            </button>
          </div>
        )}

        {/* ---------- Who's here (owners) ---------- */}
        {isOwner && stage !== 'closed' && (
          <details className="mt-8 border border-gray-200 rounded-xl p-4">
            <summary className="text-sm font-semibold text-gray-700 cursor-pointer">
              Who's here? ({participation.eligible} of {participation.members})
            </summary>
            <p className="text-xs text-gray-500 mt-2 mb-3">
              Untick anyone who isn't here. They can't vote, and their votes aren't counted, so
              you're never waiting on them. You can change this at any time, for example when
              someone arrives late.
            </p>
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!absent.has(m.id)}
                      disabled={busy}
                      onChange={(e) => setAttendance([m.id], e.target.checked)}
                    />
                    <span className={absent.has(m.id) ? 'text-gray-400' : 'text-gray-900'}>
                      {m.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {absent.size > 0 && (
              <button
                onClick={() => setAttendance([...absent], true)}
                disabled={busy}
                className="mt-3 text-xs text-blue-600 hover:underline disabled:opacity-50"
              >
                Everyone's here
              </button>
            )}
          </details>
        )}

        {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}

        {isOwner && (
          <p className="mt-8 text-center">
            <button
              onClick={deleteRound}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-red-600 underline disabled:opacity-50"
            >
              Delete this vote
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function MeetingSelect({ meetings, value, onChange }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">
        Set it as the book for a meeting (optional)
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option value="">Don't attach it to a meeting</option>
        {meetings.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title} · {formatEventTime(m.event_time)}
          </option>
        ))}
      </select>
    </label>
  );
}

// One head-to-head. Members vote for a side (a second click takes the pick back);
// owners also see live counts and can break a tie.
function MatchCard({ match, label, booksById, pick, canVote, isOwner, busy, onVote, onTieBreak }) {
  const a = booksById[match.book_a];
  const b = match.book_b ? booksById[match.book_b] : null;
  if (!a) return null;

  if (!b) {
    return (
      <div className="border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-400 mb-2">{label} · bye</p>
        <p className="text-sm text-gray-700">
          <strong>{a.books.title}</strong> moves straight on to the next round.
        </p>
      </div>
    );
  }

  const tied = isOwner && match.winner == null && match.a_votes != null && match.a_votes === match.b_votes;

  const side = (rb, votes) => {
    const picked = pick === rb.id;
    return (
      <div className={`rounded-lg border p-3 ${picked ? 'border-green-500 bg-green-50/50' : 'border-gray-200'}`}>
        <BookCard book={rb.books} />
        {isOwner && votes != null && (
          <p className="mt-2 text-xs font-semibold text-gray-600">
            {votes} vote{votes === 1 ? '' : 's'}
          </p>
        )}
        {canVote && (
          <button
            onClick={() => onVote(rb.id)}
            disabled={busy}
            aria-pressed={picked}
            className={`mt-3 w-full border font-semibold py-2 rounded-lg text-sm transition disabled:opacity-50 ${
              picked
                ? 'bg-green-600 border-green-600 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {picked ? '✓ Your pick' : 'Pick this one'}
          </button>
        )}
        {tied && (
          <button
            onClick={() => onTieBreak(rb.id, rb.books.title)}
            disabled={busy}
            className="mt-2 w-full text-xs text-purple-700 border border-purple-300 rounded-lg py-1.5 hover:bg-purple-50 disabled:opacity-50"
          >
            Break the tie for this one
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <p className="text-xs font-semibold text-gray-400 mb-2">{label}</p>
      <div className="space-y-2">
        {side(a, match.a_votes)}
        <p className="text-center text-xs font-semibold text-gray-400">vs</p>
        {side(b, match.b_votes)}
      </div>
      {tied && (
        <p className="mt-2 text-xs text-amber-700">It's a tie. Break it to move the round on.</p>
      )}
      {match.winner != null && (
        <p className="mt-2 text-xs text-green-700">
          Decided: {booksById[match.winner]?.books.title}
        </p>
      )}
    </div>
  );
}

// "Book A beat Book B (3-2)" for a decided match.
function ResultLine({ match, booksById }) {
  const a = booksById[match.book_a]?.books.title ?? '?';
  const b = match.book_b ? (booksById[match.book_b]?.books.title ?? '?') : null;
  const winnerTitle = booksById[match.winner]?.books.title;
  if (!b) {
    return (
      <li className="text-gray-600">
        <strong>{a}</strong> had a bye
      </li>
    );
  }
  const loser = match.winner === match.book_a ? b : a;
  return (
    <li className="text-gray-600">
      <strong className="text-gray-900">{winnerTitle}</strong> beat {loser}
      {match.a_votes != null && match.b_votes != null && (
        <span className="text-gray-400">
          {' '}
          ({match.winner === match.book_a
            ? `${match.a_votes}-${match.b_votes}`
            : `${match.b_votes}-${match.a_votes}`}
          )
        </span>
      )}
    </li>
  );
}

export default RoundPage;
