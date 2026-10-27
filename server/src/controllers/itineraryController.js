const itineraryService = require('../services/itineraryService');
const generatorService = require('../services/generatorService');
const rescheduleService = require('../services/rescheduleService');
const { requireTripAccess } = require('../services/accessService');
const { ItineraryItem } = require('../models');
const { asyncHandler, ok, created } = require('../utils/http');
const { notFound } = require('../utils/errors');

/** Resolve an item by id and check the caller's access to its trip. */
async function itemWithAccess(itemId, user, role) {
  const item = await ItineraryItem.findById(itemId);
  if (!item) throw notFound('Itinerary item');
  const { trip } = await requireTripAccess(item.tripId, user, role).catch((err) => {
    if (err.status === 404) throw notFound('Itinerary item');
    throw err;
  });
  return { item, trip };
}

const list = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  ok(res, await itineraryService.listItems(trip, req.validatedQuery || {}));
});

const create = asyncHandler(async (req, res) => {
  const { trip, role } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  const { item, routing } = await itineraryService.createItem(trip, req.user, req.body, { source: role === 'owner' ? 'user' : 'collaborator' });
  res.status(201).json({ data: item, meta: { routing } });
});

const bulkCreate = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  created(res, await itineraryService.bulkCreate(trip, req.user, req.body));
});

const generate = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  ok(res, await generatorService.generateDraft(trip, req.user, req.body));
});

const update = asyncHandler(async (req, res) => {
  const { item, trip } = await itemWithAccess(req.params.id, req.user, 'editor');
  ok(res, await itineraryService.updateItem(trip, req.user, item, req.body));
});

const remove = asyncHandler(async (req, res) => {
  const { item, trip } = await itemWithAccess(req.params.id, req.user, 'editor');
  await itineraryService.deleteItem(trip, req.user, item);
  res.status(204).end();
});

const updateStatus = asyncHandler(async (req, res) => {
  const { item, trip } = await itemWithAccess(req.params.id, req.user, 'editor');
  const saved = await itineraryService.setStatus(trip, item, req.body.status, { actor: req.user, source: 'user', reason: req.body.reason || '' });
  ok(res, saved);
});

const reorder = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  ok(res, await itineraryService.reorderDay(trip, req.user, req.body));
});

const recalculate = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  ok(res, await itineraryService.recalculate(trip, req.user, req.body || {}));
});

const reportDelay = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  const proposal = await rescheduleService.reportDelay(trip, req.user, req.body);
  ok(res, proposal, { message: proposal ? undefined : 'The schedule already has enough slack for this delay.' });
});

const listProposals = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  ok(res, await rescheduleService.listProposals(trip, { status: req.query.status }));
});

const applyProposal = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  ok(res, await rescheduleService.applyProposal(trip, req.user, req.params.proposalId, req.body || {}));
});

const rejectProposal = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  ok(res, await rescheduleService.rejectProposal(trip, req.user, req.params.proposalId));
});

module.exports = { list, create, bulkCreate, generate, update, remove, updateStatus, reorder, recalculate, reportDelay, listProposals, applyProposal, rejectProposal };
