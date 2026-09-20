import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Avatar from './Avatar';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

// Crop to a centred square and shrink to 256px JPEG. Keeps uploads tiny and
// means the stored file is always a JPEG, whatever the person picked.
async function resizeToSquareJpeg(file, size = 256) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext('2d')
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that image."))),
      'image/jpeg',
      0.85,
    );
  });
}

function ProfilePage({ profile, email, onBack, onSaved }) {
  const [firstName, setFirstName] = useState(profile.first_name ?? '');
  const [lastName, setLastName] = useState(profile.last_name ?? '');
  const [newPhoto, setNewPhoto] = useState(null); // { blob, previewUrl }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, isError }

  // Free the preview's object URL when it's replaced or the page closes.
  useEffect(() => {
    return () => {
      if (newPhoto) URL.revokeObjectURL(newPhoto.previewUrl);
    };
  }, [newPhoto]);

  async function handlePhotoChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be chosen again later
    if (!file) return;

    try {
      const blob = await resizeToSquareJpeg(file);
      setNewPhoto({ blob, previewUrl: URL.createObjectURL(blob) });
      setMessage(null);
    } catch (err) {
      console.error('Error processing photo:', err);
      setMessage({ text: "Couldn't read that image. Try a JPEG or PNG.", isError: true });
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    const updates = { first_name: firstName.trim(), last_name: lastName.trim() };

    if (newPhoto) {
      // One fixed path per user, overwritten on each change. The policy only lets
      // you write inside a folder named after your own id.
      const path = `${profile.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, newPhoto.blob, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) {
        console.error('Error uploading photo:', uploadError);
        setBusy(false);
        setMessage({ text: `Couldn't upload your photo: ${uploadError.message}`, isError: true });
        return;
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      // The path never changes, so add a version to get past browser caches.
      updates.avatar_url = `${data.publicUrl}?v=${Date.now()}`;
    }

    const { data: saved, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id)
      .select('first_name, last_name, avatar_url')
      .single();

    setBusy(false);

    if (error) {
      console.error('Error saving profile:', error);
      setMessage({ text: `Couldn't save your profile: ${error.message}`, isError: true });
      return;
    }

    setNewPhoto(null);
    onSaved(saved);
    setMessage({ text: 'Saved!', isError: false });
  }

  const shown = newPhoto ? { ...profile, avatar_url: newPhoto.previewUrl } : profile;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8">
        <button onClick={onBack} className="text-sm text-gray-500 hover:underline mb-4">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Your profile</h1>

        <div className="flex flex-col items-center mb-6">
          <Avatar profile={shown} size={96} />
          <label className="mt-3 text-sm text-blue-600 hover:underline cursor-pointer">
            {profile.avatar_url || newPhoto ? 'Change photo' : 'Add a photo'}
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoChosen}
              className="sr-only"
            />
          </label>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
          />
          <div>
            <input
              type="email"
              value={email}
              disabled
              className={`${inputClass} bg-gray-100 text-gray-500`}
            />
            <p className="text-xs text-gray-400 mt-1">
              Your email is how you sign in, so it can't be changed here.
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </form>

        {message && (
          <p
            className={`mt-4 text-center text-sm ${
              message.isError ? 'text-red-600' : 'text-green-700'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
