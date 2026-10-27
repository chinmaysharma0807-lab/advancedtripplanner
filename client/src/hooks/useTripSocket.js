import { useEffect, useRef, useState } from 'react';
import { getSocket, emitWithAck } from '../socket/socket';

/**
 * Join a trip's real-time room and subscribe to events. On every (re)connect the room is
 * re-joined and `onResync` runs, so the page reloads the persisted state it may have missed.
 */
export function useTripSocket(tripId, handlers, onResync) {
  const handlersRef = useRef(handlers);
  const resyncRef = useRef(onResync);
  handlersRef.current = handlers;
  resyncRef.current = onResync;
  const [connection, setConnection] = useState(() => (getSocket().connected ? 'connected' : 'connecting'));
  const [joinError, setJoinError] = useState(null);

  useEffect(() => {
    if (!tripId) return undefined;
    const socket = getSocket();
    let first = true;

    const join = async () => {
      setConnection('connected');
      const reply = await emitWithAck('join_trip', { tripId });
      setJoinError(reply?.ok ? null : reply?.error?.message || 'Could not join live updates');
      if (!first) resyncRef.current?.();
      first = false;
    };
    const onDisconnect = () => setConnection('disconnected');
    const onError = () => setConnection('disconnected');

    const events = Object.keys(handlersRef.current || {});
    const listeners = events.map((event) => {
      const fn = (payload) => {
        if (payload?.tripId && payload.tripId !== tripId) return;
        handlersRef.current[event]?.(payload);
      };
      socket.on(event, fn);
      return [event, fn];
    });

    socket.on('connect', join);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    if (socket.connected) join();
    else socket.connect();

    return () => {
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
      listeners.forEach(([event, fn]) => socket.off(event, fn));
      if (socket.connected) socket.emit('leave_trip', { tripId });
    };
    // Handler identity is tracked through refs; only the trip id re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  return { connection, joinError };
}
