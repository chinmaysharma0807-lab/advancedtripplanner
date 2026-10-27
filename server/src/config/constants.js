const TRANSPORT_MODES = ['driving', 'walking', 'cycling', 'transit', 'flight', 'mixed'];

const TRIP_STATUSES = ['upcoming', 'active', 'completed'];

const PARTICIPANT_ROLES = ['editor', 'viewer'];
const ALL_ROLES = ['owner', ...PARTICIPANT_ROLES];

const ITEM_CATEGORIES = [
  'sightseeing',
  'activity',
  'meal',
  'hotel_checkin',
  'hotel_checkout',
  'transport',
  'rest',
  'shopping',
  'other',
];

const ITEM_STATUSES = [
  'upcoming',
  'approaching',
  'in_progress',
  'completed',
  'delayed',
  'skipped',
  'cancelled',
  'missed',
];

// Statuses after which an item no longer needs the traveller's attention.
const TERMINAL_ITEM_STATUSES = ['completed', 'skipped', 'cancelled', 'missed'];

const PRIORITIES = ['low', 'medium', 'high', 'must'];

const EXPENSE_CATEGORIES = ['transport', 'accommodation', 'food', 'activities', 'shopping', 'miscellaneous'];

// Notification types grouped into user-configurable categories.
const NOTIFICATION_CATEGORIES = {
  upcoming: ['activity_upcoming', 'activity_approaching'],
  departures: ['departure_soon'],
  eta: ['eta_changed'],
  traffic: ['traffic_delay'],
  deviation: ['route_deviation'],
  weather: ['weather_alert'],
  missed: ['activity_missed', 'schedule_conflict', 'reschedule_proposed'],
  collaborators: ['collaborator_change', 'invitation', 'change_request'],
  bookings: ['booking_reminder'],
  budget: ['budget_alert'],
  status: ['activity_status', 'arrival_detected', 'completion_prompt'],
};
const NOTIFICATION_TYPES = Object.values(NOTIFICATION_CATEGORIES).flat();

const CHANGE_TYPES = [
  'created',
  'updated',
  'deleted',
  'reordered',
  'status_changed',
  'rescheduled',
  'generated',
  'recalculated',
  'proposal_created',
  'proposal_applied',
  'proposal_rejected',
];

const CHANGE_SOURCES = ['user', 'collaborator', 'system', 'gps', 'rule', 'routing', 'weather', 'ai'];

const LOCATION_SOURCES = ['browser_geolocation', 'demo_simulator', 'manual'];

// Typical maximum sustained speeds (km/h) used to flag unrealistic transfers.
const MAX_SPEED_KMH = {
  walking: 7,
  cycling: 30,
  driving: 130,
  transit: 110,
  mixed: 130,
  flight: 950,
};

// Average speeds used only when no routing provider can answer (labelled as estimates).
const AVERAGE_SPEED_KMH = {
  walking: 4.8,
  cycling: 15,
  driving: 45,
  transit: 30,
  mixed: 35,
  flight: 700,
};

const CURRENCY_REGEX = /^[A-Z]{3}$/;

module.exports = {
  TRANSPORT_MODES,
  TRIP_STATUSES,
  PARTICIPANT_ROLES,
  ALL_ROLES,
  ITEM_CATEGORIES,
  ITEM_STATUSES,
  TERMINAL_ITEM_STATUSES,
  PRIORITIES,
  EXPENSE_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  CHANGE_TYPES,
  CHANGE_SOURCES,
  LOCATION_SOURCES,
  MAX_SPEED_KMH,
  AVERAGE_SPEED_KMH,
  CURRENCY_REGEX,
};
