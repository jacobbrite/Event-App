// Google sign-ins can arrive without a last name, so never build a name with
// a plain `${first} ${last}` (that renders "Sam null").
export function fullName(profile) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Guest';
}

export function initials(profile) {
  const letters = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
  return letters || '?';
}
