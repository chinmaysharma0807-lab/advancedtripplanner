const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validate, validateObjectIds } = require('../middleware/validate');
const { authLimiter, locationLimiter } = require('../middleware/rateLimit');
const { z, isoDate, objectId, pagination } = require('../validators/common');
const authV = require('../validators/authValidators');
const tripV = require('../validators/tripValidators');
const itemV = require('../validators/itineraryValidators');
const trackV = require('../validators/trackingValidators');
const expenseV = require('../validators/expenseValidators');
const auth = require('../controllers/authController');
const trips = require('../controllers/tripController');
const itinerary = require('../controllers/itineraryController');
const tracking = require('../controllers/trackingController');
const expenses = require('../controllers/expenseController');
const notifications = require('../controllers/notificationController');

const router = express.Router();
const tripId = validateObjectIds('tripId');
const id = validateObjectIds('id');

// ---------------------------------------------------------------- auth & profile
router.get('/auth/csrf', auth.csrf);
router.post('/auth/register', authLimiter, validate({ body: authV.register }), auth.register);
router.post('/auth/login', authLimiter, validate({ body: authV.login }), auth.login);
router.post('/auth/logout', auth.logout);
router.post('/auth/logout-all', requireAuth, auth.logoutAll);
router.get('/auth/me', requireAuth, auth.me);
router.patch('/users/me', requireAuth, validate({ body: authV.updateProfile }), auth.updateMe);
router.post('/users/me/password', authLimiter, requireAuth, validate({ body: authV.changePassword }), auth.changePassword);
router.delete('/users/me/location-history', requireAuth, validate({ query: z.object({ tripId: objectId.optional() }) }), auth.deleteLocationHistory);

// ---------------------------------------------------------------- utilities
router.get('/providers', trips.providerStatus);
router.get('/geocode', requireAuth, trips.geocode);

// ---------------------------------------------------------------- trips
router.get('/trips', requireAuth, validate({ query: tripV.listTripsQuery }), trips.list);
router.post('/trips', requireAuth, validate({ body: tripV.createTrip }), trips.create);
router.get('/trips/:tripId', requireAuth, tripId, trips.get);
router.patch('/trips/:tripId', requireAuth, tripId, validate({ body: tripV.updateTrip }), trips.update);
router.delete('/trips/:tripId', requireAuth, tripId, trips.remove);
router.post('/trips/:tripId/duplicate', requireAuth, tripId, validate({ body: z.object({ startDate: isoDate.optional() }) }), trips.duplicate);
router.get('/trips/:tripId/activity-log', requireAuth, tripId, trips.activityLog);
router.get('/trips/:tripId/weather', requireAuth, tripId, trips.weather);
router.get('/trips/:tripId/recommendations', requireAuth, tripId, trips.recommendations);

// collaboration
router.post('/trips/:tripId/invitations', requireAuth, tripId, validate({ body: tripV.invitation }), trips.invite);
router.get('/invitations', requireAuth, trips.pendingInvitations);
router.post('/invitations/:tripId/accept', requireAuth, tripId, trips.acceptInvitation);
router.post('/invitations/:tripId/decline', requireAuth, tripId, trips.declineInvitation);
router.patch('/trips/:tripId/participants/:userId', requireAuth, validateObjectIds('tripId', 'userId'), validate({ body: tripV.updateParticipant }), trips.updateParticipant);
router.delete('/trips/:tripId/participants/:userId', requireAuth, validateObjectIds('tripId', 'userId'), trips.removeParticipant);
router.get('/trips/:tripId/share-links', requireAuth, tripId, trips.listShareLinks);
router.post('/trips/:tripId/share-links', requireAuth, tripId, validate({ body: tripV.shareLink }), trips.createShareLink);
router.delete('/trips/:tripId/share-links/:linkId', requireAuth, validateObjectIds('tripId', 'linkId'), trips.revokeShareLink);
router.get('/share/:token', optionalAuth, trips.viewShared);
router.post('/share/:token/join', requireAuth, trips.joinShared);

// ---------------------------------------------------------------- itinerary
router.get('/trips/:tripId/itinerary', requireAuth, tripId, validate({ query: itemV.listItemsQuery }), itinerary.list);
router.post('/trips/:tripId/itinerary', requireAuth, tripId, validate({ body: itemV.createItem }), itinerary.create);
router.post('/trips/:tripId/itinerary/bulk', requireAuth, tripId, validate({ body: itemV.bulkCreate }), itinerary.bulkCreate);
router.post('/trips/:tripId/itinerary/generate', requireAuth, tripId, validate({ body: itemV.generate }), itinerary.generate);
router.patch('/trips/:tripId/itinerary/reorder', requireAuth, tripId, validate({ body: itemV.reorder }), itinerary.reorder);
router.post('/trips/:tripId/itinerary/recalculate', requireAuth, tripId, validate({ body: itemV.recalculate }), itinerary.recalculate);
router.post(
  '/trips/:tripId/itinerary/delay',
  requireAuth,
  tripId,
  validate({ body: z.object({ minutes: z.coerce.number().int().min(1).max(720), itemId: objectId.optional() }) }),
  itinerary.reportDelay
);
router.get('/trips/:tripId/proposals', requireAuth, tripId, itinerary.listProposals);
router.post(
  '/trips/:tripId/proposals/:proposalId/apply',
  requireAuth,
  validateObjectIds('tripId', 'proposalId'),
  validate({ body: z.object({ excludeItemIds: z.array(objectId).max(200).optional() }) }),
  itinerary.applyProposal
);
router.post('/trips/:tripId/proposals/:proposalId/reject', requireAuth, validateObjectIds('tripId', 'proposalId'), itinerary.rejectProposal);
router.patch('/itinerary/:id', requireAuth, id, validate({ body: itemV.updateItem }), itinerary.update);
router.patch('/itinerary/:id/status', requireAuth, id, validate({ body: itemV.statusUpdate }), itinerary.updateStatus);
router.delete('/itinerary/:id', requireAuth, id, itinerary.remove);

// ---------------------------------------------------------------- live tracking
router.post('/trips/:tripId/tracking/start', requireAuth, tripId, validate({ body: trackV.startTracking }), tracking.start);
router.post('/trips/:tripId/tracking/pause', requireAuth, tripId, tracking.pause);
router.post('/trips/:tripId/tracking/stop', requireAuth, tripId, tracking.stop);
router.post('/trips/:tripId/location', requireAuth, locationLimiter, tripId, validate({ body: trackV.locationUpdate }), tracking.location);
router.get('/trips/:tripId/location/latest', requireAuth, tripId, tracking.latest);
router.get('/trips/:tripId/location/history', requireAuth, tripId, validate({ query: trackV.historyQuery }), tracking.history);
router.get('/trips/:tripId/route', requireAuth, tripId, validate({ query: itemV.routeQuery }), tracking.route);

// ---------------------------------------------------------------- notifications
router.get('/notifications', requireAuth, validate({ query: pagination.extend({ unread: z.enum(['true', 'false']).optional() }) }), notifications.list);
router.patch('/notifications/read-all', requireAuth, notifications.markAllRead);
router.patch('/notifications/:id/read', requireAuth, id, notifications.markRead);

// ---------------------------------------------------------------- expenses
router.get('/trips/:tripId/expenses', requireAuth, tripId, validate({ query: expenseV.listExpensesQuery }), expenses.list);
router.get('/trips/:tripId/expenses/summary', requireAuth, tripId, expenses.summary);
router.post('/trips/:tripId/expenses', requireAuth, tripId, validate({ body: expenseV.createExpense }), expenses.create);
router.patch('/expenses/:id', requireAuth, id, validate({ body: expenseV.updateExpense }), expenses.update);
router.delete('/expenses/:id', requireAuth, id, expenses.remove);

module.exports = router;
