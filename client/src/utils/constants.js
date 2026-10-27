export const ITEM_STATUS = {
  upcoming: { label: 'Upcoming', className: 'bg-slate-100 text-slate-700', dot: '#64748b' },
  approaching: { label: 'Approaching', className: 'bg-sky-100 text-sky-800', dot: '#0284c7' },
  in_progress: { label: 'In progress', className: 'bg-brand-100 text-brand-800', dot: '#1473ef' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-800', dot: '#059669' },
  delayed: { label: 'Delayed', className: 'bg-amber-100 text-amber-800', dot: '#d97706' },
  skipped: { label: 'Skipped', className: 'bg-slate-200 text-slate-600', dot: '#94a3b8' },
  cancelled: { label: 'Cancelled', className: 'bg-rose-100 text-rose-700', dot: '#e11d48' },
  missed: { label: 'Missed', className: 'bg-rose-100 text-rose-800', dot: '#be123c' },
};

export const TRIP_STATUS = {
  upcoming: { label: 'Upcoming', className: 'bg-sky-100 text-sky-800' },
  active: { label: 'Active', className: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', className: 'bg-slate-200 text-slate-700' },
};

export const CATEGORIES = [
  ['sightseeing', 'Sightseeing', '🏛️'],
  ['activity', 'Activity', '🎟️'],
  ['meal', 'Meal', '🍽️'],
  ['hotel_checkin', 'Hotel check-in', '🏨'],
  ['hotel_checkout', 'Hotel check-out', '🧳'],
  ['transport', 'Transport', '🚆'],
  ['rest', 'Rest', '☕'],
  ['shopping', 'Shopping', '🛍️'],
  ['other', 'Other', '📍'],
];
export const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map(([k, , icon]) => [k, icon]));

export const TRANSPORT_MODES = [
  ['walking', 'Walking'],
  ['driving', 'Driving'],
  ['cycling', 'Cycling'],
  ['transit', 'Public transport'],
  ['flight', 'Flight'],
  ['mixed', 'Mixed'],
];

export const PRIORITIES = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['must', 'Must do'],
];

export const EXPENSE_CATEGORIES = [
  ['transport', 'Transport', '#1473ef'],
  ['accommodation', 'Accommodation', '#7c3aed'],
  ['food', 'Food', '#f59e0b'],
  ['activities', 'Activities', '#10b981'],
  ['shopping', 'Shopping', '#ec4899'],
  ['miscellaneous', 'Miscellaneous', '#64748b'],
];

export const INTERESTS = ['museums', 'food', 'history', 'nature', 'art', 'nightlife', 'shopping', 'architecture', 'beaches', 'adventure', 'culture', 'family'];

export const NOTIFICATION_CATEGORIES = [
  ['upcoming', 'Upcoming activities', 'Reminders shortly before an activity and when you are approaching it'],
  ['departures', 'Departure times', 'When it is time to leave for the next stop'],
  ['eta', 'ETA changes', 'When your estimated arrival changes significantly'],
  ['traffic', 'Traffic delays', 'Live traffic slowing you down or meaning you should leave earlier (needs TomTom routing)'],
  ['deviation', 'Route deviations', 'When you move far from the planned route'],
  ['weather', 'Weather alerts', 'Forecasts that may affect outdoor plans'],
  ['missed', 'Missed activities & conflicts', 'Missed windows and proposed schedule changes'],
  ['collaborators', 'Collaborator changes', 'Invitations and edits made by others'],
  ['bookings', 'Bookings & check-ins', 'Reservation and check-in reminders'],
  ['budget', 'Budget alerts', 'When spending nears or exceeds the budget'],
  ['status', 'Activity status prompts', 'Arrival and completion confirmations'],
];

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED', 'CHF', 'CNY', 'THB'];

export const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Madrid',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Dubai',
  'Australia/Sydney',
];
