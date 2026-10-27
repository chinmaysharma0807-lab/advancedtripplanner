const trackingService = require('../services/trackingService');
const { requireTripAccess } = require('../services/accessService');
const { asyncHandler, ok, parsePagination, pageMeta } = require('../utils/http');

const start = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  const session = await trackingService.startTracking(trip, req.user);
  ok(res, trackingService.publicSession(session, req.user));
});

const pause = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  ok(res, trackingService.publicSession(await trackingService.pauseTracking(trip, req.user), req.user));
});

const stop = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'viewer');
  const session = await trackingService.stopTracking(trip, req.user);
  ok(res, session ? trackingService.publicSession(session, req.user) : { status: 'stopped' });
});

const location = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  res.status(201).json({ data: await trackingService.recordLocation(trip, req.user, req.body) });
});

const latest = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const [travellers, mine] = await Promise.all([trackingService.latestForTrip(trip, req.user), trackingService.myLatestSession(trip, req.user)]);
  ok(res, { travellers, mine });
});

const history = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const q = req.validatedQuery || {};
  const page = parsePagination(q, { defaultLimit: 200, maxLimit: 1000 });
  const { items, total } = await trackingService.history(trip, req.user, { ...page, userId: q.userId, since: q.since });
  ok(res, items, pageMeta(page, total));
});

const route = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  ok(res, await trackingService.plannedRoute(trip, (req.validatedQuery || {}).day));
});

module.exports = { start, pause, stop, location, latest, history, route };
