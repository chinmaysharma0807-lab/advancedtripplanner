const { Server } = require('socket.io');
const cookie = require('cookie');
const env = require('../config/env');
const logger = require('../config/logger');
const realtime = require('./realtime');
const { userFromToken } = require('../middleware/auth');
const { requireTripAccess, memberIds } = require('../services/accessService');
const itineraryService = require('../services/itineraryService');
const trackingService = require('../services/trackingService');
const notificationService = require('../services/notificationService');
const { z, objectId } = require('../validators/common');
const { locationUpdate } = require('../validators/trackingValidators');
const { ITEM_STATUSES } = require('../config/constants');
const { User } = require('../models');

const schemas = {
  join_trip: z.object({ tripId: objectId }),
  leave_trip: z.object({ tripId: objectId }),
  location_update: locationUpdate.extend({ tripId: objectId }),
  activity_status_update: z.object({ tripId: objectId, itemId: objectId, status: z.enum(ITEM_STATUSES), reason: z.string().max(500).optional() }),
  itinerary_change_request: z.object({ tripId: objectId, itemId: objectId.optional(), message: z.string().trim().min(1).max(1000) }),
};

const errorPayload = (err) => ({
  ok: false,
  error: { code: err.code || 'ERROR', message: err.status && err.status < 500 ? err.message : 'Something went wrong' },
});

/**
 * Wrap an event handler: validate the payload, re-check authorization on every event (roles can
 * change while a socket stays connected) and always answer through the ack callback.
 */
function handler(socket, event, fn) {
  socket.on(event, async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const parsed = schemas[event].safeParse(payload ?? {});
    if (!parsed.success) {
      reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.issues.map((i) => i.message) } });
      return;
    }
    try {
      reply({ ok: true, data: await fn(parsed.data) });
    } catch (err) {
      if (!err.status || err.status >= 500) logger.error('Socket handler error', { event, error: err.message });
      reply(errorPayload(err));
    }
  });
}

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientUrls, credentials: true },
    // Browsers do not apply CORS to WebSocket upgrades, so check Origin explicitly.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      let sameOrigin = false;
      try {
        sameOrigin = Boolean(origin) && new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
      cb(null, !origin || sameOrigin || env.clientUrls.includes(origin));
    },
    pingInterval: 20000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const user = await userFromToken(cookies[env.cookieName]);
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      socket.data.userName = user.name;
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(realtime.userRoom(socket.data.userId));
    const currentUser = () => User.findById(socket.data.userId);
    let lastLocationAt = 0;

    handler(socket, 'join_trip', async ({ tripId }) => {
      const { trip, role } = await requireTripAccess(tripId, await currentUser());
      socket.join(realtime.tripRoom(tripId));
      socket.to(realtime.tripRoom(tripId)).emit('participant_online', { tripId, userId: socket.data.userId, name: socket.data.userName });
      return { tripId, role, members: memberIds(trip).length };
    });

    handler(socket, 'leave_trip', async ({ tripId }) => {
      socket.leave(realtime.tripRoom(tripId));
      return { tripId };
    });

    handler(socket, 'location_update', async ({ tripId, ...fix }) => {
      const now = Date.now();
      if (now - lastLocationAt < 1000) {
        const err = new Error('Location updates are limited to one per second');
        err.status = 429;
        err.code = 'RATE_LIMITED';
        throw err;
      }
      lastLocationAt = now;
      const user = await currentUser();
      const { trip } = await requireTripAccess(tripId, user, 'editor');
      const result = await trackingService.recordLocation(trip, user, fix);
      return { session: result.session, events: result.events };
    });

    handler(socket, 'activity_status_update', async ({ tripId, itemId, status, reason }) => {
      const user = await currentUser();
      const { trip } = await requireTripAccess(tripId, user, 'editor');
      const item = await itineraryService.getItemForTrip(itemId, trip._id);
      const saved = await itineraryService.setStatus(trip, item, status, { actor: user, source: 'user', reason: reason || '' });
      return { itemId, status: saved.status };
    });

    handler(socket, 'itinerary_change_request', async ({ tripId, itemId, message }) => {
      const user = await currentUser();
      const { trip } = await requireTripAccess(tripId, user, 'viewer');
      const editors = [String(trip.ownerId), ...trip.participants.filter((p) => p.status === 'accepted' && p.role === 'editor').map((p) => String(p.userId))];
      const at = new Date();
      await Promise.all(
        editors
          .filter((uid) => uid !== String(user._id))
          .map((uid) =>
            notificationService.notify({
              userId: uid,
              tripId: trip._id,
              type: 'change_request',
              title: `${user.name} requested a change`,
              message,
              data: { itemId, fromUserId: String(user._id) },
              dedupKey: `change-request:${trip._id}:${user._id}:${at.getTime()}`,
            })
          )
      );
      await realtime.emitToTripUsers(trip._id, editors, 'itinerary_change_requested', { itemId, message, from: { id: String(user._id), name: user.name }, at });
      return { delivered: editors.length };
    });
  });

  realtime.setIo(io);
  return io;
}

module.exports = { createSocketServer };
