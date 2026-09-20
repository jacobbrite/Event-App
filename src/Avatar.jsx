import { initials } from './names';

// Round profile picture, falling back to initials when there isn't one.
function Avatar({ profile, size = 40 }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };

  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        style={style}
        className="rounded-full object-cover bg-gray-200"
        // Google-hosted pictures sometimes refuse to load when a referrer is sent.
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      style={style}
      className="rounded-full bg-blue-100 text-blue-700 font-semibold inline-flex items-center justify-center"
    >
      {initials(profile)}
    </span>
  );
}

export default Avatar;
