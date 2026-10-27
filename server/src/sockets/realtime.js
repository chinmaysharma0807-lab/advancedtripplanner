// Thin indirection over the Socket.IO server so services can broadcast without importing
// the socket layer (and so tests can run services without a live io instance).
// Callers must persist state before emitting; clients re-fetch on reconnect.

let io = null;

const tripRoom = (tripId) => `trip:${tripId}`;
const userRoom = (userId) => `user:${userId}`;

function setIo(instance) {
  io = instance;
}

function getIo() {
  return io;
}

function emitToTrip(tripId, event, payload) {
  if (io) io.to(tripRoom(String(tripId))).emit(event, { tripId: String(tripId), ...payload });
}

function emitToUser(userId, event, payload) {
  if (io) io.to(userRoom(String(userId))).emit(event, payload);
}

/** Emit to a trip room but only to sockets whose user is in `allowedUserIds`. */
async function emitToTripUsers(tripId, allowedUserIds, event, payload) {
  if (!io) return;
  const allowed = new Set(allowedUserIds.map(String));
  const sockets = await io.in(tripRoom(String(tripId))).fetchSockets();
  for (const s of sockets) {
    if (allowed.has(String(s.data.userId))) s.emit(event, { tripId: String(tripId), ...payload });
  }
}

/** Remove every socket of a user from a trip room (e.g. after their access is revoked). */
function removeUserFromTrip(userId, tripId) {
  if (io) io.in(userRoom(String(userId))).socketsLeave(tripRoom(String(tripId)));
}

module.exports = { setIo, getIo, emitToTrip, emitToUser, emitToTripUsers, removeUserFromTrip, tripRoom, userRoom };
