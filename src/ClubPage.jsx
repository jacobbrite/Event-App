import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Avatar from './Avatar';
import { fullName } from './names';
import { typeLabel } from './clubTypes';
import { formatEventTime } from './formatEventTime';
import { Centered, ErrorScreen } from './Screens';

// Meetings that started up to this long ago still count as "upcoming".
const EVENT_GRACE_MS = 6 * 60 * 60 * 1000;

// One club: its meetings, its members, and (for the club's host) the join link.
// Who can read what is enforced by RLS and club_directory(); the buttons here
// are just hidden when you couldn't use them anyway.
function ClubPage({ clubId, profile, session, onBack, onOpenEvent, onSchedule, onLogout }) {
  const [club, setClub] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);
  const [members, setMembers] = useState([]);
  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const [clubRes, eventsRes, membersRes] = await Promise.all([
        supabase.from('clubs').select('id, name, type, owner_id').eq('id', clubId).maybeSingle(),
        supabase
          .from('events')
          .select('id, title, event_time, location, description')
          .eq('club_id', clubId)
          .order('event_time', { ascending: false }),
        supabase.rpc('club_directory', { p_club_id: clubId }),
      ]);

      let failure = clubRes.error || eventsRes.error || membersRes.error;
      let inviteCode = null;

      // Only the club's host (or an admin) can read the join code.
      const manages = clubRes.data?.owner_id === session.user.id || profile.is_admin;
      if (!failure && clubRes.data && manages) {
        const linkRes = await supabase
          .from('club_invite_links')
          .select('code')
          .eq('club_id', clubId)
          .maybeSingle();
        failure = linkRes.error;
        inviteCode = linkRes.data?.code ?? null;
      }

      if (failure) {
        console.error('Error loading club:', failure);
        setLoadError(failure.message);
        setLoading(false);
        return;
      }

      const cutoff = Date.now() - EVENT_GRACE_MS;
      const all = eventsRes.data;
      setLoadError(null);
      setClub(clubRes.data);
      setUpcoming(all.filter((e) => new Date(e.event_time).getTime() >= cutoff).reverse());
      setPast(all.filter((e) => new Date(e.event_time).getTime() < cutoff));
      setMembers(membersRes.data);
      setCode(inviteCode);
      setLoading(false);
    }

    load();
  }, [clubId, session.user.id, profile.is_admin, attempt]);

  function reload() {
    setAttempt((n) => n + 1);
  }

  function retry() {
    setLoading(true);
    setLoadError(null);
    reload();
  }

  const isOwner = club?.owner_id === session.user.id;
  const canManage = isOwner || profile.is_admin;
  const joinUrl = code ? `${window.location.origin}/?join=${code}` : null;
  // The most recent meeting, used to pre-fill "schedule the next one".
  const latest = upcoming.length > 0 ? upcoming[upcoming.length - 1] : past[0];

  async function handleCopy() {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionError("Couldn't copy automatically. Select the link and copy it by hand.");
    }
  }

  async function handleResetLink() {
    if (!window.confirm('Reset the invite link? The old link will stop working for new people. Existing members stay in the club.')) {
      return;
    }
    setBusy(true);
    setActionError(null);

    const newCode = crypto.randomUUID().replaceAll('-', '');
    const { error } = await supabase
      .from('club_invite_links')
      .update({ code: newCode })
      .eq('club_id', clubId);

    setBusy(false);
    if (error) {
      console.error('Error resetting invite link:', error);
      setActionError(error.message);
      return;
    }
    setCode(newCode);
  }

  async function removeMember(userId, name) {
    const isSelf = userId === session.user.id;
    const question = isSelf
      ? `Leave ${club.name}? You'll need a new invite link to rejoin.`
      : `Remove ${name} from ${club.name}?`;
    if (!window.confirm(question)) return;

    setBusy(true);
    setActionError(null);

    const { error } = await supabase
      .from('club_members')
      .delete()
      .eq('club_id', clubId)
      .eq('user_id', userId);

    setBusy(false);
    if (error) {
      console.error('Error removing member:', error);
      setActionError(error.message);
      return;
    }

    if (isSelf) onBack();
    else reload();
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
        title="Couldn't load the club"
        detail={loadError}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  if (!club) {
    return (
      <Centered>
        <p>This club doesn't exist, or you're not a member.</p>
        <button onClick={onBack} className="mt-6 text-sm text-blue-600 underline">
          ← Back
        </button>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        <button onClick={onBack} className="text-sm text-gray-500 hover:underline mb-4">
          ← Home
        </button>

        <h1 className="text-3xl font-bold text-gray-900 mb-1">{club.name}</h1>
        <p className="text-sm text-gray-500 mb-6">{typeLabel(club.type)}</p>

        <h2 className="text-sm font-semibold text-gray-500 mb-2">Upcoming meetings</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing scheduled yet.</p>
        ) : (
          <EventRows events={upcoming} onOpen={onOpenEvent} />
        )}

        {canManage && (
          <button
            onClick={() => onSchedule({ id: club.id, name: club.name }, latest)}
            className="mt-4 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
          >
            {latest ? 'Schedule the next meeting' : 'Schedule a meeting'}
          </button>
        )}

        {past.length > 0 && (
          <details className="mt-4">
            <summary className="text-sm text-gray-500 cursor-pointer">
              Past meetings ({past.length})
            </summary>
            <div className="mt-2">
              <EventRows events={past} onOpen={onOpenEvent} muted />
            </div>
          </details>
        )}

        <h2 className="text-sm font-semibold text-gray-500 mt-8 mb-2">
          Members ({members.length})
        </h2>
        <ul className="space-y-2">
          {members.map((m) => {
            const name = fullName(m);
            const isMe = m.user_id === session.user.id;
            return (
              <li key={m.user_id} className="flex items-center gap-3">
                <Avatar profile={m} size={32} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-gray-900 truncate">
                    {name}
                    {m.is_owner && (
                      <span className="ml-2 text-xs font-medium text-purple-700 bg-purple-50 rounded-full px-2 py-0.5">
                        Host
                      </span>
                    )}
                    {isMe && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                  </span>
                  {m.email && (
                    <span className="block text-xs text-gray-400 truncate">{m.email}</span>
                  )}
                </span>
                {canManage && !m.is_owner && !isMe && (
                  <button
                    onClick={() => removeMember(m.user_id, name)}
                    disabled={busy}
                    className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {canManage && (
          <div className="mt-8 border-t border-gray-200 pt-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-1">Invite link</h2>
            <p className="text-xs text-gray-400 mb-2">
              Anyone who opens this link and signs in can join {club.name}. Only share it with
              people you want in the club.
            </p>
            {joinUrl ? (
              <>
                <input
                  type="text"
                  readOnly
                  value={joinUrl}
                  onFocus={(e) => e.target.select()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-600 bg-gray-50"
                />
                <div className="flex gap-3 mt-2 text-sm">
                  <button onClick={handleCopy} className="text-blue-600 hover:underline">
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                  <button
                    onClick={handleResetLink}
                    disabled={busy}
                    className="text-gray-500 hover:underline disabled:opacity-50"
                  >
                    Reset link
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">No invite link found for this club.</p>
            )}
          </div>
        )}

        {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}

        {!isOwner && (
          <button
            onClick={() => removeMember(session.user.id, 'yourself')}
            disabled={busy}
            className="mt-6 w-full border border-gray-300 text-gray-600 font-semibold py-2 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            Leave club
          </button>
        )}

        <button
          onClick={onLogout}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}

function EventRows({ events, onOpen, muted }) {
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id}>
          <button
            onClick={() => onOpen(e.id)}
            className="w-full text-left border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition"
          >
            <span className={`block font-semibold ${muted ? 'text-gray-500' : 'text-gray-900'}`}>
              {e.title}
            </span>
            <span className={`block text-sm ${muted ? 'text-gray-400' : 'text-blue-600'}`}>
              {formatEventTime(e.event_time)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default ClubPage;
