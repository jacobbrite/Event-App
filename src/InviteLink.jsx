import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// The private join link for a club (or for a one-time event, which lives in a
// hidden club). Only a club owner can read the code, enforced by RLS:
// for anyone else this component just shows nothing useful, and isn't rendered.
function InviteLink({ clubId, subject }) {
  const [code, setCode] = useState(undefined); // undefined = loading, null = none
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function loadCode() {
      const { data, error } = await supabase
        .from('club_invite_links')
        .select('code')
        .eq('club_id', clubId)
        .maybeSingle();

      if (error) {
        console.error('Error loading invite link:', error);
        setError(error.message);
        setCode(null);
        return;
      }
      setCode(data?.code ?? null);
    }

    loadCode();
  }, [clubId]);

  const joinUrl = code ? `${window.location.origin}/?join=${code}` : null;

  async function handleCopy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically. Select the link and copy it by hand.");
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        `Reset the invite link? The old link will stop working for new people. People who already joined ${subject} stay.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);

    const newCode = crypto.randomUUID().replaceAll('-', '');
    const { error } = await supabase
      .from('club_invite_links')
      .update({ code: newCode })
      .eq('club_id', clubId);

    setBusy(false);
    if (error) {
      console.error('Error resetting invite link:', error);
      setError(error.message);
      return;
    }
    setCode(newCode);
  }

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="text-sm font-semibold text-gray-500 mb-1">Invite link</h2>
      <p className="text-xs text-gray-400 mb-2">
        Anyone who opens this link and signs in can join {subject}. Only share it with people
        you want to invite.
      </p>

      {code === undefined && <p className="text-sm text-gray-500">Loading...</p>}

      {joinUrl && (
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
              onClick={handleReset}
              disabled={busy}
              className="text-gray-500 hover:underline disabled:opacity-50"
            >
              Reset link
            </button>
          </div>
        </>
      )}

      {code === null && !error && (
        <p className="text-sm text-gray-500">No invite link found.</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default InviteLink;
