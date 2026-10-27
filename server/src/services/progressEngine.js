const { ItineraryItem } = require('../models');
const providers = require('./providers');
const itineraryService = require('./itineraryService');
const rescheduleService = require('./rescheduleService');
const notificationService = require('./notificationService');
const realtime = require('../sockets/realtime');
const logger = require('../config/logger');
const env = require('../config/env');
const { haversine, distanceToPolyline, polylineLength } = require('../utils/geo');
const { diffMinutes, MINUTE } = require('../utils/time');

/**
 * Event-driven itinerary progress engine. Called with every accepted location fix.
 *
 * Rules (all thresholds come from trip.trackingSettings):
 *   approaching  – within approachRadiusMeters or approachMinutes of the next stop
 *   arrival      – inside arrivalRadiusMeters: prompts the traveller; auto-starts the activity
 *                  only after autoStartDwellMinutes inside the geofence (0 disables)
 *   completion   – never from proximity alone; only by confirmation, or when the owner enabled
 *                  autoCompleteOnDeparture and the traveller leaves the geofence
 *   delay        – ETA later than scheduled start + delayGraceMinutes marks the stop delayed and,
 *                  past proposalThresholdMinutes, creates a reschedule proposal for approval
 *   deviation    – two consecutive fixes farther than deviationThresholdMeters from the leg route
 * Poor-accuracy fixes are stored but never trigger geofence decisions.
 */

const LOW_ACCURACY_METERS = 150;
const ROUTE_REFRESH_MS = 5 * 60 * 1000;
const ROUTE_REFRESH_DISTANCE_M = 1000;

async function processLocation({ trip, session, fix, user }) {
  const settings = trip.trackingSettings || {};
  const now = new Date(fix.timestamp);
  const lowAccuracy = Number.isFinite(fix.accuracy) && fix.accuracy > Math.max(LOW_ACCURACY_METERS, settings.arrivalRadiusMeters);
  const point = fix.coordinates;
  const events = [];

  const items = await ItineraryItem.find({ tripId: trip._id }).sort({ scheduledStart: 1 });
  const current = items.find((i) => i.status === 'in_progress') || null;
  const target =
    items.find(
      (i) => ['upcoming', 'approaching', 'delayed'].includes(i.status) && i.coordinates && new Date(i.scheduledEnd) > now
    ) || null;

  // 1. Leaving an in-progress activity.
  if (current?.coordinates && !lowAccuracy) {
    const away = haversine(point, current.coordinates);
    if (away > settings.arrivalRadiusMeters * 2) {
      if (settings.autoCompleteOnDeparture) {
        await itineraryService.setStatus(trip, current, 'completed', {
          source: 'rule',
          reason: `Left the area of "${current.title}" and auto-complete on departure is enabled for this trip.`,
        });
        events.push({ type: 'activity_completed', itemId: String(current._id) });
      } else {
        await notificationService.notify({
          userId: user._id,
          tripId: trip._id,
          type: 'completion_prompt',
          title: `Finished ${current.title}?`,
          message: `You seem to have left "${current.title}". Mark it as completed or keep it in progress.`,
          data: { itemId: String(current._id) },
          dedupKey: `completion-prompt:${current._id}`,
        });
        realtime.emitToUser(user._id, 'completion_prompt', { tripId: String(trip._id), itemId: String(current._id), title: current.title });
      }
    }
  }

  session.currentItemId = current && current.status === 'in_progress' ? current._id : null;

  if (!target) {
    session.targetItemId = null;
    session.progress = { updatedAt: now };
    return { target: null, current, progress: session.progress, events };
  }

  // 2. Leg bookkeeping and route-deviation check against the previous route.
  const newLeg = String(session.leg?.targetItemId || '') !== String(target._id);
  let forceReroute = false;
  if (!newLeg && session.leg?.geometry?.length > 1 && !lowAccuracy && session.leg.source !== 'straight-line-estimate') {
    const off = distanceToPolyline(point, session.leg.geometry).distance;
    const threshold = Math.max(settings.deviationThresholdMeters, (fix.accuracy || 0) * 2);
    if (off > threshold) {
      session.deviation.consecutive = (session.deviation.consecutive || 0) + 1;
      session.deviation.distanceMeters = Math.round(off);
      if (session.deviation.consecutive >= 2 && !session.deviation.isDeviating) {
        session.deviation.isDeviating = true;
        session.deviation.detectedAt = now;
        forceReroute = true;
        events.push({ type: 'route_deviation', distanceMeters: Math.round(off) });
        realtime.emitToTrip(trip._id, 'route_deviation_detected', {
          userId: String(user._id),
          itemId: String(target._id),
          distanceMeters: Math.round(off),
          at: now.toISOString(),
        });
        await notificationService.notify({
          userId: user._id,
          tripId: trip._id,
          type: 'route_deviation',
          severity: 'warning',
          title: 'You are off the planned route',
          message: `You are about ${Math.round(off)} m from the route to "${target.title}". The route and ETA were recalculated from your position.`,
          data: { itemId: String(target._id) },
          dedupKey: `deviation:${session._id}:${target._id}:${Math.floor(now.getTime() / (15 * MINUTE))}`,
        });
      }
    } else {
      if (session.deviation.isDeviating) events.push({ type: 'route_rejoined' });
      session.deviation.isDeviating = false;
      session.deviation.consecutive = 0;
      session.deviation.distanceMeters = Math.round(off);
    }
  }

  // 3. Route & ETA from the routing provider (refreshed on new legs, deviation, time or distance).
  const mode = target.transportMode || trip.transportMode;
  const stale =
    !session.leg?.computedAt ||
    now - new Date(session.leg.computedAt) > ROUTE_REFRESH_MS ||
    (session.leg.computedFrom && haversine(point, session.leg.computedFrom) > ROUTE_REFRESH_DISTANCE_M);
  let distanceRemaining;
  let durationRemaining;
  let trafficDelayRemaining = 0;
  if (newLeg || forceReroute || stale) {
    try {
      const r = await providers.routing.route([point, target.coordinates], mode);
      session.leg = {
        targetItemId: target._id,
        origin: newLeg ? point : session.leg.origin,
        initialDistance: newLeg ? r.distance : Math.max(session.leg.initialDistance || 0, r.distance),
        geometry: r.geometry,
        source: r.source,
        isDemo: r.isDemo,
        computedAt: now,
        computedFrom: point,
        routeDistance: r.distance,
        routeDuration: r.duration,
        isEstimate: r.isEstimate,
        trafficAware: Boolean(r.trafficAware),
        trafficKind: r.trafficKind || null,
        trafficDelay: r.trafficAware ? r.trafficDelay || 0 : 0,
        noTrafficDuration: r.noTrafficDuration ?? null,
      };
      if (newLeg) session.deviation = { isDeviating: false, consecutive: 0 };
      distanceRemaining = r.distance;
      durationRemaining = r.duration;
      trafficDelayRemaining = session.leg.trafficDelay;
    } catch (err) {
      logger.warn('Routing failed during tracking', { error: err.message });
    }
  }
  if (distanceRemaining === undefined && session.leg?.geometry?.length > 1) {
    // Project onto the cached route instead of calling the provider on every fix.
    const { along } = distanceToPolyline(point, session.leg.geometry);
    const geomLen = polylineLength(session.leg.geometry) || 1;
    const ratio = Math.max(0, geomLen - along) / geomLen;
    distanceRemaining = (session.leg.routeDistance ?? geomLen) * ratio;
    durationRemaining = (session.leg.routeDuration ?? 0) * ratio;
    trafficDelayRemaining = (session.leg.trafficDelay || 0) * ratio;
  }
  session.markModified('leg');

  const direct = haversine(point, target.coordinates);
  const inGeofence = !lowAccuracy && direct <= settings.arrivalRadiusMeters;
  if (inGeofence) {
    distanceRemaining = Math.min(distanceRemaining ?? direct, direct);
    durationRemaining = 0;
    trafficDelayRemaining = 0;
  }
  const hasEta = Number.isFinite(durationRemaining);
  const eta = hasEta ? new Date(now.getTime() + durationRemaining * 1000) : null;
  const initial = session.leg?.initialDistance || distanceRemaining || 0;
  const percent = initial > 0 && Number.isFinite(distanceRemaining) ? Math.max(0, Math.min(100, Math.round((1 - distanceRemaining / initial) * 100))) : 0;
  const delayMinutes = eta ? diffMinutes(eta, target.scheduledStart) : null;

  // 4. Arrival geofence and approach detection.
  if (inGeofence) {
    if (String(session.geofence?.itemId || '') !== String(target._id)) {
      session.geofence = { itemId: target._id, enteredAt: now };
      events.push({ type: 'arrival_detected', itemId: String(target._id) });
      realtime.emitToUser(user._id, 'arrival_detected', { tripId: String(trip._id), itemId: String(target._id), title: target.title });
      await notificationService.notify({
        userId: user._id,
        tripId: trip._id,
        type: 'arrival_detected',
        title: `Arrived at ${target.title}?`,
        message:
          settings.autoStartDwellMinutes > 0
            ? `Confirm to start "${target.title}". It will start automatically after ${settings.autoStartDwellMinutes} min here.`
            : `Confirm arrival to start "${target.title}".`,
        data: { itemId: String(target._id) },
        dedupKey: `arrival:${target._id}`,
      });
    }
    const dwell = (now - new Date(session.geofence.enteredAt)) / MINUTE;
    if (settings.autoStartDwellMinutes > 0 && dwell >= settings.autoStartDwellMinutes) {
      await itineraryService.setStatus(trip, target, 'in_progress', {
        source: 'rule',
        reason: `Inside the ${settings.arrivalRadiusMeters} m arrival zone for ${Math.round(dwell)} min.`,
      });
      events.push({ type: 'activity_started', itemId: String(target._id) });
    }
  } else {
    if (String(session.geofence?.itemId || '') === String(target._id) && direct > settings.arrivalRadiusMeters * 2) {
      session.geofence = { itemId: null, enteredAt: null };
    }
    const nearByDistance = !lowAccuracy && direct <= settings.approachRadiusMeters;
    const nearByTime = hasEta && durationRemaining <= settings.approachMinutes * 60;
    if ((nearByDistance || nearByTime) && ['upcoming', 'delayed'].includes(target.status)) {
      await itineraryService.setStatus(trip, target, 'approaching', {
        source: 'gps',
        reason: `About ${Math.round(direct)} m${hasEta ? ` / ${Math.max(1, Math.round(durationRemaining / 60))} min` : ''} away.`,
      });
      await notificationService.notify({
        userId: user._id,
        tripId: trip._id,
        type: 'activity_approaching',
        title: `Almost at ${target.title}`,
        message: hasEta ? `Expected arrival ${eta.toISOString()} (${session.leg?.source || 'routing'}).` : `About ${Math.round(direct)} m away.`,
        data: { itemId: String(target._id), eta },
        dedupKey: `approaching:${target._id}`,
      });
    }
  }

  // 5. Delay handling.
  if (eta && target.status !== 'in_progress') {
    target.eta = eta;
    await ItineraryItem.updateOne({ _id: target._id }, { $set: { eta } });
    const grace = settings.delayGraceMinutes ?? 10;
    if (delayMinutes > grace) {
      if (target.status === 'upcoming') {
        await itineraryService.setStatus(trip, target, 'delayed', {
          source: 'gps',
          reason: `Expected about ${delayMinutes} min after the planned start (${session.leg?.source || 'routing'} ETA).`,
        });
      }
      const last = session.lastNotifiedEta ? new Date(session.lastNotifiedEta) : null;
      if (!last || Math.abs(eta - last) >= 10 * MINUTE) {
        session.lastNotifiedEta = eta;
        await notificationService.notify({
          userId: user._id,
          tripId: trip._id,
          type: 'eta_changed',
          severity: 'warning',
          title: `ETA changed for ${target.title}`,
          message: `New estimated arrival is about ${delayMinutes} min after the planned start.${
            session.leg?.isEstimate
              ? ' (Straight-line estimate — routing unavailable.)'
              : session.leg?.trafficAware
                ? ` Includes live traffic (${session.leg.source}).`
                : ' Routing data does not include live traffic.'
          }`,
          data: { itemId: String(target._id), eta, delayMinutes },
          dedupKey: `eta:${target._id}:${Math.round(delayMinutes / 10)}`,
        });
      }
      if (delayMinutes >= (settings.proposalThresholdMinutes ?? 20)) {
        try {
          await rescheduleService.proposeForDelay(trip, target, eta, {
            source: 'gps',
            dataSource: session.leg?.source,
            isEstimate: Boolean(session.leg?.isEstimate),
            includesTraffic: Boolean(session.leg?.trafficAware),
          });
        } catch (err) {
          logger.warn('Could not create reschedule proposal', { error: err.message });
        }
      }
    }
  }

  // 6. Traffic delay — only from a provider that actually applied traffic to this route.
  if (session.leg?.trafficAware && target.status !== 'in_progress' && eta) {
    const trafficMin = Math.round(trafficDelayRemaining / 60);
    const free = session.leg.noTrafficDuration;
    const significant = trafficMin >= env.trafficDelayNotifyMinutes && (!free || trafficDelayRemaining >= 0.15 * free);
    if (significant) {
      const late = delayMinutes > (settings.delayGraceMinutes ?? 10);
      events.push({ type: 'traffic_delay', minutes: trafficMin });
      await notificationService.notify({
        userId: user._id,
        tripId: trip._id,
        type: 'traffic_delay',
        severity: late ? 'warning' : 'info',
        title: `Traffic on the way to ${target.title}`,
        message: `Traffic adds about ${trafficMin} min compared with empty roads (${session.leg.source} ${session.leg.trafficKind || 'live'} traffic). ${
          late ? `You are now expected about ${delayMinutes} min after the planned start.` : 'You should still arrive on time.'
        }`,
        data: { itemId: String(target._id), trafficDelayMinutes: trafficMin, eta },
        dedupKey: `traffic:${session._id}:${target._id}:${Math.floor(trafficMin / 10)}`,
      });
    }
  }

  session.targetItemId = target._id;
  session.progress = {
    distanceRemaining: Number.isFinite(distanceRemaining) ? Math.round(distanceRemaining) : null,
    durationRemaining: Number.isFinite(durationRemaining) ? Math.round(durationRemaining) : null,
    eta,
    percent,
    source: session.leg?.source || null,
    isEstimate: Boolean(session.leg?.isEstimate),
    isDemo: Boolean(session.leg?.isDemo),
    trafficAware: Boolean(session.leg?.trafficAware),
    trafficDelaySeconds: session.leg?.trafficAware ? Math.round(trafficDelayRemaining) : null,
    delayMinutes,
    updatedAt: now,
  };

  return { target, current, progress: session.progress, events };
}

module.exports = { processLocation, LOW_ACCURACY_METERS };
