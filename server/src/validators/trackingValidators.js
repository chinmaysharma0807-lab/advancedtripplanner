const { z, isoDate } = require('./common');
const { LOCATION_SOURCES } = require('../config/constants');

const locationUpdate = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100000).optional(),
  speed: z.coerce.number().min(0).max(400).nullable().optional(),
  heading: z.coerce.number().min(0).max(360).nullable().optional(),
  timestamp: isoDate.optional(),
  source: z.enum(LOCATION_SOURCES).default('browser_geolocation'),
});

const startTracking = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: 'Explicit consent is required to start location sharing' }) }),
});

const historyQuery = z.object({
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  since: isoDate.optional(),
});

module.exports = { locationUpdate, startTracking, historyQuery };
