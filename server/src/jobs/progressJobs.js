const { Trip, ItineraryItem, TrackingSession, RescheduleProposal } = require('../models');
const itineraryService = require('../services/itineraryService');
const notificationService = require('../services/notificationService');
const tripService = require('../services/tripService');
const weatherService = require('../services/weatherService');
const providers = require('../services/providers');
const realtime = require('../sockets/realtime');
const env = require('../config/env');
const logger = require('../config/logger');
const { MINUTE, HOUR, DAY, localTimeOfDay } = require('../utils/time');

const OPEN = ['upcoming', 'approaching', 'delayed'];

async function openTrips(now) {
  return Trip.find({
    statusOverride: { $ne: 'completed' },
    startDate: { $lte: new Date(now.getTime() + 2 * DAY) },
    endDate: { $gte: new Date(now.getTime() - 2 * DAY) },
  });
}

/** Missed activities, upcoming/departure/booking reminders, trip status refresh. Runs every minute. */
async function sweepSchedules(now = new Date()) {
  const trips = await openTrips(now);
  const stats = { trips: trips.length, missed: 0, reminders: 0 };
  for (const trip of trips) {
    const tz = trip.timezone;

    // Activities whose window passed without being started or completed.
    const missed = await ItineraryItem.find({ tripId: trip._id, status: { $in: OPEN }, scheduledEnd: { $lt: new Date(now.getTime() - 5 * MINUTE) } });
    for (const item of missed) {
      await itineraryService.setStatus(trip, item, 'missed', {
        source: 'system',
        reason: `The scheduled window (${localTimeOfDay(item.scheduledStart, tz)}–${localTimeOfDay(item.scheduledEnd, tz)}) passed without the activity being started.`,
      });
      if (now - item.scheduledEnd < DAY) {
        await notificationService.notifyTripMembers(trip, {
          type: 'activity_missed',
          severity: 'warning',
          title: `Missed: ${item.title}`,
          message: `"${item.title}" was not started in its scheduled window. You can reschedule it or mark it as skipped.`,
          data: { itemId: String(item._id) },
          dedupKey: `missed:${item._id}`,
        });
      }
      stats.missed += 1;
    }

    const soon = await ItineraryItem.find({
      tripId: trip._id,
      status: { $in: OPEN },
      scheduledStart: { $gte: now, $lte: new Date(now.getTime() + DAY) },
    });
    for (const item of soon) {
      const minutesUntil = Math.round((item.scheduledStart - now) / MINUTE);
      const at = localTimeOfDay(item.scheduledStart, tz);
      if (minutesUntil <= 30) {
        const r = await notificationService.notifyTripMembers(trip, {
          type: 'activity_upcoming',
          title: `Coming up: ${item.title}`,
          message: `"${item.title}" starts at ${at} (in ${minutesUntil} min).`,
          data: { itemId: String(item._id) },
          dedupKey: `upcoming:${item._id}`,
        });
        stats.reminders += r.filter((x) => x.created).length;
      }
      if (Number.isFinite(item.estimatedTravelTime) && item.estimatedTravelTime > 0) {
        const leaveBy = item.scheduledStart.getTime() - item.estimatedTravelTime * MINUTE;
        if (now.getTime() >= leaveBy - 15 * MINUTE && now.getTime() < leaveBy + 5 * MINUTE) {
          await notificationService.notifyTripMembers(trip, {
            type: 'departure_soon',
            title: `Leave soon for ${item.title}`,
            message: `Leave by ${localTimeOfDay(new Date(leaveBy), tz)} to arrive at ${at} (about ${item.estimatedTravelTime} min travel, ${item.travelSource || 'estimate'}).`,
            data: { itemId: String(item._id) },
            dedupKey: `departure:${item._id}`,
          });
        }
      }
      const isBooking = item.category === 'hotel_checkin' || item.isFixedTime || item.bookingReference?.code;
      if (isBooking) {
        await notificationService.notifyTripMembers(trip, {
          type: 'booking_reminder',
          title: `Booking reminder: ${item.title}`,
          message: `${item.title} at ${at}${item.bookingReference?.code ? ` · reference ${item.bookingReference.code}` : ''}.`,
          data: { itemId: String(item._id) },
          dedupKey: `booking:${item._id}`,
        });
      }
    }

    for (const acc of trip.accommodation || []) {
      if (acc.checkIn && acc.checkIn > now && acc.checkIn - now <= DAY) {
        await notificationService.notifyTripMembers(trip, {
          type: 'booking_reminder',
          title: `Check-in tomorrow: ${acc.name}`,
          message: `Check-in at ${acc.name} on ${acc.checkIn.toISOString().slice(0, 16).replace('T', ' ')} UTC${acc.confirmationNumber ? ` · confirmation ${acc.confirmationNumber}` : ''}.`,
          dedupKey: `booking:acc:${acc._id}`,
        });
      }
    }

    await tripService.refreshStatus(trip, now);
  }

  // Proposals that were never answered expire once their day is over.
  await RescheduleProposal.updateMany({ status: 'pending', createdAt: { $lt: new Date(now.getTime() - 18 * HOUR) } }, { $set: { status: 'expired', resolvedAt: now } });
  return stats;
}

/** Weather flags for trips that start within the forecast window. Runs every 30 minutes. */
async function checkWeather(now = new Date()) {
  const trips = await Trip.find({
    statusOverride: { $ne: 'completed' },
    startDate: { $lte: new Date(now.getTime() + 14 * DAY) },
    endDate: { $gte: now },
  });
  for (const trip of trips) {
    try {
      await weatherService.flagTripItems(trip);
    } catch (err) {
      logger.warn('Weather job failed for trip', { tripId: String(trip._id), error: err.message });
    }
  }
  return { trips: trips.length };
}

/**
 * Live traffic check for the next stop of active trips nobody is tracking right now (the progress
 * engine covers tracked travellers). Only runs with a traffic-aware routing provider (TomTom);
 * refreshes the leg's travel time and warns members when traffic means leaving earlier.
 * Runs every 10 minutes.
 */
async function checkTraffic(now = new Date()) {
  if (!providers.routing.supportsTraffic()) return { skipped: 'routing provider has no traffic data' };
  const trips = await Trip.find({ status: 'active', statusOverride: { $ne: 'completed' } });
  const stats = { trips: trips.length, checked: 0, notified: 0 };
  for (const trip of trips) {
    if (await TrackingSession.exists({ tripId: trip._id, status: 'active' })) continue;
    const next = await ItineraryItem.findOne({
      tripId: trip._id,
      status: { $in: OPEN },
      coordinates: { $exists: true },
      scheduledStart: { $gte: now, $lte: new Date(now.getTime() + 3 * HOUR) },
    }).sort({ scheduledStart: 1 });
    if (!next) continue;
    const prev = await ItineraryItem.findOne({
      tripId: trip._id,
      day: next.day,
      coordinates: { $exists: true },
      scheduledEnd: { $lte: next.scheduledStart },
      status: { $nin: ['cancelled', 'skipped'] },
      _id: { $ne: next._id },
    }).sort({ scheduledEnd: -1 });
    if (!prev) continue;

    let r;
    try {
      r = await providers.routing.route([prev.coordinates, next.coordinates], next.transportMode || trip.transportMode);
    } catch (err) {
      logger.warn('Traffic check failed', { error: err.message });
      continue;
    }
    if (!r.trafficAware) continue; // e.g. walking legs, or the provider fell back to OSRM
    stats.checked += 1;
    const travelMin = Math.round(r.duration / 60);
    const trafficMin = Math.round((r.trafficDelay || 0) / 60);
    await ItineraryItem.updateOne(
      { _id: next._id },
      { $set: { estimatedTravelTime: travelMin, travelDistance: Math.round(r.distance), travelSource: r.source, trafficDelayMinutes: trafficMin, trafficKind: 'live' } }
    );
    const significant = trafficMin >= env.trafficDelayNotifyMinutes && (!r.noTrafficDuration || r.trafficDelay >= 0.15 * r.noTrafficDuration);
    if (!significant) continue;
    const leaveBy = new Date(next.scheduledStart.getTime() - travelMin * MINUTE);
    const results = await notificationService.notifyTripMembers(trip, {
      type: 'traffic_delay',
      severity: leaveBy < now ? 'warning' : 'info',
      title: `Traffic on the way to ${next.title}`,
      message: `Live traffic adds about ${trafficMin} min from "${prev.title}" (${r.source}). ${
        leaveBy < now
          ? `Leaving now, you would arrive about ${Math.round((now - leaveBy) / MINUTE)} min late.`
          : `Leave by ${localTimeOfDay(leaveBy, trip.timezone)} to arrive at ${localTimeOfDay(next.scheduledStart, trip.timezone)}.`
      }`,
      data: { itemId: String(next._id), trafficDelayMinutes: trafficMin, leaveBy },
      dedupKey: `traffic-plan:${next._id}:${Math.floor(trafficMin / 10)}`,
    });
    stats.notified += results.filter((x) => x.created).length;
    realtime.emitToTrip(trip._id, 'itinerary_updated', { action: 'traffic', itemId: String(next._id) });
  }
  return stats;
}

/** Stop tracking sessions that have not received a fix for 12 hours (e.g. a closed browser). */
async function closeStaleSessions(now = new Date()) {
  const res = await TrackingSession.updateMany(
    { status: { $in: ['active', 'paused'] }, updatedAt: { $lt: new Date(now.getTime() - 12 * HOUR) } },
    { $set: { status: 'stopped', stoppedAt: now } }
  );
  return { stopped: res.modifiedCount };
}

module.exports = { sweepSchedules, checkWeather, checkTraffic, closeStaleSessions };
