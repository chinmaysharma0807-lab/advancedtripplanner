import { io } from 'socket.io-client';

// One shared connection per signed-in session. The session cookie authenticates the handshake.
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_SOCKET_URL || '/', {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/** Emit with an acknowledgement, resolving to the server's { ok, data | error } reply. */
export function emitWithAck(event, payload, timeoutMs = 8000) {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(timeoutMs).emit(event, payload, (err, reply) => {
      if (err) resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The server did not respond in time' } });
      else resolve(reply);
    });
  });
}
