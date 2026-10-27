const mongoose = require('mongoose');
const { ItineraryItem } = require('../models');
const { TERMINAL_ITEM_STATUSES } = require('../config/constants');
const providers = require('./providers');
const changeLog = require('./changeLogService');
const notificationService = require('./notificationService');
const { analyzeSchedule, findOverlaps, reflow } = require('./scheduleService');
const realtime = require('../sockets/realtime');
const logger = require('../config/logger');
const { notFound, conflict, badRequest } = require('../utils/errors');
const { tripDayFor } = require('../utils/time');

const sortItems = (a, b) => a.day - b.day || a.order - b.order || new Date(a.scheduledStart) - new Date(b.scheduledStart);

async function getItemForTrip(itemId, tripId) {
  if (!mongoose.isValidObjectId(itemId)) throw notFound('Itinerary item');
  const item = await ItineraryItem.findOne({ _id: itemId, tripId });
  if (!item) throw notFound('Itinerary item');
  return item;
}

async function listItems(trip, { day } = {}) {
  const filter = { tripId: trip._id, ...(day ? { day } : {}) };
  const items = (await ItineraryItem.find(filter).lean()).sort(sortItems);
  return { items, warnings: analyzeSchedule(items, { timezone: trip.timezone }) };
}

function broadcast(trip, actor, payload) {
  realtime.emitToTrip(trip._id, 'itinerary_updated', {
    ...payload,
    changedBy: actor ? { id: String(actor._id), name: actor.name } : { id: null, name: 'TripSync' },
    at: new Date().toISOString(),
  });
}

async function notifyCollaborators(trip, actor, message, dedupKey) {
  if (!actor) return;
  await notificationService.notifyTripMembers(
    trip,
    { type: 'collaborator_change', title: `Itinerary updated: ${trip.name}`, message, dedupKey },
    { excludeUserId: actor._id }
  );
}

/**
 * Recompute estimated travel time/distance between consecutive stops of a day with the
 * routing provider. Items without coordinates get null travel data rather than a guess.
 */
async function recalculateDay(trip, day) {
  const items = (await ItineraryItem.find({ tripId: trip._id, day })).sort(sortItems);
  const notes = new Set();
  const sources = new Set();
  let prev = null;
  const updates = [];
  for (const item of items) {
    if (['cancelled', 'skipped'].includes(item.status)) continue;
    if (!item.coordinates) {
      updates.push({ item, travel: null, distance: null, source: null, traffic: null });
      continue;
    }
    if (!prev) {
      updates.push({ item, travel: null, distance: null, source: null, traffic: null });
    } else {
      try {
        const mode = item.transportMode || trip.transportMode;
        // Leaving when the previous stop ends lets traffic-aware providers predict that hour's traffic.
        const r = await providers.routing.route([prev.coordinates, item.coordinates], mode, { departAt: prev.scheduledEnd });
        updates.push({
          item,
          travel: Math.round(r.duration / 60),
          distance: Math.round(r.distance),
          source: r.source,
          traffic: r.trafficAware ? { minutes: Math.round((r.trafficDelay || 0) / 60), kind: r.trafficKind } : null,
        });
        sources.add(r.source);
        if (r.note) notes.add(r.note);
      } catch (err) {
        logger.warn('Travel time recalculation failed', { error: err.message });
        notes.add(`Travel time unavailable: ${err.message}`);
        updates.push({ item, travel: null, distance: null, source: null, traffic: null });
      }
    }
    prev = item;
  }
  await Promise.all(
    updates.map(({ item, travel, distance, source, traffic }) =>
      ItineraryItem.updateOne(
        { _id: item._id },
        { $set: { estimatedTravelTime: travel, travelDistance: distance, travelSource: source, trafficDelayMinutes: traffic?.minutes ?? null, trafficKind: traffic?.kind ?? null } }
      )
    )
  );
  return { sources: [...sources], notes: [...notes] };
}

async function nextOrder(tripId, day, scheduledStart) {
  const sameDay = await ItineraryItem.find({ tripId, day }).select('order scheduledStart').lean();
  const before = sameDay.filter((i) => new Date(i.scheduledStart) <= new Date(scheduledStart)).length;
  await ItineraryItem.updateMany({ tripId, day, order: { $gte: before } }, { $inc: { order: 1 } });
  return before;
}

async function assertNoConflicts(trip, candidate, confirmConflict) {
  const others = await ItineraryItem.find({ tripId: trip._id }).select('title scheduledStart scheduledEnd status').lean();
  const clashes = findOverlaps(candidate, others);
  if (clashes.length && !confirmConflict) {
    throw conflict(
      'This activity overlaps other scheduled activities. Confirm to keep both.',
      { conflicts: clashes.map((c) => ({ id: c._id, title: c.title, scheduledStart: c.scheduledStart, scheduledEnd: c.scheduledEnd })) },
      'SCHEDULE_CONFLICT'
    );
  }
  return clashes.length > 0;
}

async function createItem(trip, actor, data, { source = 'user' } = {}) {
  const { confirmConflict, ...fields } = data;
  const day = fields.day || tripDayFor(trip, fields.scheduledStart);
  const hasConflict = await assertNoConflicts(trip, fields, confirmConflict);
  const order = await nextOrder(trip._id, day, fields.scheduledStart);
  const item = await ItineraryItem.create({
    transportMode: trip.transportMode,
    costCurrency: trip.currency,
    ...fields,
    coordinates: fields.coordinates || undefined,
    operatingHours: fields.operatingHours || undefined,
    tripId: trip._id,
    day,
    order,
    conflictAcknowledged: hasConflict,
    lastModifiedBy: actor?._id,
  });
  const routing = await recalculateDay(trip, day);
  await changeLog.record({ tripId: trip._id, item, changedBy: actor, changeType: 'created', newValues: changeLog.snapshot(item), source });
  broadcast(trip, actor, { action: 'created', itemId: String(item._id), day });
  await notifyCollaborators(trip, actor, `${actor?.name || 'Someone'} added "${item.title}" on day ${day}.`, `item-created:${item._id}`);
  return { item: await ItineraryItem.findById(item._id).lean(), routing };
}

async function bulkCreate(trip, actor, { items, replaceExisting }) {
  if (replaceExisting) {
    await ItineraryItem.deleteMany({ tripId: trip._id, status: { $nin: ['completed', 'in_progress'] } });
  }
  const existing = await ItineraryItem.find({ tripId: trip._id }).select('day order').lean();
  const maxOrder = {};
  for (const e of existing) maxOrder[e.day] = Math.max(maxOrder[e.day] ?? -1, e.order);
  const sorted = [...items].sort((a, b) => a.day - b.day || new Date(a.scheduledStart) - new Date(b.scheduledStart));
  const docs = sorted.map((i) => {
    maxOrder[i.day] = (maxOrder[i.day] ?? -1) + 1;
    return {
      transportMode: trip.transportMode,
      costCurrency: trip.currency,
      ...i,
      coordinates: i.coordinates || undefined,
      operatingHours: i.operatingHours || undefined,
      tripId: trip._id,
      order: maxOrder[i.day],
      lastModifiedBy: actor._id,
    };
  });
  const created = await ItineraryItem.insertMany(docs);
  const days = [...new Set(created.map((c) => c.day))];
  for (const day of days) await recalculateDay(trip, day);
  await changeLog.record({
    tripId: trip._id,
    changedBy: actor,
    changeType: 'generated',
    newValues: { count: created.length, days },
    reason: replaceExisting ? 'Replaced the itinerary with a generated draft' : 'Added a generated itinerary draft',
    source: created.some((c) => c.generatedBy === 'ai') ? 'ai' : 'user',
  });
  broadcast(trip, actor, { action: 'bulk_created', days });
  return listItems(trip);
}

async function updateItem(trip, actor, item, patch, { source = 'user' } = {}) {
  const { confirmConflict, ...fields } = patch;
  const before = changeLog.snapshot(item);
  const timesChanged = fields.scheduledStart || fields.scheduledEnd;

  item.set({ ...fields, lastModifiedBy: actor?._id });
  if (fields.coordinates === null) item.coordinates = undefined;
  if (fields.operatingHours === null) item.operatingHours = undefined;
  if (timesChanged) {
    const hasConflict = await assertNoConflicts(trip, item, confirmConflict);
    item.conflictAcknowledged = hasConflict;
    if (!fields.day) item.day = tripDayFor(trip, item.scheduledStart);
  }
  const previousDay = before.day;
  await item.save();
  if (fields.coordinates !== undefined || fields.transportMode || item.day !== previousDay || timesChanged) {
    await recalculateDay(trip, item.day);
    if (item.day !== previousDay) await recalculateDay(trip, previousDay);
  }
  const { prev, next, changed } = changeLog.diff(before, changeLog.snapshot(item));
  if (changed) {
    await changeLog.record({
      tripId: trip._id,
      item,
      changedBy: actor,
      changeType: timesChanged ? 'rescheduled' : 'updated',
      previousValues: prev,
      newValues: next,
      source,
    });
  }
  broadcast(trip, actor, { action: 'updated', itemId: String(item._id), day: item.day });
  await notifyCollaborators(trip, actor, `${actor?.name || 'Someone'} updated "${item.title}".`, `item-updated:${item._id}:${item.updatedAt.getTime()}`);
  return ItineraryItem.findById(item._id).lean();
}

async function deleteItem(trip, actor, item) {
  await ItineraryItem.deleteOne({ _id: item._id });
  const rest = (await ItineraryItem.find({ tripId: trip._id, day: item.day })).sort(sortItems);
  await Promise.all(rest.map((r, i) => (r.order === i ? null : ItineraryItem.updateOne({ _id: r._id }, { $set: { order: i } }))));
  await recalculateDay(trip, item.day);
  await changeLog.record({ tripId: trip._id, item, changedBy: actor, changeType: 'deleted', previousValues: changeLog.snapshot(item) });
  broadcast(trip, actor, { action: 'deleted', itemId: String(item._id), day: item.day });
  await notifyCollaborators(trip, actor, `${actor.name} removed "${item.title}".`, `item-deleted:${item._id}`);
}

async function reorderDay(trip, actor, { day, orderedIds, reflow: shouldReflow }) {
  const items = await ItineraryItem.find({ tripId: trip._id, day });
  const ids = new Set(items.map((i) => String(i._id)));
  if (orderedIds.length !== ids.size || !orderedIds.every((id) => ids.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
    throw badRequest('orderedIds must list every item of the day exactly once');
  }
  const byId = Object.fromEntries(items.map((i) => [String(i._id), i]));
  const previousOrder = [...items].sort(sortItems).map((i) => String(i._id));
  await Promise.all(orderedIds.map((id, index) => ItineraryItem.updateOne({ _id: id }, { $set: { order: index } })));
  const routing = await recalculateDay(trip, day);

  if (shouldReflow) {
    const fresh = await ItineraryItem.find({ tripId: trip._id, day });
    const freshById = Object.fromEntries(fresh.map((i) => [String(i._id), i]));
    const plan = reflow(orderedIds.map((id) => freshById[id]));
    await Promise.all(
      plan
        .filter((p) => String(p.scheduledStart) !== String(p.item.scheduledStart))
        .map((p) =>
          ItineraryItem.updateOne(
            { _id: p.item._id },
            { $set: { scheduledStart: p.scheduledStart, scheduledEnd: p.scheduledEnd, lastModifiedBy: actor._id } }
          )
        )
    );
  }

  await changeLog.record({
    tripId: trip._id,
    changedBy: actor,
    changeType: 'reordered',
    previousValues: { day, order: previousOrder.map((id) => byId[id].title) },
    newValues: { day, order: orderedIds.map((id) => byId[id].title), reflowed: shouldReflow },
    reason: shouldReflow ? 'Activities re-timed to follow the new order; fixed-time bookings unchanged' : '',
  });
  broadcast(trip, actor, { action: 'reordered', day });
  await notifyCollaborators(trip, actor, `${actor.name} reordered day ${day}.`, `reorder:${trip._id}:${day}:${Date.now()}`);
  return { ...(await listItems(trip, { day })), routing };
}

async function recalculate(trip, actor, { day } = {}) {
  const days = day ? [day] : await ItineraryItem.distinct('day', { tripId: trip._id });
  const results = [];
  for (const d of days) results.push(await recalculateDay(trip, d));
  await changeLog.record({
    tripId: trip._id,
    changedBy: actor,
    changeType: 'recalculated',
    newValues: { days, sources: [...new Set(results.flatMap((r) => r.sources))] },
    source: 'routing',
  });
  broadcast(trip, actor, { action: 'recalculated', days });
  return {
    ...(await listItems(trip, day ? { day } : {})),
    routing: { sources: [...new Set(results.flatMap((r) => r.sources))], notes: [...new Set(results.flatMap((r) => r.notes))] },
  };
}

/**
 * Change an activity's status. Shared by the REST API, Socket.IO handlers and the progress
 * engine so every path persists, logs and broadcasts the same way.
 */
async function setStatus(trip, item, status, { actor = null, source = 'user', reason = '' } = {}) {
  if (item.status === status) return item;
  const previous = item.status;
  const now = new Date();
  item.status = status;
  item.statusSource = source;
  if (status === 'in_progress' && !item.actualStart) item.actualStart = now;
  if (status === 'completed') {
    item.actualEnd = now;
    if (!item.actualStart) item.actualStart = item.scheduledStart < now ? item.scheduledStart : now;
  }
  if (status === 'upcoming') {
    item.actualStart = undefined;
    item.actualEnd = undefined;
  }
  if (actor) item.lastModifiedBy = actor._id;
  await item.save();

  await changeLog.record({
    tripId: trip._id,
    item,
    changedBy: actor,
    changeType: 'status_changed',
    previousValues: { status: previous },
    newValues: { status },
    reason,
    source,
  });
  realtime.emitToTrip(trip._id, 'activity_status_changed', {
    itemId: String(item._id),
    title: item.title,
    previousStatus: previous,
    status,
    source,
    reason,
    changedBy: actor ? { id: String(actor._id), name: actor.name } : null,
    at: now.toISOString(),
  });
  if (source !== 'user' || actor) {
    await notificationService.notifyTripMembers(
      trip,
      {
        type: 'activity_status',
        title: `${item.title}: ${status.replace('_', ' ')}`,
        message: reason || `${actor?.name || 'TripSync'} marked "${item.title}" as ${status.replace('_', ' ')}.`,
        data: { itemId: String(item._id), status },
        dedupKey: `status:${item._id}:${status}`,
      },
      { excludeUserId: actor?._id }
    );
  }
  return item;
}

const isOpen = (item) => !TERMINAL_ITEM_STATUSES.includes(item.status);

module.exports = {
  sortItems,
  getItemForTrip,
  listItems,
  recalculateDay,
  createItem,
  bulkCreate,
  updateItem,
  deleteItem,
  reorderDay,
  recalculate,
  setStatus,
  isOpen,
  broadcast,
};
