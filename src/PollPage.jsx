import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Centered, ErrorScreen, PageHeader } from './Screens';
import { formatEventTime } from './formatEventTime';
import { fullName } from './names';

const VOTES = [
  { value: 'yes', label: 'Yes', selected: 'bg-green-600 border-green-600 text-white' },
  { value: 'maybe', label: 'Maybe', selected: 'bg-amber-500 border-amber-500 text-white' },
  { value: 'no', label: 'No', selected: 'bg-gray-600 border-gray-600 text-white' },
];

// One meeting-time poll. Everyone in the club votes yes / maybe / no on each time
// and sees the totals. A club owner also sees who voted for what, and picks the
// winning time, which creates the meeting.
function PollPage({ pollId, session, onBack, onOpenEvent, onLogout }) {
  const [poll, setPoll] = useState(null);
  const [results, setResults] = useState([]);
  const [votes, setVotes] = useState([]); // rows we're allowed to see
  const [names, setNames] = useState({});
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    async function load() {
      const pollRes = await supabase
        .from('meeting_polls')
        .select('*, clubs(id, name)')
        .eq('id', pollId)
        .maybeSingle();

      if (pollRes.error || !pollRes.data) {
        setLoadError(pollRes.error?.message ?? "This poll doesn't exist, or you can't see it.");
        setLoading(false);
        return;
      }
      const clubId = pollRes.data.club_id;

      const [resultsRes, ownerRes, dirRes] = await Promise.all([
        supabase.rpc('poll_results', { p_poll_id: pollId }),
        supabase.rpc('is_club_owner', { p_club_id: clubId }),
        supabase.rpc('club_directory', { p_club_id: clubId }),
      ]);

      // RLS returns just your own votes to an ordinary member, and everyone's to
      // a club owner, so this one query serves both.
      const optionIds = (resultsRes.data ?? []).map((r) => r.option_id);
      const votesRes = optionIds.length
        ? await supabase
            .from('poll_votes')
            .select('option_id, user_id, vote')
            .in('option_id', optionIds)
        : { data: [], error: null };

      const failure = resultsRes.error || ownerRes.error || dirRes.error || votesRes.error;
      if (failure) {
        console.error('Error loading poll:', failure);
        setLoadError(failure.message);
        setLoading(false);
        return;
      }

      setLoadError(null);
      setPoll(pollRes.data);
      setResults(resultsRes.data);
      setVotes(votesRes.data);
      setIsOwner(ownerRes.data === true);
      setNames(Object.fromEntries(dirRes.data.map((m) => [m.user_id, fullName(m)])));
      setLoading(false);
    }

    load();
  }, [pollId, attempt]);

  const reload = () => setAttempt((n) => n + 1);

  const myVote = (optionId) =>
    votes.find((v) => v.option_id === optionId && v.user_id === session.user.id)?.vote;

  async function cast(optionId, vote) {
    setBusy(true);
    setActionError(null);
    // Clicking your current answer again takes it back.
    const next = myVote(optionId) === vote ? null : vote;
    const { error } = await supabase.rpc('cast_poll_vote', { p_option_id: optionId, p_vote: next });
    setBusy(false);

    if (error) {
      console.error('Error voting:', error);
      setActionError(error.message);
      return;
    }
    reload();
  }

  async function choose(option) {
    const when = formatEventTime(option.starts_at);
    if (!window.confirm(`Schedule "${poll.title}" for ${when}? This closes the poll.`)) return;

    setBusy(true);
    setActionError(null);
    const { data: eventId, error } = await supabase.rpc('finalize_meeting_poll', {
      p_poll_id: pollId,
      p_option_id: option.option_id,
    });
    setBusy(false);

    if (error) {
      console.error('Error choosing time:', error);
      setActionError(error.message);
      return;
    }
    onOpenEvent(eventId);
  }

  async function deletePoll() {
    if (!window.confirm('Delete this poll and all its votes?')) return;

    setBusy(true);
    setActionError(null);
    const { error } = await supabase.from('meeting_polls').delete().eq('id', pollId);
    setBusy(false);

    if (error) {
      console.error('Error deleting poll:', error);
      setActionError(error.message);
      return;
    }
    onBack(poll.club_id);
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
        title="Couldn't load the poll"
        detail={loadError}
        onRetry={() => {
          setLoading(true);
          reload();
        }}
        onLogout={onLogout}
      />
    );
  }

  const isOpen = poll.status === 'open';
  // The most popular time so far: most yes, then most maybe.
  const best = [...results].sort(
    (a, b) => b.yes_count - a.yes_count || b.maybe_count - a.maybe_count,
  )[0];
  const anyVotes = results.some((r) => r.yes_count + r.maybe_count + r.no_count > 0);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <PageHeader
          backLabel={poll.clubs?.name ?? 'Club'}
          onBack={() => onBack(poll.club_id)}
          onLogout={onLogout}
        />

        <h1 className="text-3xl font-bold text-gray-900 mb-1">{poll.title}</h1>
        <p className="text-gray-500">{poll.location}</p>
        <p className="text-gray-700 mt-2">{poll.description}</p>

        {!isOpen && (
          <div className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
            This poll is closed.
            {poll.event_id && (
              <button
                onClick={() => onOpenEvent(poll.event_id)}
                className="ml-2 text-blue-600 underline"
              >
                See the meeting
              </button>
            )}
          </div>
        )}

        <h2 className="text-sm font-semibold text-gray-500 mt-8 mb-3">
          {isOpen ? 'Which times work for you?' : 'Times that were proposed'}
        </h2>
        <ul className="space-y-4">
          {results.map((r) => {
            const mine = myVote(r.option_id);
            const voters = votes.filter((v) => v.option_id === r.option_id);
            const isBest = anyVotes && best?.option_id === r.option_id;
            return (
              <li
                key={r.option_id}
                className={`border rounded-xl p-4 ${isBest ? 'border-green-400 bg-green-50/40' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gray-900">{formatEventTime(r.starts_at)}</p>
                  {isBest && (
                    <span className="text-xs font-medium text-green-700 bg-green-100 rounded-full px-2 py-0.5 shrink-0">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {r.yes_count} yes · {r.maybe_count} maybe · {r.no_count} no
                </p>

                {isOpen && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {VOTES.map((v) => (
                      <button
                        key={v.value}
                        onClick={() => cast(r.option_id, v.value)}
                        disabled={busy}
                        aria-pressed={mine === v.value}
                        className={`border font-semibold py-1.5 rounded-lg text-sm transition disabled:opacity-50 ${
                          mine === v.value ? v.selected : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}

                {isOwner && voters.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-gray-500 cursor-pointer">Who voted</summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                      {VOTES.map((v) => {
                        const who = voters.filter((x) => x.vote === v.value);
                        return who.length > 0 ? (
                          <li key={v.value}>
                            <span className="font-semibold">{v.label}:</span>{' '}
                            {who.map((x) => names[x.user_id] ?? 'Someone').join(', ')}
                          </li>
                        ) : null;
                      })}
                    </ul>
                  </details>
                )}

                {isOpen && isOwner && (
                  <button
                    onClick={() => choose(r)}
                    disabled={busy}
                    className="mt-3 w-full border border-blue-600 text-blue-700 font-semibold py-1.5 rounded-lg text-sm hover:bg-blue-50 transition disabled:opacity-50"
                  >
                    Choose this time
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}

        {isOwner && (
          <p className="mt-8 text-center">
            <button
              onClick={deletePoll}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-red-600 underline disabled:opacity-50"
            >
              Delete this poll
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default PollPage;
