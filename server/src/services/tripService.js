const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  Trip,
  User,
  ItineraryItem,
  Expense,
  TrackingSession,
  ShareLink,
  LocationUpdate,
  Notification,
  ItineraryChangeLog,
  RescheduleProposal,
} = require('../models');
const { TERMINAL_ITEM_STATUSES } = require('../config/constants');
const { roleFor, accessibleTripsFilter, requireTripAccess } = require('./accessService');
const notificationService = require('./notificationService');
const realtime = require('../sockets/realtime');
const { AppError, notFound, badRequest, conflict, forbidden } = require('../utils/errors');
const { endOfUtcDay, startOfUtcDay, DAY } = require('../utils/time');
const { roundMoney } = require('../models/shared');

/**
 * Derive a trip's status from dates and real progress. A manual override always wins.
 *  - completed: past the end date, or every itinerary item has reached a terminal status
 *  - active:    within the date range, or someone is tracking right now
 *  - upcoming:  otherwise
 */
function computeStatus(trip, { now = new Date(), activeTracking = false, itemStats } = {}) {
  if (trip.statusOverride) return trip.statusOverride;
  if (now > endOfUtcDay(trip.endDate)) return 'completed';
  if (itemStats && itemStats.total > 0 && itemStats.open === 0 && now >= startOfUtcDay(trip.startDate)) return 'completed';
  if (activeTracking || now >= startOfUtcDay(trip.startDate)) return 'active';
  return 'upcoming';
}

async function refreshStatus(trip, now = new Date()) {
  const [activeTracking, total, open] = await Promise.all([
    TrackingSession.exists({ tripId: trip._id, status: 'active' }),
    ItineraryItem.countDocuments({ tripId: trip._id }),
    ItineraryItem.countDocuments({ tripId: trip._id, status: { $nin: TERMINAL_ITEM_STATUSES } }),
  ]);
  const status = computeStatus(trip, { now, activeTracking: Boolean(activeTracking), itemStats: { total, open } });
  if (status !== trip.status) {
    trip.status = status;
    await Trip.updateOne({ _id: trip._id }, { $set: { status } });
  }
  return status;
}

function serialize(trip, userId, extras = {}) {
  const obj = trip.toObject ? trip.toObject({ virtuals: false }) : trip;
  return { ...obj, id: String(obj._id), myRole: roleFor(obj, userId), ...extras };
}

async function spendingFor(tripIds, currencyById) {
  const rows = await Expense.aggregate([
    { $match: { tripId: { $in: tripIds } } },
    { $project: { tripId: 1, amount: 1, currency: 1, exchangeRate: 1 } },
  ]);
  const totals = {};
  for (const r of rows) {
    const tripCurrency = currencyById[String(r.tripId)];
    const value = r.currency === tripCurrency ? r.amount : r.exchangeRate ? r.amount * r.exchangeRate : null;
    if (value === null) continue;
    totals[String(r.tripId)] = roundMoney((totals[String(r.tripId)] || 0) + value);
  }
  return totals;
}

async function createTrip(user, data) {
  const trip = await Trip.create({
    ...data,
    ownerId: user._id,
    currency: data.currency || user.travelPreferences?.currency || 'INR',
    transportMode: data.transportMode || user.travelPreferences?.transport || 'driving',
  });
  trip.status = computeStatus(trip);
  await trip.save();
  return trip;
}

async function listTrips(user, { status, skip, limit }) {
  const filter = { ...accessibleTripsFilter(user._id), ...(status ? { status } : {}) };
  const [trips, total] = await Promise.all([
    Trip.find(filter).sort({ startDate: 1 }).skip(skip).limit(limit),
    Trip.countDocuments(filter),
  ]);
  await Promise.all(trips.map((t) => refreshStatus(t)));
  const ids = trips.map((t) => t._id);
  const [spending, itemCounts, tracking] = await Promise.all([
    spendingFor(ids, Object.fromEntries(trips.map((t) => [String(t._id), t.currency]))),
    ItineraryItem.aggregate([
      { $match: { tripId: { $in: ids } } },
      {
        $group: {
          _id: '$tripId',
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $in: ['$status', TERMINAL_ITEM_STATUSES] }, 1, 0] } },
        },
      },
    ]),
    TrackingSession.find({ tripId: { $in: ids }, status: 'active' }).select('tripId userId progress lastLocation.timestamp').lean(),
  ]);
  const countsById = Object.fromEntries(itemCounts.map((c) => [String(c._id), c]));
  const items = trips
    .filter((t) => !status || t.status === status)
    .map((t) => {
      const c = countsById[String(t._id)] || { total: 0, done: 0 };
      return serialize(t, user._id, {
        actualSpending: spending[String(t._id)] || 0,
        itineraryStats: { total: c.total, done: c.done, percent: c.total ? Math.round((c.done / c.total) * 100) : 0 },
        liveTracking: tracking
          .filter((s) => String(s.tripId) === String(t._id))
          .map((s) => ({ userId: s.userId, eta: s.progress?.eta, percent: s.progress?.percent, lastUpdate: s.lastLocation?.timestamp })),
      });
    });
  return { items, total };
}

async function getTripDetails(trip, user) {
  await refreshStatus(trip);
  await trip.populate([
    { path: 'ownerId', select: 'name email' },
    { path: 'participants.userId', select: 'name email' },
  ]);
  const [spending, activeSessions] = await Promise.all([
    spendingFor([trip._id], { [String(trip._id)]: trip.currency }),
    TrackingSession.find({ tripId: trip._id, status: { $in: ['active', 'paused'] } })
      .select('userId status startedAt')
      .populate('userId', 'name')
      .lean(),
  ]);
  const obj = trip.toObject();
  return {
    ...obj,
    id: String(obj._id),
    owner: obj.ownerId,
    ownerId: obj.ownerId?._id,
    myRole: roleFor(trip, user._id),
    actualSpending: spending[String(trip._id)] || 0,
    activeTracking: activeSessions,
  };
}

const OWNER_ONLY_FIELDS = ['visibility', 'statusOverride', 'trackingSettings'];

async function updateTrip(trip, role, patch, actor) {
  if (role !== 'owner' && OWNER_ONLY_FIELDS.some((f) => patch[f] !== undefined)) {
    throw forbidden('Only the trip owner can change visibility, status overrides or tracking rules');
  }
  if (patch.trackingSettings) {
    patch.trackingSettings = { ...trip.trackingSettings.toObject(), ...patch.trackingSettings };
  }
  const datesMoved = patch.startDate && String(new Date(patch.startDate)) !== String(trip.startDate);
  const shiftMs = datesMoved ? startOfUtcDay(patch.startDate) - startOfUtcDay(trip.startDate) : 0;

  trip.set(patch);
  await trip.validate();
  await trip.save();

  // Moving the start date shifts the whole itinerary so day numbers stay meaningful.
  if (shiftMs) {
    await ItineraryItem.updateMany({ tripId: trip._id }, [
      {
        $set: {
          scheduledStart: { $add: ['$scheduledStart', shiftMs] },
          scheduledEnd: { $add: ['$scheduledEnd', shiftMs] },
        },
      },
    ]);
  }
  await refreshStatus(trip);
  realtime.emitToTrip(trip._id, 'trip_updated', { changedBy: { id: String(actor._id), name: actor.name } });
  await notificationService.notifyTripMembers(
    trip,
    {
      type: 'collaborator_change',
      title: `${trip.name} was updated`,
      message: `${actor.name} updated the trip details.`,
      dedupKey: `trip-updated:${trip._id}:${trip.updatedAt.getTime()}`,
    },
    { excludeUserId: actor._id }
  );
  return trip;
}

async function deleteTrip(trip) {
  const tripId = trip._id;
  await Promise.all([
    ItineraryItem.deleteMany({ tripId }),
    Expense.deleteMany({ tripId }),
    TrackingSession.deleteMany({ tripId }),
    LocationUpdate.deleteMany({ tripId }),
    ShareLink.deleteMany({ tripId }),
    Notification.deleteMany({ tripId }),
    ItineraryChangeLog.deleteMany({ tripId }),
    RescheduleProposal.deleteMany({ tripId }),
  ]);
  await Trip.deleteOne({ _id: tripId });
  realtime.emitToTrip(tripId, 'trip_deleted', {});
}

async function duplicateTrip(trip, user, { startDate } = {}) {
  const source = trip.toObject();
  const newStart = startDate ? startOfUtcDay(startDate) : startOfUtcDay(source.startDate);
  const shift = newStart - startOfUtcDay(source.startDate);
  const copy = await Trip.create({
    ...source,
    _id: undefined,
    name: `${source.name} (copy)`,
    ownerId: user._id,
    participants: [],
    statusOverride: null,
    status: 'upcoming',
    isDemo: false,
    startDate: new Date(new Date(source.startDate).getTime() + shift),
    endDate: new Date(new Date(source.endDate).getTime() + shift),
    accommodation: (source.accommodation || []).map(({ _id, ...a }) => a),
    createdAt: undefined,
    updatedAt: undefined,
  });
  const items = await ItineraryItem.find({ tripId: trip._id }).lean();
  if (items.length) {
    await ItineraryItem.insertMany(
      items.map(({ _id, createdAt, updatedAt, eta, actualStart, actualEnd, weatherFlag, ...item }) => ({
        ...item,
        tripId: copy._id,
        status: 'upcoming',
        statusSource: 'user',
        scheduledStart: new Date(new Date(item.scheduledStart).getTime() + shift),
        scheduledEnd: new Date(new Date(item.scheduledEnd).getTime() + shift),
        lastModifiedBy: user._id,
      }))
    );
  }
  copy.status = computeStatus(copy);
  await copy.save();
  return copy;
}

// ---------------------------------------------------------------- collaboration

async function inviteParticipant(trip, actor, { email, role }) {
  const invitee = await User.findOne({ email });
  if (!invitee) {
    throw new AppError(404, 'USER_NOT_FOUND', 'No TripSync account uses that email. Ask them to sign up first, or create a share link instead.');
  }
  if (String(invitee._id) === String(trip.ownerId)) throw badRequest('The owner is already on this trip');
  const existing = trip.participants.find((p) => String(p.userId) === String(invitee._id));
  if (existing) {
    if (existing.status === 'accepted') throw conflict('This user is already a participant');
    existing.role = role;
  } else {
    trip.participants.push({ userId: invitee._id, role, status: 'pending', invitedBy: actor._id, invitedAt: new Date() });
  }
  if (trip.visibility === 'private') trip.visibility = 'shared';
  await trip.save();
  await notificationService.notify({
    userId: invitee._id,
    tripId: trip._id,
    type: 'invitation',
    title: `Invitation to ${trip.name}`,
    message: `${actor.name} invited you to join "${trip.name}" as ${role === 'editor' ? 'an editor' : 'a viewer'}.`,
    data: { tripId: String(trip._id), role },
    dedupKey: `invitation:${trip._id}:${invitee._id}:${role}`,
  });
  return { userId: invitee._id, name: invitee.name, email: invitee.email, role, status: 'pending' };
}

async function respondToInvitation(tripId, user, accept) {
  if (!mongoose.isValidObjectId(tripId)) throw notFound('Invitation');
  const trip = await Trip.findById(tripId);
  const p = trip?.participants.find((x) => String(x.userId) === String(user._id) && x.status === 'pending');
  if (!p) throw notFound('Invitation');
  if (accept) {
    p.status = 'accepted';
    p.joinedAt = new Date();
  } else {
    trip.participants = trip.participants.filter((x) => String(x.userId) !== String(user._id));
  }
  await trip.save();
  if (accept) {
    realtime.emitToTrip(trip._id, 'collaborator_joined', { user: { id: String(user._id), name: user.name }, role: p.role });
    await notificationService.notify({
      userId: trip.ownerId,
      tripId: trip._id,
      type: 'collaborator_change',
      title: `${user.name} joined ${trip.name}`,
      message: `${user.name} accepted your invitation as ${p.role}.`,
      dedupKey: `joined:${trip._id}:${user._id}`,
    });
  }
  return trip;
}

async function listPendingInvitations(user) {
  const trips = await Trip.find({ participants: { $elemMatch: { userId: user._id, status: 'pending' } } })
    .select('name destination startDate endDate ownerId participants')
    .populate('ownerId', 'name');
  return trips.map((t) => {
    const p = t.participants.find((x) => String(x.userId) === String(user._id));
    return { tripId: t._id, name: t.name, destination: t.destination, startDate: t.startDate, endDate: t.endDate, owner: t.ownerId, role: p.role, invitedAt: p.invitedAt };
  });
}

async function updateParticipantRole(trip, userId, role) {
  const p = trip.participants.find((x) => String(x.userId) === String(userId));
  if (!p) throw notFound('Participant');
  p.role = role;
  await trip.save();
  realtime.emitToTrip(trip._id, 'trip_updated', { participants: true });
  return p;
}

async function removeParticipant(trip, actor, userId) {
  const isSelf = String(actor._id) === String(userId);
  if (!isSelf && String(trip.ownerId) !== String(actor._id)) throw forbidden('Only the owner can remove participants');
  const before = trip.participants.length;
  trip.participants = trip.participants.filter((x) => String(x.userId) !== String(userId));
  if (trip.participants.length === before) throw notFound('Participant');
  await trip.save();
  await TrackingSession.updateMany({ tripId: trip._id, userId, status: { $ne: 'stopped' } }, { $set: { status: 'stopped', stoppedAt: new Date() } });
  realtime.removeUserFromTrip(userId, trip._id);
  realtime.emitToTrip(trip._id, 'trip_updated', { participants: true });
}

// ---------------------------------------------------------------- share links

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function createShareLink(trip, actor, { role, expiresInDays, allowAnonymousView }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const link = await ShareLink.create({
    tripId: trip._id,
    tokenHash: hashToken(token),
    role,
    allowAnonymousView,
    createdBy: actor._id,
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * DAY) : null,
  });
  if (trip.visibility === 'private') {
    trip.visibility = 'shared';
    await trip.save();
  }
  return { ...link.toObject(), tokenHash: undefined, token };
}

async function listShareLinks(trip) {
  return ShareLink.find({ tripId: trip._id, revokedAt: null }).select('-tokenHash').sort({ createdAt: -1 }).lean();
}

async function revokeShareLink(trip, linkId) {
  const res = await ShareLink.updateOne({ _id: linkId, tripId: trip._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!res.matchedCount) throw notFound('Share link');
}

async function resolveShareLink(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 100) throw notFound('Share link');
  const link = await ShareLink.findOne({ tokenHash: hashToken(token), revokedAt: null });
  if (!link || (link.expiresAt && link.expiresAt < new Date())) throw notFound('Share link');
  const trip = await Trip.findById(link.tripId);
  if (!trip) throw notFound('Share link');
  return { link, trip };
}

/** Public, read-only view of a shared itinerary. Never includes live location. */
async function sharedTripView(token, user) {
  const { link, trip } = await resolveShareLink(token);
  const role = roleFor(trip, user?._id);
  if (!link.allowAnonymousView && !role) {
    return { requiresSignIn: true, linkRole: link.role, tripName: trip.name };
  }
  const items = await ItineraryItem.find({ tripId: trip._id })
    .sort({ day: 1, order: 1 })
    .select('day order title description category location coordinates scheduledStart scheduledEnd status priority transportMode')
    .lean();
  return {
    trip: {
      id: String(trip._id),
      name: trip.name,
      description: trip.description,
      origin: trip.origin,
      destination: trip.destination,
      intermediateStops: trip.intermediateStops,
      startDate: trip.startDate,
      endDate: trip.endDate,
      timezone: trip.timezone,
      status: trip.status,
    },
    items,
    linkRole: link.role,
    myRole: role,
  };
}

async function joinViaShareLink(token, user) {
  const { link, trip } = await resolveShareLink(token);
  const role = roleFor(trip, user._id);
  if (role) return { trip, role, alreadyMember: true };
  trip.participants = trip.participants.filter((p) => String(p.userId) !== String(user._id));
  trip.participants.push({ userId: user._id, role: link.role, status: 'accepted', invitedBy: link.createdBy, joinedAt: new Date() });
  await trip.save();
  await ShareLink.updateOne({ _id: link._id }, { $inc: { uses: 1 } });
  realtime.emitToTrip(trip._id, 'collaborator_joined', { user: { id: String(user._id), name: user.name }, role: link.role });
  await notificationService.notify({
    userId: trip.ownerId,
    tripId: trip._id,
    type: 'collaborator_change',
    title: `${user.name} joined ${trip.name}`,
    message: `${user.name} joined through a share link as ${link.role}.`,
    dedupKey: `joined:${trip._id}:${user._id}`,
  });
  return { trip, role: link.role, alreadyMember: false };
}

module.exports = {
  computeStatus,
  refreshStatus,
  serialize,
  createTrip,
  listTrips,
  getTripDetails,
  updateTrip,
  deleteTrip,
  duplicateTrip,
  inviteParticipant,
  respondToInvitation,
  listPendingInvitations,
  updateParticipantRole,
  removeParticipant,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  sharedTripView,
  joinViaShareLink,
  requireTripAccess,
};
