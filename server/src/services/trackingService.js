const { TrackingSession, LocationUpdate, User, ItineraryItem } = require('../models');
const env = require('../config/env');
const progressEngine = require('./progressEngine');
const tripService = require('./tripService');
const { memberIds } = require('./accessService');
const realtime = require('../sockets/realtime');
const { conflict, forbidden, badRequest } = require('../utils/errors');
const { haversine } = require('../utils/geo');
const { DAY } = require('../utils/time');

const LIVE = ['active', 'paused'];

function publicSession(session, user) {
  if (!session) return null;
  const s = session.toObject ? session.toObject() : session;
  return {
    id: String(s._id),
    tripId: String(s.tripId),
    userId: String(s.userId?._id || s.userId),
    userName: user?.name || s.userId?.name,
    status: s.status,
    startedAt: s.startedAt,
    pausedAt: s.pausedAt,
    stoppedAt: s.stoppedAt,
    lastLocation: s.lastLocation?.coordinates ? s.lastLocation : null,
    travelledMeters: Math.round(s.travelledMeters || 0),
    targetItemId: s.targetItemId,
    currentItemId: s.currentItemId,
    progress: s.progress || null,
    deviation: s.deviation ? { isDeviating: s.deviation.isDeviating, distanceMeters: s.deviation.distanceMeters, detectedAt: s.deviation.detectedAt } : null,
    route: s.leg?.geometry ? { geometry: s.leg.geometry, source: s.leg.source, isDemo: s.leg.isDemo, isEstimate: s.leg.isEstimate, targetItemId: s.leg.targetItemId } : null,
  };
}

function broadcastStatus(trip, session, user) {
  realtime.emitToTrip(trip._id, 'tracking_status_changed', {
    userId: String(user._id),
    userName: user.name,
    status: session.status,
    at: new Date().toISOString(),
  });
}

async function startTracking(trip, user) {
  let session = await TrackingSession.findOne({ tripId: trip._id, userId: user._id, status: { $in: LIVE } });
  if (session?.status === 'active') return session;
  if (session) {
    session.status = 'active';
    session.pausedAt = undefined;
  } else {
    session = new TrackingSession({ tripId: trip._id, userId: user._id, status: 'active', startedAt: new Date() });
  }
  try {
    await session.save();
  } catch (err) {
    if (err?.code === 11000) return TrackingSession.findOne({ tripId: trip._id, userId: user._id, status: { $in: LIVE } });
    throw err;
  }
  await tripService.refreshStatus(trip);
  broadcastStatus(trip, session, user);
  return session;
}

async function pauseTracking(trip, user) {
  const session = await TrackingSession.findOne({ tripId: trip._id, userId: user._id, status: 'active' });
  if (!session) throw conflict('Tracking is not active', undefined, 'TRACKING_NOT_ACTIVE');
  session.status = 'paused';
  session.pausedAt = new Date();
  await session.save();
  broadcastStatus(trip, session, user);
  return session;
}

async function stopTracking(trip, user) {
  const session = await TrackingSession.findOne({ tripId: trip._id, userId: user._id, status: { $in: LIVE } });
  if (!session) return null;
  session.status = 'stopped';
  session.stoppedAt = new Date();
  await session.save();
  await tripService.refreshStatus(trip);
  broadcastStatus(trip, session, user);
  return session;
}

/**
 * Persist a location fix, run the progress engine, then broadcast. The fix is stored before any
 * broadcast so reconnecting clients always recover the same state from MongoDB.
 */
async function recordLocation(trip, user, payload) {
  const session = await TrackingSession.findOne({ tripId: trip._id, userId: user._id, status: 'active' });
  if (!session) {
    throw conflict('Location sharing is not active for this trip. Start tracking first.', undefined, 'TRACKING_NOT_ACTIVE');
  }
  if (payload.source === 'demo_simulator' && !env.allowDemoSimulation) {
    throw forbidden('Demo location simulation is disabled on this server');
  }
  const now = Date.now();
  const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date(now);
  if (timestamp.getTime() > now + 2 * 60 * 1000) throw badRequest('Location timestamp is in the future');
  if (timestamp.getTime() < now - DAY) throw badRequest('Location timestamp is too old');

  const freshUser = await User.findById(user._id).select('name privacy');
  const retentionDays = freshUser.privacy?.locationRetentionDays || env.locationRetentionDays;
  const coordinates = { lat: payload.lat, lng: payload.lng };
  const location = await LocationUpdate.create({
    tripId: trip._id,
    userId: user._id,
    sessionId: session._id,
    coordinates,
    accuracy: payload.accuracy,
    speed: payload.speed ?? undefined,
    heading: payload.heading ?? undefined,
    timestamp,
    source: payload.source,
    expiresAt: new Date(timestamp.getTime() + retentionDays * DAY),
  });

  const previous = session.lastLocation?.timestamp ? session.lastLocation : null;
  const outOfOrder = previous && new Date(previous.timestamp) > timestamp;
  let result = { progress: session.progress, events: [], target: null };
  if (!outOfOrder) {
    if (previous?.coordinates) {
      const moved = haversine(previous.coordinates, coordinates);
      if (moved > Math.max(payload.accuracy || 0, 5)) session.travelledMeters = (session.travelledMeters || 0) + moved;
    }
    session.lastLocation = { coordinates, accuracy: payload.accuracy, timestamp, source: payload.source };
    result = await progressEngine.processLocation({ trip, session, fix: { coordinates, accuracy: payload.accuracy, timestamp }, user: freshUser });
    await session.save();
  }

  const isDemo = payload.source === 'demo_simulator';
  const plain = session.toObject();
  const update = {
    userId: String(user._id),
    userName: freshUser.name,
    coordinates,
    accuracy: payload.accuracy ?? null,
    timestamp: timestamp.toISOString(),
    source: payload.source,
    isDemo,
    progress: plain.progress || null,
    targetItemId: session.targetItemId ? String(session.targetItemId) : null,
    currentItemId: session.currentItemId ? String(session.currentItemId) : null,
    deviation: { isDeviating: plain.deviation?.isDeviating, distanceMeters: plain.deviation?.distanceMeters },
  };
  const audience = freshUser.privacy?.shareLocationWithParticipants === false ? [String(user._id)] : memberIds(trip);
  await realtime.emitToTripUsers(trip._id, audience, 'trip_location_updated', update);
  if (!outOfOrder) {
    await realtime.emitToTripUsers(trip._id, audience, 'eta_updated', {
      userId: String(user._id),
      targetItemId: update.targetItemId,
      ...(plain.progress || {}),
    });
  }
  return { location: location.toObject(), session: publicSession(session, freshUser), events: result.events, outOfOrder: Boolean(outOfOrder) };
}

/** Latest state for every live traveller on a trip the viewer may see. */
async function latestForTrip(trip, viewer) {
  const sessions = await TrackingSession.find({ tripId: trip._id, status: { $in: LIVE } }).populate('userId', 'name privacy');
  return sessions
    .filter((s) => String(s.userId._id) === String(viewer._id) || s.userId.privacy?.shareLocationWithParticipants !== false)
    .map((s) => publicSession(s));
}

async function myLatestSession(trip, user) {
  const s = await TrackingSession.findOne({ tripId: trip._id, userId: user._id }).sort({ updatedAt: -1 });
  return publicSession(s, user);
}

async function history(trip, viewer, { userId, skip, limit, since }) {
  const subject = userId || String(viewer._id);
  if (subject !== String(viewer._id)) {
    const other = await User.findById(subject).select('privacy');
    if (!other || other.privacy?.shareLocationWithParticipants === false || !memberIds(trip).includes(subject)) {
      throw forbidden('This traveller does not share their location with you');
    }
  }
  const filter = { tripId: trip._id, userId: subject, ...(since ? { timestamp: { $gte: since } } : {}) };
  const [items, total] = await Promise.all([
    LocationUpdate.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).select('coordinates accuracy timestamp source').lean(),
    LocationUpdate.countDocuments(filter),
  ]);
  return { items, total };
}

/** Planned route through a day's stops (for the map). */
async function plannedRoute(trip, day) {
  const providers = require('./providers'); // eslint-disable-line global-require
  const items = await ItineraryItem.find({ tripId: trip._id, ...(day ? { day } : {}), status: { $nin: ['cancelled', 'skipped'] } })
    .sort({ day: 1, order: 1 })
    .lean();
  const stops = items.filter((i) => i.coordinates);
  if (stops.length < 2) return { geometry: [], stops, source: null, available: false, reason: 'At least two stops with coordinates are needed to draw a route.' };
  try {
    const r = await providers.routing.route(stops.map((s) => s.coordinates), trip.transportMode);
    return { geometry: r.geometry, distance: r.distance, duration: r.duration, legs: r.legs, stops, source: r.source, isDemo: r.isDemo, isEstimate: r.isEstimate, note: r.note, available: true };
  } catch (err) {
    return { geometry: [], stops, available: false, reason: err.message };
  }
}

module.exports = { startTracking, pauseTracking, stopTracking, recordLocation, latestForTrip, myLatestSession, history, plannedRoute, publicSession };
