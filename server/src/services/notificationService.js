const { Notification, User } = require('../models');
const { NOTIFICATION_CATEGORIES } = require('../config/constants');
const realtime = require('../sockets/realtime');
const logger = require('../config/logger');
const { notFound } = require('../utils/errors');

const CATEGORY_BY_TYPE = Object.fromEntries(
  Object.entries(NOTIFICATION_CATEGORIES).flatMap(([cat, types]) => types.map((t) => [t, cat]))
);

function isEnabled(user, type) {
  const category = CATEGORY_BY_TYPE[type];
  const prefs = user?.notificationPreferences;
  if (!category || !prefs) return true;
  return prefs[category] !== false;
}

/**
 * Create a notification exactly once per (user, deduplicationKey).
 * Uses an atomic upsert, so concurrent producers cannot create duplicates; returns
 * `{ notification, created }`. Respects the user's per-category preferences.
 */
async function notify({ userId, tripId = null, type, title, message, severity = 'info', data = {}, dedupKey, user }) {
  const recipient = user || (await User.findById(userId).select('notificationPreferences'));
  if (!recipient) return { notification: null, created: false };
  if (!isEnabled(recipient, type)) return { notification: null, created: false, suppressed: true };

  const deduplicationKey = dedupKey || `${type}:${tripId || 'none'}:${title}`;
  try {
    const result = await Notification.findOneAndUpdate(
      { userId: recipient._id, deduplicationKey },
      {
        $setOnInsert: {
          userId: recipient._id,
          tripId,
          type,
          title,
          message,
          severity,
          data,
          deduplicationKey,
          readAt: null,
        },
      },
      { upsert: true, new: true, includeResultMetadata: true, setDefaultsOnInsert: true }
    );
    const created = !result.lastErrorObject?.updatedExisting;
    if (created) realtime.emitToUser(recipient._id, 'trip_notification', result.value.toObject());
    return { notification: result.value, created };
  } catch (err) {
    if (err?.code === 11000) {
      return { notification: await Notification.findOne({ userId: recipient._id, deduplicationKey }), created: false };
    }
    logger.error('Failed to create notification', { error: err.message, type });
    throw err;
  }
}

/** Notify every accepted member of a trip (optionally excluding the actor). */
async function notifyTripMembers(trip, payload, { excludeUserId, dedupKey } = {}) {
  const ids = [String(trip.ownerId), ...trip.participants.filter((p) => p.status === 'accepted').map((p) => String(p.userId))];
  const recipients = await User.find({ _id: { $in: ids.filter((id) => id !== String(excludeUserId || '')) } }).select(
    'notificationPreferences'
  );
  return Promise.all(
    recipients.map((user) =>
      notify({ ...payload, user, userId: user._id, tripId: trip._id, dedupKey: dedupKey || payload.dedupKey })
    )
  );
}

async function list(userId, { skip, limit }, { unread } = {}) {
  const filter = { userId, ...(unread ? { readAt: null } : {}) };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, readAt: null }),
  ]);
  return { items, total, unreadCount };
}

async function markRead(userId, id) {
  const n = await Notification.findOneAndUpdate(
    { _id: id, userId },
    [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
    { new: true }
  );
  if (!n) throw notFound('Notification');
  return n;
}

async function markAllRead(userId) {
  const res = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  return { updated: res.modifiedCount };
}

module.exports = { notify, notifyTripMembers, list, markRead, markAllRead, isEnabled };
