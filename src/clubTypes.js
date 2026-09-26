// Clubs are recurring groups (a book club); one-time events are single events.
// Under the hood a one-time event lives in a hidden club of type 'one_time', so
// that all the access rules for clubs apply to it too. The app never lists those
// as clubs. Which types an organizer may create is decided in the database
// (profiles.allowed_types); this list is only for labels and pickers.
export const ONE_TIME = 'one_time';

export const CLUB_TYPES = [
  { value: 'book_club', label: 'Book club', blurb: 'A group that reads and meets together' },
  { value: 'dinner_party', label: 'Dinner club', blurb: 'A group that shares regular meals' },
  { value: 'custom', label: 'Other club', blurb: 'Any other recurring group' },
];

export function typeLabel(value) {
  if (value === ONE_TIME) return 'One-time event';
  return CLUB_TYPES.find((t) => t.value === value)?.label ?? 'Club';
}
