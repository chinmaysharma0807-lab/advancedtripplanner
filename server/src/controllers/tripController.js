const tripService = require('../services/tripService');
const { requireTripAccess } = require('../services/accessService');
const changeLog = require('../services/changeLogService');
const weatherService = require('../services/weatherService');
const recommendationService = require('../services/recommendationService');
const providers = require('../services/providers');
const { asyncHandler, ok, created, parsePagination, pageMeta } = require('../utils/http');
const { badRequest } = require('../utils/errors');

const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || {};
  const page = parsePagination(q, { defaultLimit: 50 });
  const { items, total } = await tripService.listTrips(req.user, { ...page, status: q.status });
  ok(res, items, pageMeta(page, total));
});

const create = asyncHandler(async (req, res) => {
  const trip = await tripService.createTrip(req.user, req.body);
  created(res, tripService.serialize(trip, req.user._id));
});

const get = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  ok(res, await tripService.getTripDetails(trip, req.user));
});

const update = asyncHandler(async (req, res) => {
  const { trip, role } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  const updated = await tripService.updateTrip(trip, role, req.body, req.user);
  ok(res, tripService.serialize(updated, req.user._id));
});

const remove = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'owner');
  await tripService.deleteTrip(trip);
  res.status(204).end();
});

const duplicate = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const copy = await tripService.duplicateTrip(trip, req.user, { startDate: req.body?.startDate });
  created(res, tripService.serialize(copy, req.user._id));
});

const invite = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'owner');
  created(res, await tripService.inviteParticipant(trip, req.user, req.body));
});

const updateParticipant = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'owner');
  ok(res, await tripService.updateParticipantRole(trip, req.params.userId, req.body.role));
});

const removeParticipant = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  await tripService.removeParticipant(trip, req.user, req.params.userId);
  res.status(204).end();
});

const pendingInvitations = asyncHandler(async (req, res) => ok(res, await tripService.listPendingInvitations(req.user)));

const respondInvitation = (accept) =>
  asyncHandler(async (req, res) => {
    const trip = await tripService.respondToInvitation(req.params.tripId, req.user, accept);
    ok(res, { tripId: trip._id, accepted: accept });
  });

const createShareLink = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'owner');
  created(res, await tripService.createShareLink(trip, req.user, req.body));
});

const listShareLinks = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'owner');
  ok(res, await tripService.listShareLinks(trip));
});

const revokeShareLink = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'owner');
  await tripService.revokeShareLink(trip, req.params.linkId);
  res.status(204).end();
});

const viewShared = asyncHandler(async (req, res) => ok(res, await tripService.sharedTripView(req.params.token, req.user)));

const joinShared = asyncHandler(async (req, res) => {
  const { trip, role, alreadyMember } = await tripService.joinViaShareLink(req.params.token, req.user);
  ok(res, { tripId: trip._id, role, alreadyMember });
});

const activityLog = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const page = parsePagination(req.query, { defaultLimit: 30 });
  const { items, total } = await changeLog.list(trip._id, page, { itemId: req.query.itemId });
  ok(res, items, pageMeta(page, total));
});

const weather = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const [destinations, flags] = await Promise.all([weatherService.tripWeather(trip), weatherService.flagTripItems(trip)]);
  ok(res, { destinations, flags });
});

const recommendations = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const lat = Number(req.query.lat ?? trip.destination.coordinates?.lat);
  const lng = Number(req.query.lng ?? trip.destination.coordinates?.lng);
  const radius = Math.min(10000, Math.max(100, Number(req.query.radius) || 1500));
  ok(res, await recommendationService.recommend(trip, req.user, { lat, lng, category: req.query.category, radius }));
});

const geocode = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  if (q.trim().length < 2) throw badRequest('Search for at least two characters');
  try {
    const results = await providers.geocoding.search(q);
    ok(res, results, { source: providers.geocoding.selectAdapter().name });
  } catch (err) {
    res.status(503).json({ error: { code: 'PROVIDER_UNAVAILABLE', message: `Place search is unavailable right now: ${err.message}` } });
  }
});

const providerStatus = (req, res) => ok(res, providers.describeProviders());

module.exports = {
  list,
  create,
  get,
  update,
  remove,
  duplicate,
  invite,
  updateParticipant,
  removeParticipant,
  pendingInvitations,
  acceptInvitation: respondInvitation(true),
  declineInvitation: respondInvitation(false),
  createShareLink,
  listShareLinks,
  revokeShareLink,
  viewShared,
  joinShared,
  activityLog,
  weather,
  recommendations,
  geocode,
  providerStatus,
};
