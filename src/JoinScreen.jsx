import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { typeLabel } from './clubTypes';
import { Centered } from './Screens';

// Shown after signing in with a club's join link. Joining is an explicit click,
// so opening a link never silently adds you to something.
function JoinScreen({ code, onJoined, onCancel }) {
  const [preview, setPreview] = useState(undefined); // undefined = loading, null = invalid
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadPreview() {
      const { data, error } = await supabase.rpc('club_preview', { p_code: code });
      if (error) {
        console.error('Error loading invite:', error);
        setError(error.message);
        setPreview(null);
        return;
      }
      setPreview(data?.[0] ?? null);
    }

    loadPreview();
  }, [code]);

  async function handleJoin() {
    setBusy(true);
    setError(null);

    const { data: clubId, error } = await supabase.rpc('join_club', { p_code: code });
    setBusy(false);

    if (error) {
      console.error('Error joining club:', error);
      setError(error.message);
      return;
    }

    onJoined(clubId);
  }

  if (preview === undefined) {
    return (
      <Centered>
        <p>Loading invitation...</p>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="bg-white rounded-2xl shadow-lg p-8">
        {preview ? (
          <>
            <p className="text-sm text-gray-500 mb-1">You've been invited to join</p>
            <h1 className="text-2xl font-bold text-gray-900">{preview.name}</h1>
            <p className="text-xs text-gray-400 mb-6">{typeLabel(preview.type)}</p>
            <button
              onClick={handleJoin}
              disabled={busy}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
            >
              {busy ? 'Joining...' : 'Join'}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">This invite link isn't valid</h1>
            <p className="text-sm text-gray-500 mb-6">
              It may have been replaced by a newer one. Ask the host to send you the latest link.
            </p>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={onCancel}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          {preview ? 'Not now' : 'Continue'}
        </button>
      </div>
    </Centered>
  );
}

export default JoinScreen;
