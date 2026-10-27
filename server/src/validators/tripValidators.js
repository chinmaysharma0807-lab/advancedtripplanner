const { z, place, currency, money, isoDate, coordinates } = require('./common');
const { TRANSPORT_MODES, TRIP_STATUSES, PARTICIPANT_ROLES } = require('../config/constants');

const accommodation = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(400).optional(),
  coordinates: coordinates.optional(),
  checkIn: isoDate.optional(),
  checkOut: isoDate.optional(),
  confirmationNumber: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const timezone = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown time zone' }
  );

const trackingSettings = z
  .object({
    approachRadiusMeters: z.coerce.number().int().min(50).max(20000),
    approachMinutes: z.coerce.number().int().min(1).max(120),
    arrivalRadiusMeters: z.coerce.number().int().min(20).max(2000),
    autoStartDwellMinutes: z.coerce.number().int().min(0).max(120),
    autoCompleteOnDeparture: z.boolean(),
    deviationThresholdMeters: z.coerce.number().int().min(100).max(10000),
    delayGraceMinutes: z.coerce.number().int().min(0).max(120),
    proposalThresholdMinutes: z.coerce.number().int().min(5).max(600),
  })
  .partial();

const tripFields = {
  name: z.string().trim().min(1, 'Trip name is required').max(150),
  description: z.string().trim().max(4000),
  origin: place,
  destination: place,
  intermediateStops: z.array(place).max(50),
  startDate: isoDate,
  endDate: isoDate,
  timezone,
  travelers: z.coerce.number().int().min(1).max(100),
  budget: money,
  currency,
  transportMode: z.enum(TRANSPORT_MODES),
  accommodation: z.array(accommodation).max(50),
  interests: z.array(z.string().trim().min(1).max(50)).max(30),
  visibility: z.enum(['private', 'shared']),
  statusOverride: z.enum(TRIP_STATUSES).nullable(),
  trackingSettings,
};

const dateOrder = (data, ctx) => {
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after the start date' });
  }
};

const createTrip = z
  .object(tripFields)
  .partial()
  .required({ name: true, origin: true, destination: true, startDate: true, endDate: true })
  .superRefine(dateOrder);

const updateTrip = z.object(tripFields).partial().superRefine(dateOrder);

const listTripsQuery = z.object({
  status: z.enum(TRIP_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const invitation = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(PARTICIPANT_ROLES).default('viewer'),
});

const updateParticipant = z.object({ role: z.enum(PARTICIPANT_ROLES) });

const shareLink = z.object({
  role: z.enum(PARTICIPANT_ROLES).default('viewer'),
  expiresInDays: z.coerce.number().int().min(1).max(365).nullable().default(14),
  allowAnonymousView: z.boolean().default(true),
});

module.exports = { createTrip, updateTrip, listTripsQuery, invitation, updateParticipant, shareLink };
