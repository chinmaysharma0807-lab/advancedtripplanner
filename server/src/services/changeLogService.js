const { ItineraryChangeLog } = require('../models');

const SNAPSHOT_FIELDS = [
  'title',
  'day',
  'order',
  'status',
  'scheduledStart',
  'scheduledEnd',
  'estimatedTravelTime',
  'priority',
  'isFixedTime',
  'estimatedCost',
];

/** Small, comparable snapshot of the fields worth auditing. */
function snapshot(item, fields = SNAPSHOT_FIELDS) {
  if (!item) return null;
  const obj = typeof item.toObject === 'function' ? item.toObject() : item;
  return Object.fromEntries(fields.filter((f) => obj[f] !== undefined).map((f) => [f, obj[f]]));
}

/** Only the fields that changed between two snapshots. */
function diff(before, after) {
  const prev = {};
  const next = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[key];
    const b = after?.[key];
    const same = a instanceof Date || b instanceof Date ? String(new Date(a)) === String(new Date(b)) : JSON.stringify(a) === JSON.stringify(b);
    if (!same) {
      prev[key] = a ?? null;
      next[key] = b ?? null;
    }
  }
  return { prev, next, changed: Object.keys(next).length > 0 };
}

async function record({ tripId, item, itemId, itemTitle, changedBy = null, changeType, previousValues = null, newValues = null, reason = '', source = 'user' }) {
  return ItineraryChangeLog.create({
    tripId,
    itineraryItemId: item?._id || itemId || null,
    itemTitle: item?.title || itemTitle,
    changedBy: changedBy?._id || changedBy || null,
    changeType,
    previousValues,
    newValues,
    reason,
    source,
  });
}

async function list(tripId, { skip, limit }, { itemId } = {}) {
  const filter = { tripId, ...(itemId ? { itineraryItemId: itemId } : {}) };
  const [items, total] = await Promise.all([
    ItineraryChangeLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('changedBy', 'name').lean(),
    ItineraryChangeLog.countDocuments(filter),
  ]);
  return { items, total };
}

module.exports = { snapshot, diff, record, list };
