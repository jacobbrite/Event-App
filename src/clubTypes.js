// The kinds of club a host can create. Which of these a given host may actually
// use is decided in the database (profiles.allowed_types); this list is only for
// labels and the picker.
export const CLUB_TYPES = [
  { value: 'book_club', label: 'Book club', blurb: 'A group that reads and meets together' },
  { value: 'dinner_party', label: 'Dinner party', blurb: 'Host a meal for friends' },
  { value: 'custom', label: 'Custom event', blurb: 'Anything else' },
];

export function typeLabel(value) {
  return CLUB_TYPES.find((t) => t.value === value)?.label ?? 'Club';
}
