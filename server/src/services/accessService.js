const mongoose = require('mongoose');
const { Trip } = require('../models');
const { notFound, forbidden } = require('../utils/errors');

const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };

/** Role of `userId` on `trip`, or null. Pending invitations grant no access. */
function roleFor(trip, userId) {
  if (!trip || !userId) return null;
  const id = String(userId);
  if (String(trip.ownerId?._id || trip.ownerId) === id) return 'owner';
  const p = trip.participants?.find((x) => String(x.userId?._id || x.userId) === id && x.status === 'accepted');
  return p ? p.role : null;
}

const hasRole = (role, required) => Boolean(role) && ROLE_RANK[role] >= ROLE_RANK[required];

/**
 * Load a trip and assert the user holds at least `required`. Returns 404 (not 403) when the user
 * has no relationship with the trip, so trip ids cannot be probed.
 */
async function requireTripAccess(tripId, user, required = 'viewer') {
  if (!mongoose.isValidObjectId(tripId)) throw notFound('Trip');
  const trip = await Trip.findById(tripId);
  const role = roleFor(trip, user?._id);
  if (!trip || !role) throw notFound('Trip');
  if (!hasRole(role, required)) {
    throw forbidden(required === 'owner' ? 'Only the trip owner can do this' : 'You need editor access to change this trip');
  }
  return { trip, role };
}

/** Ids of users with accepted access (owner first). */
function memberIds(trip) {
  return [
    String(trip.ownerId),
    ...trip.participants.filter((p) => p.status === 'accepted').map((p) => String(p.userId)),
  ];
}

/** Query fragment matching trips a user may read. */
const accessibleTripsFilter = (userId) => ({
  $or: [{ ownerId: userId }, { participants: { $elemMatch: { userId, status: 'accepted' } } }],
});

module.exports = { ROLE_RANK, roleFor, hasRole, requireTripAccess, memberIds, accessibleTripsFilter };
