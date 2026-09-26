// The three answers a guest can give, with the button styling for each when it
// is the selected one.
export const RSVP_OPTIONS = [
  { value: 'going', label: 'Going', selected: 'bg-green-600 border-green-600 text-white' },
  { value: 'maybe', label: 'Maybe', selected: 'bg-amber-500 border-amber-500 text-white' },
  { value: 'not_going', label: "Can't go", selected: 'bg-gray-600 border-gray-600 text-white' },
];

export const RSVP_MESSAGES = {
  going: "You're going! 🎉",
  maybe: "You're a maybe.",
  not_going: "You can't make it.",
};
