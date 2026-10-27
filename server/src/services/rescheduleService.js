const mongoose = require('mongoose');
const { ItineraryItem, RescheduleProposal } = require('../models');
const { TERMINAL_ITEM_STATUSES } = require('../config/constants');
const providers = require('./providers');
const changeLog = require('./changeLogService');
const notificationService = require('./notificationService');
const itineraryService = require('./itineraryService');
const realtime = require('../sockets/realtime');
const logger = require('../config/logger');
const { notFound, conflict } = require('../utils/errors');
const { MINUTE, localTimeOfDay, hhmmToMinutes, diffMinutes } = require('../utils/time');

const t = (d) => new Date(d).getTime();

/**
 * Pure proposal builder.
 * Walks the day's remaining activities from `trigger`, starting at `expectedArrival`, and
 *   - shifts flexible activities later,
 *   - never moves fixed-time bookings (warns if they are at risk),
 *   - suggests skipping low/medium priority activities that would run past closing time,
 *     past the end of the planned day, or into a fixed booking.
 */
function buildProposal({ dayItems, trigger, expectedArrival, timezone = 'UTC' }) {
  const ordered = [...dayItems].sort((a, b) => t(a.scheduledStart) - t(b.scheduledStart));
  const startIndex = ordered.findIndex((i) => String(i._id) === String(trigger._id));
  const remaining = ordered.slice(startIndex).filter((i) => !TERMINAL_ITEM_STATUSES.includes(i.status) && i.status !== 'in_progress');
  const dayEndLimit = Math.max(...ordered.map((i) => t(i.scheduledEnd))) + 90 * MINUTE;
  const delayMinutes = Math.max(0, diffMinutes(expectedArrival, trigger.scheduledStart));

  const changes = [];
  const warnings = [];
  let cursor = t(expectedArrival);

  remaining.forEach((item, idx) => {
    const start = t(item.scheduledStart);
    const end = t(item.scheduledEnd);
    const duration = end - start;
    if (idx > 0) cursor += (item.estimatedTravelTime || 0) * MINUTE;

    if (item.isFixedTime) {
      if (cursor > start) {
        warnings.push(`"${item.title}" is a fixed-time booking and you may arrive about ${Math.round((cursor - start) / MINUTE)} min late. It was not moved.`);
      }
      changes.push({
        itemId: item._id,
        title: item.title,
        action: 'keep',
        previousStart: item.scheduledStart,
        previousEnd: item.scheduledEnd,
        proposedStart: item.scheduledStart,
        proposedEnd: item.scheduledEnd,
        reason: 'Fixed-time booking preserved',
      });
      cursor = Math.max(end, cursor + duration);
      return;
    }

    const newStart = Math.max(start, cursor);
    const newEnd = newStart + duration;
    if (newStart === start) {
      cursor = newEnd;
      return; // slack in the schedule absorbed the delay
    }

    const reasons = [];
    const hours = item.operatingHours;
    if (hours?.close && hhmmToMinutes(hours.close) > hhmmToMinutes(hours.open || '00:00')) {
      const endLocal = hhmmToMinutes(localTimeOfDay(new Date(newEnd), timezone));
      const startLocal = hhmmToMinutes(localTimeOfDay(new Date(newStart), timezone));
      if (endLocal > hhmmToMinutes(hours.close) || endLocal < startLocal) reasons.push(`it would end after closing time (${hours.close})`);
    }
    if (newEnd > dayEndLimit) reasons.push('it would run past the end of the planned day');
    const nextFixed = remaining.slice(idx + 1).find((i) => i.isFixedTime);
    if (nextFixed && newEnd + (nextFixed.estimatedTravelTime || 0) * MINUTE > t(nextFixed.scheduledStart)) {
      reasons.push(`it would make you late for the fixed booking "${nextFixed.title}"`);
    }

    const canSkip = !['must', 'high'].includes(item.priority);
    if (reasons.length && canSkip) {
      changes.push({
        itemId: item._id,
        title: item.title,
        action: 'skip',
        previousStart: item.scheduledStart,
        previousEnd: item.scheduledEnd,
        reason: `Suggested to skip because ${reasons.join(' and ')}.`,
      });
      cursor -= (item.estimatedTravelTime || 0) * MINUTE; // no detour to a skipped stop
      return;
    }
    if (reasons.length) warnings.push(`"${item.title}" is ${item.priority} priority, so it was kept even though ${reasons.join(' and ')}.`);
    changes.push({
      itemId: item._id,
      title: item.title,
      action: 'shift',
      previousStart: item.scheduledStart,
      previousEnd: item.scheduledEnd,
      proposedStart: new Date(newStart),
      proposedEnd: new Date(newEnd),
      reason: `Starts ${Math.round((newStart - start) / MINUTE)} min later because of the delay.`,
    });
    cursor = newEnd;
  });

  const shifted = changes.filter((c) => c.action === 'shift').length;
  const skipped = changes.filter((c) => c.action === 'skip').length;
  return { delayMinutes, changes, warnings, shifted, skipped };
}

function explain({ trigger, delayMinutes, shifted, skipped, source, dataSource, isEstimate, includesTraffic }) {
  const basis = {
    gps: `your live location and ${dataSource || 'routing'} travel times${isEstimate ? ' (straight-line estimate — routing unavailable)' : includesTraffic ? ' including live traffic' : ''}`,
    user: 'the delay you reported',
    routing: `updated ${dataSource || 'routing'} travel times`,
    system: 'the current time versus the schedule',
  }[source];
  const parts = [`You are expected at "${trigger.title}" about ${delayMinutes} min after its planned start, based on ${basis}.`];
  if (shifted) parts.push(`${shifted} ${shifted === 1 ? 'activity moves' : 'activities move'} later.`);
  if (skipped) parts.push(`${skipped} ${skipped === 1 ? 'activity is' : 'activities are'} suggested to skip so the rest of the day still fits.`);
  parts.push('Fixed-time bookings are never moved automatically. Nothing changes until you approve.');
  return parts.join(' ');
}

async function attachAlternatives(proposal, items) {
  try {
    const byId = Object.fromEntries(items.map((i) => [String(i._id), i]));
    let touched = false;
    for (const change of proposal.changes) {
      const item = byId[String(change.itemId)];
      if (change.action !== 'skip' || !item?.coordinates) continue;
      const found = await providers.places.nearby(item.coordinates, item.isOutdoor ? 'indoor' : 'attractions', 1200);
      change.alternatives = found.slice(0, 3).map((p) => ({
        name: p.name,
        kind: p.kind,
        coordinates: p.coordinates,
        distance: p.distance,
        openingHours: p.openingHours,
        source: p.source,
        isDemo: p.isDemo,
      }));
      touched = true;
    }
    if (touched) {
      proposal.markModified('changes');
      await proposal.save();
      realtime.emitToTrip(proposal.tripId, 'reschedule_proposed', { proposalId: String(proposal._id), updated: true });
    }
  } catch (err) {
    logger.warn('Could not load alternatives for a reschedule proposal', { error: err.message });
  }
}

/**
 * Create (or reuse) a pending proposal for a delay at `trigger`. A pending proposal for the same
 * day with a similar delay is reused so travellers are not flooded with near-identical prompts.
 */
async function proposeForDelay(trip, trigger, expectedArrival, { source = 'system', dataSource, isEstimate = false, includesTraffic = false, actor = null } = {}) {
  const dayItems = await ItineraryItem.find({ tripId: trip._id, day: trigger.day }).lean();
  const built = buildProposal({ dayItems, trigger, expectedArrival, timezone: trip.timezone });
  if (built.delayMinutes <= 0) return null;

  const pending = await RescheduleProposal.findOne({ tripId: trip._id, day: trigger.day, status: 'pending' });
  if (pending && Math.abs(pending.delayMinutes - built.delayMinutes) < 10 && String(pending.triggerItemId) === String(trigger._id)) {
    return pending;
  }
  if (!built.changes.some((c) => c.action !== 'keep') && !built.warnings.length) return null;
  if (pending) {
    pending.status = 'expired';
    pending.resolvedAt = new Date();
    await pending.save();
  }

  const proposal = await RescheduleProposal.create({
    tripId: trip._id,
    day: trigger.day,
    triggerItemId: trigger._id,
    delayMinutes: built.delayMinutes,
    source,
    dataSource,
    isEstimate,
    includesTraffic,
    explanation: explain({ trigger, ...built, source, dataSource, isEstimate, includesTraffic }),
    changes: built.changes,
    warnings: built.warnings,
    createdBy: actor?._id || null,
  });
  await changeLog.record({
    tripId: trip._id,
    item: trigger,
    changedBy: actor,
    changeType: 'proposal_created',
    newValues: { proposalId: String(proposal._id), delayMinutes: built.delayMinutes, shifted: built.shifted, skipped: built.skipped },
    reason: proposal.explanation,
    source: source === 'gps' ? 'gps' : source === 'user' ? 'user' : 'system',
  });
  realtime.emitToTrip(trip._id, 'reschedule_proposed', { proposalId: String(proposal._id), delayMinutes: built.delayMinutes, day: trigger.day });
  await notificationService.notifyTripMembers(trip, {
    type: 'reschedule_proposed',
    severity: 'warning',
    title: `Running about ${built.delayMinutes} min late`,
    message: proposal.explanation,
    data: { proposalId: String(proposal._id), day: trigger.day },
    dedupKey: `proposal:${proposal._id}`,
  });
  attachAlternatives(proposal, dayItems); // best effort, does not block the caller
  return proposal;
}

/** A traveller reports a delay manually (works without GPS). */
async function reportDelay(trip, actor, { minutes, itemId }) {
  const now = new Date();
  let trigger;
  if (itemId) {
    trigger = await itineraryService.getItemForTrip(itemId, trip._id);
  } else {
    trigger = await ItineraryItem.findOne({
      tripId: trip._id,
      status: { $in: ['upcoming', 'approaching', 'delayed'] },
      scheduledEnd: { $gt: now },
    }).sort({ scheduledStart: 1 });
  }
  if (!trigger) throw notFound('Upcoming activity');
  const base = Math.max(now.getTime(), t(trigger.scheduledStart));
  const expected = new Date(base + minutes * MINUTE);
  const proposal = await proposeForDelay(trip, trigger, expected, { source: 'user', actor });
  return proposal;
}

async function listProposals(trip, { status } = {}) {
  return RescheduleProposal.find({ tripId: trip._id, ...(status ? { status } : {}) }).sort({ createdAt: -1 }).limit(20).lean();
}

async function getProposal(trip, proposalId) {
  if (!mongoose.isValidObjectId(proposalId)) throw notFound('Proposal');
  const p = await RescheduleProposal.findOne({ _id: proposalId, tripId: trip._id });
  if (!p) throw notFound('Proposal');
  return p;
}

async function applyProposal(trip, actor, proposalId, { excludeItemIds = [] } = {}) {
  const proposal = await getProposal(trip, proposalId);
  if (proposal.status !== 'pending') throw conflict(`This proposal is already ${proposal.status}`);
  const excluded = new Set(excludeItemIds.map(String));
  const applied = [];
  for (const change of proposal.changes) {
    if (change.action === 'keep' || excluded.has(String(change.itemId))) continue;
    const item = await ItineraryItem.findOne({ _id: change.itemId, tripId: trip._id });
    if (!item || TERMINAL_ITEM_STATUSES.includes(item.status)) continue;
    if (change.action === 'skip') {
      await itineraryService.setStatus(trip, item, 'skipped', { actor, source: 'user', reason: change.reason });
    } else {
      const before = { scheduledStart: item.scheduledStart, scheduledEnd: item.scheduledEnd };
      item.scheduledStart = change.proposedStart;
      item.scheduledEnd = change.proposedEnd;
      item.lastModifiedBy = actor._id;
      await item.save();
      await changeLog.record({
        tripId: trip._id,
        item,
        changedBy: actor,
        changeType: 'rescheduled',
        previousValues: before,
        newValues: { scheduledStart: item.scheduledStart, scheduledEnd: item.scheduledEnd },
        reason: `${change.reason} ${proposal.explanation}`.trim(),
        source: proposal.source === 'gps' ? 'gps' : proposal.source === 'user' ? 'user' : 'system',
      });
    }
    applied.push(String(change.itemId));
  }
  proposal.status = 'applied';
  proposal.resolvedBy = actor._id;
  proposal.resolvedAt = new Date();
  await proposal.save();
  await changeLog.record({
    tripId: trip._id,
    changedBy: actor,
    changeType: 'proposal_applied',
    newValues: { proposalId: String(proposal._id), applied: applied.length },
    reason: proposal.explanation,
  });
  itineraryService.broadcast(trip, actor, { action: 'rescheduled', day: proposal.day, proposalId: String(proposal._id) });
  await notificationService.notifyTripMembers(
    trip,
    {
      type: 'collaborator_change',
      title: `Schedule updated for day ${proposal.day}`,
      message: `${actor.name} approved a revised schedule (${applied.length} change${applied.length === 1 ? '' : 's'}).`,
      dedupKey: `proposal-applied:${proposal._id}`,
    },
    { excludeUserId: actor._id }
  );
  return proposal;
}

async function rejectProposal(trip, actor, proposalId) {
  const proposal = await getProposal(trip, proposalId);
  if (proposal.status !== 'pending') throw conflict(`This proposal is already ${proposal.status}`);
  proposal.status = 'rejected';
  proposal.resolvedBy = actor._id;
  proposal.resolvedAt = new Date();
  await proposal.save();
  await changeLog.record({ tripId: trip._id, changedBy: actor, changeType: 'proposal_rejected', newValues: { proposalId: String(proposal._id) } });
  realtime.emitToTrip(trip._id, 'reschedule_resolved', { proposalId: String(proposal._id), status: 'rejected' });
  return proposal;
}

module.exports = { buildProposal, proposeForDelay, reportDelay, listProposals, applyProposal, rejectProposal };
